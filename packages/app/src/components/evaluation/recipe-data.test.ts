import { describe, expect, it } from 'vitest';

import type { BenchmarkRow, EvalRow } from '@/lib/api';

import { buildRecipeRows, categorizeTechniques, describeTechniques } from './recipe-data';

function bmk(overrides: Partial<BenchmarkRow>): BenchmarkRow {
  return {
    hardware: 'h100',
    framework: 'vllm',
    model: 'gemma4',
    precision: 'fp8',
    spec_method: 'none',
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
  } as BenchmarkRow;
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
  // NOTE: the `techniques` JSONB bag (spec_method + num_speculative_tokens +
  // max_num_batched_tokens + kv_cache_dtype + prefix_cache) was reverted along
  // with migrations 006/007 (see chore/sync-dev-with-master). BenchmarkRow now
  // only carries `spec_method`, so these tests exercise spec_method-only
  // variants; they can no longer express distinct num_speculative_tokens /
  // batch-size / kv-cache / prefix-cache variants at the BenchmarkRow level
  // (see the KNOWN LIMITATION comment in recipe-data.ts).
  it('computes speedup vs baseline within a group', () => {
    const rows = buildRecipeRows(
      [
        bmk({ spec_method: 'none', metrics: { tput_per_gpu: 100, median_tpot: 0.01 } }),
        bmk({
          spec_method: 'mtp',
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
    // Two spec-decoding variants, no spec_method=none baseline.
    const rows = buildRecipeRows(
      [
        bmk({ spec_method: 'mtp', metrics: { tput_per_gpu: 120 } }),
        bmk({ spec_method: 'eagle', metrics: { tput_per_gpu: 140 } }),
      ],
      [],
    );
    for (const r of rows) {
      expect(r.isBaseline).toBe(false);
      expect(r.speedup).toBeNull();
      expect(r.tpotRatio).toBeNull();
    }
  });

  it('groups by (model, hw, framework, precision, isl, osl, conc) and not by spec_method', () => {
    const rows = buildRecipeRows(
      [
        bmk({ spec_method: 'none' }),
        bmk({ spec_method: 'mtp' }),
        bmk({ spec_method: 'eagle' }),
        // Different conc → different group, no shared baseline.
        bmk({ spec_method: 'mtp', conc: 16 }),
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
    const rows = buildRecipeRows([bmk({ spec_method: 'none' })], [ev]);
    expect(rows[0]?.accuracy).toBeCloseTo(0.842, 5);
  });

  it('separates 1× and 2× H100 into distinct groups via topology in groupKey', () => {
    const rows = buildRecipeRows(
      [
        bmk({
          num_prefill_gpu: 1,
          num_decode_gpu: 1,
          prefill_tp: 1,
          decode_tp: 1,
          spec_method: 'none',
        }),
        bmk({
          num_prefill_gpu: 2,
          num_decode_gpu: 2,
          prefill_tp: 2,
          decode_tp: 2,
          spec_method: 'mtp',
        }),
      ],
      [],
    );
    expect(new Set(rows.map((r) => r.groupKey)).size).toBe(2);
    const oneXh = rows.find((r) => r.numPrefillGpu === 1)!;
    const twoXh = rows.find((r) => r.numPrefillGpu === 2)!;
    expect(oneXh.topology).toBe('1× (TP=1)');
    expect(twoXh.topology).toBe('2× (TP=2)');
  });

  it('tags rows with technique category for filter chips', () => {
    expect(categorizeTechniques({})).toBe('baseline');
    expect(categorizeTechniques({ spec_method: 'mtp', num_speculative_tokens: 4 })).toBe(
      'spec-decoding',
    );
    expect(categorizeTechniques({ max_num_batched_tokens: 4096 })).toBe('batch-size');
    expect(categorizeTechniques({ kv_cache_dtype: 'fp8' })).toBe('kv-cache');
    expect(categorizeTechniques({ prefix_cache: 'true' })).toBe('prefix-cache');
  });

  it('reads acceptance rate from variant metrics', () => {
    const rows = buildRecipeRows(
      [
        bmk({
          spec_method: 'mtp',
          metrics: { tput_per_gpu: 150, median_acceptance_rate: 0.78 },
        }),
      ],
      [],
    );
    expect(rows[0]?.acceptanceRate).toBeCloseTo(0.78, 5);
  });
});
