/**
 * Canonical set of metric keys stored in the benchmark_results.metrics JSONB column.
 *
 * Latency values (ttft/tpot/itl/e2el/intvty) are in seconds. Throughput values are
 * tokens/sec — `_per_gpu` is per-GPU, `_tps` is total tokens/sec across the deployment.
 *
 * Distribution stats (mean/median/std/p75/p90/p95/p99/p99.9) are present for latency,
 * QPS, and per-request token counts; agentic runs carry the full set, fixed-seq runs
 * carry median/mean/p99/std for latency only.
 */
export const METRIC_KEYS = new Set([
  // throughput (tokens/sec/GPU)
  'tput_per_gpu',
  'output_tput_per_gpu',
  'input_tput_per_gpu',
  // throughput (tokens/sec, deployment total) — agentic aiperf reports both
  'total_tput_tps',
  'output_tput_tps',
  'input_tput_tps',
  // TTFT — time to first token
  'median_ttft',
  'mean_ttft',
  'p75_ttft',
  'p90_ttft',
  'p95_ttft',
  'p99_ttft',
  'p99.9_ttft',
  'std_ttft',
  // TPOT — time per output token
  'median_tpot',
  'mean_tpot',
  'p75_tpot',
  'p90_tpot',
  'p95_tpot',
  'p99_tpot',
  'p99.9_tpot',
  'std_tpot',
  // ITL — inter-token latency
  'median_itl',
  'mean_itl',
  'p75_itl',
  'p90_itl',
  'p95_itl',
  'p99_itl',
  'p99.9_itl',
  'std_itl',
  // E2EL — end-to-end latency
  'median_e2el',
  'mean_e2el',
  'p75_e2el',
  'p90_e2el',
  'p95_e2el',
  'p99_e2el',
  'p99.9_e2el',
  'std_e2el',
  // interactivity
  'median_intvty',
  'mean_intvty',
  'p75_intvty',
  'p90_intvty',
  'p95_intvty',
  'p99_intvty',
  'p99.9_intvty',
  'std_intvty',
  // QPS — queries per second (agentic aiperf)
  'median_qps',
  'mean_qps',
  'p75_qps',
  'p90_qps',
  'p95_qps',
  'p99_qps',
  'p99.9_qps',
  'std_qps',
  // per-request input token count distribution
  'median_input_tokens',
  'mean_input_tokens',
  'p75_input_tokens',
  'p90_input_tokens',
  'p95_input_tokens',
  'p99_input_tokens',
  'p99.9_input_tokens',
  'std_input_tokens',
  // per-request output token count distribution — actual served
  'median_output_tokens_actual',
  'mean_output_tokens_actual',
  'p75_output_tokens_actual',
  'p90_output_tokens_actual',
  'p95_output_tokens_actual',
  'p99_output_tokens_actual',
  'p99.9_output_tokens_actual',
  'std_output_tokens_actual',
  // per-request output token count distribution — expected from trace
  'median_output_tokens_expected',
  'mean_output_tokens_expected',
  'p75_output_tokens_expected',
  'p90_output_tokens_expected',
  'p95_output_tokens_expected',
  'p99_output_tokens_expected',
  'p99.9_output_tokens_expected',
  'std_output_tokens_expected',
  // run totals (agentic aiperf)
  'duration_seconds',
  'total_requests_completed',
  'total_prompt_tokens',
  'total_generation_tokens',
  // server prefix-cache observability (agentic aiperf)
  'server_gpu_cache_hit_rate',
  'server_cpu_cache_hit_rate',
  'theoretical_cache_hit_rate',
]);
