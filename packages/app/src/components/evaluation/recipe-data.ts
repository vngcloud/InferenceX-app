/**
 * Transform benchmark + eval rows into "recipe comparison" rows for the
 * /evaluation table.
 *
 * Each row is one (deployment context, technique-variant) pair. Within a
 * deployment context, the row whose `techniques` is empty (or whose
 * spec_method='none') is treated as the baseline; sibling rows show speedup
 * and TPOT-ratio deltas against it. When no baseline exists in the group, the
 * deltas are null and the UI renders them as "—".
 *
 * Accuracy is joined from eval rows at the (model, hardware, framework,
 * precision) level — coarser than benchmarks because lm-eval is run once per
 * model+config, not per concurrency point.
 */

import type { BenchmarkRow, EvalRow } from '@/lib/api';

const ACCURACY_KEY = 'em_strict';

/**
 * Recipe-comparison filter axes. Each row is tagged with one category so the
 * UI can show e.g. only spec-decoding variants without mixing in batch-size
 * sweeps.
 */
export type TechniqueCategory =
  | 'baseline'
  | 'spec-decoding'
  | 'batch-size'
  | 'kv-cache'
  | 'prefix-cache'
  | 'other';

export const TECHNIQUE_CATEGORIES: { value: TechniqueCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'spec-decoding', label: 'Spec decoding' },
  { value: 'batch-size', label: 'Batch size' },
  { value: 'kv-cache', label: 'KV cache' },
  { value: 'prefix-cache', label: 'Prefix cache' },
  { value: 'baseline', label: 'Baseline only' },
];

export interface RecipeRow {
  groupKey: string;
  /** Identity (constant within a group). */
  model: string;
  hardware: string;
  framework: string;
  precision: string;
  /** Parallelism dims that distinguish 1× vs 2× topology, disagg, etc. */
  numPrefillGpu: number;
  numDecodeGpu: number;
  prefillTp: number;
  decodeTp: number;
  disagg: boolean;
  /** Pretty-printed topology, e.g. "2× (TP=2)", "1P+1D (TP=2/2)". */
  topology: string;
  isl: number;
  osl: number;
  conc: number;
  /** Variant. */
  techniques: Record<string, string | number>;
  variantLabel: string;
  category: TechniqueCategory;
  isBaseline: boolean;
  /** Measurements. */
  tputPerGpu: number;
  medianTpot: number;
  medianIntvty: number;
  /** Deltas vs the baseline in the same group. null when no baseline exists. */
  speedup: number | null;
  tpotRatio: number | null;
  /** Joined eval. null when no matching eval row. */
  accuracy: number | null;
  accuracyDelta: number | null;
  /** Acceptance rate from this variant's metrics (spec-dec only). */
  acceptanceRate: number | null;
  /** Drill-down to the benchmark run. */
  runUrl: string | null;
}

function groupKey(
  r: Pick<
    BenchmarkRow,
    | 'model'
    | 'hardware'
    | 'framework'
    | 'precision'
    | 'isl'
    | 'osl'
    | 'conc'
    | 'num_prefill_gpu'
    | 'num_decode_gpu'
    | 'prefill_tp'
    | 'decode_tp'
    | 'disagg'
  >,
): string {
  // Topology dims (num_*_gpu, *_tp, disagg) are part of the deployment
  // context — a 1× H100 and a 2× H100 run are different deployments and must
  // not collapse into the same row group.
  return [
    r.model,
    r.hardware,
    r.framework,
    r.precision,
    r.isl,
    r.osl,
    r.conc,
    r.num_prefill_gpu,
    r.num_decode_gpu,
    r.prefill_tp,
    r.decode_tp,
    r.disagg ? '1' : '0',
  ].join('|');
}

function topologyLabel(r: {
  num_prefill_gpu: number;
  num_decode_gpu: number;
  prefill_tp: number;
  decode_tp: number;
  disagg: boolean;
}): string {
  if (r.disagg) {
    return `${r.num_prefill_gpu}P+${r.num_decode_gpu}D (TP=${r.prefill_tp}/${r.decode_tp})`;
  }
  return `${r.num_prefill_gpu}× (TP=${r.prefill_tp})`;
}

/**
 * Tag a techniques jsonb with the category that best describes the knob being
 * tuned. Used to drive the filter chip group on /evaluation.
 */
export function categorizeTechniques(t: Record<string, string | number>): TechniqueCategory {
  if (Object.keys(t).length === 0) return 'baseline';
  if (typeof t.spec_method === 'string' && t.spec_method !== 'none') return 'spec-decoding';
  if (t.max_num_batched_tokens !== undefined) return 'batch-size';
  if (t.kv_cache_dtype !== undefined) return 'kv-cache';
  if (t.prefix_cache !== undefined) return 'prefix-cache';
  return 'other';
}

function accuracyKey(r: {
  model: string;
  hardware: string;
  framework: string;
  precision: string;
}): string {
  return `${r.model}|${r.hardware}|${r.framework}|${r.precision}`;
}

/**
 * Stable label for a techniques jsonb. Empty object → "baseline"; otherwise a
 * short, human-readable summary. Insertion order is preserved from
 * `parseTechniques()` so the label is deterministic.
 */
function specMethodLabel(sm: string): string {
  // Short codes (mtp, eagle, ntp, medusa) → ALL CAPS; longer names get title-cased.
  return sm.length <= 6 ? sm.toUpperCase() : sm.charAt(0).toUpperCase() + sm.slice(1);
}

export function describeTechniques(t: Record<string, string | number>): string {
  const keys = Object.keys(t);
  if (keys.length === 0) return 'baseline';
  const sm = t.spec_method;
  const n = t.num_speculative_tokens;
  if (typeof sm === 'string' && sm !== 'none' && typeof n === 'number') {
    return `${specMethodLabel(sm)}×${n}`;
  }
  if (typeof sm === 'string' && sm !== 'none') {
    return specMethodLabel(sm);
  }
  return keys.map((k) => `${k}=${t[k]}`).join(' · ');
}

function isBaseline(t: Record<string, string | number>): boolean {
  if (Object.keys(t).length === 0) return true;
  return t.spec_method === 'none';
}

/**
 * KNOWN LIMITATION (post migration-006/007 revert, see chore/sync-dev-with-master):
 * `benchmark_results.techniques` (a per-measurement JSONB bag of
 * spec_method/num_speculative_tokens/max_num_batched_tokens/kv_cache_dtype/
 * prefix_cache) was dropped when the schema reverted to master's single
 * `configs.spec_method` column. This shim reconstructs only the `spec_method`
 * key from `BenchmarkRow.spec_method` so Recipe Comparison keeps working for
 * its most common case (spec-decoding variants). It CANNOT recover:
 *   - num_speculative_tokens (e.g. MTP×4 vs MTP×6 collapse into one variant —
 *     they also collide at the DB level now since the unique constraint no
 *     longer includes techniques, so one silently overwrites the other on
 *     ingest).
 *   - max_num_batched_tokens / kv_cache_dtype / prefix_cache — the
 *     'batch-size' / 'kv-cache' / 'prefix-cache' filter chips in
 *     TECHNIQUE_CATEGORIES will never match any row.
 * Follow-up: either reintroduce a narrower technique-tracking column (a design
 * discussion, not a merge-conflict resolution) or scope this feature down to
 * spec_method-only comparisons explicitly.
 */
function techniquesFromRow(r: Pick<BenchmarkRow, 'spec_method'>): Record<string, string | number> {
  return r.spec_method && r.spec_method !== 'none' ? { spec_method: r.spec_method } : {};
}

export function buildRecipeRows(benchmarks: BenchmarkRow[], evals: EvalRow[]): RecipeRow[] {
  // Index eval rows by accuracy key → latest em_strict.
  const accuracyByKey = new Map<string, number>();
  for (const e of evals) {
    const v = e.metrics?.[ACCURACY_KEY];
    if (typeof v !== 'number') continue;
    accuracyByKey.set(accuracyKey(e), v);
  }

  // Recipe comparison is a fixed-sequence-length feature; agentic_traces rows
  // (isl/osl null) don't have a sequence dimension to group on and are excluded.
  const fixedSeqBenchmarks = benchmarks.filter(
    (b): b is BenchmarkRow & { isl: number; osl: number } => b.isl !== null && b.osl !== null,
  );

  // Bucket benchmark rows by deployment-context groupKey.
  const groups = new Map<string, (BenchmarkRow & { isl: number; osl: number })[]>();
  for (const b of fixedSeqBenchmarks) {
    const k = groupKey(b);
    const existing = groups.get(k);
    if (existing) existing.push(b);
    else groups.set(k, [b]);
  }

  const out: RecipeRow[] = [];
  for (const [k, rows] of groups) {
    const baseline = rows.find((r) => isBaseline(techniquesFromRow(r))) ?? null;
    const baselineAccuracy = baseline ? (accuracyByKey.get(accuracyKey(baseline)) ?? null) : null;
    for (const r of rows) {
      const tput = Number(r.metrics?.tput_per_gpu ?? 0);
      const tpot = Number(r.metrics?.median_tpot ?? 0);
      const intvty = Number(r.metrics?.median_intvty ?? 0);
      const acc = accuracyByKey.get(accuracyKey(r)) ?? null;
      const accept =
        typeof r.metrics?.median_acceptance_rate === 'number'
          ? r.metrics.median_acceptance_rate
          : null;
      const speedup =
        baseline && baseline.metrics?.tput_per_gpu
          ? tput / Number(baseline.metrics.tput_per_gpu)
          : null;
      const tpotRatio =
        baseline && baseline.metrics?.median_tpot
          ? tpot / Number(baseline.metrics.median_tpot)
          : null;
      const techniques = techniquesFromRow(r);
      out.push({
        groupKey: k,
        model: r.model,
        hardware: r.hardware,
        framework: r.framework,
        precision: r.precision,
        numPrefillGpu: r.num_prefill_gpu,
        numDecodeGpu: r.num_decode_gpu,
        prefillTp: r.prefill_tp,
        decodeTp: r.decode_tp,
        disagg: r.disagg,
        topology: topologyLabel(r),
        isl: r.isl,
        osl: r.osl,
        conc: r.conc,
        techniques,
        variantLabel: describeTechniques(techniques),
        category: categorizeTechniques(techniques),
        isBaseline: isBaseline(techniques),
        tputPerGpu: tput,
        medianTpot: tpot,
        medianIntvty: intvty,
        speedup,
        tpotRatio,
        accuracy: acc,
        accuracyDelta: acc !== null && baselineAccuracy !== null ? acc - baselineAccuracy : null,
        acceptanceRate: accept,
        runUrl: r.run_url,
      });
    }
  }

  return out;
}
