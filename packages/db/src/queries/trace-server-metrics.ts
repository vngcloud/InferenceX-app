/**
 * Time-series view of one agentic benchmark point: chart-ready arrays for
 * KV utilization, prefix-cache hit rate, queue depth, prefill + decode TPS,
 * and per-source prompt-token counts.
 *
 * Backed by `agentic_trace_replay.chart_series` (pre-computed at ingest
 * time, see `etl/compute-chart-series.ts`). The fast path is a single SQL
 * row read; the slow path re-computes from `server_metrics_json_gz` and is
 * only taken when the column is missing or the stored
 * `CHART_SERIES_VERSION` is stale (the backfill script should drain that).
 */

import {
  CHART_SERIES_VERSION,
  computeChartSeries,
  type ChartSeries,
  type QueueDepthPoint,
  type TimeSeriesPoint,
} from '../etl/compute-chart-series';

import type { DbClient } from '../connection.js';

export type { TimeSeriesPoint, QueueDepthPoint } from '../etl/compute-chart-series';

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

interface RawMetaRow extends PointMeta {
  blob: Buffer | null;
  chart_series: ChartSeries | null;
}

function buildMeta(row: RawMetaRow): PointMeta {
  return {
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
}

function merge(meta: PointMeta, series: ChartSeries): TraceServerMetrics {
  return {
    meta,
    startNs: series.startNs,
    endNs: series.endNs,
    durationS: series.durationS,
    timeslicesCount: series.timeslicesCount,
    kvCacheUsage: series.kvCacheUsage,
    prefixCacheHitRate: series.prefixCacheHitRate,
    queueDepth: series.queueDepth,
    promptTokensBySource: series.promptTokensBySource,
    prefillTps: series.prefillTps,
    decodeTps: series.decodeTps,
  };
}

export async function getTraceServerMetrics(
  sql: DbClient,
  benchmarkResultId: number,
): Promise<TraceServerMetrics | null> {
  const rows = (await sql`
    select
      atr.server_metrics_json_gz as blob,
      atr.chart_series,
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
  `) as unknown as RawMetaRow[];
  const row = rows[0];
  if (!row) return null;
  if (!row.blob) return null;
  const meta = buildMeta(row);

  // Fast path: pre-computed chart_series at the current version.
  if (row.chart_series && Number(row.chart_series.version) === CHART_SERIES_VERSION) {
    return merge(meta, row.chart_series);
  }

  // Slow path: compute from the blob. `computeChartSeries` handles
  // ERR_STRING_TOO_LONG via a stream-parse fallback so high-conc TP+EP
  // rows succeed even before the backfill drains them.
  const series = await computeChartSeries(row.blob);
  if (!series) return null;
  return merge(meta, series);
}
