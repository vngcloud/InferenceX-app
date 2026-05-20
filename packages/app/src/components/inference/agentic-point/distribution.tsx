'use client';

import { useMemo, useRef } from 'react';

/**
 * Bar histogram with vertical p50/p75/p90/p95 guide lines. Designed for the
 * detail-page card — fills its container width via `viewBox` + 100% width.
 */
export function Distribution({
  values,
  unit,
  height = 260,
}: {
  values: readonly number[];
  unit: string;
  height?: number;
}) {
  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 56, left: 60 };

  const svgParts = useMemo(() => {
    if (values.length === 0) return { bars: '', guides: '', legend: '', axis: '', yTicks: '' };
    const sorted = [...values].toSorted((a, b) => a - b);
    const min = sorted[0]!;
    const max = sorted.at(-1)!;
    const range = Math.max(1e-9, max - min);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    // Sturges-ish, scaled with sample size, capped so bars stay visible.
    const nBins = Math.min(50, Math.max(15, Math.ceil(Math.sqrt(values.length))));
    const counts: number[] = Array.from({ length: nBins }, () => 0);
    for (const v of values) {
      const i = Math.min(nBins - 1, Math.floor(((v - min) / range) * nBins));
      counts[i]!++;
    }
    const maxCount = Math.max(...counts, 1);
    const xScale = (v: number) => PAD.left + ((v - min) / range) * innerW;
    const barW = innerW / nBins;

    const fmt = (n: number) =>
      n >= 10000 ? new Intl.NumberFormat('en-US').format(Math.round(n)) : String(Math.round(n));

    const quantile = (q: number): number => {
      const pos = (sorted.length - 1) * q;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
    };

    const bars = counts
      .map((c, i) => {
        const h = (c / maxCount) * innerH;
        const x = PAD.left + i * barW;
        const y = PAD.top + (innerH - h);
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(0, barW - 1).toFixed(2)}" height="${h.toFixed(2)}" fill="currentColor" opacity="0.55" />`;
      })
      .join('');

    const GUIDES = [
      { label: 'p50', q: 0.5, color: '#3b82f6' },
      { label: 'p75', q: 0.75, color: '#22c55e' },
      { label: 'p90', q: 0.9, color: '#f59e0b' },
      { label: 'p95', q: 0.95, color: '#ef4444' },
    ] as const;
    const guides = GUIDES.map(({ q, color }) => {
      const v = quantile(q);
      const x = xScale(v);
      return `<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${PAD.top}" y2="${(PAD.top + innerH).toFixed(2)}" stroke="${color}" stroke-width="2" stroke-dasharray="5 3" opacity="0.95" />`;
    }).join('');

    // 4-tick x-axis: min, ~33%, ~66%, max
    const xTickVals = [min, min + range / 3, min + (2 * range) / 3, max];
    const axisY = PAD.top + innerH + 14;
    const axisLine = `<line x1="${PAD.left}" x2="${(PAD.left + innerW).toFixed(2)}" y1="${(PAD.top + innerH).toFixed(2)}" y2="${(PAD.top + innerH).toFixed(2)}" stroke="currentColor" opacity="0.2" />`;
    const xLabels = xTickVals
      .map((v, i) => {
        const anchor = i === 0 ? 'start' : i === xTickVals.length - 1 ? 'end' : 'middle';
        return `<text x="${xScale(v).toFixed(2)}" y="${axisY}" font-size="11" fill="currentColor" opacity="0.7" text-anchor="${anchor}">${fmt(v)}</text>`;
      })
      .join('');
    const axisTitle = `<text x="${(W / 2).toFixed(2)}" y="${H - 22}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="middle">value (${unit})</text>`;

    // 5-tick y-axis
    const yTickVals = Array.from({ length: 5 }, (_, i) => (maxCount * i) / 4);
    const yScale = (c: number) => PAD.top + (1 - c / maxCount) * innerH;
    const yTicks = yTickVals
      .map((v) => {
        const y = yScale(v);
        return `<g><line x1="${PAD.left - 4}" x2="${PAD.left}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="currentColor" opacity="0.4" /><text x="${PAD.left - 8}" y="${(y + 3).toFixed(2)}" font-size="10" fill="currentColor" opacity="0.55" text-anchor="end">${fmt(v)}</text></g>`;
      })
      .join('');
    const yAxisLabel = `<text x="${10}" y="${(H / 2).toFixed(2)}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="middle" transform="rotate(-90 10 ${(H / 2).toFixed(2)})">count</text>`;

    const chipY = H - 8;
    const chipW = innerW / GUIDES.length;
    const legend = GUIDES.map(({ label: ql, q, color }, i) => {
      const v = quantile(q);
      const x = PAD.left + i * chipW;
      return `
      <line x1="${(x + 2).toFixed(2)}" x2="${(x + 14).toFixed(2)}" y1="${chipY - 4}" y2="${chipY - 4}" stroke="${color}" stroke-width="2" stroke-dasharray="5 3" />
      <text x="${(x + 18).toFixed(2)}" y="${chipY}" font-size="11" fill="currentColor" opacity="0.9">${ql} ${fmt(v)}</text>`;
    }).join('');

    return {
      bars,
      guides,
      legend,
      axis: axisLine + xLabels + axisTitle + yAxisLabel,
      yTicks,
    };
  }, [values, unit, H]);

  const ref = useRef<HTMLDivElement | null>(null);

  if (values.length === 0) {
    return (
      <div className="h-[260px] grid place-items-center text-xs text-muted-foreground">No data</div>
    );
  }

  return (
    <div ref={ref} className="w-full">
      <div className="mb-2 text-xs text-muted-foreground">
        {values.length.toLocaleString()} requests · range {Math.round(Math.min(...values))}–
        {Math.round(Math.max(...values))} {unit}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto text-foreground"
        dangerouslySetInnerHTML={{
          __html:
            svgParts.bars + svgParts.guides + svgParts.axis + svgParts.yTicks + svgParts.legend,
        }}
      />
    </div>
  );
}
