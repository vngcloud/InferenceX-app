import { useQuery } from '@tanstack/react-query';

export interface TraceHistogramPoint {
  id: number;
  /** Input sequence length (tokens) per completed request. */
  isl: number[];
  /** Output sequence length (tokens) per completed request. */
  osl: number[];
}

export type TraceHistogramMap = Record<number, TraceHistogramPoint>;

async function fetchTraceHistograms(
  ids: number[],
  signal?: AbortSignal,
): Promise<TraceHistogramMap> {
  if (ids.length === 0) return {};
  const res = await fetch(`/api/v1/trace-histograms?ids=${ids.join(',')}`, { signal });
  if (!res.ok) throw new Error(`trace-histograms ${res.status}`);
  return (await res.json()) as TraceHistogramMap;
}

/**
 * Fetch per-request ISL/OSL arrays for a set of benchmark_results.id values.
 * Ids without a stored trace_replay blob are silently omitted from the response.
 *
 * Caller passes the agentic id set currently on screen; React Query handles
 * dedup + stale-while-revalidate. Cache key is sorted-ids-comma-joined so
 * any permutation of the same set hits the same cache entry.
 */
export function useTraceHistograms(ids: number[], enabled = true) {
  const sortedKey = [...new Set(ids)].toSorted((a, b) => a - b);
  return useQuery({
    queryKey: ['trace-histograms', sortedKey.join(',')] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchTraceHistograms(sortedKey, signal),
    enabled: enabled && sortedKey.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
