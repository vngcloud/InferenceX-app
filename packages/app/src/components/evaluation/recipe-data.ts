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

export interface RecipeRow {
  groupKey: string;
  /** Identity (constant within a group). */
  model: string;
  hardware: string;
  framework: string;
  precision: string;
  isl: number;
  osl: number;
  conc: number;
  /** Variant. */
  techniques: Record<string, string | number>;
  variantLabel: string;
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
  r: Pick<BenchmarkRow, 'model' | 'hardware' | 'framework' | 'precision' | 'isl' | 'osl' | 'conc'>,
): string {
  return `${r.model}|${r.hardware}|${r.framework}|${r.precision}|${r.isl}|${r.osl}|${r.conc}`;
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

export function buildRecipeRows(benchmarks: BenchmarkRow[], evals: EvalRow[]): RecipeRow[] {
  // Index eval rows by accuracy key → latest em_strict.
  const accuracyByKey = new Map<string, number>();
  for (const e of evals) {
    const v = e.metrics?.[ACCURACY_KEY];
    if (typeof v !== 'number') continue;
    accuracyByKey.set(accuracyKey(e), v);
  }

  // Bucket benchmark rows by deployment-context groupKey.
  const groups = new Map<string, BenchmarkRow[]>();
  for (const b of benchmarks) {
    const k = groupKey(b);
    const existing = groups.get(k);
    if (existing) existing.push(b);
    else groups.set(k, [b]);
  }

  const out: RecipeRow[] = [];
  for (const [k, rows] of groups) {
    const baseline = rows.find((r) => isBaseline(r.techniques)) ?? null;
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
      out.push({
        groupKey: k,
        model: r.model,
        hardware: r.hardware,
        framework: r.framework,
        precision: r.precision,
        isl: r.isl,
        osl: r.osl,
        conc: r.conc,
        techniques: r.techniques ?? {},
        variantLabel: describeTechniques(r.techniques ?? {}),
        isBaseline: isBaseline(r.techniques ?? {}),
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
