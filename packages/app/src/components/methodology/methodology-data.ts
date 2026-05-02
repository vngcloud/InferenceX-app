export interface MethodologySection {
  id: string;
  title: string;
}

export const METHODOLOGY_SECTIONS: MethodologySection[] = [
  { id: 'scope', title: 'Scope' },
  { id: 'how-benchmarks-run', title: 'How benchmarks run' },
  { id: 'benchmark-protocol', title: 'Benchmark client protocol' },
  { id: 'metrics', title: 'Performance metrics' },
  { id: 'formulas', title: 'Formulas' },
  { id: 'pricing', title: 'Pricing assumptions' },
  { id: 'power', title: 'Power assumptions' },
  { id: 'evaluation', title: 'Evaluation methodology' },
  { id: 'glossary', title: 'Glossary' },
  { id: 'caveats', title: 'Caveats' },
  { id: 'official', title: 'Official vs unofficial' },
  { id: 'references', title: 'References' },
];

export interface MetricDefinition {
  name: string;
  units?: string;
  field?: string;
  definition: string;
}

export interface MetricGroup {
  title: string;
  metrics: MetricDefinition[];
}

export const METRIC_GROUPS: MetricGroup[] = [
  {
    title: 'Latency',
    metrics: [
      {
        name: 'Time To First Token (TTFT)',
        units: 'seconds',
        field: 'mean_ttft / median_ttft / p99_ttft',
        definition:
          'Time from request submission to the first response token. Dominated by prefill compute and queueing. Reported as mean, median, and p99 across all requests in the run.',
      },
      {
        name: 'Time Per Output Token (TPOT)',
        units: 'seconds',
        field: 'mean_tpot / median_tpot / p99_tpot',
        definition:
          'Average per-token decode time after the first token. Dominated by memory bandwidth at decode time.',
      },
      {
        name: 'Inter-Token Latency (ITL)',
        units: 'seconds',
        field: 'mean_itl / median_itl / p99_itl',
        definition:
          'Time between consecutive output tokens as observed by the client (gap-based). Closely related to TPOT but measured per gap rather than averaged.',
      },
      {
        name: 'End-to-End Latency (E2EL)',
        units: 'seconds',
        field: 'mean_e2el / median_e2el / p99_e2el',
        definition:
          'Total wall-clock time from request submission to last token, equal to TTFT plus the sum of inter-token latencies for that request.',
      },
    ],
  },
  {
    title: 'Throughput',
    metrics: [
      {
        name: 'Token Throughput per GPU',
        units: 'tok / s / gpu',
        field: 'tput_per_gpu',
        definition:
          'Total tokens (input + output) processed per second, normalized by the GPU count of the serving deployment. For disaggregated configurations, this normalizes by total GPU count (prefill + decode).',
      },
      {
        name: 'Output Token Throughput per GPU',
        units: 'tok / s / gpu',
        field: 'output_tput_per_gpu',
        definition:
          'Output tokens generated per second per GPU. For disaggregated configurations this is normalized by decode GPU count only. See the disagg caveat below.',
      },
      {
        name: 'Input Token Throughput per GPU',
        units: 'tok / s / gpu',
        field: 'input_tput_per_gpu',
        definition:
          'Input tokens consumed per second per GPU (prefill throughput). Useful when comparing prefill-bound workloads.',
      },
      {
        name: 'Interactivity',
        units: 'tok / s / user',
        field: 'median_intvty / p99_intvty',
        definition:
          'Per-user output token rate. Higher batch sizes raise total throughput per GPU but split the GPU across more concurrent users, lowering interactivity. The dashboard plots most metrics against interactivity to surface this tradeoff.',
      },
    ],
  },
  {
    title: 'Power efficiency',
    metrics: [
      {
        name: 'Tokens per all-in MW',
        units: 'tok / s / MW',
        definition:
          'Throughput per GPU divided by the all-in provisioned utility power per GPU (kW), expressed at megawatt scale. See the Power assumptions section for what "all-in" includes.',
      },
      {
        name: 'Joules per token',
        units: 'J / tok',
        definition:
          'Energy required to generate one token at all-in provisioned power. Equivalent to (W per GPU) ÷ (tok/s/gpu). Reported as total, output-only, and input-only variants.',
      },
    ],
  },
  {
    title: 'Cost',
    metrics: [
      {
        name: 'Cost per million tokens',
        units: '$ / M tokens',
        definition:
          'Per-GPU TCO (USD per hour) divided by the per-GPU token-rate (in millions of tokens per hour). Reported across three economic tiers (hyperscaler, neocloud-owning, rental) and three token bases (total, output, input), for nine variants in total.',
      },
    ],
  },
];

export interface FormulaEntry {
  name: string;
  expression: string;
  source: string;
  description?: string;
}

export const FORMULAS: FormulaEntry[] = [
  {
    name: 'Tokens per hour (per GPU)',
    expression: 'tokens_per_hour = tput_per_gpu × 3600 ÷ 1,000,000',
    source: 'chart-utils.ts:267',
    description:
      'Used as the denominator for cost-per-million-tokens. Variants exist for output-only and input-only throughput.',
  },
  {
    name: 'Tokens per all-in utility MW',
    expression: 'tok/s/MW = (tput_per_gpu × 1000) ÷ kW_per_gpu',
    source: 'chart-utils.ts:310',
    description:
      'kW_per_gpu is the all-in provisioned utility power amortized per GPU (GPU + host + networking + facility overhead). Multiplying by 1000 converts the kW denominator to MW.',
  },
  {
    name: 'Joules per token',
    expression: 'J/token = (kW_per_gpu × 1000) ÷ tput_per_gpu',
    source: 'chart-utils.ts:372',
    description:
      'Energy per generated token at all-in provisioned power. Output-only and input-only variants substitute output_tput_per_gpu and input_tput_per_gpu.',
  },
  {
    name: 'Cost per million tokens (per tier)',
    expression: '$/M tokens = TCO_$_per_hour ÷ tokens_per_hour',
    source: 'chart-utils.ts:329',
    description:
      'TCO_$_per_hour is one of three tiers: hyperscaler-owned, neocloud-giant-owned, or 3-year rental. Same formula applies to total, output-only, and input-only token bases.',
  },
];

export interface PricingTier {
  name: string;
  description: string;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Hyperscaler-owned (4-year economic life)',
    description:
      'Hyperscalers and tier-1 frontier labs that buy and own their own GPUs. TCO amortizes purchase and operating costs over a 4-year useful life.',
  },
  {
    name: 'Neocloud Giant-owned (4-year economic life)',
    description:
      'Neocloud Giants and large managed-inference providers that own their fleets. Same 4-year amortization as the hyperscaler tier but with neocloud-specific cost structure.',
  },
  {
    name: '3-year rental (with 25% upfront)',
    description:
      'Renting GPU capacity from a neocloud on a 3-year contract with 25% upfront payment. Reflects what an end user actually pays per GPU-hour today.',
  },
];

export interface BenchProtocolFlag {
  flag: string;
  purpose: string;
}

export const BENCH_PROTOCOL_FLAGS: BenchProtocolFlag[] = [
  {
    flag: '--dataset-name random',
    purpose:
      'Inputs are random tokens. No shareGPT, no realistic prompt structure, no shared prefix. Eliminates prefix-cache effects.',
  },
  {
    flag: '--ignore-eos',
    purpose:
      'Server is forced to generate the full requested OSL even if the model would naturally stop sooner. Makes per-request token counts deterministic.',
  },
  {
    flag: '--request-rate inf',
    purpose:
      'Client never throttles itself, so the server is saturated up to the configured concurrency. Throughput is bound by the server, not the client.',
  },
  {
    flag: '--max-concurrency $CONC',
    purpose:
      'Sets the in-flight request count. The dashboard sweeps multiple concurrency levels per config to trace the throughput-vs-interactivity curve.',
  },
  {
    flag: '--num-prompts $((CONC × 10))',
    purpose:
      'Total request count is 10× concurrency so cold-start instabilities (JIT compile, weight load, cache warmup) are amortized across the run.',
  },
  {
    flag: '--seed 42',
    purpose:
      'Fixed seed for the random input generator so input distribution is identical across runs.',
  },
  {
    flag: 'OpenAI-compatible /v1 API',
    purpose:
      'All servers are exercised through the same OpenAI-compatible endpoint, so the client logic is shared regardless of backend (vLLM, SGLang, TRT-LLM, ATOM, Dynamo).',
  },
];

export interface SeqLenPair {
  label: string;
  description: string;
}

export const SEQ_LEN_PAIRS: SeqLenPair[] = [
  {
    label: '1k / 1k',
    description: '1024 input tokens / 1024 output tokens. Balanced chat-style workload.',
  },
  {
    label: '8k / 1k',
    description:
      '8192 input tokens / 1024 output tokens. Long-context summarization and RAG-style workload, prefill-heavy.',
  },
  {
    label: '1k / 8k',
    description:
      '1024 input tokens / 8192 output tokens. Long-generation workload like reasoning or code completion, decode-heavy.',
  },
];

export interface EvalTask {
  name: string;
  threshold: number;
  description: string;
}

export const EVAL_TASKS: EvalTask[] = [
  {
    name: 'GSM8K',
    threshold: 0.85,
    description:
      'Grade-school math word problems. Tests basic arithmetic reasoning. Score is exact-match against the gold answer; em_flexible and em_strict variants are reported alongside.',
  },
];

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
}

export interface GlossaryGroup {
  title: string;
  terms: GlossaryTerm[];
}

export const GLOSSARY_GROUPS: GlossaryGroup[] = [
  {
    title: 'Model architecture',
    terms: [
      {
        id: 'moe',
        term: 'MoE',
        definition:
          'Mixture of Experts. The feed-forward layer of each transformer block is replaced by a router that activates only a small subset of expert weights per token. Total parameter count grows but compute per token stays bounded.',
      },
      {
        id: 'mla',
        term: 'MLA',
        definition:
          'Multi-head Latent Attention. KV-cache-saving attention variant introduced in DeepSeek V2 that projects keys and values into a shared latent space. Used by DeepSeek and Kimi families.',
      },
    ],
  },
  {
    title: 'Parallelism',
    terms: [
      {
        id: 'tp',
        term: 'TP',
        definition:
          "Tensor Parallelism. Each layer's weight matrices are sharded across GPUs, with two all-reduces per layer (after column-parallel and row-parallel GEMMs). Comms cost scales with model depth.",
      },
      {
        id: 'ep',
        term: 'EP',
        definition:
          'Expert Parallelism. Experts in an MoE layer are sharded across GPUs. Each MoE layer requires an all-to-all dispatch and combine, but dense layers do not pay comms cost.',
      },
      {
        id: 'wide-ep',
        term: 'Wide EP',
        definition:
          'EP across many GPUs (e.g. 16+) so each GPU holds fewer experts. Reduces per-GPU expert weight footprint and amortizes weight load across the cluster, at the cost of larger all-to-all collectives that may spill onto scale-out fabric.',
      },
      {
        id: 'dp',
        term: 'DP',
        definition:
          'Data Parallelism. Each GPU holds a full model replica and processes a different batch shard. Replicates weights, no inter-GPU comms during forward.',
      },
      {
        id: 'dp-attn',
        term: 'DP attention',
        definition:
          'Data-parallel attention only. Splits the batch dimension across GPUs for the attention block, removing the need to duplicate KV cache and reducing comms. Used by SGLang for low interactivity.',
      },
    ],
  },
  {
    title: 'Serving',
    terms: [
      {
        id: 'prefill',
        term: 'Prefill',
        definition:
          'Processing the input prompt to produce KV cache and the first token. Compute-bound and bursty.',
      },
      {
        id: 'decode',
        term: 'Decode',
        definition:
          'Generating subsequent tokens autoregressively. Memory-bandwidth-bound and steady-state.',
      },
      {
        id: 'disagg',
        term: 'Disaggregated serving',
        definition:
          'Running prefill and decode on separate GPU pools so each pool can be sized and scheduled for its own workload characteristics, eliminating prefill-vs-decode interference.',
      },
    ],
  },
  {
    title: 'Decoding',
    terms: [
      {
        id: 'stp',
        term: 'STP',
        definition:
          'Single Token Prediction. Standard autoregressive decoding where one forward pass produces one token. The default when no speculative method is enabled.',
      },
      {
        id: 'mtp',
        term: 'MTP',
        definition:
          'Multi-Token Prediction. Speculative decoding scheme where a draft path proposes multiple tokens per forward pass and the main model verifies them. Implemented as EAGLE-style or NEXTN-style speculation in our recipes.',
      },
      {
        id: 'spec-decoding',
        term: 'Speculative decoding',
        definition:
          'General class of techniques where a cheap draft proposes future tokens that a main model accepts or rejects. MTP is the variant currently benchmarked.',
      },
    ],
  },
  {
    title: 'Networking',
    terms: [
      {
        id: 'nvlink',
        term: 'NVLink (scale-up)',
        definition:
          'High-bandwidth GPU-to-GPU interconnect within a server or rack. NVL72 connects 72 GPUs over an aggregate 130 TB/s NVLink-5 fabric (1.8 TB/s per GPU).',
      },
      {
        id: 'scale-out',
        term: 'IB / RoCE (scale-out)',
        definition:
          'InfiniBand or RoCEv2 Ethernet between racks/nodes. Typically 400–800 Gbit/s per GPU one-way (50–100 GB/s), an order of magnitude less than scale-up.',
      },
    ],
  },
  {
    title: 'Sequences',
    terms: [
      {
        id: 'isl',
        term: 'ISL',
        definition: 'Input Sequence Length. Number of input tokens per request.',
      },
      {
        id: 'osl',
        term: 'OSL',
        definition: 'Output Sequence Length. Number of output tokens per request.',
      },
      {
        id: 'concurrency',
        term: 'Concurrency',
        definition:
          'Number of in-flight requests at the server. Higher concurrency raises throughput but increases queueing and lowers per-user interactivity.',
      },
    ],
  },
  {
    title: 'Analysis',
    terms: [
      {
        id: 'pareto',
        term: 'Pareto frontier',
        definition:
          'The set of points that are not strictly dominated on all axes by any other point. Dashboard frontiers are computed in the appropriate corner (upper-right for throughput vs latency, lower-right for cost).',
      },
      {
        id: 'roofline',
        term: 'Roofline',
        definition:
          'In this dashboard, the per-config envelope along the chosen axis pair, marking the boundary of achievable performance for that hardware/framework/precision combination at the swept concurrencies.',
      },
      {
        id: 'iso-interactivity',
        term: 'Iso-interactivity',
        definition:
          'Comparing hardware at a fixed interactivity (tok/s/user). Answers "at the same per-user speed, which platform serves more total throughput?".',
      },
      {
        id: 'iso-throughput',
        term: 'Iso-throughput',
        definition:
          'Comparing hardware at a fixed total throughput. Answers "at the same total tok/s, which platform delivers higher per-user interactivity?".',
      },
    ],
  },
  {
    title: 'Cost',
    terms: [
      {
        id: 'tco',
        term: 'TCO',
        definition:
          'Total Cost of Ownership. Per-GPU all-in cost of running a system, expressed as USD per GPU per hour. Includes capex amortization, power, cooling, networking, real estate, and personnel.',
      },
    ],
  },
];

export interface Caveat {
  title: string;
  body: string;
}

export const CAVEATS: Caveat[] = [
  {
    title: 'Worst-case input',
    body: 'Random tokens with prefix caching disabled and forced output length. Production traffic with realistic prompt structure, prefix sharing, or shorter outputs typically performs better. Treat dashboard numbers as a baseline, not a ceiling.',
  },
  {
    title: 'Sequence-length specificity',
    body: 'Performance shifts dramatically with ISL/OSL. Always read the chart with its sequence-length tag, since 1k/1k, 8k/1k, and 1k/8k stress different parts of the system.',
  },
  {
    title: 'Concurrency dependence',
    body: 'Each chart point is at a specific concurrency. Interactivity-vs-throughput curves are concurrency sweeps; cross-config comparison is meaningful at iso-concurrency or via the Pareto frontier.',
  },
  {
    title: 'Disagg per-GPU normalization',
    body: 'For disaggregated configurations, output-only throughput is normalized by decode GPU count (not total prefill+decode GPUs) so the metric reflects what the decode pool actually produces. Total throughput is normalized by all GPUs in the serving deployment.',
  },
  {
    title: 'Software maturity',
    body: 'Newly released hardware (e.g. Blackwell Ultra) and newly added frameworks often have software stacks that have not yet caught up to the silicon. Numbers improve as kernels are written and tuned, which is exactly why the benchmark is continuous.',
  },
  {
    title: 'Bar-chart interpolation',
    body: 'When summary bar charts compare hardware at a target interactivity, the underlying data may not contain an exact data point at that interactivity for every configuration. Bar values are reasonable interpolations; the scatter charts show the raw points.',
  },
  {
    title: 'Power is conservative',
    body: 'Joules-per-token is computed against TDP-based all-in power. Memory-bound decode workloads typically draw less than TDP at the GPU, so real energy-per-token is usually lower than what the dashboard shows.',
  },
];
