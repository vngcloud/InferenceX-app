/**
 * Smoke-test and throughput-test row mappers: raw
 * `smoke_test_results_<stack>` / `throughput_test_results_<stack>` artifact
 * JSON → `LiveCheckParams[]`. See design/new-test-design.md.
 *
 * Throughput's `sweep[]` lands here (as one `test_type: 'throughput'` row's
 * `data`), not in `benchmark_results` -- the real-trace dataset
 * (`semianalysis_cc_traces_weka`) has no fixed isl/osl per sweep point
 * (variable-length requests, not a synthetic fixed shape), which
 * `benchmark_results` structurally requires. See migration 009's header
 * comment.
 */

export interface LiveCheckParams {
  stack: string;
  testType: string;
  runType: string;
  ok: boolean;
  detail: string | null;
  data: Record<string, unknown>;
  gpuModel: string | null;
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
  // Snapshotted once per stack (DCGM `modelName`, e.g. "NVIDIA GeForce RTX
  // 5090") -- verbatim, not a lookup key. Older artifacts predate this field.
  const gpuModel = typeof r.gpu_model === 'string' ? r.gpu_model : null;

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
      gpuModel,
    });
  }
  return rows;
}

/**
 * Map one `throughput_test_results_<stack>.json` payload to a single
 * `LiveCheckParams` (`test_type: 'throughput'`). `data` (dataset,
 * num_dataset_entries, gpu_model, framework, precision, tp, disaggregation,
 * sweep[], redeployed_mid_run) is stored verbatim, same "snapshot upstream
 * as-is" convention as `mapSmokeTestRow`.
 *
 * Note `data.redeployed_mid_run` can be `true`/`false`/`null` --
 * `null` means "unconfirmed" (the post-sweep `/version` re-check itself
 * failed, e.g. a transient 503), distinct from a confirmed-`false`. Callers
 * charting this data should treat `null` the same as `true` (don't chart)
 * unless they specifically want to distinguish "confirmed stable" from
 * "unconfirmed."
 *
 * @param raw - Parsed contents of a `throughput_test_results_<stack>.json` file.
 * @returns A one-element array with the mapped row, or `[]` if malformed.
 */
export function mapThroughputTestRow(raw: unknown): LiveCheckParams[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const r = raw as Record<string, any>;

  const stack = typeof r.stack === 'string' ? r.stack.toLowerCase() : null;
  if (!stack || typeof r.ok !== 'boolean') return [];

  const runType = typeof r.run_type === 'string' ? r.run_type.toLowerCase() : 'live-check';
  const data = typeof r.data === 'object' && r.data !== null ? r.data : {};
  const gpuModel = typeof data.gpu_model === 'string' ? data.gpu_model : null;

  return [
    {
      stack,
      testType: 'throughput',
      runType,
      ok: r.ok,
      detail: typeof r.detail === 'string' ? r.detail : null,
      data,
      gpuModel,
    },
  ];
}
