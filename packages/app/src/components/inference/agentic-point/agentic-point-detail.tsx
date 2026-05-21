'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { useAgenticAggregates, type AgenticAggregateMap } from '@/hooks/api/use-agentic-aggregates';
import { useTraceHistograms } from '@/hooks/api/use-trace-histograms';
import {
  useTraceServerMetrics,
  type PointMeta,
  type QueueDepthPoint,
  type TimeSeriesPoint,
} from '@/hooks/api/use-trace-server-metrics';
import { useBenchmarkSiblings } from '@/hooks/api/use-benchmark-siblings';
import { SegmentedToggle, type SegmentedToggleOption } from '@/components/ui/segmented-toggle';

import { AggregateChart, type AggregatePoint, type PercentileKey } from './aggregate-chart';
import { Distribution } from './distribution';
import { ExpandableChart } from './expandable-chart';
import { SiblingNav, chipLabel } from './sibling-nav';
import {
  StackedAreaChart,
  TimeSeriesChart,
  cumulativeAverage,
  rollingAverage,
  sumSeries,
} from './time-series-chart';

interface Props {
  id: number;
}

const fmtPct = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(2)}%`;

function MetaLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function PointSummary({ meta }: { meta: PointMeta }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-sm text-muted-foreground">
          Selected point
          {meta.disagg ? ' · disagg' : ''}
          {meta.spec_method && meta.spec_method !== 'none' ? ` · spec=${meta.spec_method}` : ''}
        </p>
        {meta.run_url && (
          <a
            href={meta.run_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            GitHub Actions run →
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetaLine label="Offload" value={(meta.offload_mode ?? 'off').toUpperCase()} />
        <MetaLine label="Concurrency" value={meta.conc} />
        <MetaLine label="GPU cache hit" value={fmtPct(meta.server_gpu_cache_hit_rate)} />
        <MetaLine label="CPU cache hit" value={fmtPct(meta.server_cpu_cache_hit_rate)} />
        {meta.isl !== null && <MetaLine label="ISL" value={meta.isl} />}
        {meta.osl !== null && <MetaLine label="OSL" value={meta.osl} />}
      </div>
    </div>
  );
}

/** Sizes passed to charts for the inline (small) vs expanded (dialog) render. */
const CHART_SIZES = {
  inline: { width: 720, height: 260 },
  expanded: { width: 1300, height: 520 },
};

type DetailView = 'point' | 'aggregates';
const VIEW_OPTIONS: SegmentedToggleOption<DetailView>[] = [
  { value: 'point', label: 'Per-point', testId: 'detail-view-point' },
  { value: 'aggregates', label: 'Aggregates across configs', testId: 'detail-view-aggregates' },
];

/** Bundle per-percentile values for one sibling into the shape AggregateChart wants. */
function toAggPoint(
  sibling: { id: number; label: string },
  pct: { mean: number; p50: number; p75: number; p90: number; p99: number } | null | undefined,
): AggregatePoint {
  const values: Partial<Record<PercentileKey, number>> = {};
  if (pct) {
    values.mean = pct.mean;
    values.p50 = pct.p50;
    values.p75 = pct.p75;
    values.p90 = pct.p90;
    values.p99 = pct.p99;
  }
  return { id: sibling.id, label: sibling.label, values };
}

export function AgenticPointDetail({ id }: Props) {
  const router = useRouter();
  const histQuery = useTraceHistograms([id], true);
  const metricsQuery = useTraceServerMetrics(id, true);
  const siblingsQuery = useBenchmarkSiblings(id);

  const hist = histQuery.data?.[id];
  const metrics = metricsQuery.data;
  const siblingsData = siblingsQuery.data;

  const [view, setView] = useState<DetailView>('point');
  // Fetch aggregates only when the aggregates view is active. Uses the full
  // sibling set (across parallelism + concurrency configs) so each chart
  // shows how the metric varies across the SKU.
  const siblingIds = siblingsData?.siblings.map((s) => s.id) ?? [];
  const aggregatesQuery = useAgenticAggregates(siblingIds, view === 'aggregates');

  return (
    <div className="container mx-auto px-4 lg:px-8 flex flex-col gap-4 py-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
        <span className="text-sm text-muted-foreground">·</span>
        <Link href="/inference" className="text-sm text-muted-foreground hover:text-foreground">
          Inference chart
        </Link>
      </div>

      {siblingsData ? (
        <SiblingNav sku={siblingsData.sku} siblings={siblingsData.siblings} />
      ) : siblingsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading SKU navigator…</div>
      ) : null}

      {metrics ? (
        <PointSummary meta={metrics.meta} />
      ) : metricsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading point metadata…</div>
      ) : null}

      {metricsQuery.isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load trace data for benchmark point #{id}.
        </div>
      )}
      {metricsQuery.data === null && !metricsQuery.isLoading && (
        <div className="rounded-lg border border-border/40 bg-card/40 p-4 text-sm text-muted-foreground">
          No stored trace_replay blob for benchmark point #{id}. This point predates the aiperf
          time-series capture, or its source artifacts have expired on GitHub.
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <SegmentedToggle
          value={view}
          options={VIEW_OPTIONS}
          onValueChange={setView}
          ariaLabel="Detail view"
          testId="detail-view-toggle"
          buttonClassName="px-3 py-1.5 text-sm"
        />
        {view === 'aggregates' && (
          <span className="text-xs text-muted-foreground">
            {siblingIds.length} configs in SKU
            {aggregatesQuery.isLoading ? ' · loading…' : ''}
          </span>
        )}
      </div>

      {view === 'aggregates' ? (
        <AggregatesGrid
          siblings={siblingsData?.siblings ?? []}
          aggregates={aggregatesQuery.data}
          isLoading={aggregatesQuery.isLoading}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ExpandableChart
            title="Input sequence length distribution"
            render={(expanded) => {
              const size = expanded ? CHART_SIZES.expanded : CHART_SIZES.inline;
              if (hist) return <Distribution values={hist.isl} unit="tokens" {...size} />;
              return histQuery.isLoading ? <Skeleton /> : <Empty />;
            }}
          />
          <ExpandableChart
            title="Output sequence length distribution"
            render={(expanded) => {
              const size = expanded ? CHART_SIZES.expanded : CHART_SIZES.inline;
              if (hist) return <Distribution values={hist.osl} unit="tokens" {...size} />;
              return histQuery.isLoading ? <Skeleton /> : <Empty />;
            }}
          />

          <ExpandableChart
            title="KV cache utilization over time"
            render={(expanded) => {
              const size = expanded ? CHART_SIZES.expanded : CHART_SIZES.inline;
              if (!metrics) return <Skeleton />;
              return (
                <TimeSeriesChart
                  series={[
                    {
                      name: 'GPU KV cache (avg n=50)',
                      data: rollingAverage(metrics.kvCacheUsage, 50),
                      rawData: metrics.kvCacheUsage,
                      color: '#3b82f6',
                      strokeWidth: 2,
                    },
                  ]}
                  durationS={metrics.durationS}
                  yMax={1}
                  yFmt={(v) => `${(v * 100).toFixed(0)}%`}
                  yAxisLabel="KV cache (%)"
                  {...size}
                />
              );
            }}
          />

          <ExpandableChart
            title="Request queue depth"
            render={(expanded) => {
              const size = expanded ? CHART_SIZES.expanded : CHART_SIZES.inline;
              if (!metrics) return <Skeleton />;
              return (
                <TimeSeriesChart
                  series={[
                    {
                      name: 'Running (avg n=50)',
                      data: rollingAverage(
                        metrics.queueDepth.map((p: QueueDepthPoint) => ({
                          t: p.t,
                          value: p.running,
                        })),
                        50,
                      ),
                      color: '#22c55e',
                      strokeWidth: 2,
                    },
                    {
                      name: 'Waiting (avg n=50)',
                      data: rollingAverage(
                        metrics.queueDepth.map((p: QueueDepthPoint) => ({
                          t: p.t,
                          value: p.waiting,
                        })),
                        50,
                      ),
                      color: '#ef4444',
                      strokeWidth: 2,
                    },
                    {
                      name: 'Total (avg n=50)',
                      data: rollingAverage(
                        metrics.queueDepth.map((p: QueueDepthPoint) => ({
                          t: p.t,
                          value: p.total,
                        })),
                        50,
                      ),
                      color: '#3b82f6',
                      strokeWidth: 2,
                    },
                  ]}
                  durationS={metrics.durationS}
                  yAxisLabel="Requests"
                  {...size}
                />
              );
            }}
          />

          <ExpandableChart
            title="Prefix cache hit rate per interval"
            render={(expanded) => {
              const size = expanded ? CHART_SIZES.expanded : CHART_SIZES.inline;
              if (!metrics) return <Skeleton />;
              return (
                <TimeSeriesChart
                  series={[
                    {
                      name: 'GPU (HBM, avg n=50)',
                      data: rollingAverage(metrics.prefixCacheHitRate, 50),
                      rawData: metrics.prefixCacheHitRate,
                      color: '#a855f7',
                      strokeWidth: 2,
                    },
                  ]}
                  durationS={metrics.durationS}
                  yMax={1}
                  yFmt={(v) => `${(v * 100).toFixed(0)}%`}
                  yAxisLabel="Hit rate (%)"
                  {...size}
                />
              );
            }}
          />

          <ExpandableChart
            title="Throughput (total & decode)"
            render={(expanded) => {
              const size = expanded ? CHART_SIZES.expanded : CHART_SIZES.inline;
              if (!metrics) return <Skeleton />;
              const total = sumSeries(metrics.prefillTps, metrics.decodeTps);
              return (
                <TimeSeriesChart
                  series={[
                    {
                      name: 'Total (avg n=50)',
                      data: rollingAverage(total, 50),
                      color: '#3b82f6',
                      strokeWidth: 1.6,
                    },
                    {
                      name: 'Decode (avg n=50)',
                      data: rollingAverage(metrics.decodeTps, 50),
                      color: '#f97316',
                      strokeWidth: 1.6,
                    },
                    {
                      name: 'Total running avg',
                      data: cumulativeAverage(total),
                      color: '#ef4444',
                      strokeWidth: 3,
                    },
                  ]}
                  durationS={metrics.durationS}
                  yAxisLabel="Tokens / sec"
                  {...size}
                />
              );
            }}
          />

          <ExpandableChart
            title="Cumulative prompt token source breakdown"
            render={(expanded) => {
              const size = expanded ? CHART_SIZES.expanded : CHART_SIZES.inline;
              if (!metrics) return <Skeleton />;
              return (
                <StackedAreaChart
                  sourceSeries={metrics.promptTokensBySource}
                  durationS={metrics.durationS}
                  {...size}
                />
              );
            }}
          />
        </div>
      )}
    </div>
  );
}

function AggregatesGrid({
  siblings,
  aggregates,
  isLoading,
}: {
  siblings: {
    id: number;
    conc: number;
    decode_tp: number;
    decode_ep: number;
    disagg: boolean;
    num_prefill_gpu: number;
    num_decode_gpu: number;
    offload_mode?: string | null;
  }[];
  aggregates: AgenticAggregateMap | undefined;
  isLoading: boolean;
}) {
  if (siblings.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/40 p-4 text-sm text-muted-foreground">
        SKU sibling list not loaded yet — open a point to populate.
      </div>
    );
  }
  if (isLoading && !aggregates) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/40 p-4 text-sm text-muted-foreground">
        Computing aggregates across {siblings.length} configs… (parsing trace blobs)
      </div>
    );
  }
  const labeled = siblings.map((s) => ({ id: s.id, label: chipLabel(s as any) }));
  const islPoints = labeled.map((s) => toAggPoint(s, aggregates?.[s.id]?.isl));
  const oslPoints = labeled.map((s) => toAggPoint(s, aggregates?.[s.id]?.osl));
  const kvPoints = labeled.map((s) => toAggPoint(s, aggregates?.[s.id]?.kvCacheUtil));
  const prefixPoints = labeled.map((s) => toAggPoint(s, aggregates?.[s.id]?.prefixCacheHitRate));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ExpandableChart
        title="ISL distribution (across configs)"
        render={(expanded) => (
          <AggregateChart
            points={islPoints}
            unit="tokens"
            {...(expanded ? CHART_SIZES.expanded : CHART_SIZES.inline)}
          />
        )}
      />
      <ExpandableChart
        title="OSL distribution (across configs)"
        render={(expanded) => (
          <AggregateChart
            points={oslPoints}
            unit="tokens"
            {...(expanded ? CHART_SIZES.expanded : CHART_SIZES.inline)}
          />
        )}
      />
      <ExpandableChart
        title="KV cache utilization (across configs)"
        render={(expanded) => (
          <AggregateChart
            points={kvPoints}
            unit="%"
            yMax={1}
            yFmt={(v) => `${(v * 100).toFixed(0)}%`}
            {...(expanded ? CHART_SIZES.expanded : CHART_SIZES.inline)}
          />
        )}
      />
      <ExpandableChart
        title="Prefix cache hit rate (across configs)"
        render={(expanded) => (
          <AggregateChart
            points={prefixPoints}
            unit="%"
            yMax={1}
            yFmt={(v) => `${(v * 100).toFixed(0)}%`}
            {...(expanded ? CHART_SIZES.expanded : CHART_SIZES.inline)}
          />
        )}
      />
    </div>
  );
}

function Skeleton() {
  return <div className="h-[260px] rounded-md bg-muted/30 animate-pulse" />;
}

function Empty() {
  return (
    <div className="h-[260px] grid place-items-center text-xs text-muted-foreground">No data</div>
  );
}

// Re-export type for use by sub-components
export type { TimeSeriesPoint, QueueDepthPoint };
