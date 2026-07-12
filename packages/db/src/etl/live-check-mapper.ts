/**
 * Live-check reader — post-deploy smoke tests (`metadata`, `tool-calling`) and a
 * short live throughput sanity sweep (`throughput`), from InferenceX's
 * `smoke-test.yml` workflow. Artifact name `smoke_test_results_<stack>`, one
 * JSON envelope per stack per run. See design/new-test-design.md.
 *
 * Unlike the benchmark mappers, this data has no numeric-metric sweep axis for
 * two of its three probes, and the `stack` string is a deploy name, not a
 * `configs` row — so this mapper deliberately does not resolve a `config_id`
 * and instead feeds a dedicated `live_check_results` table (migration 009).
 */

import fs from 'node:fs';
import path from 'node:path';

const KNOWN_PROBE_TYPES = new Set(['metadata', 'tool-calling', 'throughput']);

export interface LiveCheckRow {
  stack: string;
  probeType: string;
  runType: string;
  ok: boolean;
  detail: string | null;
  data: Record<string, unknown>;
}

interface ProbeResult {
  ok?: unknown;
  detail?: unknown;
  data?: unknown;
}

/**
 * Shape one `smoke_test_results_*` envelope (already-parsed JSON) into one row
 * per probe present. Probes with an unrecognized key are skipped (forward
 * compatibility with a future probe type InferenceX-app doesn't know about yet).
 *
 * @returns Rows, or `[]` if the envelope lacks a `stack` or `probes` object.
 */
export function mapLiveCheckEnvelope(envelope: Record<string, any>): LiveCheckRow[] {
  const stack = typeof envelope.stack === 'string' ? envelope.stack : null;
  const probes = envelope.probes;
  if (!stack || !probes || typeof probes !== 'object') return [];

  const runType = typeof envelope.run_type === 'string' ? envelope.run_type : 'live-check';

  const rows: LiveCheckRow[] = [];
  for (const [probeType, result] of Object.entries(probes as Record<string, ProbeResult>)) {
    if (!KNOWN_PROBE_TYPES.has(probeType)) continue;
    if (!result || typeof result !== 'object') continue;
    if (typeof result.ok !== 'boolean') continue;

    rows.push({
      stack,
      probeType,
      runType,
      ok: result.ok,
      detail: typeof result.detail === 'string' ? result.detail : null,
      data: (result.data ?? {}) as Record<string, unknown>,
    });
  }
  return rows;
}

/**
 * Read every JSON file in one `smoke_test_results_*` artifact directory and
 * shape it into `live_check_results` rows.
 *
 * @param dir - Absolute path to one `smoke_test_results_<stack>` artifact directory.
 * @returns Rows across all envelope files found; empty if none are parseable.
 */
export function readLiveCheckDir(dir: string): LiveCheckRow[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const rows: LiveCheckRow[] = [];
  for (const file of files) {
    let envelope: Record<string, any>;
    try {
      envelope = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    rows.push(...mapLiveCheckEnvelope(envelope));
  }
  return rows;
}
