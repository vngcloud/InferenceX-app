/**
 * Live-computed per-point metrics derived from the stored aiperf
 * `profile_export.jsonl` blob. These aren't precomputed in the metrics JSONB
 * because they require grouping by `conversation_id` and aggregating per
 * session — work that's cheap once per agentic point but adds up to be
 * meaningful only when actually plotted.
 *
 * - normalized_session_time_s: per the "Mean Normalized Session Time" proposal
 *   (https://gist.github.com/xinli-sw/115d370c17f6d1b977878b68530981fa). Sum of
 *   per-turn `request_latency` per session (inter-turn tool/thinking gaps are
 *   inherently excluded since we only sum the active GPU time, not wallclock).
 *   Each session's time is rescaled by `mean_load / session_load`, where load
 *   is Σ(ISL+OSL) across turns. The plotted value is the mean across sessions.
 *
 * - mean_p90_prefill_tps_per_user: per the same gist's "Prefill" Pareto chart.
 *   Per turn: prefill_tps = ISL / TTFT_seconds. Per session: P90 across its
 *   turns. Across sessions: arithmetic mean. Captures the worst-turn prefill
 *   responsiveness from the end-user perspective.
 */

import { gunzipSync } from 'node:zlib';

import type { DbClient } from '../connection.js';

export interface DerivedAgenticMetric {
  /** benchmark_results.id this entry belongs to. */
  id: number;
  /** Mean normalized session time in seconds. */
  normalized_session_time_s: number | null;
  /** Mean across sessions of (P90 prefill tps/user across the session's turns). */
  mean_p90_prefill_tps_per_user: number | null;
}

export type DerivedAgenticMetricMap = Record<number, DerivedAgenticMetric>;

/**
 * JSONL blobs can be ~1-2 MB compressed (~5-10 MB raw) and Neon's serverless
 * HTTP driver caps responses at 64 MB — chunk to stay well under.
 */
const QUERY_CHUNK_SIZE = 6;

interface RecordMetrics {
  request_latency?: { value?: number; unit?: string } | number;
  time_to_first_token?: { value?: number; unit?: string } | number;
  input_sequence_length?: { value?: number } | number;
  output_sequence_length?: { value?: number } | number;
}

interface RecordMetadata {
  conversation_id?: string;
  turn_index?: number;
  benchmark_phase?: string;
}

interface ProfileRecord {
  metadata?: RecordMetadata;
  metrics?: RecordMetrics;
}

interface TurnFields {
  request_latency_ms: number;
  ttft_ms: number;
  isl: number;
  osl: number;
}

/** Pull a numeric metric out of the {value, unit} envelope (or a bare number). */
function readNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as { value?: unknown }).value;
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

function extractTurn(rec: ProfileRecord): TurnFields | null {
  const m = rec.metrics ?? {};
  const rl = readNum(m.request_latency);
  const tt = readNum(m.time_to_first_token);
  const isl = readNum(m.input_sequence_length);
  const osl = readNum(m.output_sequence_length);
  if (rl === undefined || tt === undefined || isl === undefined || osl === undefined) return null;
  if (rl <= 0 || tt <= 0 || isl <= 0) return null;
  return { request_latency_ms: rl, ttft_ms: tt, isl, osl };
}

/** Linear-interpolated percentile (matches numpy's default linear method). */
function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

function meanOf(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Parse one point's JSONL and return the two derived metrics. Returns
 * `{ session_time: null, prefill: null }` if the blob has no usable records.
 */
export function computeDerivedFromBlob(jsonl: string): {
  normalized_session_time_s: number | null;
  mean_p90_prefill_tps_per_user: number | null;
} {
  // Group records by conversation_id, filter to the profiling phase.
  const bySession = new Map<string, TurnFields[]>();
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let rec: ProfileRecord;
    try {
      rec = JSON.parse(line) as ProfileRecord;
    } catch {
      continue;
    }
    if (rec.metadata?.benchmark_phase && rec.metadata.benchmark_phase !== 'profiling') continue;
    const sid = rec.metadata?.conversation_id;
    if (!sid) continue;
    const turn = extractTurn(rec);
    if (!turn) continue;
    let list = bySession.get(sid);
    if (!list) {
      list = [];
      bySession.set(sid, list);
    }
    list.push(turn);
  }
  if (bySession.size === 0) {
    return { normalized_session_time_s: null, mean_p90_prefill_tps_per_user: null };
  }

  // Per-session aggregates.
  const sessionTimesS: number[] = [];
  const sessionLoads: number[] = [];
  const sessionP90Prefill: number[] = [];
  for (const turns of bySession.values()) {
    let timeMs = 0;
    let load = 0;
    const prefillRates: number[] = [];
    for (const t of turns) {
      timeMs += t.request_latency_ms;
      load += t.isl + t.osl;
      const ttftSec = t.ttft_ms / 1000;
      if (ttftSec > 0) prefillRates.push(t.isl / ttftSec);
    }
    if (load > 0) {
      sessionTimesS.push(timeMs / 1000);
      sessionLoads.push(load);
    }
    if (prefillRates.length > 0) {
      prefillRates.sort((a, b) => a - b);
      sessionP90Prefill.push(quantile(prefillRates, 0.9));
    }
  }

  // Normalized session time: T̃_i = T_i × (mean_load / load_i), then mean.
  let normalized: number | null = null;
  if (sessionTimesS.length > 0) {
    const meanLoad = meanOf(sessionLoads);
    if (meanLoad > 0) {
      const scaled: number[] = [];
      for (let i = 0; i < sessionTimesS.length; i++) {
        const ti = sessionTimesS[i]!;
        const li = sessionLoads[i]!;
        if (li > 0) scaled.push(ti * (meanLoad / li));
      }
      normalized = scaled.length > 0 ? meanOf(scaled) : null;
    }
  }

  const prefill = sessionP90Prefill.length > 0 ? meanOf(sessionP90Prefill) : null;

  return {
    normalized_session_time_s: normalized,
    mean_p90_prefill_tps_per_user: prefill,
  };
}

export async function getDerivedAgenticMetrics(
  sql: DbClient,
  benchmarkResultIds: number[],
): Promise<DerivedAgenticMetricMap> {
  if (benchmarkResultIds.length === 0) return {};

  const rows: { benchmark_result_id: number; blob: Buffer }[] = [];
  for (let i = 0; i < benchmarkResultIds.length; i += QUERY_CHUNK_SIZE) {
    const chunk = benchmarkResultIds.slice(i, i + QUERY_CHUNK_SIZE);
    const chunkRows = (await sql`
      select
        br.id as benchmark_result_id,
        atr.profile_export_jsonl_gz as blob
      from benchmark_results br
      join agentic_trace_replay atr on atr.id = br.trace_replay_id
      where br.id = any(${chunk}::bigint[])
        and atr.profile_export_jsonl_gz is not null
    `) as { benchmark_result_id: number; blob: Buffer }[];
    rows.push(...chunkRows);
  }

  const result: DerivedAgenticMetricMap = {};
  for (const row of rows) {
    try {
      const jsonl = gunzipSync(row.blob).toString('utf8');
      const { normalized_session_time_s, mean_p90_prefill_tps_per_user } =
        computeDerivedFromBlob(jsonl);
      result[Number(row.benchmark_result_id)] = {
        id: Number(row.benchmark_result_id),
        normalized_session_time_s,
        mean_p90_prefill_tps_per_user,
      };
    } catch {
      // Skip malformed blobs silently — frontend treats missing ids as "no data".
    }
  }
  return result;
}
