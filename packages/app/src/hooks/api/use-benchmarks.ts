import { useQuery } from '@tanstack/react-query';

import { fetchBenchmarks } from '@/lib/api';

/** Shared query options — reused by useQueries for comparison dates. */
export function benchmarkQueryOptions(
  model: string,
  date: string,
  enabled = true,
  exact?: boolean,
) {
  // 'latest' is only a queryKey marker meaning "no specific date" — must NOT
  // be sent to the API as a date filter (postgres-js coerces `${date}::date`
  // params via `new Date(date)`, which on 'latest' produces NaN and throws
  // `Invalid time value` from toISOString → 500 to the client).
  const dateForFetch = date === 'latest' ? undefined : date;
  return {
    queryKey: ['benchmarks', model, date, exact ? 'exact' : 'latest'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchBenchmarks(model, dateForFetch, exact, signal),
    enabled: enabled && Boolean(model),
  };
}

export function useBenchmarks(model: string, date?: string, enabled = true) {
  return useQuery(benchmarkQueryOptions(model, date ?? 'latest', enabled));
}
