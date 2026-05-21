import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { CHART_SERIES_VERSION, computeChartSeries } from './compute-chart-series.js';

/**
 * Build a minimal server_metrics_json blob covering the metrics the chart
 * consumes. Each timeslice is one second long starting at t=0.
 */
function makeBlob(opts?: {
  prefixHits?: number;
  prefixQueries?: number;
  promptTokensRate?: number;
}) {
  const json = JSON.stringify({
    metrics: {
      'vllm:kv_cache_usage_perc': {
        series: [
          {
            timeslices: [
              { start_ns: 0, end_ns: 1e9, avg: 0.1 },
              { start_ns: 1e9, end_ns: 2e9, avg: 0.4 },
              { start_ns: 2e9, end_ns: 3e9, avg: 0.7 },
            ],
          },
        ],
      },
      'vllm:prefix_cache_hits': {
        series: [{ timeslices: [{ start_ns: 0, end_ns: 1e9, rate: opts?.prefixHits ?? 75 }] }],
      },
      'vllm:prefix_cache_queries': {
        series: [{ timeslices: [{ start_ns: 0, end_ns: 1e9, rate: opts?.prefixQueries ?? 100 }] }],
      },
      'vllm:num_requests_running': {
        series: [{ timeslices: [{ start_ns: 0, end_ns: 1e9, avg: 5 }] }],
      },
      'vllm:num_requests_waiting': {
        series: [{ timeslices: [{ start_ns: 0, end_ns: 1e9, avg: 2 }] }],
      },
      'vllm:prompt_tokens': {
        series: [
          { timeslices: [{ start_ns: 0, end_ns: 1e9, rate: opts?.promptTokensRate ?? 1000 }] },
        ],
      },
      'vllm:generation_tokens': {
        series: [{ timeslices: [{ start_ns: 0, end_ns: 1e9, rate: 500 }] }],
      },
      'vllm:prompt_tokens_by_source': {
        series: [
          {
            labels: { source: 'local_cache_hit' },
            timeslices: [{ start_ns: 0, end_ns: 1e9, rate: 200 }],
          },
          {
            labels: { source: 'miss' },
            timeslices: [{ start_ns: 0, end_ns: 1e9, rate: 800 }],
          },
        ],
      },
    },
  });
  return gzipSync(Buffer.from(json));
}

describe('computeChartSeries', () => {
  it('returns null when the blob is null', async () => {
    expect(await computeChartSeries(null)).toBeNull();
  });

  it('returns the current CHART_SERIES_VERSION in the bundle', async () => {
    const series = await computeChartSeries(makeBlob());
    expect(series?.version).toBe(CHART_SERIES_VERSION);
  });

  it('extracts kvCacheUsage points with t=seconds-from-start', async () => {
    const series = await computeChartSeries(makeBlob());
    expect(series?.kvCacheUsage).toEqual([
      { t: 0, value: 0.1 },
      { t: 1, value: 0.4 },
      { t: 2, value: 0.7 },
    ]);
  });

  it('computes prefixCacheHitRate as hits.rate / queries.rate', async () => {
    const series = await computeChartSeries(makeBlob({ prefixHits: 80, prefixQueries: 100 }));
    expect(series?.prefixCacheHitRate).toEqual([{ t: 0, value: 0.8 }]);
  });

  it('drops prefixCacheHitRate windows where queries.rate is 0', async () => {
    const series = await computeChartSeries(makeBlob({ prefixHits: 5, prefixQueries: 0 }));
    expect(series?.prefixCacheHitRate).toEqual([]);
  });

  it('pairs running + waiting into queueDepth points', async () => {
    const series = await computeChartSeries(makeBlob());
    expect(series?.queueDepth).toEqual([{ t: 0, running: 5, waiting: 2, total: 7 }]);
  });

  it('extracts prefillTps + decodeTps from counter rates', async () => {
    const series = await computeChartSeries(makeBlob());
    expect(series?.prefillTps).toEqual([{ t: 0, value: 1000 }]);
    expect(series?.decodeTps).toEqual([{ t: 0, value: 500 }]);
  });

  it('splits promptTokensBySource by label and skips empty series', async () => {
    const series = await computeChartSeries(makeBlob());
    expect(Object.keys(series!.promptTokensBySource).toSorted()).toEqual([
      'local_cache_hit',
      'miss',
    ]);
    expect(series!.promptTokensBySource['local_cache_hit']).toEqual([{ t: 0, value: 200 }]);
    expect(series!.promptTokensBySource['miss']).toEqual([{ t: 0, value: 800 }]);
  });

  it('computes timing metadata from the widest metric window', async () => {
    const series = await computeChartSeries(makeBlob());
    // kvCacheUsage has the widest window (0 → 3e9), so startNs=0, endNs=3e9.
    expect(series?.startNs).toBe(0);
    expect(series?.endNs).toBe(3e9);
    expect(series?.durationS).toBeCloseTo(3, 6);
    expect(series?.timeslicesCount).toBe(3);
  });

  it('returns null on a malformed (non-gzip) blob', async () => {
    const result = await computeChartSeries(Buffer.from('not-gzip-data'));
    expect(result).toBeNull();
  });
});
