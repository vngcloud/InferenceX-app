import { useQuery } from '@tanstack/react-query';

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
  run_url: string | null;
  server_gpu_cache_hit_rate: number | null;
  server_cpu_cache_hit_rate: number | null;
}

export interface TraceServerMetrics {
  meta: PointMeta;
  startNs: number;
  endNs: number;
  durationS: number;
  timeslicesCount: number;
  kvCacheUsage: TimeSeriesPoint[];
  prefixCacheHitRate: TimeSeriesPoint[];
  queueDepth: QueueDepthPoint[];
  promptTokensBySource: Record<string, TimeSeriesPoint[]>;
  prefillTps: TimeSeriesPoint[];
  decodeTps: TimeSeriesPoint[];
}

async function fetchTraceServerMetrics(
  id: number,
  signal?: AbortSignal,
): Promise<TraceServerMetrics | null> {
  const res = await fetch(`/api/v1/trace-server-metrics?id=${id}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`trace-server-metrics ${res.status}`);
  return (await res.json()) as TraceServerMetrics;
}

/**
 * Lazy-fetch parsed server-metric time-series for one agentic point.
 * Enabled only when the caller passes `enabled=true` (the detail panel opens),
 * so we don't pay the parse cost on every hover.
 */
export function useTraceServerMetrics(id: number | null, enabled = false) {
  return useQuery({
    queryKey: ['trace-server-metrics', id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      id ? fetchTraceServerMetrics(id, signal) : Promise.resolve(null),
    enabled: enabled && Boolean(id),
    staleTime: 5 * 60 * 1000,
  });
}
