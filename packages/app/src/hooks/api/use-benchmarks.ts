import { useQuery } from '@tanstack/react-query';

import { fetchBenchmarks } from '@/lib/api';

/** Shared query options — reused by useQueries for comparison dates. */
export function benchmarkQueryOptions(
  model: string,
  date: string,
  enabled = true,
  exact?: boolean,
  runId?: string,
) {
  return {
    queryKey: ['benchmarks', model, date, exact ? 'exact' : 'latest', runId ?? ''] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchBenchmarks(model, date, exact, signal, runId),
    enabled: enabled && Boolean(model),
  };
}

export function useBenchmarks(model: string, date?: string, enabled = true, runId?: string) {
  return useQuery(benchmarkQueryOptions(model, date ?? 'latest', enabled, undefined, runId));
}
