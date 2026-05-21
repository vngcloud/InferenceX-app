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

import { gunzipSync } from 'node:zlib';

import type { DbClient } from '../connection.js';

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
 * Each row pulls TWO compressed blobs (profile_export + server_metrics).
 * `server_metrics_json_gz` can be up to ~17 MB compressed for high-conc
 * runs, so even 3 rows can clear Neon's 64 MB cap. Stay conservative at 2.
 * Chunks are issued in parallel below, so the wall-clock impact is small.
 */
const QUERY_CHUNK_SIZE = 2;

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
  const prefixCacheHitRate: number[] = [];
  const hitsSeries = firstSeries('vllm:gpu_prefix_cache_hits');
  const queriesSeries = firstSeries('vllm:gpu_prefix_cache_queries');
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

export async function getAgenticAggregates(
  sql: DbClient,
  benchmarkResultIds: number[],
): Promise<AgenticAggregateMap> {
  if (benchmarkResultIds.length === 0) return {};

  // Serial chunks so we never have more than ~`QUERY_CHUNK_SIZE` blobs in
  // memory at once. Some `server_metrics` blobs decompress to >100 MB; running
  // all chunks in parallel OOMs the Node process. The aggregator is fronted by
  // a blob cache (`blobOnly: true`), so the slow path runs at most once per
  // sibling set.
  const result: AgenticAggregateMap = {};
  for (let i = 0; i < benchmarkResultIds.length; i += QUERY_CHUNK_SIZE) {
    const chunk = benchmarkResultIds.slice(i, i + QUERY_CHUNK_SIZE);
    const chunkRows = (await sql`
      select
        br.id as benchmark_result_id,
        atr.profile_export_jsonl_gz as profile_blob,
        atr.server_metrics_json_gz as server_blob
      from benchmark_results br
      join agentic_trace_replay atr on atr.id = br.trace_replay_id
      where br.id = any(${chunk}::bigint[])
    `) as {
      benchmark_result_id: number;
      profile_blob: Buffer | null;
      server_blob: Buffer | null;
    }[];
    for (const row of chunkRows) {
      processRow(row, result);
    }
  }
  return result;
}

function processRow(
  row: { benchmark_result_id: number; profile_blob: Buffer | null; server_blob: Buffer | null },
  result: AgenticAggregateMap,
): void {
  let islPct: MetricPercentiles | null = null;
  let oslPct: MetricPercentiles | null = null;
  let kvPct: MetricPercentiles | null = null;
  let prefixPct: MetricPercentiles | null = null;

  if (row.profile_blob) {
    try {
      const jsonl = gunzipSync(row.profile_blob).toString('utf8');
      const { isl, osl } = extractIslOsl(jsonl);
      islPct = percentilesOf(isl);
      oslPct = percentilesOf(osl);
    } catch {
      // ignore malformed blob
    }
  }
  if (row.server_blob) {
    try {
      const json = gunzipSync(row.server_blob).toString('utf8');
      const { kvCacheUtil, prefixCacheHitRate } = extractServerMetricSamples(json);
      kvPct = percentilesOf(kvCacheUtil);
      prefixPct = percentilesOf(prefixCacheHitRate);
    } catch {
      // ignore malformed blob
    }
  }

  result[Number(row.benchmark_result_id)] = {
    id: Number(row.benchmark_result_id),
    isl: islPct,
    osl: oslPct,
    kvCacheUtil: kvPct,
    prefixCacheHitRate: prefixPct,
  };
}
