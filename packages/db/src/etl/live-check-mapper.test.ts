import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapLiveCheckEnvelope, readLiveCheckDir } from './live-check-mapper';

describe('mapLiveCheckEnvelope', () => {
  it('maps all three probes to rows', () => {
    const rows = mapLiveCheckEnvelope({
      stack: 'sglang-vanilla',
      run_type: 'live-check',
      probes: {
        metadata: { ok: true, detail: 'ok', data: { framework: 'sglang' } },
        'tool-calling': { ok: false, detail: 'no tool_calls', data: { content: 'plain text' } },
        throughput: { ok: true, detail: 'ok', data: { sweep: [{ conc: 8 }] } },
      },
    });

    expect(rows).toEqual([
      {
        stack: 'sglang-vanilla',
        probeType: 'metadata',
        runType: 'live-check',
        ok: true,
        detail: 'ok',
        data: { framework: 'sglang' },
      },
      {
        stack: 'sglang-vanilla',
        probeType: 'tool-calling',
        runType: 'live-check',
        ok: false,
        detail: 'no tool_calls',
        data: { content: 'plain text' },
      },
      {
        stack: 'sglang-vanilla',
        probeType: 'throughput',
        runType: 'live-check',
        ok: true,
        detail: 'ok',
        data: { sweep: [{ conc: 8 }] },
      },
    ]);
  });

  it('only maps probes actually present', () => {
    const rows = mapLiveCheckEnvelope({
      stack: 'sglang-pd-disaggregation',
      run_type: 'live-check',
      probes: {
        metadata: { ok: true, detail: '', data: {} },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].probeType).toBe('metadata');
  });

  it('skips an unrecognized probe key (forward compat)', () => {
    const rows = mapLiveCheckEnvelope({
      stack: 'sglang-vanilla',
      probes: {
        metadata: { ok: true, detail: '', data: {} },
        'future-probe': { ok: true, detail: '', data: {} },
      },
    });
    expect(rows.map((r) => r.probeType)).toEqual(['metadata']);
  });

  it('defaults detail to null and data to {} when absent', () => {
    const rows = mapLiveCheckEnvelope({
      stack: 'sglang-vanilla',
      probes: { metadata: { ok: true } },
    });
    expect(rows[0]).toMatchObject({ detail: null, data: {} });
  });

  it('returns [] when stack is missing', () => {
    expect(mapLiveCheckEnvelope({ probes: { metadata: { ok: true } } })).toEqual([]);
  });

  it('returns [] when probes is missing', () => {
    expect(mapLiveCheckEnvelope({ stack: 'sglang-vanilla' })).toEqual([]);
  });

  it('skips a probe entry missing a boolean ok', () => {
    const rows = mapLiveCheckEnvelope({
      stack: 'sglang-vanilla',
      probes: { metadata: { detail: 'no ok field', data: {} } },
    });
    expect(rows).toEqual([]);
  });
});

describe('readLiveCheckDir', () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads and maps a fixture artifact directory', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-check-test-'));
    const artDir = path.join(tmp, 'smoke_test_results_sglang-vanilla');
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(
      path.join(artDir, 'result.json'),
      JSON.stringify({
        stack: 'sglang-vanilla',
        run_type: 'live-check',
        probes: {
          metadata: { ok: true, detail: '', data: { framework: 'sglang' } },
          'tool-calling': { ok: false, detail: 'HTTP 500', data: {} },
        },
      }),
    );

    const rows = readLiveCheckDir(artDir);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.probeType).toSorted()).toEqual(['metadata', 'tool-calling']);
  });

  it('returns [] for a non-existent directory', () => {
    expect(readLiveCheckDir('/nonexistent/does-not-exist')).toEqual([]);
  });

  it('skips a malformed JSON file rather than throwing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-check-test-'));
    const artDir = path.join(tmp, 'smoke_test_results_broken');
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(artDir, 'result.json'), '{not valid json');

    expect(readLiveCheckDir(artDir)).toEqual([]);
  });
});
