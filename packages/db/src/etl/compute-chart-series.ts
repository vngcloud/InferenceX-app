/**
 * Pre-compute the time-series for the agentic detail page chart, so the
 * API doesn't have to gunzip + JSON-parse a multi-hundred-MB blob on every
 * request. The output lands in `agentic_trace_replay.chart_series` and is
 * read directly by `getTraceServerMetrics`.
 *
 * Versioned so the backfill script knows which rows are stale — bump
 * `CHART_SERIES_VERSION` whenever the extraction algorithm changes.
 */

import { Readable } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';

import { chain } from 'stream-chain';

import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamObject } from 'stream-json/streamers/stream-object.js';

/** Bump when the extraction algorithm changes — backfill recomputes anything older. */
export const CHART_SERIES_VERSION = 1;

export interface TimeSeriesPoint {
  /** Seconds from benchmark start. */
  t: number;
  value: number;
}

export interface QueueDepthPoint {
  t: number;
  running: number;
  waiting: number;
  total: number;
}

export interface ChartSeries {
  version: number;
  /** ns wall-clock of the first window's start; for debugging only. */
  startNs: number;
  /** ns wall-clock of the last window's end. */
  endNs: number;
  /** Total benchmark window in seconds. */
  durationS: number;
  /** Number of 1Hz windows captured. */
  timeslicesCount: number;
  kvCacheUsage: TimeSeriesPoint[];
  prefixCacheHitRate: TimeSeriesPoint[];
  queueDepth: QueueDepthPoint[];
  promptTokensBySource: Record<string, TimeSeriesPoint[]>;
  prefillTps: TimeSeriesPoint[];
  decodeTps: TimeSeriesPoint[];
}

// ── Raw blob shapes (subset we read) ────────────────────────────────────

interface RawSlice {
  start_ns?: number;
  end_ns?: number;
  avg?: number;
  rate?: number;
}

interface RawSeries {
  labels?: Record<string, string>;
  timeslices?: RawSlice[];
}

interface RawMetric {
  series?: RawSeries[];
}

type MetricsMap = Record<string, RawMetric>;

/** The set of metric subtrees the chart consumes. */
const CHART_METRIC_KEYS = new Set([
  'vllm:kv_cache_usage_perc',
  'vllm:gpu_cache_usage_perc',
  'vllm:prefix_cache_hits',
  'vllm:prefix_cache_queries',
  'vllm:num_requests_running',
  'vllm:num_requests_waiting',
  'vllm:prompt_tokens',
  'vllm:generation_tokens',
  'vllm:prompt_tokens_by_source',
]);

/**
 * Stream-parse the gzipped server_metrics_json and collect only the metric
 * subtrees the chart needs. Avoids Node's 512 MB max-string-length cap that
 * `gunzipSync(buffer).toString('utf8')` trips on high-conc TP+EP rows.
 */
async function streamCollectMetrics(buffer: Buffer): Promise<MetricsMap> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const collected: MetricsMap = {};
  const pipeline = chain([
    Readable.from(buffer),
    createGunzip(),
    parser(),
    pick({ filter: 'metrics' }),
    streamObject(),
  ]);
  await new Promise<void>((resolve, reject) => {
    (pipeline as any).on('data', (chunk: unknown) => {
      const { key, value } = chunk as { key: string; value: RawMetric };
      if (CHART_METRIC_KEYS.has(key)) collected[key] = value;
    });
    (pipeline as any).on('end', resolve);
    (pipeline as any).on('error', reject);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return collected;
}

/**
 * Parse the gzipped server_metrics blob into the metric map. Tries the
 * synchronous fast path first; falls back to stream-parse on
 * ERR_STRING_TOO_LONG so high-conc TP+EP rows succeed.
 */
async function parseMetrics(buffer: Buffer): Promise<MetricsMap> {
  try {
    const obj = JSON.parse(gunzipSync(buffer).toString('utf8')) as { metrics?: MetricsMap };
    return obj.metrics ?? {};
  } catch (error) {
    const code = error && (error as NodeJS.ErrnoException).code;
    const msg = error instanceof Error ? error.message : String(error);
    if (code === 'ERR_STRING_TOO_LONG' || msg.includes('longer than 0x1fffffe8')) {
      return await streamCollectMetrics(buffer);
    }
    throw error;
  }
}

/**
 * Build chart-ready time-series arrays from a gzipped server_metrics blob.
 * The math mirrors `getTraceServerMetrics` — this helper exists so ingest,
 * backfill, and the API path produce byte-identical results.
 */
export async function computeChartSeries(blob: Buffer | null): Promise<ChartSeries | null> {
  if (!blob) return null;
  let metrics: MetricsMap;
  try {
    metrics = await parseMetrics(blob);
  } catch {
    // Malformed blob → no series (caller treats null as "no data").
    return null;
  }
  return buildSeriesFromMetrics(metrics);
}

/** Pull the first series under a metric key, or undefined. */
function firstSeries(metrics: MetricsMap, name: string): RawSeries | undefined {
  const s = metrics[name]?.series;
  return s && s.length > 0 ? s[0] : undefined;
}

function buildSeriesFromMetrics(metrics: MetricsMap): ChartSeries {
  // Timing reference: smallest start_ns and largest end_ns across every
  // timeslice we extracted. (Same logic as the original getTraceServerMetrics
  // — looking at every metric gives the widest possible window even if some
  // series start late.)
  let startNs = Number.POSITIVE_INFINITY;
  let endNs = 0;
  let timeslicesCount = 0;
  for (const metricMeta of Object.values(metrics)) {
    for (const s of metricMeta?.series ?? []) {
      const ts = s.timeslices ?? [];
      if (ts.length === 0) continue;
      timeslicesCount = Math.max(timeslicesCount, ts.length);
      const first = ts[0]!;
      const last = ts.at(-1)!;
      if (typeof first.start_ns === 'number' && first.start_ns < startNs) startNs = first.start_ns;
      if (typeof last.end_ns === 'number' && last.end_ns > endNs) endNs = last.end_ns;
    }
  }
  if (!Number.isFinite(startNs)) startNs = 0;
  const tOf = (ns: number) => (ns - startNs) / 1e9;

  // KV cache usage (gauge, 0..1)
  const kvCacheUsage: TimeSeriesPoint[] = [];
  const kvSeries =
    firstSeries(metrics, 'vllm:kv_cache_usage_perc') ??
    firstSeries(metrics, 'vllm:gpu_cache_usage_perc');
  for (const ts of kvSeries?.timeslices ?? []) {
    if (typeof ts.avg === 'number' && typeof ts.start_ns === 'number') {
      kvCacheUsage.push({ t: tOf(ts.start_ns), value: ts.avg });
    }
  }

  // Prefix cache hit rate per scrape (Δhits / Δqueries from counter rate).
  const hitsTs = firstSeries(metrics, 'vllm:prefix_cache_hits')?.timeslices ?? [];
  const qsTs = firstSeries(metrics, 'vllm:prefix_cache_queries')?.timeslices ?? [];
  const prefixCacheHitRate: TimeSeriesPoint[] = [];
  const minLen = Math.min(hitsTs.length, qsTs.length);
  for (let i = 0; i < minLen; i++) {
    const h = hitsTs[i]!;
    const q = qsTs[i]!;
    if (
      typeof q.rate === 'number' &&
      q.rate > 0 &&
      typeof h.rate === 'number' &&
      typeof h.start_ns === 'number'
    ) {
      prefixCacheHitRate.push({ t: tOf(h.start_ns), value: h.rate / q.rate });
    }
  }

  // Queue depth: pair running + waiting by index.
  const runTs = firstSeries(metrics, 'vllm:num_requests_running')?.timeslices ?? [];
  const waitTs = firstSeries(metrics, 'vllm:num_requests_waiting')?.timeslices ?? [];
  const queueDepth: QueueDepthPoint[] = [];
  const qlen = Math.min(runTs.length, waitTs.length);
  for (let i = 0; i < qlen; i++) {
    const r = runTs[i]!;
    const w = waitTs[i]!;
    if (typeof r.start_ns !== 'number') continue;
    const running = typeof r.avg === 'number' ? r.avg : 0;
    const waiting = typeof w.avg === 'number' ? w.avg : 0;
    queueDepth.push({
      t: tOf(r.start_ns),
      running,
      waiting,
      total: running + waiting,
    });
  }

  // Throughput: extract counter `rate` (already per-second from aiperf).
  const counterRate = (name: string): TimeSeriesPoint[] => {
    const s = firstSeries(metrics, name);
    if (!s) return [];
    const out: TimeSeriesPoint[] = [];
    for (const ts of s.timeslices ?? []) {
      if (typeof ts.rate === 'number' && typeof ts.start_ns === 'number') {
        out.push({ t: tOf(ts.start_ns), value: ts.rate });
      }
    }
    return out;
  };
  const prefillTps = counterRate('vllm:prompt_tokens');
  const decodeTps = counterRate('vllm:generation_tokens');

  // Per-source prompt tokens — emit one TS array per source label.
  const promptTokensBySource: Record<string, TimeSeriesPoint[]> = {};
  for (const series of metrics['vllm:prompt_tokens_by_source']?.series ?? []) {
    const labels = series.labels ?? {};
    const source = labels['source'] ?? labels['reason'] ?? labels['kind'] ?? JSON.stringify(labels);
    const arr: TimeSeriesPoint[] = [];
    for (const ts of series.timeslices ?? []) {
      if (typeof ts.rate === 'number' && typeof ts.start_ns === 'number') {
        arr.push({ t: tOf(ts.start_ns), value: ts.rate });
      }
    }
    if (arr.length > 0) promptTokensBySource[source] = arr;
  }

  return {
    version: CHART_SERIES_VERSION,
    startNs,
    endNs,
    durationS: endNs > startNs ? (endNs - startNs) / 1e9 : 0,
    timeslicesCount,
    kvCacheUsage,
    prefixCacheHitRate,
    queueDepth,
    promptTokensBySource,
    prefillTps,
    decodeTps,
  };
}
