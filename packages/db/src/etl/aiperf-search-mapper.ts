/**
 * AIPerf search-ladder reader.
 *
 * Fastfood benchmark runs do not emit the standard `results_bmk` artifact. Instead
 * each run ships an `aiperf_search_*` artifact: an AIPerf max-concurrency-under-SLA
 * *search* whose every iteration is one candidate at one concurrency. We ingest the
 * **full ladder** (every candidate, feasible or not) so the existing
 * throughput-vs-latency charts render the whole capacity curve — one
 * `benchmark_results` row per concurrency. See `docs/adr/0001`.
 *
 * This module only *reads and shapes* the raw artifact into synthetic benchmark
 * rows. The rows are then fed through the existing `mapBenchmarkRow()` so config
 * resolution, normalization, metric auto-capture, and dedup are all reused.
 *
 * Field mapping mirrors `aiperf-service-docs/scripts/aiperf_candidate_table.py`,
 * reading from the source-of-truth `profile_export_aiperf.json` per iteration.
 * Latency metrics are converted ms→s to match the `METRIC_KEYS` convention
 * (all values in seconds unless noted); throughput is divided by GPU count so it
 * is stored per-GPU.
 */

import fs from 'node:fs';
import path from 'node:path';

/** A synthetic raw benchmark row, shaped exactly like a `results_bmk` dict so it
 * can be passed straight to `mapBenchmarkRow()`. Identity fields drive config
 * resolution; canonical `METRIC_KEYS` fields are auto-captured into metrics. */
export type AiperfRawRow = Record<string, number | string | boolean | null>;

interface SlugInfo {
  model: string;
  isl: number;
  osl: number;
  precision: string;
  engine: string;
  tp: number;
  ep: number;
  disagg: boolean;
  hw: string;
}

const GPU_TOKEN = /_((?:h|b)\d{3}|gb\d{3}|mi\d{3}x)-/u;
/** Compact workload token "8k1k" / "16k1k" — values are in units of 1024 tokens. */
const WORKLOAD_K_TOKEN = /^(\d+)k(\d+)k$/u;
/** A single raw integer token (e.g. "16384", "1024"). */
const INT_TOKEN = /^\d+$/u;
/** Smallest ISL we treat as a workload anchor — guards against a stray small int
 * inside a model name being mistaken for the sequence-length pair. */
const MIN_WORKLOAD_ISL = 256;

/**
 * Parse an `aiperf_search_*` artifact directory name into config identity.
 *
 * Two workload-token spellings exist in the wild, depending on the InferenceX
 * config that produced the run:
 *   A. compact "<n>k<m>k"      → `..._8k1k_bf16_vllm_...`        (×1024)
 *   B. raw "<isl>_<osl>" pair  → `..._16384_1024_bf16_vllm_...`  (token counts)
 * Both are accepted; the workload token(s) anchor model (before) and
 * precision/engine (after).
 *
 * Example:
 *   aiperf_search_qwen3.5-27b_8k1k_bf16_vllm_aiperf_tp1-ep1-dpafalse_disagg-false_spec-none_n_mnbt_conc1000_h200-greennode_00
 *   → { model: 'qwen3.5-27b', isl: 8192, osl: 1024, precision: 'bf16',
 *       engine: 'vllm', tp: 1, ep: 1, disagg: false, hw: 'h200' }
 *
 * @returns Parsed identity, or `null` if the name lacks a workload token (in which
 *   case the caller should skip the directory).
 */
export function parseAiperfSlug(dirName: string): SlugInfo | null {
  const base = dirName.replace(/^aiperf_search_/u, '');
  const parts = base.split('_');

  let isl: number;
  let osl: number;
  let wlIdx: number; // index of the first workload token
  let afterIdx: number; // index of the precision token (just past the workload)

  // Format A: a single "<n>k<m>k" token.
  const kIdx = parts.findIndex((p) => WORKLOAD_K_TOKEN.test(p));
  if (kIdx > 0) {
    const wl = WORKLOAD_K_TOKEN.exec(parts[kIdx])!;
    isl = parseInt(wl[1], 10) * 1024;
    osl = parseInt(wl[2], 10) * 1024;
    wlIdx = kIdx;
    afterIdx = kIdx + 1;
  } else {
    // Format B: two consecutive raw integer tokens "<isl>_<osl>" (token counts,
    // not ×1024). Require isl ≥ MIN_WORKLOAD_ISL so a small int in the model name
    // can't be mistaken for the pair.
    const pairIdx = parts.findIndex(
      (p, i) =>
        INT_TOKEN.test(p) &&
        parseInt(p, 10) >= MIN_WORKLOAD_ISL &&
        i + 1 < parts.length &&
        INT_TOKEN.test(parts[i + 1]),
    );
    if (pairIdx <= 0) return null;
    isl = parseInt(parts[pairIdx], 10);
    osl = parseInt(parts[pairIdx + 1], 10);
    wlIdx = pairIdx;
    afterIdx = pairIdx + 2;
  }

  const model = parts.slice(0, wlIdx).join('_');
  const precision = parts[afterIdx] ?? '';
  const engine = parts[afterIdx + 1] ?? '';

  const tpEp = /tp(\d+)-ep(\d+)/u.exec(base);
  const tp = tpEp ? parseInt(tpEp[1], 10) : 1;
  const ep = tpEp ? parseInt(tpEp[2], 10) : 1;

  const disagg = /disagg-true/u.test(base);

  const gpu = GPU_TOKEN.exec(base);
  const hw = gpu ? gpu[1] : '';

  if (!model || !precision || !engine || !hw) return null;
  return { model, isl, osl, precision, engine, tp, ep, disagg, hw };
}

type StatKey = 'avg' | 'p50' | 'p90' | 'p99' | 'std';

/** Read a numeric stat from an AIPerf metric object, trying alternative metric
 * names in order. Returns `undefined` when absent. */
function stat(
  data: Record<string, any>,
  names: string[],
  key: StatKey = 'avg',
): number | undefined {
  for (const name of names) {
    const obj = data[name];
    if (obj && typeof obj === 'object') {
      const v = obj[key];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

/** Concurrency of an iteration: the `profiling` phase concurrency in input_config. */
function concurrencyOf(data: Record<string, any>): number | undefined {
  const phases: any[] = data?.input_config?.phases ?? [];
  const profiling =
    phases.find((p) => p?.name === 'profiling') ??
    phases.find((p) => typeof p?.concurrency === 'number');
  const c = profiling?.concurrency;
  return typeof c === 'number' ? c : undefined;
}

/** Assign `dst[key] = ms/1000` (ms→s) when `ms` is defined. */
function setSec(dst: AiperfRawRow, key: string, ms: number | undefined): void {
  if (ms !== undefined) dst[key] = ms / 1000;
}

/**
 * Convert one iteration's `profile_export_aiperf.json` into a synthetic raw row.
 * Combines parsed slug identity with extracted, unit-normalized metrics.
 *
 * @returns The row, or `null` if concurrency or core throughput is missing.
 */
function rowFromProfile(slug: SlugInfo, data: Record<string, any>): AiperfRawRow | null {
  const conc = concurrencyOf(data);
  const total = stat(data, ['total_token_throughput']);
  const output = stat(data, ['output_token_throughput']);
  if (conc === undefined || total === undefined || output === undefined) return null;

  const gpu = Math.max(1, slug.tp * slug.ep);

  const row: AiperfRawRow = {
    // ── identity (drives config resolution + isl/osl/conc routing) ──
    infmax_model_prefix: slug.model,
    model: slug.model,
    hw: slug.hw,
    framework: slug.engine,
    precision: slug.precision,
    disagg: slug.disagg,
    tp: slug.tp,
    ep: slug.ep,
    isl: slug.isl, // from slug, not measured avg, to hit registered seq pairs exactly
    osl: slug.osl,
    conc,
    // ── throughput, stored per-GPU (METRIC_KEYS convention) ──
    tput_per_gpu: total / gpu,
    output_tput_per_gpu: output / gpu,
    input_tput_per_gpu: (total - output) / gpu,
  };

  // TTFT (ms→s)
  const ttft = ['time_to_first_token', 'time_to_first_output_token'];
  setSec(row, 'median_ttft', stat(data, ttft, 'p50'));
  setSec(row, 'p90_ttft', stat(data, ttft, 'p90'));
  setSec(row, 'p99_ttft', stat(data, ttft, 'p99'));
  setSec(row, 'mean_ttft', stat(data, ttft, 'avg'));
  setSec(row, 'std_ttft', stat(data, ttft, 'std'));

  // ITL / TPOT — for non-speculative runs they are the same series (ms→s)
  const itl = ['inter_token_latency', 'inter_chunk_latency'];
  const itlStats: [StatKey, string, string][] = [
    ['p50', 'median_itl', 'median_tpot'],
    ['p90', 'p90_itl', 'p90_tpot'],
    ['p99', 'p99_itl', 'p99_tpot'],
    ['avg', 'mean_itl', 'mean_tpot'],
    ['std', 'std_itl', 'std_tpot'],
  ];
  for (const [src, dstItl, dstTpot] of itlStats) {
    const v = stat(data, itl, src);
    setSec(row, dstItl, v);
    setSec(row, dstTpot, v);
  }

  // E2E latency (ms→s)
  const e2e = ['request_latency', 'e2e_request_latency'];
  setSec(row, 'median_e2el', stat(data, e2e, 'p50'));
  setSec(row, 'p90_e2el', stat(data, e2e, 'p90'));
  setSec(row, 'p99_e2el', stat(data, e2e, 'p99'));
  setSec(row, 'mean_e2el', stat(data, e2e, 'avg'));
  setSec(row, 'std_e2el', stat(data, e2e, 'std'));

  // Interactivity (tokens/sec/user) — authoritative per-user throughput distribution.
  const intvty = ['output_token_throughput_per_user', 'e2e_output_token_throughput'];
  const medIntvty = stat(data, intvty, 'p50');
  const itlP50 = stat(data, itl, 'p50');
  // Fall back to 1000/ITL_p50 when the per-user series omits p50.
  row.median_intvty = medIntvty ?? (itlP50 ? 1000 / itlP50 : 0);
  const meanIntvty = stat(data, intvty, 'avg');
  if (meanIntvty !== undefined) row.mean_intvty = meanIntvty;
  const p90Intvty = stat(data, intvty, 'p90');
  if (p90Intvty !== undefined) row.p90_intvty = p90Intvty;
  const p99Intvty = stat(data, intvty, 'p99');
  if (p99Intvty !== undefined) row.p99_intvty = p99Intvty;

  return row;
}

/**
 * Read every candidate from one `aiperf_search_*` artifact directory.
 *
 * Walks each `search_iter_<n>/profile_runs/run_0001/profile_export_aiperf.json`. The
 * directory name supplies config identity; each iteration's profile export
 * supplies metrics and concurrency. Feasibility is intentionally not read — all
 * candidates are ingested (ADR 0001).
 *
 * @param dir - Absolute path to one `aiperf_search_*` artifact directory.
 * @returns Synthetic raw rows ready for `mapBenchmarkRow()`. Empty if the slug
 *   is unparseable or no readable iterations exist.
 */
export function readAiperfSearchDir(dir: string): AiperfRawRow[] {
  const slug = parseAiperfSlug(path.basename(dir));
  if (!slug) return [];

  const iterDirs = fs
    .readdirSync(dir)
    .filter((d) => d.startsWith('search_iter_'))
    .toSorted();

  const rows: AiperfRawRow[] = [];
  for (const iter of iterDirs) {
    const profile = path.join(dir, iter, 'profile_runs', 'run_0001', 'profile_export_aiperf.json');
    if (!fs.existsSync(profile)) continue;
    let data: Record<string, any>;
    try {
      data = JSON.parse(fs.readFileSync(profile, 'utf8'));
    } catch {
      continue;
    }
    const row = rowFromProfile(slug, data);
    if (row) rows.push(row);
  }
  return rows;
}
