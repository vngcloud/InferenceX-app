/**
 * Smoke-test row mapper: raw `smoke_test_results_<stack>` artifact JSON →
 * `LiveCheckParams[]` (one per probe). See design/new-test-design.md.
 *
 * Throughput-test's `sweep[]` is intentionally not handled here — it has no
 * mapper/home yet (see migration 009's header comment).
 */

export interface LiveCheckParams {
  stack: string;
  testType: string;
  runType: string;
  ok: boolean;
  detail: string | null;
  data: Record<string, unknown>;
}

/**
 * Map one `smoke_test_results_<stack>.json` payload to one `LiveCheckParams`
 * per probe in `probes` (currently `metadata` and `tool-calling`).
 *
 * Unknown/malformed input yields an empty array rather than throwing --
 * mirrors the rest of the ETL's "silent row, loud run" skip convention,
 * though callers here just log a count since there's no unmapped-entity
 * concept for this artifact shape.
 *
 * @param raw - Parsed contents of a `smoke_test_results_<stack>.json` file.
 * @returns One `LiveCheckParams` per probe, or `[]` if the artifact is malformed.
 */
export function mapSmokeTestRow(raw: unknown): LiveCheckParams[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const r = raw as Record<string, any>;

  const stack = typeof r.stack === 'string' ? r.stack.toLowerCase() : null;
  const probes = r.probes;
  if (!stack || typeof probes !== 'object' || probes === null) return [];

  const runType = typeof r.run_type === 'string' ? r.run_type.toLowerCase() : 'live-check';

  const rows: LiveCheckParams[] = [];
  for (const [testType, probe] of Object.entries(probes as Record<string, any>)) {
    if (typeof probe !== 'object' || probe === null) continue;
    if (typeof probe.ok !== 'boolean') continue;

    rows.push({
      stack,
      testType: testType.toLowerCase(),
      runType,
      ok: probe.ok,
      detail: typeof probe.detail === 'string' ? probe.detail : null,
      // Field set is probe- and stack-dependent (e.g. disaggregation-only
      // stacks add `disaggregation: true`) -- store verbatim, don't project.
      data: typeof probe.data === 'object' && probe.data !== null ? probe.data : {},
    });
  }
  return rows;
}
