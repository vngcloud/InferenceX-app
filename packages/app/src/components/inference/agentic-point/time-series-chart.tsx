'use client';

import { useMemo } from 'react';

import type { TimeSeriesPoint } from '@/hooks/api/use-trace-server-metrics';

import { ChartHover, type HoverItem } from './chart-hover';

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
  width?: number;
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

/** Expanding-window cumulative mean from index 0..i. */
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

const fmtIntDefault = (n: number) =>
  n >= 10000 ? new Intl.NumberFormat('en-US').format(Math.round(n)) : String(Math.round(n));

const fmtSeconds = (s: number) => {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
};

/** Linear-interpolated value at time `t` from a time-sorted series. */
function interpAt(data: TimeSeriesPoint[], t: number): number | null {
  if (data.length === 0) return null;
  if (t <= data[0]!.t) return data[0]!.value;
  if (t >= data.at(-1)!.t) return data.at(-1)!.value;
  // Binary search
  let lo = 0;
  let hi = data.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (data[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = data[lo]!;
  const b = data[hi]!;
  if (b.t === a.t) return a.value;
  const frac = (t - a.t) / (b.t - a.t);
  return a.value + (b.value - a.value) * frac;
}

export function TimeSeriesChart({
  series,
  durationS,
  yMax: yMaxOpt,
  yFmt = fmtIntDefault,
  yAxisLabel,
  width = 720,
  height = 260,
}: TimeSeriesChartProps) {
  const W = width;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 56, left: 60 };

  const layout = useMemo(() => {
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const xMax = Math.max(durationS, 1);
    const yMax = yMaxOpt ?? Math.max(1e-9, ...series.flatMap((s) => s.data.map((d) => d.value)));
    const xScale = (t: number) => PAD.left + (t / xMax) * innerW;
    const yScale = (v: number) => PAD.top + (1 - v / yMax) * innerH;
    return { innerW, innerH, xMax, yMax, xScale, yScale };
  }, [series, durationS, yMaxOpt, W, H, PAD.bottom, PAD.left, PAD.right, PAD.top]);

  const { innerW, innerH, xMax, yMax, xScale, yScale } = layout;

  const subsample = (arr: TimeSeriesPoint[]) => {
    if (arr.length === 0) return arr;
    const stride = Math.max(1, Math.floor(arr.length / innerW));
    return stride > 1 ? arr.filter((_, i) => i % stride === 0) : arr;
  };

  // Pre-format axis ticks.
  const xTickVals = Array.from({ length: 5 }, (_, i) => (xMax * i) / 4);
  const yTickVals = Array.from({ length: 5 }, (_, i) => (yMax * i) / 4);

  const resolve = (fraction: number) => {
    const t = fraction * xMax;
    const items: HoverItem[] = [];
    for (const s of series) {
      const v = interpAt(s.data, t);
      if (v === null || !Number.isFinite(v)) continue;
      items.push({ color: s.color, label: s.name, value: yFmt(v) });
    }
    if (items.length === 0) return null;
    return { items, title: fmtSeconds(t) };
  };

  if (series.every((s) => s.data.length === 0)) {
    return (
      <div className="h-[260px] grid place-items-center text-xs text-muted-foreground">No data</div>
    );
  }

  return (
    <ChartHover pad={PAD} width={W} height={H} resolve={resolve}>
      {/* y-axis gridlines + labels */}
      {yTickVals.map((v, i) => {
        const y = yScale(v);
        return (
          <g key={`y${i}`}>
            <line
              x1={PAD.left - 4}
              x2={PAD.left + innerW}
              y1={y}
              y2={y}
              stroke="currentColor"
              opacity={0.08}
            />
            <text
              x={PAD.left - 8}
              y={y + 3}
              fontSize={10}
              fill="currentColor"
              opacity={0.55}
              textAnchor="end"
            >
              {yFmt(v)}
            </text>
          </g>
        );
      })}

      {/* Raw scatter underlay */}
      {series
        .filter((s) => s.rawData && s.rawData.length > 0)
        .map((s, si) =>
          subsample(s.rawData!).map((d, i) => (
            <circle
              key={`r${si}-${i}`}
              cx={xScale(d.t)}
              cy={yScale(d.value)}
              r={1.5}
              fill={s.color}
              opacity={0.2}
            />
          )),
        )}

      {/* Lines */}
      {series.map((s, si) => {
        if (s.data.length === 0) return null;
        const sampled = subsample(s.data);
        const path = sampled
          .map(
            (d, i) =>
              `${i === 0 ? 'M' : 'L'}${xScale(d.t).toFixed(2)},${yScale(d.value).toFixed(2)}`,
          )
          .join(' ');
        return (
          <path
            key={`l${si}`}
            d={path}
            fill="none"
            stroke={s.color}
            strokeWidth={s.strokeWidth ?? 1.8}
          />
        );
      })}

      {/* X-axis */}
      <line
        x1={PAD.left}
        x2={PAD.left + innerW}
        y1={PAD.top + innerH}
        y2={PAD.top + innerH}
        stroke="currentColor"
        opacity={0.2}
      />
      {xTickVals.map((v, i) => {
        const x = xScale(v);
        const anchor = i === 0 ? 'start' : i === xTickVals.length - 1 ? 'end' : 'middle';
        return (
          <text
            key={`x${i}`}
            x={x}
            y={PAD.top + innerH + 14}
            fontSize={11}
            fill="currentColor"
            opacity={0.7}
            textAnchor={anchor}
          >
            {fmtSeconds(v)}
          </text>
        );
      })}
      <text
        x={W / 2}
        y={H - 22}
        fontSize={11}
        fill="currentColor"
        opacity={0.55}
        textAnchor="middle"
      >
        time
      </text>

      {yAxisLabel && (
        <text
          x={10}
          y={H / 2}
          fontSize={11}
          fill="currentColor"
          opacity={0.55}
          textAnchor="middle"
          transform={`rotate(-90 10 ${H / 2})`}
        >
          {yAxisLabel}
        </text>
      )}

      {/* Legend */}
      {(() => {
        const chipY = H - 8;
        const chipW = innerW / Math.max(1, series.length);
        return series.map((s, i) => {
          const x = PAD.left + i * chipW;
          return (
            <g key={`leg${i}`}>
              <line
                x1={x + 2}
                x2={x + 14}
                y1={chipY - 4}
                y2={chipY - 4}
                stroke={s.color}
                strokeWidth={s.strokeWidth ?? 2}
              />
              <text x={x + 18} y={chipY} fontSize={11} fill="currentColor" opacity={0.9}>
                {s.name}
              </text>
            </g>
          );
        });
      })()}
    </ChartHover>
  );
}

/** Stacked-area chart for token-source share over time. */
export function StackedAreaChart({
  sourceSeries,
  durationS,
  width = 720,
  height = 260,
}: {
  sourceSeries: Record<string, TimeSeriesPoint[]>;
  durationS: number;
  width?: number;
  height?: number;
}) {
  const W = width;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 56, left: 60 };

  const computed = useMemo(() => {
    const entries = Object.entries(sourceSeries).filter(([, v]) => v.length > 0);
    if (entries.length === 0) return null;
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
    return { tValues, shares };
  }, [sourceSeries]);

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

  if (!computed) {
    return (
      <div className="h-[260px] grid place-items-center text-xs text-muted-foreground">No data</div>
    );
  }
  const { tValues, shares } = computed;

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
    for (let i = 0; i < tValues.length; i++) lower[i] = upper[i]!;
    return { name, color, d };
  });

  const resolve = (fraction: number) => {
    const t = fraction * xMax;
    // Find the closest tValue index.
    let idx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < tValues.length; i++) {
      const d = Math.abs(tValues[i]! - t);
      if (d < bestDist) {
        bestDist = d;
        idx = i;
      }
    }
    const items: HoverItem[] = stackOrder.map((name) => ({
      color: colors[name] ?? '#6b7280',
      label: labelFor[name] ?? name,
      value: `${((shares[name]?.[idx] ?? 0) * 100).toFixed(1)}%`,
    }));
    return { items, title: fmtSeconds(t) };
  };

  const xTickVals = Array.from({ length: 5 }, (_, i) => (xMax * i) / 4);
  const yTickVals = [0, 0.25, 0.5, 0.75, 1];

  return (
    <ChartHover pad={PAD} width={W} height={H} resolve={resolve}>
      {yTickVals.map((v, i) => {
        const y = yScale(v);
        return (
          <g key={`y${i}`}>
            <line
              x1={PAD.left - 4}
              x2={PAD.left + innerW}
              y1={y}
              y2={y}
              stroke="currentColor"
              opacity={0.08}
            />
            <text
              x={PAD.left - 8}
              y={y + 3}
              fontSize={10}
              fill="currentColor"
              opacity={0.55}
              textAnchor="end"
            >
              {(v * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
      {layers.map((l, i) => (
        <path key={i} d={l.d} fill={l.color} opacity={0.75} />
      ))}
      <line
        x1={PAD.left}
        x2={PAD.left + innerW}
        y1={PAD.top + innerH}
        y2={PAD.top + innerH}
        stroke="currentColor"
        opacity={0.2}
      />
      {xTickVals.map((v, i) => {
        const x = xScale(v);
        const anchor = i === 0 ? 'start' : i === xTickVals.length - 1 ? 'end' : 'middle';
        return (
          <text
            key={`x${i}`}
            x={x}
            y={PAD.top + innerH + 14}
            fontSize={11}
            fill="currentColor"
            opacity={0.7}
            textAnchor={anchor}
          >
            {fmtSeconds(v)}
          </text>
        );
      })}
      <text
        x={W / 2}
        y={H - 22}
        fontSize={11}
        fill="currentColor"
        opacity={0.55}
        textAnchor="middle"
      >
        time
      </text>
      <text
        x={10}
        y={H / 2}
        fontSize={11}
        fill="currentColor"
        opacity={0.55}
        textAnchor="middle"
        transform={`rotate(-90 10 ${H / 2})`}
      >
        % of prefill tokens
      </text>
      {(() => {
        const chipY = H - 8;
        const chipW = innerW / Math.max(1, layers.length);
        return layers.map((l, i) => {
          const x = PAD.left + i * chipW;
          return (
            <g key={`leg${i}`}>
              <rect x={x + 2} y={chipY - 9} width={12} height={8} fill={l.color} opacity={0.75} />
              <text x={x + 18} y={chipY} fontSize={11} fill="currentColor" opacity={0.9}>
                {labelFor[l.name] ?? l.name}
              </text>
            </g>
          );
        });
      })()}
    </ChartHover>
  );
}
