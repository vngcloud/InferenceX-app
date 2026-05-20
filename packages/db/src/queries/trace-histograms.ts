/**
 * Fetch per-request ISL/OSL arrays from stored aiperf `profile_export.jsonl`
 * blobs (gzipped in `agentic_trace_replay.profile_export_jsonl_gz`). Caller
 * passes the set of `benchmark_results.id`s it wants and receives one entry
 * per id that actually has a trace_replay blob (others are silently skipped).
 *
 * The JSONL has one JSON object per request with the shape:
 *   { metrics: { input_sequence_length: { value, unit }, output_sequence_length: {...}, ... } }
 *
 * Returns raw arrays rather than pre-binned histograms — payload stays tiny
 * (~256 ints * 2 fields per point, ~2 KB compressed) and the frontend can bin
 * however it wants.
 */

import { gunzipSync } from 'node:zlib';

import type { DbClient } from '../connection.js';

export interface TraceHistogramPoint {
  /** benchmark_results.id this entry belongs to. */
  id: number;
  /** Input sequence length (tokens) per completed request. */
  isl: number[];
  /** Output sequence length (tokens) per completed request. */
  osl: number[];
}

export type TraceHistogramMap = Record<number, TraceHistogramPoint>;

export async function getTraceHistograms(
  sql: DbClient,
  benchmarkResultIds: number[],
): Promise<TraceHistogramMap> {
  if (benchmarkResultIds.length === 0) return {};

  const rows = (await sql`
    select
      br.id as benchmark_result_id,
      atr.profile_export_jsonl_gz as blob
    from benchmark_results br
    join agentic_trace_replay atr on atr.id = br.trace_replay_id
    where br.id = any(${benchmarkResultIds}::bigint[])
      and atr.profile_export_jsonl_gz is not null
  `) as { benchmark_result_id: number; blob: Buffer }[];

  const result: TraceHistogramMap = {};
  for (const row of rows) {
    try {
      const jsonl = gunzipSync(row.blob).toString('utf8');
      const isl: number[] = [];
      const osl: number[] = [];
      for (const line of jsonl.split('\n')) {
        if (!line) continue;
        let rec: { metrics?: Record<string, { value?: number } | number> };
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        const m = rec.metrics ?? {};
        const islVal = readMetric(m['input_sequence_length']);
        const oslVal = readMetric(m['output_sequence_length']);
        if (typeof islVal === 'number' && Number.isFinite(islVal)) isl.push(islVal);
        if (typeof oslVal === 'number' && Number.isFinite(oslVal)) osl.push(oslVal);
      }
      result[Number(row.benchmark_result_id)] = {
        id: Number(row.benchmark_result_id),
        isl,
        osl,
      };
    } catch {
      // Drop malformed blobs silently — caller treats missing ids as "no data".
    }
  }
  return result;
}

function readMetric(v: { value?: number } | number | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v;
  return v.value;
}
