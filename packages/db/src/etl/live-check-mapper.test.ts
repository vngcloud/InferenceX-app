import { describe, it, expect } from 'vitest';
import { mapSmokeTestRow } from './live-check-mapper';

// Real artifact from vngcloud/InferenceX run 29214012782 (smoke-test_results_sglang-vanilla.json).
const REAL_SGLANG_VANILLA = {
  stack: 'sglang-vanilla',
  run_type: 'live-check',
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

    const toolCalling = rows.find((r) => r.testType === 'tool-calling')!;
    expect(toolCalling.ok).toBe(false);
    expect(toolCalling.detail).toContain('did not invoke the tool');
    expect(toolCalling.data.role).toBe('assistant');
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
