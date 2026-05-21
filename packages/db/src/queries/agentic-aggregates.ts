/**
 * Per-id aggregate stats for the "Aggregates across configs" view on the
 * agentic detail page. Each id contributes one summary number per metric per
 * percentile so the frontend can plot how each metric varies across the
 * SKU's parallelism + concurrency configs.
 *
 * Sources:
 *  - `profile_export.jsonl` → ISL / OSL per request (filtered to profiling phase)
 *  - `server_metrics_json` → time-series of KV cache utilization +
 *     prefix-cache hit rate per scrape interval
 *
 * Returns mean/p50/p75/p90/p99 per metric. Nulls when the blob is missing
 * or has no usable samples — frontend treats those as "no data".
 */

import { Readable } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';

import { chain } from 'stream-chain';

import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamObject } from 'stream-json/streamers/stream-object.js';

import type { DbClient } from '../connection.js';

/**
 * Bump when the aggregate-stats computation algorithm changes — the backfill
 * script recomputes any row whose stored `aggregate_stats.version` is older.
 * Lives here (rather than in compute-aggregate-stats.ts) to avoid a circular
 * import: the compute helper depends on the percentile utilities below.
 */
export const STATS_VERSION = 1;

export interface MetricPercentiles {
  mean: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
  /** Sample count used to compute the percentiles. */
  n: number;
}

export interface AgenticAggregate {
  id: number;
  isl: MetricPercentiles | null;
  osl: MetricPercentiles | null;
  kvCacheUtil: MetricPercentiles | null;
  prefixCacheHitRate: MetricPercentiles | null;
}

export type AgenticAggregateMap = Record<number, AgenticAggregate>;

/**
 * `profile_export_jsonl_gz` is small (~1-3 MB) so we can batch many per
 * round-trip. `server_metrics_json_gz` is much bigger (~17 MB compressed
 * for high-conc TP+EP runs; Neon encodes bytea over HTTP at ~1.6× wire
 * size, so two of those = ~50 MB and three already trips the 64 MB cap).
 * We fetch the two blob types in separate queries with different chunk
 * sizes.
 */
const PROFILE_CHUNK_SIZE = 8;
const SERVER_CHUNK_SIZE = 1;

/** Linear-interpolated percentile (matches numpy default). */
function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

function meanOf(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Compute the percentile bundle for an array of samples; null if empty. */
export function percentilesOf(samples: number[]): MetricPercentiles | null {
  const clean = samples.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  const sorted = [...clean].toSorted((a, b) => a - b);
  return {
    mean: meanOf(sorted),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    p99: quantile(sorted, 0.99),
    n: sorted.length,
  };
}

/** Pull a numeric metric out of the {value, unit} envelope (or a bare number). */
function readNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as { value?: unknown }).value;
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

interface ProfileRecord {
  metadata?: { benchmark_phase?: string };
  metrics?: {
    input_sequence_length?: { value?: number } | number;
    output_sequence_length?: { value?: number } | number;
  };
}

/** Parse the profile_export.jsonl → per-request ISL + OSL arrays. */
export function extractIslOsl(jsonl: string): { isl: number[]; osl: number[] } {
  const isl: number[] = [];
  const osl: number[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let rec: ProfileRecord;
    try {
      rec = JSON.parse(line) as ProfileRecord;
    } catch {
      continue;
    }
    if (rec.metadata?.benchmark_phase && rec.metadata.benchmark_phase !== 'profiling') continue;
    const m = rec.metrics ?? {};
    const i = readNum(m.input_sequence_length);
    const o = readNum(m.output_sequence_length);
    if (typeof i === 'number') isl.push(i);
    if (typeof o === 'number') osl.push(o);
  }
  return { isl, osl };
}

interface TimeSlice {
  start_ns?: number;
  end_ns?: number;
  avg?: number;
  rate?: number;
  count?: number;
  sum?: number;
}
interface Series {
  labels?: Record<string, string>;
  timeslices?: TimeSlice[];
}
interface MetricMeta {
  series?: Series[];
}
interface MetricsJson {
  metrics?: Record<string, MetricMeta>;
}

/**
 * Parse the server_metrics_json → time-series arrays for KV cache util and
 * prefix cache hit rate (per-interval, computed from the prometheus
 * counters the same way trace-server-metrics does it).
 */
export function extractServerMetricSamples(json: string): {
  kvCacheUtil: number[];
  prefixCacheHitRate: number[];
} {
  const parsed = JSON.parse(json) as MetricsJson;
  const metrics = parsed.metrics ?? {};
  const firstSeries = (name: string): Series | undefined => {
    const s = metrics[name]?.series;
    return s && s.length > 0 ? s[0] : undefined;
  };

  // KV cache util — gauge in [0, 1].
  const kvSeries =
    firstSeries('vllm:kv_cache_usage_perc') ?? firstSeries('vllm:gpu_cache_usage_perc');
  const kvCacheUtil: number[] = [];
  for (const ts of kvSeries?.timeslices ?? []) {
    if (typeof ts.avg === 'number') kvCacheUtil.push(ts.avg);
  }

  // Prefix cache hit rate per interval = hits.rate / queries.rate.
  // Matches the derivation in queries/trace-server-metrics.ts.
  // Metric names: vllm exposes these as `vllm:prefix_cache_*` (no `gpu_`
  // prefix); falls back to the `gpu_`-prefixed names in case a future
  // vllm version renames them.
  const prefixCacheHitRate: number[] = [];
  const hitsSeries =
    firstSeries('vllm:prefix_cache_hits') ?? firstSeries('vllm:gpu_prefix_cache_hits');
  const queriesSeries =
    firstSeries('vllm:prefix_cache_queries') ?? firstSeries('vllm:gpu_prefix_cache_queries');
  if (hitsSeries && queriesSeries) {
    const qByStart = new Map<number, TimeSlice>();
    for (const q of queriesSeries.timeslices ?? []) {
      if (typeof q.start_ns === 'number') qByStart.set(q.start_ns, q);
    }
    for (const h of hitsSeries.timeslices ?? []) {
      if (typeof h.start_ns !== 'number' || typeof h.rate !== 'number') continue;
      const q = qByStart.get(h.start_ns);
      if (!q || typeof q.rate !== 'number' || q.rate === 0) continue;
      prefixCacheHitRate.push(h.rate / q.rate);
    }
  }

  return { kvCacheUtil, prefixCacheHitRate };
}

/** Metrics our aggregates pipeline cares about. Anything else in the blob is skipped. */
const TARGET_METRIC_KEYS = new Set([
  'vllm:kv_cache_usage_perc',
  'vllm:gpu_cache_usage_perc', // older fallback name
  'vllm:prefix_cache_hits',
  'vllm:prefix_cache_queries',
  'vllm:gpu_prefix_cache_hits', // legacy alias (used in pre-fix code paths)
  'vllm:gpu_prefix_cache_queries',
]);

/**
 * Stream-parse the gzipped server_metrics_json and collect ONLY the metrics
 * we need. Avoids the Node 512 MB string cap that JSON.parse hits on
 * server_metrics blobs from high-conc TP+EP runs (which can decompress to
 * >500 MB because vllm dumps `cache_config_info` every scrape interval).
 *
 * Pipeline: Buffer → gunzip → JSON parser → Pick('metrics') →
 * StreamObject (one metric per chunk) → keep only the keys we care about.
 *
 * Returns the same `{ kvCacheUtil, prefixCacheHitRate }` shape as the
 * synchronous fast path so callers can use either interchangeably.
 */
async function streamExtractServerMetricSamples(
  buffer: Buffer,
): Promise<{ kvCacheUtil: number[]; prefixCacheHitRate: number[] }> {
  const collected: Record<string, MetricMeta> = {};
  // stream-json's TypeScript types don't compose cleanly with node:stream's
  // pipeline() generic, and several `.pipe()`/event APIs are typed loosely —
  // cast to any for this local pipe chain. It works at runtime.
  // stream-json composes transforms via stream-chain. `pick`/`streamObject`
  // each return a Transform when called; `chain([...])` wires them.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const pipeline = chain([
    Readable.from(buffer),
    createGunzip(),
    parser(),
    pick({ filter: 'metrics' }),
    streamObject(),
  ]);
  await new Promise<void>((resolve, reject) => {
    (pipeline as any).on('data', (chunk: unknown) => {
      const { key, value } = chunk as { key: string; value: MetricMeta };
      if (TARGET_METRIC_KEYS.has(key)) collected[key] = value;
    });
    (pipeline as any).on('end', resolve);
    (pipeline as any).on('error', reject);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return extractServerMetricSamples(JSON.stringify({ metrics: collected }));
}

export async function getAgenticAggregates(
  sql: DbClient,
  benchmarkResultIds: number[],
): Promise<AgenticAggregateMap> {
  if (benchmarkResultIds.length === 0) return {};

  const result: AgenticAggregateMap = {};

  // Fast path: read the pre-computed `aggregate_stats` JSONB written by the
  // ingest pipeline (and back-filled by `backfill-aggregate-stats.ts`). One
  // round-trip pulls everything we need for every requested id with no blob
  // decompression, so the slow blob-parsing fallback only runs for ids
  // whose stats are missing or were produced by an older `STATS_VERSION`.
  const statsRows = (await sql`
    select
      br.id as benchmark_result_id,
      atr.aggregate_stats as stats
    from benchmark_results br
    join agentic_trace_replay atr on atr.id = br.trace_replay_id
    where br.id = any(${benchmarkResultIds}::bigint[])
  `) as {
    benchmark_result_id: number;
    stats: AggregateStatsRow | null;
  }[];

  const idsNeedingProfile: number[] = [];
  const idsNeedingServer: number[] = [];
  for (const row of statsRows) {
    const id = Number(row.benchmark_result_id);
    const agg = blankAggregate(id);
    if (row.stats && Number(row.stats.version) === STATS_VERSION) {
      agg.isl = row.stats.isl ?? null;
      agg.osl = row.stats.osl ?? null;
      agg.kvCacheUtil = row.stats.kvCacheUtil ?? null;
      agg.prefixCacheHitRate = row.stats.prefixCacheHitRate ?? null;
    } else {
      // No stats (or stale version) — schedule the blob-parse fallback below
      // so the response still surfaces data. Backfill should drain these.
      idsNeedingProfile.push(id);
      idsNeedingServer.push(id);
    }
    result[id] = agg;
  }
  // Also fall back for ids that didn't return a row at all (no trace_replay
  // link) — keep the caller contract: every id we know about lands in the map.
  for (const id of benchmarkResultIds) {
    if (!(id in result)) result[id] = blankAggregate(id);
  }

  if (idsNeedingProfile.length === 0 && idsNeedingServer.length === 0) {
    return result;
  }

  // ── Fallback Pass 1: profile_export blobs (cheap; large batches). ──────
  for (let i = 0; i < idsNeedingProfile.length; i += PROFILE_CHUNK_SIZE) {
    const chunk = idsNeedingProfile.slice(i, i + PROFILE_CHUNK_SIZE);
    const rows = (await sql`
      select
        br.id as benchmark_result_id,
        atr.profile_export_jsonl_gz as profile_blob
      from benchmark_results br
      join agentic_trace_replay atr on atr.id = br.trace_replay_id
      where br.id = any(${chunk}::bigint[])
    `) as { benchmark_result_id: number; profile_blob: Buffer | null }[];
    for (const row of rows) {
      const id = Number(row.benchmark_result_id);
      result[id] ??= blankAggregate(id);
      if (row.profile_blob) {
        try {
          const jsonl = gunzipSync(row.profile_blob).toString('utf8');
          const { isl, osl } = extractIslOsl(jsonl);
          result[id].isl = percentilesOf(isl);
          result[id].osl = percentilesOf(osl);
        } catch {
          // ignore malformed blob
        }
      }
    }
  }
  // ── Fallback Pass 2: server_metrics blobs (huge; one at a time). ───────
  // Serial to avoid OOM on the decompressed JSON of a high-conc TP+EP row
  // (>500 MB raw). The aggregator is fronted by a blob cache, so the slow
  // path runs at most once per sibling set.
  for (let i = 0; i < idsNeedingServer.length; i += SERVER_CHUNK_SIZE) {
    const chunk = idsNeedingServer.slice(i, i + SERVER_CHUNK_SIZE);
    const rows = (await sql`
      select
        br.id as benchmark_result_id,
        atr.server_metrics_json_gz as server_blob
      from benchmark_results br
      join agentic_trace_replay atr on atr.id = br.trace_replay_id
      where br.id = any(${chunk}::bigint[])
    `) as { benchmark_result_id: number; server_blob: Buffer | null }[];
    for (const row of rows) {
      const id = Number(row.benchmark_result_id);
      result[id] ??= blankAggregate(id);
      if (!row.server_blob) continue;
      let parsed: { kvCacheUtil: number[]; prefixCacheHitRate: number[] } | null = null;
      try {
        const json = gunzipSync(row.server_blob).toString('utf8');
        parsed = extractServerMetricSamples(json);
      } catch (error) {
        // ERR_STRING_TOO_LONG (>512 MB) hits on high-conc TP+EP rows whose
        // server_metrics_json decompresses past Node's max string length.
        // Stream-parse to extract just the metric subtrees we care about.
        const code = error && (error as NodeJS.ErrnoException).code;
        const msg = error instanceof Error ? error.message : String(error);
        if (code === 'ERR_STRING_TOO_LONG' || msg.includes('longer than 0x1fffffe8')) {
          try {
            parsed = await streamExtractServerMetricSamples(row.server_blob);
          } catch {
            // stream fallback failed too — leave nulls
          }
        }
      }
      if (parsed) {
        result[id].kvCacheUtil = percentilesOf(parsed.kvCacheUtil);
        result[id].prefixCacheHitRate = percentilesOf(parsed.prefixCacheHitRate);
      }
    }
  }
  return result;
}

/** Shape of the JSONB column when read back via postgres-js. */
interface AggregateStatsRow {
  version: number;
  isl: MetricPercentiles | null;
  osl: MetricPercentiles | null;
  kvCacheUtil: MetricPercentiles | null;
  prefixCacheHitRate: MetricPercentiles | null;
  normalizedSessionTimeS: number | null;
  p90PrefillTpsPerUser: number | null;
}

function blankAggregate(id: number): AgenticAggregate {
  return { id, isl: null, osl: null, kvCacheUtil: null, prefixCacheHitRate: null };
}
