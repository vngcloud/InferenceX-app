import { useQuery } from '@tanstack/react-query';

export interface BenchmarkSibling {
  id: number;
  conc: number;
  offload_mode: string | null;
  decode_tp: number;
  decode_ep: number;
  prefill_tp: number;
  prefill_ep: number;
  num_prefill_gpu: number;
  num_decode_gpu: number;
  disagg: boolean;
  is_current: boolean;
  has_trace: boolean;
}

export interface BenchmarkSku {
  hardware: string;
  framework: string;
  model: string;
  precision: string;
  spec_method: string;
  benchmark_type: string;
  github_run_id: number;
  date: string;
}

export interface BenchmarkSiblings {
  sku: BenchmarkSku;
  siblings: BenchmarkSibling[];
}

export function useBenchmarkSiblings(id: number | null) {
  return useQuery({
    queryKey: ['benchmark-siblings', id] as const,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/v1/benchmark-siblings?id=${id}`, { signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`benchmark-siblings ${res.status}`);
      return (await res.json()) as BenchmarkSiblings;
    },
    enabled: id !== null && id > 0,
    staleTime: 5 * 60 * 1000,
  });
}
