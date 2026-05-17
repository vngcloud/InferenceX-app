'use client';

import { useMemo, useState } from 'react';
import { HelpCircle } from 'lucide-react';

import { useInference } from '@/components/inference/InferenceContext';
import type { InferenceData } from '@/components/inference/types';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { track } from '@/lib/analytics';
import { getHardwareConfig } from '@/lib/constants';
import { aucUnderFrontier, interpAlongFrontier, paretoFrontier, type Point2D } from '@/lib/pareto';
import { cn, getDisplayLabel } from '@/lib/utils';

/**
 * Default baseline preferences. We resolve to whichever enabled config best
 * matches each name; if none match we fall back to the first enabled config.
 */
const DEFAULT_THROUGHPUT_BASELINE_HINTS = ['mi355x_sglang'];
const DEFAULT_AUC_PRIMARY_HINTS = ['b200_sglang'];
const DEFAULT_AUC_SECONDARY_HINTS = ['mi355x_sglang'];
const DEFAULT_AUC_TERTIARY_HINTS = ['mi355x_atom'];

interface ConfigSeries {
  hwKey: string;
  label: string;
  frontier: Point2D[];
}

/**
 * Pick the enabled hwKey whose lowercase string contains all hint tokens
 * (e.g. 'mi355x_sglang' matches 'mi355x_sglang' but NOT 'mi355x_sglang_mtp').
 * The hint should NOT match the `_mtp` variant by default — we prefer the
 * non-MTP entry. Returns null when no enabled config matches.
 */
function pickDefaultBaseline(
  enabledKeys: string[],
  hints: string[],
  excludeMtp = true,
): string | null {
  for (const hint of hints) {
    const lcHint = hint.toLowerCase();
    const match = enabledKeys.find((k) => {
      const lc = k.toLowerCase();
      if (!lc.includes(lcHint)) return false;
      if (excludeMtp && lc.endsWith('_mtp')) return false;
      return true;
    });
    if (match) return match;
  }
  return null;
}

/** Format a non-negative integer with thousands separators. */
function formatInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance for an sRGB color. */
function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

const RATIO_CAP_HI = 3;
const RATIO_CAP_LO = 1 / 3;

/**
 * Map a ratio (other / baseline) to a red→white→green color, centered at 1.0×
 * and log-symmetric. ratio = 1   → white; ratio ≥ 3   → fully green; ratio ≤
 * 1/3 → fully red. Anything between interpolates linearly in log space so that
 * "2×" and "0.5×" land at symmetric saturations. Returns { background, color }
 * with the WCAG-derived text color.
 */
function ratioColor(ratio: number): { background: string; color: string } {
  const clamped = Math.max(RATIO_CAP_LO, Math.min(RATIO_CAP_HI, ratio));
  // log-symmetric t in [-1, 1]: t=0 at 1.0, t=+1 at cap-hi, t=-1 at cap-lo.
  const t = Math.log(clamped) / Math.log(RATIO_CAP_HI);
  let r: number;
  let g: number;
  let b: number;
  if (t >= 0) {
    // white → green
    // green target: #15803d (rgb 21, 128, 61) — Tailwind green-700
    r = Math.round(255 + (21 - 255) * t);
    g = Math.round(255 + (128 - 255) * t);
    b = Math.round(255 + (61 - 255) * t);
  } else {
    // white → red
    // red target: #b91c1c (rgb 185, 28, 28) — Tailwind red-700
    const u = -t;
    r = Math.round(255 + (185 - 255) * u);
    g = Math.round(255 + (28 - 255) * u);
    b = Math.round(255 + (28 - 255) * u);
  }
  const lum = relativeLuminance(r, g, b);
  const color = lum > 0.45 ? '#0a0a0a' : '#ffffff';
  return { background: `rgb(${r}, ${g}, ${b})`, color };
}

const INFINITY_BG_POS = '#14532d'; // dark green (green-900) for ∞ (other defined, baseline missing)
const ZERO_BG = '#7f1d1d'; // dark red (red-900) for 0× (other missing, baseline defined)
const SELF_BG = '#fbbf24'; // amber-400 for baseline-vs-self
const COL_MAX_BG = '#bbf7d0'; // green-200 for best per column in throughput

/**
 * Build per-config Pareto frontiers from filtered InferenceData. Filters by
 * selected precisions + active legend toggles, then groups by hwKey and runs
 * the shared 2-D Pareto algorithm on (x, y) = (interactivity, tok/s/gpu).
 */
function useConfigSeries(): ConfigSeries[] {
  const { graphs, activeHwTypes, selectedPrecisions, hardwareConfig } = useInference();
  return useMemo(() => {
    const interactivityGraph = graphs.find((g) => g.chartDefinition.chartType === 'interactivity');
    if (!interactivityGraph) return [];

    // Group filtered points by hwKey.
    const byHw = new Map<string, InferenceData[]>();
    for (const d of interactivityGraph.data) {
      const hw = String(d.hwKey);
      if (activeHwTypes.size > 0 && !activeHwTypes.has(hw)) continue;
      if (!selectedPrecisions.includes(d.precision)) continue;
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) continue;
      const arr = byHw.get(hw) ?? [];
      arr.push(d);
      byHw.set(hw, arr);
    }

    const result: ConfigSeries[] = [];
    for (const [hwKey, points] of byHw) {
      if (points.length < 2) continue;
      const frontier = paretoFrontier(points.map((p) => ({ x: p.x, y: p.y })));
      if (frontier.length < 2) continue;
      const hwConfig = hardwareConfig[hwKey] ?? getHardwareConfig(hwKey);
      result.push({ hwKey, label: getDisplayLabel(hwConfig), frontier });
    }
    // Order: same as legend (hardwareConfig insertion order, already sorted by
    // model sort index in InferenceContext).
    const order = Object.keys(hardwareConfig);
    result.sort((a, b) => {
      const ai = order.indexOf(a.hwKey);
      const bi = order.indexOf(b.hwKey);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });
    return result;
  }, [graphs, activeHwTypes, selectedPrecisions, hardwareConfig]);
}

interface BaselineSelectProps {
  value: string;
  onChange: (next: string) => void;
  configs: ConfigSeries[];
  label: string;
  testId?: string;
}

function BaselineSelect({ value, onChange, configs, label, testId }: BaselineSelectProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground whitespace-nowrap">{label}:</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 min-w-[14rem] text-sm" data-testid={testId}>
          <SelectValue placeholder="Select baseline" />
        </SelectTrigger>
        <SelectContent>
          {configs.map((c) => (
            <SelectItem key={c.hwKey} value={c.hwKey}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InfoIcon({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Info"
          >
            <HelpCircle className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

/** Per-interactivity throughput table + linked percent-diff heatmap. */
function ThroughputAndDiffTable({ configs }: { configs: ConfigSeries[] }) {
  // Compute buckets: every 10 from 10 up through floor(globalMax / 10) * 10.
  // (Using floor ensures the last bucket is always one a config actually reaches,
  // not a bucket beyond every config's reachable interactivity.)
  const buckets = useMemo(() => {
    let globalMax = 0;
    for (const c of configs) {
      const maxX = c.frontier.at(-1)?.x ?? 0;
      if (maxX > globalMax) globalMax = maxX;
    }
    const hi = Math.floor(globalMax / 10) * 10;
    const out: number[] = [];
    for (let v = 10; v <= hi; v += 10) out.push(v);
    return out;
  }, [configs]);

  // Per-(config, bucket) throughput cell, with the column-max highlight.
  const tputCells = useMemo(() => {
    const grid: (number | null)[][] = configs.map((c) =>
      buckets.map((b) => interpAlongFrontier(c.frontier, b)),
    );
    const colMaxRow: (number | null)[] = buckets.map((_, ci) => {
      let m: number | null = null;
      for (const row of grid) {
        const v = row[ci];
        if (v !== null && (m === null || v > m)) m = v;
      }
      return m;
    });
    return { grid, colMaxRow };
  }, [configs, buckets]);

  // Baseline selection for the percent-diff sub-table.
  const enabledKeys = configs.map((c) => c.hwKey);
  const defaultBaseline =
    pickDefaultBaseline(enabledKeys, DEFAULT_THROUGHPUT_BASELINE_HINTS) ?? enabledKeys[0] ?? '';
  const [baselineKey, setBaselineKey] = useState<string>(defaultBaseline);
  // If the previously-picked baseline isn't enabled anymore, snap to the default.
  const effectiveBaseline = enabledKeys.includes(baselineKey) ? baselineKey : defaultBaseline;
  const baselineRow = useMemo(() => {
    const idx = configs.findIndex((c) => c.hwKey === effectiveBaseline);
    if (idx === -1) return null;
    return tputCells.grid[idx];
  }, [configs, tputCells, effectiveBaseline]);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Per-GPU throughput at each interactivity bucket</h2>
          <InfoIcon
            text={
              'For each enabled config we compute the Pareto frontier of token throughput per GPU vs interactivity, ' +
              "then read off the throughput at every 10 tok/s/user step. Em-dash means that interactivity is outside the config's reachable range. " +
              'Best value per column is highlighted in green.'
            }
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm mt-1 mb-4">
        Linearly interpolated tok/s/gpu along each config&apos;s Pareto frontier. Reactive to model,
        precision, sequence and the legend on/off toggles above.
      </p>

      {configs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Enable at least one configuration in the legend to populate the tables.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card text-left font-medium px-2 py-1.5 border-b border-border whitespace-nowrap">
                  Config
                </th>
                {buckets.map((b) => (
                  <th
                    key={b}
                    className="text-right font-medium px-2 py-1.5 border-b border-border tabular-nums"
                  >
                    {b}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-10 bg-card text-left text-muted-foreground font-normal px-2 py-1 border-b border-border whitespace-nowrap">
                  Interactivity (tok/s/user) →
                </th>
                <th
                  className="text-right text-muted-foreground font-normal px-2 py-1 border-b border-border"
                  colSpan={buckets.length}
                />
              </tr>
            </thead>
            <tbody>
              {configs.map((c, ri) => (
                <tr key={c.hwKey} className="border-b border-border last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card text-left font-medium px-2 py-1.5 whitespace-nowrap">
                    {c.label}
                  </td>
                  {buckets.map((b, ci) => {
                    const v = tputCells.grid[ri][ci];
                    if (v === null) {
                      return (
                        <td
                          key={b}
                          className="text-right px-2 py-1.5 tabular-nums text-muted-foreground"
                        >
                          —
                        </td>
                      );
                    }
                    const isMax = tputCells.colMaxRow[ci] === v;
                    return (
                      <td
                        key={b}
                        className={cn('text-right px-2 py-1.5 tabular-nums', isMax && 'font-bold')}
                        style={
                          isMax ? { backgroundColor: COL_MAX_BG, color: '#0a0a0a' } : undefined
                        }
                      >
                        {formatInt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {configs.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">Ratio vs baseline</h3>
              <InfoIcon
                text={
                  'other / baseline at each bucket, rendered as Nx. "∞" means the baseline cannot reach that interactivity but the other config can; "0×" the reverse; "—" means neither can. Color scale is centered at 1.00× and log-symmetric, saturating at 3.00× (green) and 0.33× (red).'
                }
              />
            </div>
            <BaselineSelect
              label="Baseline"
              configs={configs}
              value={effectiveBaseline}
              onChange={(v) => {
                setBaselineKey(v);
                track('inference_throughput_baseline_changed', { baseline: v });
              }}
              testId="throughput-baseline-select"
            />
          </div>
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card text-left font-medium px-2 py-1.5 border-b border-border whitespace-nowrap">
                    Config
                  </th>
                  {buckets.map((b) => (
                    <th
                      key={b}
                      className="text-right font-medium px-2 py-1.5 border-b border-border tabular-nums"
                    >
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {configs.map((c, ri) => (
                  <tr key={c.hwKey} className="border-b border-border last:border-b-0">
                    <td className="sticky left-0 z-10 bg-card text-left font-medium px-2 py-1.5 whitespace-nowrap">
                      {c.label}
                    </td>
                    {buckets.map((b, ci) => {
                      const other = tputCells.grid[ri][ci];
                      const baseline = baselineRow ? baselineRow[ci] : null;
                      const isSelf = c.hwKey === effectiveBaseline;

                      if (isSelf) {
                        return (
                          <td
                            key={b}
                            className="text-right px-2 py-1.5 tabular-nums"
                            style={{ backgroundColor: SELF_BG, color: '#0a0a0a' }}
                          >
                            1.00×
                          </td>
                        );
                      }

                      if (other === null && baseline === null) {
                        return (
                          <td
                            key={b}
                            className="text-right px-2 py-1.5 tabular-nums text-muted-foreground"
                          >
                            —
                          </td>
                        );
                      }
                      if (other !== null && baseline === null) {
                        return (
                          <td
                            key={b}
                            className="text-right px-2 py-1.5 tabular-nums font-semibold"
                            style={{ backgroundColor: INFINITY_BG_POS, color: '#ffffff' }}
                          >
                            ∞
                          </td>
                        );
                      }
                      if (other === null && baseline !== null) {
                        return (
                          <td
                            key={b}
                            className="text-right px-2 py-1.5 tabular-nums font-semibold"
                            style={{ backgroundColor: ZERO_BG, color: '#ffffff' }}
                          >
                            0×
                          </td>
                        );
                      }
                      const ratio = other! / baseline!;
                      const { background, color } = ratioColor(ratio);
                      return (
                        <td
                          key={b}
                          className="text-right px-2 py-1.5 tabular-nums"
                          style={{ backgroundColor: background, color }}
                        >
                          {ratio.toFixed(2)}×
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

/** AUC summary table with three baseline columns. */
function AucSummaryTable({ configs }: { configs: ConfigSeries[] }) {
  const hi = useMemo(() => {
    let globalMax = 0;
    for (const c of configs) {
      const maxX = c.frontier.at(-1)?.x ?? 0;
      if (maxX > globalMax) globalMax = maxX;
    }
    return Math.floor(globalMax / 10) * 10;
  }, [configs]);

  const aucs = useMemo(
    () => configs.map((c) => aucUnderFrontier(c.frontier, 10, hi)),
    [configs, hi],
  );

  const enabledKeys = configs.map((c) => c.hwKey);
  const defaultPrimary =
    pickDefaultBaseline(enabledKeys, DEFAULT_AUC_PRIMARY_HINTS) ?? enabledKeys[0] ?? '';
  const defaultSecondary =
    pickDefaultBaseline(enabledKeys, DEFAULT_AUC_SECONDARY_HINTS) ?? enabledKeys[0] ?? '';
  const defaultTertiary =
    pickDefaultBaseline(enabledKeys, DEFAULT_AUC_TERTIARY_HINTS, false) ?? enabledKeys[0] ?? '';

  const [primary, setPrimary] = useState<string>(defaultPrimary);
  const [secondary, setSecondary] = useState<string>(defaultSecondary);
  const [tertiary, setTertiary] = useState<string>(defaultTertiary);

  const eff = (s: string, d: string) => (enabledKeys.includes(s) ? s : d);
  const ePrimary = eff(primary, defaultPrimary);
  const eSecondary = eff(secondary, defaultSecondary);
  const eTertiary = eff(tertiary, defaultTertiary);

  const baselineAuc = (key: string): number | null => {
    const i = configs.findIndex((c) => c.hwKey === key);
    return i === -1 ? null : aucs[i];
  };

  const primaryAuc = baselineAuc(ePrimary);
  const secondaryAuc = baselineAuc(eSecondary);
  const tertiaryAuc = baselineAuc(eTertiary);

  const ratioCell = (auc: number, baseline: number | null, baselineKey: string, hwKey: string) => {
    if (baseline === null || baseline === 0) return { text: '—', style: undefined };
    const ratio = auc / baseline;
    if (hwKey === baselineKey) {
      return {
        text: '1.00×',
        style: { backgroundColor: SELF_BG, color: '#0a0a0a' },
      };
    }
    const { background, color } = ratioColor(ratio);
    return {
      text: `${ratio.toFixed(2)}×`,
      style: { backgroundColor: background, color },
    };
  };

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Area under Pareto frontier (AUC summary)</h2>
        <InfoIcon
          text={
            `Trapezoidal area under each config's tok/s/gpu vs interactivity Pareto frontier, integrated from 10 to ${hi} tok/s/user. ` +
            "Outside a config's reachable interactivity range the integrand is treated as 0. " +
            'Units: (tok/s/gpu) × (tok/s/user). Higher is better — a config that reaches both high interactivity AND high throughput scores best.'
          }
        />
      </div>
      <p className="text-muted-foreground text-sm mt-1 mb-4">
        Integration window: 10 → {hi} tok/s/user.
      </p>

      {configs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Enable at least one configuration in the legend to populate the AUC summary.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
            <BaselineSelect
              label="Primary baseline"
              configs={configs}
              value={ePrimary}
              onChange={(v) => {
                setPrimary(v);
                track('inference_auc_primary_baseline_changed', { baseline: v });
              }}
              testId="auc-primary-baseline-select"
            />
            <BaselineSelect
              label="Secondary baseline"
              configs={configs}
              value={eSecondary}
              onChange={(v) => {
                setSecondary(v);
                track('inference_auc_secondary_baseline_changed', { baseline: v });
              }}
              testId="auc-secondary-baseline-select"
            />
            <BaselineSelect
              label="Tertiary baseline"
              configs={configs}
              value={eTertiary}
              onChange={(v) => {
                setTertiary(v);
                track('inference_auc_tertiary_baseline_changed', { baseline: v });
              }}
              testId="auc-tertiary-baseline-select"
            />
          </div>
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left font-medium px-2 py-1.5 whitespace-nowrap">Config</th>
                  <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">AUC</th>
                  <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">
                    Ratio vs primary
                  </th>
                  <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">
                    Ratio vs secondary
                  </th>
                  <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">
                    Ratio vs tertiary
                  </th>
                </tr>
              </thead>
              <tbody>
                {configs.map((c, i) => {
                  const auc = aucs[i];
                  const primaryR = ratioCell(auc, primaryAuc, ePrimary, c.hwKey);
                  const secondaryR = ratioCell(auc, secondaryAuc, eSecondary, c.hwKey);
                  const tertiaryR = ratioCell(auc, tertiaryAuc, eTertiary, c.hwKey);
                  return (
                    <tr key={c.hwKey} className="border-b border-border last:border-b-0">
                      <td className="text-left font-medium px-2 py-1.5 whitespace-nowrap">
                        {c.label}
                      </td>
                      <td className="text-right tabular-nums px-2 py-1.5">{formatInt(auc)}</td>
                      <td className="text-right tabular-nums px-2 py-1.5" style={primaryR.style}>
                        {primaryR.text}
                      </td>
                      <td className="text-right tabular-nums px-2 py-1.5" style={secondaryR.style}>
                        {secondaryR.text}
                      </td>
                      <td className="text-right tabular-nums px-2 py-1.5" style={tertiaryR.style}>
                        {tertiaryR.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Section that renders the two summary tables below the Pareto chart on the
 * inference page. Only shown when the active y-axis metric is "Token
 * Throughput per GPU" — the AUC + interactivity framing assumes that metric.
 */
export default function InteractivityTables() {
  const { selectedYAxisMetric } = useInference();
  const configs = useConfigSeries();

  if (selectedYAxisMetric !== 'y_tpPerGpu') return null;

  return (
    <>
      <ThroughputAndDiffTable configs={configs} />
      <AucSummaryTable configs={configs} />
    </>
  );
}
