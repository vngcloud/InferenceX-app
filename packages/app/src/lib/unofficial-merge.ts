/**
 * Helpers for promoting unofficial-run benchmark rows to first-class
 * "ingested-style" series so they participate in the regular scatter
 * filter pipeline (Optimal-only, hardware toggles, precision filter, etc.)
 * instead of being rendered as a separate overlay layer.
 *
 * Each (run, original hwKey) pair gets a synthesized hardware key of the form
 *   `${origHwKey}__uorun${runId}`
 * — preserving the base GPU as `hwKey.split('_')[0]` so `getModelSortIndex`
 * and `isKnownGpu` keep working — while still being unique per run so a single
 * job with multiple GPUs surfaces as separate legend entries, and multiple
 * runs don't collapse onto each other.
 */
import type {
  ChartDefinition,
  HardwareConfig,
  InferenceData,
  RenderableGraph,
} from '@/components/inference/types';
import { processOverlayChartData } from '@/components/inference/utils';
import type { HardwareEntry } from '@/lib/constants';
import { overlayRunIndex } from '@/lib/overlay-run-style';

const SYNTH_KEY_DELIM = '__uorun';

export interface UnofficialRunInfoLite {
  id: number;
  branch: string;
  url: string;
}

export interface OverlayChartGroup {
  e2e: { data: InferenceData[]; gpus: HardwareConfig };
  interactivity: { data: InferenceData[]; gpus: HardwareConfig };
}

export type UnofficialChartDataMap = Record<string, OverlayChartGroup>;

/** Build a unique per-run hwKey while keeping the original GPU base prefix. */
export function makeSynthHwKey(origHwKey: string, runId: number): string {
  return `${origHwKey}${SYNTH_KEY_DELIM}${runId}`;
}

/** Reverse the encoding produced by {@link makeSynthHwKey}. */
export function parseSynthHwKey(hwKey: string): { origHwKey: string; runId: number } | null {
  const idx = hwKey.indexOf(SYNTH_KEY_DELIM);
  if (idx === -1) return null;
  const origHwKey = hwKey.slice(0, idx);
  const runId = Number(hwKey.slice(idx + SYNTH_KEY_DELIM.length));
  if (!Number.isFinite(runId)) return null;
  return { origHwKey, runId };
}

export function isSynthHwKey(hwKey: string): boolean {
  return hwKey.includes(SYNTH_KEY_DELIM);
}

function makeSynthHardwareEntry(
  origEntry: HardwareEntry | undefined,
  origHwKey: string,
  run: UnofficialRunInfoLite,
  synthHwKey: string,
): HardwareEntry {
  const branch = run.branch || `run ${run.id}`;
  const baseLabel = origEntry?.label ?? origHwKey;
  // Legend label intentionally drops the branch — the color (assigned by the
  // shared vendor-zone palette) is what disambiguates runs/GPUs visually.
  // Branch + run URL stay in `gpu` so the row tooltip still shows provenance.
  return {
    name: synthHwKey.replaceAll('_', '-'),
    label: baseLabel,
    suffix: origEntry?.suffix ?? '',
    gpu: origEntry?.gpu ? `${origEntry.gpu} (UNOFFICIAL: ${branch})` : `UNOFFICIAL: ${branch}`,
    framework: origEntry?.framework,
  };
}

interface MergeArgs {
  graphs: RenderableGraph[];
  hardwareConfig: HardwareConfig;
  /**
   * Per-(model_sequence) overlay chart data, indexed exactly as produced by
   * {@link unofficial-run-provider#buildChartData}. We look up the entry for
   * the currently-selected `${model}_${sequence}` key.
   */
  unofficialChartData: UnofficialChartDataMap | null;
  selectedModel: string;
  selectedSequence: string;
  selectedYAxisMetric: string;
  selectedXAxisMetric: string | null;
  selectedE2eXAxisMetric: string | null;
  runIndexByUrl: Record<string, number>;
  unofficialRunInfos: UnofficialRunInfoLite[];
  /**
   * Chart definitions to fall back on when `graphs` is empty. Lets the merger
   * synthesize stub graphs so unofficial-only data (e.g. a model with no DB
   * coverage but an unofficial sweep) still renders when the toggle is on.
   * Optional — when omitted and `graphs` is empty, the merge is a no-op.
   */
  chartDefinitions?: ChartDefinition[];
}

export interface MergeResult {
  graphs: RenderableGraph[];
  hardwareConfig: HardwareConfig;
  /**
   * Map from synth hwKey → CSS color. ScatterGraph consults this before falling
   * back to vendor colors. Currently empty — synth keys preserve the original
   * GPU base prefix (`b200_vllm__uorun123`), so the standard
   * `generateVendorColors` pipeline picks a vendor-appropriate hue for each
   * synth key automatically. The override map is retained so callers can still
   * pin a specific color per synth key if needed.
   */
  colorOverrides: Record<string, string>;
}

/**
 * Inject overlay rows into the official `graphs` as first-class points with
 * synthesized per-run hwKeys, returning extended `hardwareConfig` and a
 * color-override map for ScatterGraph's `resolveColor`.
 *
 * If `unofficialChartData` is null or has no rows for the selected
 * (model, sequence), the result mirrors the input verbatim — the merge is a
 * no-op and downstream behavior is unchanged.
 */
export function mergeUnofficialIntoOfficial(args: MergeArgs): MergeResult {
  const {
    graphs: inputGraphs,
    hardwareConfig,
    unofficialChartData,
    selectedModel,
    selectedSequence,
    selectedYAxisMetric,
    selectedXAxisMetric,
    selectedE2eXAxisMetric,
    runIndexByUrl,
    unofficialRunInfos,
    chartDefinitions,
  } = args;

  const dataKey = `${selectedModel}_${selectedSequence}`;
  const overlayGroup = unofficialChartData?.[dataKey];
  if (!overlayGroup) {
    return { graphs: inputGraphs, hardwareConfig, colorOverrides: {} };
  }

  // When there are no official graphs but caller supplied chartDefinitions,
  // synthesize empty stubs so the merge still has a place to inject points.
  const graphs: RenderableGraph[] =
    inputGraphs.length === 0 && chartDefinitions
      ? buildStubGraphsForMerge(selectedModel, selectedSequence, chartDefinitions)
      : inputGraphs;

  const mergedHardwareConfig: HardwareConfig = { ...hardwareConfig };
  const colorOverrides: Record<string, string> = {};

  /**
   * Process overlay rows for one chart type: re-key by (run, origHwKey),
   * synthesize a HardwareEntry on first encounter, and apply the same
   * metric/x-axis pipeline that `useChartData` runs on official rows so the
   * resulting points sit in the same coordinate space.
   *
   * No color override is set: the synth hwKey preserves the original GPU base
   * prefix, so the standard vendor-zone color generator distributes hues
   * across all (official + synth) keys for a vendor automatically — that's
   * how two NVIDIA GPUs from one unofficial run end up as different shades
   * of green rather than two copies of the same overlay-palette color.
   */
  const processForChart = (
    chartType: 'e2e' | 'interactivity',
    rawRows: InferenceData[],
    overlayHwConfig: HardwareConfig,
  ): InferenceData[] => {
    if (rawRows.length === 0) return [];
    const effectiveXMetric = chartType === 'e2e' ? selectedE2eXAxisMetric : selectedXAxisMetric;
    const processed = processOverlayChartData(
      rawRows,
      chartType,
      selectedYAxisMetric,
      effectiveXMetric,
    );
    return processed.map((row) => {
      const runIdx = overlayRunIndex(row.run_url ?? null, runIndexByUrl);
      const run = unofficialRunInfos[runIdx] ?? unofficialRunInfos[0];
      // No runs known (defensive — provider always populates one when overlay
      // data exists). Fall back to the original hwKey untouched.
      if (!run) return row;
      const origHwKey = String(row.hwKey);
      const synthHwKey = makeSynthHwKey(origHwKey, run.id);
      if (!(synthHwKey in mergedHardwareConfig)) {
        const origEntry = hardwareConfig[origHwKey] ?? overlayHwConfig[origHwKey];
        mergedHardwareConfig[synthHwKey] = makeSynthHardwareEntry(
          origEntry,
          origHwKey,
          run,
          synthHwKey,
        );
      }
      return { ...row, hwKey: synthHwKey };
    });
  };

  const mergedGraphs: RenderableGraph[] = graphs.map((g) => {
    const ct = g.chartDefinition.chartType as 'e2e' | 'interactivity';
    const overlayRows = ct === 'e2e' ? overlayGroup.e2e.data : overlayGroup.interactivity.data;
    const overlayHwCfg = ct === 'e2e' ? overlayGroup.e2e.gpus : overlayGroup.interactivity.gpus;
    const merged = processForChart(ct, overlayRows, overlayHwCfg);
    if (merged.length === 0) return g;
    return { ...g, data: [...g.data, ...merged] };
  });

  return {
    graphs: mergedGraphs,
    hardwareConfig: mergedHardwareConfig,
    colorOverrides,
  };
}

/**
 * Build empty-data stub graphs from chart definitions, used when the official
 * model has no DB data but we still want the unofficial rows to render after
 * merge. Mirrors `effectiveGraphs` in ChartDisplay's no-data fallback.
 */
export function buildStubGraphsForMerge(
  selectedModel: string,
  selectedSequence: string,
  chartDefinitions: ChartDefinition[],
): RenderableGraph[] {
  return chartDefinitions.map((chartDefinition) => ({
    model: selectedModel,
    sequence: selectedSequence,
    chartDefinition,
    data: [] as InferenceData[],
  }));
}
