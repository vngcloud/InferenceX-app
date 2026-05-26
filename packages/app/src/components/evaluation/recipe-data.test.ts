import { describe, expect, it } from 'vitest';

import type { BenchmarkRow, EvalRow } from '@/lib/api';

import { buildRecipeRows, describeTechniques } from './recipe-data';

function bmk(overrides: Partial<BenchmarkRow>): BenchmarkRow {
  return {
    hardware: 'h100',
    framework: 'vllm',
    model: 'gemma4',
    precision: 'fp8',
    spec_method: 'none',
    techniques: {},
    disagg: false,
    is_multinode: false,
    prefill_tp: 2,
    prefill_ep: 1,
    prefill_dp_attention: false,
    prefill_num_workers: 0,
    decode_tp: 2,
    decode_ep: 1,
    decode_dp_attention: false,
    decode_num_workers: 0,
    num_prefill_gpu: 2,
    num_decode_gpu: 2,
    isl: 1024,
    osl: 1024,
    conc: 8,
    image: null,
    metrics: { tput_per_gpu: 100, median_tpot: 0.01 },
    date: '2026-05-25',
    run_url: 'https://github.com/vngcloud/InferenceX/actions/runs/1',
    ...overrides,
  };
}

describe('describeTechniques', () => {
  it('labels empty object as baseline', () => {
    expect(describeTechniques({})).toBe('baseline');
  });

  it('labels spec_method + token count compactly', () => {
    expect(describeTechniques({ spec_method: 'mtp', num_speculative_tokens: 4 })).toBe('MTP×4');
    expect(describeTechniques({ spec_method: 'mtp', num_speculative_tokens: 6 })).toBe('MTP×6');
    expect(describeTechniques({ spec_method: 'eagle', num_speculative_tokens: 3 })).toBe('EAGLE×3');
  });

  it('falls back to formatted spec_method', () => {
    expect(describeTechniques({ spec_method: 'eagle' })).toBe('EAGLE');
  });
});

describe('buildRecipeRows', () => {
  it('computes speedup vs baseline within a group', () => {
    const rows = buildRecipeRows(
      [
        bmk({ techniques: {}, metrics: { tput_per_gpu: 100, median_tpot: 0.01 } }),
        bmk({
          techniques: { spec_method: 'mtp', num_speculative_tokens: 4 },
          metrics: { tput_per_gpu: 150, median_tpot: 0.0067 },
        }),
      ],
      [],
    );
    expect(rows).toHaveLength(2);
    const baseline = rows.find((r) => r.isBaseline)!;
    const mtp = rows.find((r) => !r.isBaseline)!;
    expect(baseline.speedup).toBe(1);
    expect(mtp.speedup).toBeCloseTo(1.5, 3);
    expect(mtp.tpotRatio).toBeCloseTo(0.67, 2);
  });

  it('returns null speedup when no baseline exists in the group', () => {
    // Two MTP variants, no spec_method=none baseline.
    const rows = buildRecipeRows(
      [
        bmk({
          techniques: { spec_method: 'mtp', num_speculative_tokens: 4 },
          metrics: { tput_per_gpu: 120 },
        }),
        bmk({
          techniques: { spec_method: 'mtp', num_speculative_tokens: 6 },
          metrics: { tput_per_gpu: 140 },
        }),
      ],
      [],
    );
    for (const r of rows) {
      expect(r.isBaseline).toBe(false);
      expect(r.speedup).toBeNull();
      expect(r.tpotRatio).toBeNull();
    }
  });

  it('groups by (model, hw, framework, precision, isl, osl, conc) and not by techniques', () => {
    const rows = buildRecipeRows(
      [
        bmk({ techniques: {} }),
        bmk({ techniques: { spec_method: 'mtp', num_speculative_tokens: 4 } }),
        bmk({ techniques: { spec_method: 'mtp', num_speculative_tokens: 6 } }),
        // Different conc → different group, no shared baseline.
        bmk({ techniques: { spec_method: 'mtp', num_speculative_tokens: 4 }, conc: 16 }),
      ],
      [],
    );
    expect(rows).toHaveLength(4);
    const groupKeys = new Set(rows.map((r) => r.groupKey));
    expect(groupKeys.size).toBe(2);
  });

  it('joins accuracy from eval rows at the (model, hw, framework, precision) level', () => {
    const ev: EvalRow = {
      id: 1,
      config_id: 1,
      hardware: 'h100',
      framework: 'vllm',
      model: 'gemma4',
      precision: 'fp8',
      spec_method: 'none',
      techniques: {},
      disagg: false,
      is_multinode: false,
      prefill_tp: 2,
      prefill_ep: 1,
      prefill_dp_attention: false,
      prefill_num_workers: 0,
      decode_tp: 2,
      decode_ep: 1,
      decode_dp_attention: false,
      decode_num_workers: 0,
      num_prefill_gpu: 2,
      num_decode_gpu: 2,
      task: 'gsm8k',
      date: '2026-05-25',
      conc: null,
      metrics: { em_strict: 0.842 },
      timestamp: '2026-05-25T00:00:00Z',
      run_url: null,
    };
    const rows = buildRecipeRows([bmk({ techniques: {} })], [ev]);
    expect(rows[0]?.accuracy).toBeCloseTo(0.842, 5);
  });

  it('reads acceptance rate from variant metrics', () => {
    const rows = buildRecipeRows(
      [
        bmk({
          techniques: { spec_method: 'mtp', num_speculative_tokens: 4 },
          metrics: { tput_per_gpu: 150, median_acceptance_rate: 0.78 },
        }),
      ],
      [],
    );
    expect(rows[0]?.acceptanceRate).toBeCloseTo(0.78, 5);
  });
});
