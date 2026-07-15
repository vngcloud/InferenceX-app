import { describe, it, expect } from 'vitest';
import { mapSmokeTestRow, mapThroughputTestRow } from './live-check-mapper';

// Real artifact from vngcloud/InferenceX run 29220293241 (post gpu_model
// rollout, feat/gpu-model-in-livecheck-artifacts -> merged to main).
const REAL_SGLANG_VANILLA = {
  stack: 'sglang-vanilla',
  run_type: 'live-check',
  gpu_model: 'NVIDIA GeForce RTX 5090',
  probes: {
    metadata: {
      ok: true,
      detail: 'metadata matches expectations',
      data: {
        chart: 'sglang-vanilla-0.1.0',
        framework: 'sglang',
        image: 'registry.example/inference/sglang:some-tag',
        model: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8',
        precision: 'fp8',
        servedName: 'DeepSeek-Coder-V2-Lite-Instruct-FP8',
        tp: 2,
      },
    },
    'tool-calling': {
      ok: false,
      detail:
        'server did not invoke the tool -- got a plain content response instead of tool_calls',
      data: {
        role: 'assistant',
        content: 'I currently don’t have access to real-time weather data...',
        reasoning_content: null,
        tool_calls: null,
      },
    },
  },
};

// Real artifact from the same run, sglang-pd-disaggregation.json -- adds `disaggregation: true`.
const REAL_SGLANG_PD_DISAGG = {
  stack: 'sglang-pd-disaggregation',
  run_type: 'live-check',
  probes: {
    metadata: {
      ok: true,
      detail: 'metadata matches expectations',
      data: {
        chart: 'sglang-pd-disaggregation-0.1.0',
        disaggregation: true,
        framework: 'sglang',
        image: 'registry.example/inference/sglang:some-tag',
        model: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8',
        precision: 'fp8',
        servedName: 'DeepSeek-Coder-V2-Lite-Instruct-FP8',
        tp: 1,
      },
    },
    'tool-calling': {
      ok: false,
      detail: 'server did not invoke the tool',
      data: { role: 'assistant', content: '...', reasoning_content: null, tool_calls: null },
    },
  },
};

describe('mapSmokeTestRow', () => {
  it('maps both probes from a real artifact into separate rows', () => {
    const rows = mapSmokeTestRow(REAL_SGLANG_VANILLA);
    expect(rows).toHaveLength(2);

    const metadata = rows.find((r) => r.testType === 'metadata')!;
    expect(metadata.stack).toBe('sglang-vanilla');
    expect(metadata.runType).toBe('live-check');
    expect(metadata.ok).toBe(true);
    expect(metadata.detail).toBe('metadata matches expectations');
    expect(metadata.data.model).toBe('RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8');
    expect(metadata.data.tp).toBe(2);
    expect(metadata.gpuModel).toBe('NVIDIA GeForce RTX 5090');

    const toolCalling = rows.find((r) => r.testType === 'tool-calling')!;
    expect(toolCalling.ok).toBe(false);
    expect(toolCalling.detail).toContain('did not invoke the tool');
    expect(toolCalling.data.role).toBe('assistant');
    expect(toolCalling.gpuModel).toBe('NVIDIA GeForce RTX 5090');
  });

  it('defaults gpuModel to null for artifacts predating the gpu_model field', () => {
    const rows = mapSmokeTestRow(REAL_SGLANG_PD_DISAGG);
    expect(rows[0].gpuModel).toBeNull();
  });

  it('still ingests a run whose smoke test failed overall (conclusion !== success)', () => {
    // Design doc: smoke-test intentionally exits non-zero when any probe
    // fails but still uploads a valid artifact -- ok:false rows must map.
    const rows = mapSmokeTestRow(REAL_SGLANG_VANILLA);
    const toolCalling = rows.find((r) => r.testType === 'tool-calling')!;
    expect(toolCalling.ok).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('preserves stack-specific metadata fields verbatim (e.g. disaggregation)', () => {
    const rows = mapSmokeTestRow(REAL_SGLANG_PD_DISAGG);
    const metadata = rows.find((r) => r.testType === 'metadata')!;
    expect(metadata.data.disaggregation).toBe(true);
    expect(metadata.stack).toBe('sglang-pd-disaggregation');
  });

  it('lowercases stack, test_type, and run_type', () => {
    const rows = mapSmokeTestRow({
      stack: 'Sglang-Vanilla',
      run_type: 'Live-Check',
      probes: { Metadata: { ok: true, data: {} } },
    });
    expect(rows[0].stack).toBe('sglang-vanilla');
    expect(rows[0].testType).toBe('metadata');
    expect(rows[0].runType).toBe('live-check');
  });

  it('returns [] for malformed input', () => {
    expect(mapSmokeTestRow(null)).toEqual([]);
    expect(mapSmokeTestRow({})).toEqual([]);
    expect(mapSmokeTestRow({ stack: 'x' })).toEqual([]);
    expect(mapSmokeTestRow({ stack: 'x', probes: null })).toEqual([]);
  });

  it('skips a probe missing a boolean ok field', () => {
    const rows = mapSmokeTestRow({
      stack: 'x',
      probes: { metadata: { detail: 'no ok field', data: {} }, 'tool-calling': { ok: true } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].testType).toBe('tool-calling');
  });
});

// Real artifact from vngcloud/InferenceX run 29220857835
// (feat/throughput-config-snapshot -> merged to main, PR #24).
const REAL_THROUGHPUT_PD_DISAGG = {
  stack: 'sglang-pd-disaggregation',
  test_type: 'throughput',
  run_type: 'live-check',
  ok: true,
  detail: 'completed sweep at conc=[1, 8, 16]',
  data: {
    dataset: 'semianalysis_cc_traces_weka',
    num_dataset_entries: 20,
    gpu_model: 'NVIDIA GeForce RTX 5090',
    framework: 'sglang',
    precision: 'fp8',
    tp: 1,
    disaggregation: true,
    sweep: [
      { conc: 1, model_id: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8', max_concurrency: 1 },
      { conc: 8, model_id: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8', max_concurrency: 8 },
      { conc: 16, model_id: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8', max_concurrency: 16 },
    ],
    redeployed_mid_run: false,
  },
};

// Real artifact from run 29221316729, sglang-vanilla -- no `disaggregation`
// key (only pd-disaggregation reports it), and `redeployed_mid_run: null`
// (the post-sweep /version re-check itself failed, e.g. transient 503).
const REAL_THROUGHPUT_VANILLA_UNCONFIRMED = {
  stack: 'sglang-vanilla',
  test_type: 'throughput',
  run_type: 'live-check',
  ok: true,
  detail: 'completed sweep at conc=[1, 8, 16]',
  data: {
    dataset: 'semianalysis_cc_traces_weka',
    num_dataset_entries: 20,
    gpu_model: 'NVIDIA GeForce RTX 5090',
    framework: 'sglang',
    precision: 'fp8',
    tp: 2,
    sweep: [
      { conc: 1, model_id: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8', max_concurrency: 1 },
      { conc: 8, model_id: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8', max_concurrency: 8 },
      { conc: 16, model_id: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8', max_concurrency: 16 },
    ],
    redeployed_mid_run: null,
  },
};

describe('mapThroughputTestRow', () => {
  it('maps a real throughput artifact into a single throughput row', () => {
    const rows = mapThroughputTestRow(REAL_THROUGHPUT_PD_DISAGG);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.stack).toBe('sglang-pd-disaggregation');
    expect(row.testType).toBe('throughput');
    expect(row.runType).toBe('live-check');
    expect(row.ok).toBe(true);
    expect(row.detail).toBe('completed sweep at conc=[1, 8, 16]');
    expect(row.gpuModel).toBe('NVIDIA GeForce RTX 5090');
    expect(row.data.framework).toBe('sglang');
    expect(row.data.precision).toBe('fp8');
    expect(row.data.tp).toBe(1);
    expect(row.data.disaggregation).toBe(true);
    expect(Array.isArray(row.data.sweep)).toBe(true);
    expect((row.data.sweep as unknown[]).length).toBe(3);
  });

  it('handles a stack with no disaggregation field and an unconfirmed redeploy check', () => {
    const rows = mapThroughputTestRow(REAL_THROUGHPUT_VANILLA_UNCONFIRMED);
    const row = rows[0];
    expect(row.data.disaggregation).toBeUndefined();
    // null means "unconfirmed" (the /version re-check itself failed), distinct
    // from a confirmed-false -- must be preserved, not coerced to a boolean.
    expect(row.data.redeployed_mid_run).toBeNull();
  });

  it('returns [] for malformed input', () => {
    expect(mapThroughputTestRow(null)).toEqual([]);
    expect(mapThroughputTestRow({})).toEqual([]);
    expect(mapThroughputTestRow({ stack: 'x' })).toEqual([]);
    expect(mapThroughputTestRow({ stack: 'x', ok: 'not-a-bool' })).toEqual([]);
  });

  it('defaults gpuModel to null when data.gpu_model is absent', () => {
    const rows = mapThroughputTestRow({
      stack: 'x',
      ok: true,
      data: { dataset: 'd', sweep: [] },
    });
    expect(rows[0].gpuModel).toBeNull();
  });

  it('lowercases stack and run_type', () => {
    const rows = mapThroughputTestRow({
      stack: 'Sglang-Vanilla',
      run_type: 'Live-Check',
      ok: true,
      data: {},
    });
    expect(rows[0].stack).toBe('sglang-vanilla');
    expect(rows[0].runType).toBe('live-check');
  });
});
