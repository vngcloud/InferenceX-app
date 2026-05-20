'use client';

import { useMemo } from 'react';

import type { TimeSeriesPoint } from '@/hooks/api/use-trace-server-metrics';

interface Series {
  name: string;
  /** The line to draw (caller pre-smooths if desired). */
  data: TimeSeriesPoint[];
  /** Optional raw per-scrape values; rendered as low-opacity scatter behind the line. */
  rawData?: TimeSeriesPoint[];
  color: string;
  /** Override default stroke width (1.8). Use higher values for emphasis lines. */
  strokeWidth?: number;
}

interface TimeSeriesChartProps {
  series: Series[];
  durationS: number;
  yMax?: number;
  yFmt?: (v: number) => string;
  yAxisLabel?: string;
  height?: number;
}

/** Centered rolling average over `windowSize` samples. */
export function rollingAverage(data: TimeSeriesPoint[], windowSize: number): TimeSeriesPoint[] {
  if (data.length === 0 || windowSize <= 1) return data;
  const half = Math.floor(windowSize / 2);
  const out: TimeSeriesPoint[] = Array.from({ length: data.length });
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length, i + half + 1);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += data[j]!.value;
      n++;
    }
    out[i] = { t: data[i]!.t, value: n > 0 ? sum / n : 0 };
  }
  return out;
}

/**
 * Expanding-window cumulative mean from index 0..i. Useful for "running
 * average over the entire run" lines (red overlay in the throughput chart).
 */
export function cumulativeAverage(data: TimeSeriesPoint[]): TimeSeriesPoint[] {
  if (data.length === 0) return data;
  const out: TimeSeriesPoint[] = Array.from({ length: data.length });
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i]!.value;
    out[i] = { t: data[i]!.t, value: sum / (i + 1) };
  }
  return out;
}

/** Pointwise sum of two arrays sharing the same t index. */
export function sumSeries(a: TimeSeriesPoint[], b: TimeSeriesPoint[]): TimeSeriesPoint[] {
  const n = Math.min(a.length, b.length);
  const out: TimeSeriesPoint[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) {
    out[i] = { t: a[i]!.t, value: a[i]!.value + b[i]!.value };
  }
  return out;
}

const fmtInt = (n: number) =>
  n >= 10000 ? new Intl.NumberFormat('en-US').format(Math.round(n)) : String(Math.round(n));

const fmtSeconds = (s: number) => {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
};

export function TimeSeriesChart({
  series,
  durationS,
  yMax: yMaxOpt,
  yFmt = fmtInt,
  yAxisLabel,
  height = 260,
}: TimeSeriesChartProps) {
  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 56, left: 60 };

  const inner = useMemo(() => {
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xMax = Math.max(durationS, 1);
    const yMax = yMaxOpt ?? Math.max(1e-9, ...series.flatMap((s) => s.data.map((d) => d.value)));
    const xScale = (t: number) => PAD.left + (t / xMax) * innerW;
    const yScale = (v: number) => PAD.top + (1 - v / yMax) * innerH;

    const subsample = (arr: TimeSeriesPoint[]) => {
      if (arr.length === 0) return arr;
      const stride = Math.max(1, Math.floor(arr.length / innerW));
      return stride > 1 ? arr.filter((_, i) => i % stride === 0) : arr;
    };

    // Layered render: raw scatter (back) → lines (front). Iterate twice so
    // emphasis lines (high strokeWidth) draw over everything else.
    const dotsLayer = series
      .filter((s) => s.rawData && s.rawData.length > 0)
      .map((s) =>
        subsample(s.rawData!)
          .map((d) => {
            const x = xScale(d.t);
            const y = yScale(d.value);
            return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="${s.color}" opacity="0.2" />`;
          })
          .join(''),
      )
      .join('');

    const lineLayer = series
      .map((s) => {
        if (s.data.length === 0) return '';
        const sampled = subsample(s.data);
        const pts = sampled.map((d) => [xScale(d.t), yScale(d.value)] as [number, number]);
        const path = pts
          .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
          .join(' ');
        return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.strokeWidth ?? 1.8}" />`;
      })
      .join('');

    const paths = dotsLayer + lineLayer;

    // X-axis: 5 ticks at 0..xMax
    const xTickVals = Array.from({ length: 5 }, (_, i) => (xMax * i) / 4);
    const axisY = PAD.top + innerH;
    const xAxis = `<line x1="${PAD.left}" x2="${(PAD.left + innerW).toFixed(2)}" y1="${axisY.toFixed(2)}" y2="${axisY.toFixed(2)}" stroke="currentColor" opacity="0.2" />${xTickVals
      .map((v, i) => {
        const x = xScale(v);
        const anchor = i === 0 ? 'start' : i === xTickVals.length - 1 ? 'end' : 'middle';
        return `<text x="${x.toFixed(2)}" y="${(axisY + 14).toFixed(2)}" font-size="11" fill="currentColor" opacity="0.7" text-anchor="${anchor}">${fmtSeconds(v)}</text>`;
      })
      .join('')}`;
    const xAxisTitle = `<text x="${(W / 2).toFixed(2)}" y="${H - 22}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="middle">time</text>`;

    // Y-axis: 5 ticks at 0..yMax
    const yTickVals = Array.from({ length: 5 }, (_, i) => (yMax * i) / 4);
    const yTicks = yTickVals
      .map((v) => {
        const y = yScale(v);
        return `<g><line x1="${PAD.left - 4}" x2="${(PAD.left + innerW).toFixed(2)}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="currentColor" opacity="0.08" /><text x="${PAD.left - 8}" y="${(y + 3).toFixed(2)}" font-size="10" fill="currentColor" opacity="0.55" text-anchor="end">${yFmt(v)}</text></g>`;
      })
      .join('');
    const yAxisTitle = yAxisLabel
      ? `<text x="${10}" y="${(H / 2).toFixed(2)}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="middle" transform="rotate(-90 10 ${(H / 2).toFixed(2)})">${yAxisLabel}</text>`
      : '';

    // Legend at the bottom of the SVG
    const chipY = H - 8;
    const chipW = innerW / Math.max(1, series.length);
    const legend = series
      .map((s, i) => {
        const x = PAD.left + i * chipW;
        return `<line x1="${(x + 2).toFixed(2)}" x2="${(x + 14).toFixed(2)}" y1="${chipY - 4}" y2="${chipY - 4}" stroke="${s.color}" stroke-width="${s.strokeWidth ?? 2}" /><text x="${(x + 18).toFixed(2)}" y="${chipY}" font-size="11" fill="currentColor" opacity="0.9">${s.name}</text>`;
      })
      .join('');

    return paths + xAxis + xAxisTitle + yTicks + yAxisTitle + legend;
  }, [series, durationS, yMaxOpt, yFmt, yAxisLabel, H]);

  if (series.every((s) => s.data.length === 0)) {
    return (
      <div className="h-[260px] grid place-items-center text-xs text-muted-foreground">No data</div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-auto text-foreground"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

/** Stacked-area chart for token-source share over time. */
export function StackedAreaChart({
  sourceSeries,
  durationS,
  height = 260,
}: {
  sourceSeries: Record<string, TimeSeriesPoint[]>;
  durationS: number;
  height?: number;
}) {
  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 56, left: 60 };

  const inner = useMemo(() => {
    const entries = Object.entries(sourceSeries).filter(([, v]) => v.length > 0);
    if (entries.length === 0) return '';
    const tValues = entries[0]![1].map((p) => p.t);
    const cum: Record<string, number[]> = {};
    for (const [name, arr] of entries) {
      let acc = 0;
      cum[name] = arr.map((p) => {
        acc += p.value;
        return acc;
      });
    }
    const shares: Record<string, number[]> = {};
    for (const name of Object.keys(cum)) shares[name] = [];
    for (let i = 0; i < tValues.length; i++) {
      const total = entries.reduce((s, [name]) => s + (cum[name]?.[i] ?? 0), 0);
      for (const [name] of entries) {
        shares[name]!.push(total > 0 ? (cum[name]?.[i] ?? 0) / total : 0);
      }
    }

    const colors: Record<string, string> = {
      local_compute: '#f97316',
      local_cache_hit: '#3b82f6',
      external_kv_transfer: '#22c55e',
      miss: '#f97316',
    };
    const labelFor: Record<string, string> = {
      local_compute: 'Prefill',
      local_cache_hit: 'HBM Cache Hit',
      external_kv_transfer: 'Offload Cache Hit',
      miss: 'Miss',
    };

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xMax = Math.max(durationS, 1);
    const xScale = (t: number) => PAD.left + (t / xMax) * innerW;
    const yScale = (v: number) => PAD.top + (1 - v) * innerH;

    const stackOrder = Object.keys(shares);
    const lower: number[] = Array.from({ length: tValues.length }, () => 0);
    const layers = stackOrder.map((name) => {
      const upper = shares[name]!.map((v, i) => lower[i]! + v);
      const top = upper.map((v, i) => [xScale(tValues[i]!), yScale(v)] as [number, number]);
      const bottom = lower.map((v, i) => [xScale(tValues[i]!), yScale(v)] as [number, number]);
      const d = `${top
        .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ')} ${[...bottom]
        .toReversed()
        .map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ')} Z`;
      const color = colors[name] ?? '#6b7280';
      const path = `<path d="${d}" fill="${color}" opacity="0.75" />`;
      for (let i = 0; i < tValues.length; i++) lower[i] = upper[i]!;
      return { name, color, path };
    });

    const paths = layers.map((l) => l.path).join('');

    // X-axis
    const xTickVals = Array.from({ length: 5 }, (_, i) => (xMax * i) / 4);
    const axisY = PAD.top + innerH;
    const xAxis = `<line x1="${PAD.left}" x2="${(PAD.left + innerW).toFixed(2)}" y1="${axisY.toFixed(2)}" y2="${axisY.toFixed(2)}" stroke="currentColor" opacity="0.2" />${xTickVals
      .map((v, i) => {
        const x = xScale(v);
        const anchor = i === 0 ? 'start' : i === xTickVals.length - 1 ? 'end' : 'middle';
        return `<text x="${x.toFixed(2)}" y="${(axisY + 14).toFixed(2)}" font-size="11" fill="currentColor" opacity="0.7" text-anchor="${anchor}">${fmtSeconds(v)}</text>`;
      })
      .join('')}`;
    const xAxisTitle = `<text x="${(W / 2).toFixed(2)}" y="${H - 22}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="middle">time</text>`;

    // Y-axis 0..100%
    const yTickVals = [0, 0.25, 0.5, 0.75, 1];
    const yTicks = yTickVals
      .map((v) => {
        const y = yScale(v);
        return `<g><line x1="${PAD.left - 4}" x2="${(PAD.left + innerW).toFixed(2)}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="currentColor" opacity="0.08" /><text x="${PAD.left - 8}" y="${(y + 3).toFixed(2)}" font-size="10" fill="currentColor" opacity="0.55" text-anchor="end">${(v * 100).toFixed(0)}%</text></g>`;
      })
      .join('');
    const yAxisTitle = `<text x="${10}" y="${(H / 2).toFixed(2)}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="middle" transform="rotate(-90 10 ${(H / 2).toFixed(2)})">% of prefill tokens</text>`;

    const chipY = H - 8;
    const chipW = innerW / Math.max(1, layers.length);
    const legend = layers
      .map((l, i) => {
        const x = PAD.left + i * chipW;
        return `<rect x="${(x + 2).toFixed(2)}" y="${chipY - 9}" width="12" height="8" fill="${l.color}" opacity="0.75" /><text x="${(x + 18).toFixed(2)}" y="${chipY}" font-size="11" fill="currentColor" opacity="0.9">${labelFor[l.name] ?? l.name}</text>`;
      })
      .join('');

    return paths + xAxis + xAxisTitle + yTicks + yAxisTitle + legend;
  }, [sourceSeries, durationS, H]);

  if (Object.values(sourceSeries).every((v) => v.length === 0)) {
    return (
      <div className="h-[260px] grid place-items-center text-xs text-muted-foreground">No data</div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-auto text-foreground"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
