/**
 * Parse aiperf's `server_metrics_export.json` blob (gzipped in
 * `agentic_trace_replay.server_metrics_json_gz`) and return a slim, chart-ready
 * time-series for one benchmark point.
 *
 * The raw JSON has shape:
 *   metrics: {
 *     "<metric_name>": {
 *       series: [
 *         {
 *           labels: { ... },
 *           stats: { ... summary ... },
 *           timeslices: [
 *             { start_ns, end_ns, avg, min, max }            // gauges
 *             { start_ns, end_ns, total, rate }              // counters
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * Timeslices are ~1 Hz windows. The benchmark window can be tens of minutes
 * (1800+ windows). We return them as `[{ t, ...}]` arrays with `t` measured
 * in seconds from the benchmark start so the frontend doesn't need to
 * shuffle bigint nanoseconds around.
 */

import { gunzipSync } from 'node:zlib';

import type { DbClient } from '../connection.js';

interface GaugeSlice {
  start_ns: number;
  end_ns: number;
  avg?: number;
  min?: number;
  max?: number;
}

interface CounterSlice {
  start_ns: number;
  end_ns: number;
  total?: number;
  rate?: number;
}

interface Series {
  endpoint_url?: string;
  labels?: Record<string, string>;
  stats?: Record<string, unknown>;
  timeslices?: (GaugeSlice & CounterSlice)[];
}

interface MetricsJson {
  metrics?: Record<string, { type?: string; description?: string; series?: Series[] }>;
}

export interface TimeSeriesPoint {
  /** Seconds from benchmark start. */
  t: number;
  value: number;
}

export interface QueueDepthPoint {
  t: number;
  running: number;
  waiting: number;
  /** Optional total — frontend can compute too. */
  total: number;
}

export interface PointMeta {
  id: number;
  hardware: string;
  framework: string;
  model: string;
  precision: string;
  spec_method: string;
  disagg: boolean;
  conc: number;
  offload_mode: string | null;
  isl: number | null;
  osl: number | null;
  benchmark_type: string;
  date: string;
  /** GitHub Actions run URL for jumping to the source. */
  run_url: string | null;
  /** Cumulative end-of-run cache-hit number the dashboard already shows. */
  server_gpu_cache_hit_rate: number | null;
  /** Cumulative end-of-run CPU offload cache-hit. */
  server_cpu_cache_hit_rate: number | null;
}

export interface TraceServerMetrics {
  /** Point context — hardware, model, conc, etc. for the page header. */
  meta: PointMeta;
  /** ns wall-clock of the first window's start; for debugging only. */
  startNs: number;
  /** ns wall-clock of the last window's end. */
  endNs: number;
  /** Total benchmark window in seconds. */
  durationS: number;
  /** Number of 1Hz windows captured. */
  timeslicesCount: number;
  /** vllm:kv_cache_usage_perc avg per scrape, values in 0..1. */
  kvCacheUsage: TimeSeriesPoint[];
  /** Per-window prefix-cache hit rate computed as Δhits / Δqueries (0..1). */
  prefixCacheHitRate: TimeSeriesPoint[];
  /** Request queue depth: running, waiting, total per scrape. */
  queueDepth: QueueDepthPoint[];
  /**
   * Per-source prompt-token counts over time (counter rate per scrape).
   * Keyed by the value of the `source` label (typically `local_cache_hit`,
   * `external_cache_hit`, `miss`, etc.). Plot as stacked area.
   */
  promptTokensBySource: Record<string, TimeSeriesPoint[]>;
  /** Prefill throughput: vllm:prompt_tokens rate (tokens/sec) per scrape. */
  prefillTps: TimeSeriesPoint[];
  /** Decode throughput: vllm:generation_tokens rate (tokens/sec) per scrape. */
  decodeTps: TimeSeriesPoint[];
}

export async function getTraceServerMetrics(
  sql: DbClient,
  benchmarkResultId: number,
): Promise<TraceServerMetrics | null> {
  const rows = (await sql`
    select
      atr.server_metrics_json_gz as blob,
      br.id, c.hardware, c.framework, c.model, c.precision, c.spec_method, c.disagg,
      br.conc, br.offload_mode, br.isl, br.osl, br.benchmark_type,
      br.date::text,
      case when wr.html_url is not null then wr.html_url || '/attempts/' || wr.run_attempt else null end as run_url,
      (br.metrics ->> 'server_gpu_cache_hit_rate')::numeric as server_gpu_cache_hit_rate,
      (br.metrics ->> 'server_cpu_cache_hit_rate')::numeric as server_cpu_cache_hit_rate
    from benchmark_results br
    join configs c on c.id = br.config_id
    join workflow_runs wr on wr.id = br.workflow_run_id
    left join agentic_trace_replay atr on atr.id = br.trace_replay_id
    where br.id = ${benchmarkResultId}
  `) as unknown as ({ blob: Buffer | null } & PointMeta)[];
  const row = rows[0];
  if (!row) return null;
  const blob = row.blob;
  if (!blob) return null;
  const pointMeta: PointMeta = {
    id: Number(row.id),
    hardware: row.hardware,
    framework: row.framework,
    model: row.model,
    precision: row.precision,
    spec_method: row.spec_method,
    disagg: row.disagg,
    conc: row.conc,
    offload_mode: row.offload_mode,
    isl: row.isl,
    osl: row.osl,
    benchmark_type: row.benchmark_type,
    date: row.date,
    run_url: row.run_url,
    server_gpu_cache_hit_rate:
      row.server_gpu_cache_hit_rate === null ? null : Number(row.server_gpu_cache_hit_rate),
    server_cpu_cache_hit_rate:
      row.server_cpu_cache_hit_rate === null ? null : Number(row.server_cpu_cache_hit_rate),
  };

  const parsed = JSON.parse(gunzipSync(blob).toString('utf8')) as MetricsJson;
  const metrics = parsed.metrics ?? {};

  const firstSeries = (name: string): Series | undefined => {
    const s = metrics[name]?.series;
    return s && s.length > 0 ? s[0] : undefined;
  };

  // Compute timing reference from the first gauge metric we can find.
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
    firstSeries('vllm:kv_cache_usage_perc') ?? firstSeries('vllm:gpu_cache_usage_perc');
  for (const ts of kvSeries?.timeslices ?? []) {
    if (typeof ts.avg === 'number') {
      kvCacheUsage.push({ t: tOf(ts.start_ns), value: ts.avg });
    }
  }

  // Prefix cache hit rate per scrape (Δhits / Δqueries from counter rate).
  // `rate` is already per-window delta; we just divide.
  const hitsTs = firstSeries('vllm:prefix_cache_hits')?.timeslices ?? [];
  const qsTs = firstSeries('vllm:prefix_cache_queries')?.timeslices ?? [];
  const prefixCacheHitRate: TimeSeriesPoint[] = [];
  const minLen = Math.min(hitsTs.length, qsTs.length);
  for (let i = 0; i < minLen; i++) {
    const h = hitsTs[i]!;
    const q = qsTs[i]!;
    if (typeof q.rate === 'number' && q.rate > 0 && typeof h.rate === 'number') {
      prefixCacheHitRate.push({ t: tOf(h.start_ns), value: h.rate / q.rate });
    }
  }

  // Queue depth: pair running + waiting by index.
  const runTs = firstSeries('vllm:num_requests_running')?.timeslices ?? [];
  const waitTs = firstSeries('vllm:num_requests_waiting')?.timeslices ?? [];
  const queueDepth: QueueDepthPoint[] = [];
  const qlen = Math.min(runTs.length, waitTs.length);
  for (let i = 0; i < qlen; i++) {
    const r = runTs[i]!;
    const w = waitTs[i]!;
    const running = typeof r.avg === 'number' ? r.avg : 0;
    const waiting = typeof w.avg === 'number' ? w.avg : 0;
    queueDepth.push({
      t: tOf(r.start_ns),
      running,
      waiting,
      total: running + waiting,
    });
  }

  // Throughput: extract counter `rate` (already per-second delta from aiperf).
  const counterRateSeries = (name: string): TimeSeriesPoint[] => {
    const s = firstSeries(name);
    if (!s) return [];
    const out: TimeSeriesPoint[] = [];
    for (const ts of s.timeslices ?? []) {
      if (typeof ts.rate === 'number') out.push({ t: tOf(ts.start_ns), value: ts.rate });
    }
    return out;
  };
  const prefillTps = counterRateSeries('vllm:prompt_tokens');
  const decodeTps = counterRateSeries('vllm:generation_tokens');

  // Per-source prompt tokens — emit one TS array per source label.
  const promptTokensBySource: Record<string, TimeSeriesPoint[]> = {};
  for (const series of metrics['vllm:prompt_tokens_by_source']?.series ?? []) {
    const labels = series.labels ?? {};
    const source = labels['source'] ?? labels['reason'] ?? labels['kind'] ?? JSON.stringify(labels);
    const arr: TimeSeriesPoint[] = [];
    for (const ts of series.timeslices ?? []) {
      if (typeof ts.rate === 'number') {
        arr.push({ t: tOf(ts.start_ns), value: ts.rate });
      }
    }
    if (arr.length > 0) promptTokensBySource[source] = arr;
  }

  return {
    meta: pointMeta,
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
