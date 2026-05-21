import { useQuery } from '@tanstack/react-query';

export interface DerivedAgenticMetric {
  id: number;
  /** Mean across sessions of e2e time (Σ per-turn request_latency) rescaled
   *  by mean_load / session_load. Null when the JSONL had no usable records. */
  normalized_session_time_s: number | null;
  /** P90 of per-turn ISL/TTFT across every turn in every session.
   *  Null when no prefill rates could be computed. */
  p90_prefill_tps_per_user: number | null;
}

export type DerivedAgenticMetricMap = Record<number, DerivedAgenticMetric>;

async function fetchDerivedAgenticMetrics(
  ids: number[],
  signal?: AbortSignal,
): Promise<DerivedAgenticMetricMap> {
  if (ids.length === 0) return {};
  const res = await fetch(`/api/v1/derived-agentic-metrics?ids=${ids.join(',')}`, { signal });
  if (!res.ok) throw new Error(`derived-agentic-metrics ${res.status}`);
  return (await res.json()) as DerivedAgenticMetricMap;
}

/**
 * Fetch per-id derived agentic metrics (session time + p90 prefill TPS/user)
 * computed live from the stored aiperf profile_export.jsonl. Used to drive
 * the "Session Time" and "Prefill TPS/user" chart variants.
 *
 * Ids without a trace_replay blob (older or non-aiperf agentic runs) are
 * silently omitted from the response.
 */
export function useDerivedAgenticMetrics(ids: number[], enabled = true) {
  const sortedKey = [...new Set(ids)].toSorted((a, b) => a - b);
  return useQuery({
    queryKey: ['derived-agentic-metrics', sortedKey.join(',')] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchDerivedAgenticMetrics(sortedKey, signal),
    enabled: enabled && sortedKey.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
