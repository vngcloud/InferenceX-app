import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAiperfSlug, readAiperfSearchDir } from './aiperf-search-mapper';

describe('parseAiperfSlug', () => {
  it('parses a qwen 8k1k bf16 vllm tp1 H200 artifact name', () => {
    const name =
      'aiperf_search_qwen3.5-27b_8k1k_bf16_vllm_aiperf_tp1-ep1-dpafalse_disagg-false_spec-none_n_mnbt_conc1000_h200-greennode_00';
    expect(parseAiperfSlug(name)).toEqual({
      model: 'qwen3.5-27b',
      isl: 8192,
      osl: 1024,
      precision: 'bf16',
      engine: 'vllm',
      tp: 1,
      ep: 1,
      disagg: false,
      hw: 'h200',
    });
  });

  it('parses 16k1k, tp2, sglang on H100', () => {
    const name =
      'aiperf_search_gemma4_16k1k_fp8_sglang_aiperf_tp2-ep1-dpafalse_disagg-false_spec-none_n_mnbt_conc512_h100-greennode_01';
    expect(parseAiperfSlug(name)).toMatchObject({
      model: 'gemma4',
      isl: 16384,
      osl: 1024,
      precision: 'fp8',
      engine: 'sglang',
      tp: 2,
      ep: 1,
      hw: 'h100',
    });
  });

  it('detects disagg-true', () => {
    const name = 'aiperf_search_gemma4_8k1k_fp8_sglang_tp4-ep1-dpafalse_disagg-true_conc256_h200-greennode_00';
    expect(parseAiperfSlug(name)?.disagg).toBe(true);
  });

  it('returns null when no workload token is present', () => {
    expect(parseAiperfSlug('aiperf_search_qwen3.5-27b_bf16_vllm_conc256_h200-greennode_00')).toBeNull();
  });
});

/** Build a minimal AIPerf metric object: avg + the percentiles/std the mapper reads. */
function metric(avg: number, extra: Record<string, number> = {}): Record<string, number> {
  return { avg, p50: avg, p90: avg, p99: avg, std: 0, ...extra };
}

/** Write one search-iteration profile export under a fixture artifact directory. */
function writeIter(artDir: string, iter: number, concurrency: number, body: Record<string, any>): void {
  const dir = path.join(artDir, `search_iter_${String(iter).padStart(4, '0')}`, 'profile_runs', 'run_0001');
  fs.mkdirSync(dir, { recursive: true });
  const data = {
    input_config: { phases: [{ name: 'warmup', concurrency }, { name: 'profiling', concurrency }] },
    ...body,
  };
  fs.writeFileSync(path.join(dir, 'profile_export_aiperf.json'), JSON.stringify(data));
}

describe('readAiperfSearchDir', () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads every iteration and maps metrics with per-GPU + ms→s conversion', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiperf-test-'));
    // tp2 → gpu_count 2, so throughput is halved when stored per-GPU.
    const artDir = path.join(
      tmp,
      'aiperf_search_qwen3.5-27b_8k1k_bf16_vllm_aiperf_tp2-ep1-dpafalse_disagg-false_spec-none_conc1000_h200-greennode_00',
    );
    fs.mkdirSync(artDir, { recursive: true });

    writeIter(artDir, 0, 32, {
      total_token_throughput: metric(6000),
      output_token_throughput: metric(800),
      inter_token_latency: metric(40), // ms
      request_latency: metric(45000), // ms
      time_to_first_token: metric(3500), // ms
      output_token_throughput_per_user: metric(25),
    });
    writeIter(artDir, 1, 64, {
      total_token_throughput: metric(7000),
      output_token_throughput: metric(900),
      inter_token_latency: metric(70),
      request_latency: metric(75000),
      time_to_first_token: metric(3600),
      output_token_throughput_per_user: metric(14),
    });

    const rows = readAiperfSearchDir(artDir);
    expect(rows).toHaveLength(2);

    const r0 = rows.find((r) => r.conc === 32)!;
    expect(r0).toBeDefined();
    // identity from slug
    expect(r0.infmax_model_prefix).toBe('qwen3.5-27b');
    expect(r0.hw).toBe('h200');
    expect(r0.framework).toBe('vllm');
    expect(r0.precision).toBe('bf16');
    expect(r0.isl).toBe(8192);
    expect(r0.osl).toBe(1024);
    expect(r0.tp).toBe(2);
    // throughput divided by gpu_count (tp*ep = 2)
    expect(r0.tput_per_gpu).toBe(3000);
    expect(r0.output_tput_per_gpu).toBe(400);
    expect(r0.input_tput_per_gpu).toBe((6000 - 800) / 2);
    // ms → s
    expect(r0.median_itl).toBeCloseTo(0.04, 6);
    expect(r0.median_tpot).toBeCloseTo(0.04, 6);
    expect(r0.median_e2el).toBeCloseTo(45, 6);
    expect(r0.median_ttft).toBeCloseTo(3.5, 6);
    // interactivity from per-user throughput p50
    expect(r0.median_intvty).toBeCloseTo(25, 6);
  });

  it('falls back to 1000/itl_p50 for interactivity when per-user series is absent', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiperf-test-'));
    const artDir = path.join(
      tmp,
      'aiperf_search_qwen3.5-27b_8k1k_bf16_vllm_tp1-ep1-dpafalse_disagg-false_conc256_h200-greennode_00',
    );
    fs.mkdirSync(artDir, { recursive: true });
    writeIter(artDir, 0, 32, {
      total_token_throughput: metric(6000),
      output_token_throughput: metric(800),
      inter_token_latency: metric(50), // 1000/50 = 20 tok/s/user
      request_latency: metric(45000),
    });
    const rows = readAiperfSearchDir(artDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].median_intvty).toBeCloseTo(20, 6);
  });

  it('skips an iteration missing concurrency or core throughput', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiperf-test-'));
    const artDir = path.join(tmp, 'aiperf_search_qwen3.5-27b_8k1k_bf16_vllm_tp1-ep1_conc256_h200-greennode_00');
    fs.mkdirSync(artDir, { recursive: true });
    // No throughput metrics → skipped.
    writeIter(artDir, 0, 32, { inter_token_latency: metric(40) });
    expect(readAiperfSearchDir(artDir)).toHaveLength(0);
  });

  it('returns empty for an unparseable artifact name', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiperf-test-'));
    const artDir = path.join(tmp, 'aiperf_search_no_workload_here');
    fs.mkdirSync(artDir, { recursive: true });
    expect(readAiperfSearchDir(artDir)).toHaveLength(0);
  });
});
