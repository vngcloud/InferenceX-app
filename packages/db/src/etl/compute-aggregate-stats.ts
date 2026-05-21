/**
 * Pre-compute the per-row aggregate stats for an `agentic_trace_replay`
 * blob pair. The output lands in the `aggregate_stats` JSONB column so the
 * detail page can serve the "Aggregates across configs" view and the
 * derived chart x-axis modes from a single SQL row read, instead of
 * parsing the raw blobs on demand.
 *
 * Shape is intentionally versioned — bump `STATS_VERSION` whenever the
 * computation changes so the backfill script knows which rows to recompute.
 */

import { Readable } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';

import { chain } from 'stream-chain';

import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamObject } from 'stream-json/streamers/stream-object.js';

import { computeDerivedFromBlob } from '../queries/derived-agentic-metrics.js';
import {
  STATS_VERSION,
  extractIslOsl,
  extractServerMetricSamples,
  percentilesOf,
  type MetricPercentiles,
} from '../queries/agentic-aggregates.js';

export { STATS_VERSION };

export interface AggregateStats {
  version: number;
  isl: MetricPercentiles | null;
  osl: MetricPercentiles | null;
  kvCacheUtil: MetricPercentiles | null;
  prefixCacheHitRate: MetricPercentiles | null;
  /** Mean of (per-session e2e time × mean_load / session_load) across sessions. */
  normalizedSessionTimeS: number | null;
  /** P90 of per-turn ISL/TTFT pooled across every session's turns. */
  p90PrefillTpsPerUser: number | null;
}

/** Metric subtrees we extract via stream-parse on oversized server blobs. */
const TARGET_METRIC_KEYS = new Set([
  'vllm:kv_cache_usage_perc',
  'vllm:gpu_cache_usage_perc',
  'vllm:prefix_cache_hits',
  'vllm:prefix_cache_queries',
  'vllm:gpu_prefix_cache_hits',
  'vllm:gpu_prefix_cache_queries',
]);

/**
 * Stream-parse the gzipped server_metrics_json and collect just the metric
 * subtrees we care about. Avoids Node's 512 MB max-string-length cap that
 * `gunzipSync().toString('utf8')` hits on high-conc TP+EP rows.
 */
async function streamExtractServer(
  buffer: Buffer,
): Promise<{ kvCacheUtil: number[]; prefixCacheHitRate: number[] }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const collected: Record<string, unknown> = {};
  const pipelineStream = chain([
    Readable.from(buffer),
    createGunzip(),
    parser(),
    pick({ filter: 'metrics' }),
    streamObject(),
  ]);
  await new Promise<void>((resolve, reject) => {
    (pipelineStream as any).on('data', (chunk: unknown) => {
      const { key, value } = chunk as { key: string; value: unknown };
      if (TARGET_METRIC_KEYS.has(key)) collected[key] = value;
    });
    (pipelineStream as any).on('end', resolve);
    (pipelineStream as any).on('error', reject);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return extractServerMetricSamples(JSON.stringify({ metrics: collected }));
}

/**
 * Compute the full versioned stats bundle from a (profile, server-metrics)
 * blob pair. Either blob may be null (e.g. only the server file existed) —
 * the corresponding stats just come back null.
 */
export async function computeAggregateStats(args: {
  profileBlob: Buffer | null;
  serverBlob: Buffer | null;
}): Promise<AggregateStats> {
  let islPct: MetricPercentiles | null = null;
  let oslPct: MetricPercentiles | null = null;
  let normalized: number | null = null;
  let prefillP90: number | null = null;

  if (args.profileBlob) {
    try {
      const jsonl = gunzipSync(args.profileBlob).toString('utf8');
      const { isl, osl } = extractIslOsl(jsonl);
      islPct = percentilesOf(isl);
      oslPct = percentilesOf(osl);
      const derived = computeDerivedFromBlob(jsonl);
      normalized = derived.normalized_session_time_s;
      prefillP90 = derived.p90_prefill_tps_per_user;
    } catch {
      // ignore malformed blob — leave nulls
    }
  }

  let kvPct: MetricPercentiles | null = null;
  let prefixPct: MetricPercentiles | null = null;
  if (args.serverBlob) {
    let server: { kvCacheUtil: number[]; prefixCacheHitRate: number[] } | null = null;
    try {
      const json = gunzipSync(args.serverBlob).toString('utf8');
      server = extractServerMetricSamples(json);
    } catch (error) {
      const code = error && (error as NodeJS.ErrnoException).code;
      const msg = error instanceof Error ? error.message : String(error);
      // ERR_STRING_TOO_LONG hits on high-conc TP+EP rows. Stream-parse to
      // pull just the metric subtrees we need without materializing the
      // full 500+ MB JSON string.
      if (code === 'ERR_STRING_TOO_LONG' || msg.includes('longer than 0x1fffffe8')) {
        try {
          server = await streamExtractServer(args.serverBlob);
        } catch {
          // stream fallback failed too — leave nulls
        }
      }
    }
    if (server) {
      kvPct = percentilesOf(server.kvCacheUtil);
      prefixPct = percentilesOf(server.prefixCacheHitRate);
    }
  }

  return {
    version: STATS_VERSION,
    isl: islPct,
    osl: oslPct,
    kvCacheUtil: kvPct,
    prefixCacheHitRate: prefixPct,
    normalizedSessionTimeS: normalized,
    p90PrefillTpsPerUser: prefillP90,
  };
}
