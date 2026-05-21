import { useQuery } from '@tanstack/react-query';

export interface MetricPercentiles {
  mean: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
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

async function fetchAgenticAggregates(
  ids: number[],
  signal?: AbortSignal,
): Promise<AgenticAggregateMap> {
  if (ids.length === 0) return {};
  const res = await fetch(`/api/v1/agentic-aggregates?ids=${ids.join(',')}`, { signal });
  if (!res.ok) throw new Error(`agentic-aggregates ${res.status}`);
  return (await res.json()) as AgenticAggregateMap;
}

/**
 * Fetch per-id aggregate stats (mean/p50/p75/p90/p99) for ISL, OSL, KV
 * cache utilization, and prefix cache hit rate. Used by the "Aggregates
 * across configs" view on the agentic detail page.
 */
export function useAgenticAggregates(ids: number[], enabled = true) {
  const sortedKey = [...new Set(ids)].toSorted((a, b) => a - b);
  return useQuery({
    queryKey: ['agentic-aggregates', sortedKey.join(',')] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAgenticAggregates(sortedKey, signal),
    enabled: enabled && sortedKey.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
