'use client';

import { useEffect, useMemo } from 'react';

import { track } from '@/lib/analytics';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useLiveCheck } from '@/hooks/api/use-live-check';
import type { LiveCheckRow } from '@/lib/api';

/** Human labels for the fixed probe set. Unknown probe types fall back to the raw key. */
const PROBE_LABELS: Record<string, string> = {
  metadata: 'Metadata (drift check)',
  'tool-calling': 'Tool Calling',
  throughput: 'Throughput',
};

interface ThroughputSweepPoint {
  conc?: number;
  max_concurrency?: number;
  total_token_throughput?: number;
  output_throughput?: number;
  mean_ttft_ms?: number;
}

interface StackGroup {
  stack: string;
  date: string;
  probes: LiveCheckRow[];
}

function groupByStack(rows: LiveCheckRow[]): StackGroup[] {
  const byStack = new Map<string, LiveCheckRow[]>();
  for (const row of rows) {
    const existing = byStack.get(row.stack);
    if (existing) existing.push(row);
    else byStack.set(row.stack, [row]);
  }
  return [...byStack.entries()]
    .map(([stack, probes]) => ({
      stack,
      date: probes.reduce((max, p) => (p.date > max ? p.date : max), probes[0]?.date ?? ''),
      probes,
    }))
    .toSorted((a, b) => a.stack.localeCompare(b.stack));
}

export default function LiveCheckDisplay() {
  const { data, isLoading, error } = useLiveCheck();

  useEffect(() => {
    track('live_check_page_viewed');
  }, []);

  const groups = useMemo(() => groupByStack(data ?? []), [data]);

  const stats = useMemo(() => {
    const rows = data ?? [];
    const failing = rows.filter((r) => !r.ok).length;
    return { stacks: groups.length, probes: rows.length, failing };
  }, [data, groups.length]);

  if (error) {
    return (
      <Card>
        <p className="text-destructive text-sm">Failed to load live check data.</p>
      </Card>
    );
  }

  return (
    <div data-testid="live-check-display" className="flex flex-col gap-4">
      <section>
        <Card>
          <h2 className="text-lg font-semibold mb-2">Live Check</h2>
          <p className="text-muted-foreground text-sm">
            Post-deploy smoke tests and a short live throughput sweep against InferenceX&apos;s
            currently deployed stacks — what&apos;s live right now, not a benchmark sweep.
          </p>
        </Card>
      </section>

      {!isLoading && data && (
        <section>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Deployed Stacks" value={stats.stacks} />
            <StatCard label="Probes Checked" value={stats.probes} />
            <StatCard
              label="Failing Probes"
              value={stats.failing}
              tone={stats.failing > 0 ? 'destructive' : 'default'}
            />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        {isLoading ? (
          <Card>
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
              Loading live check data...
            </div>
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <p className="text-muted-foreground text-sm">No live check data yet.</p>
          </Card>
        ) : (
          groups.map((group) => <StackCard key={group.stack} group={group} />)
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'destructive';
}) {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p
        className={
          tone === 'destructive' && value > 0
            ? 'text-2xl font-bold tabular-nums text-destructive'
            : 'text-2xl font-bold tabular-nums'
        }
      >
        {value.toLocaleString()}
      </p>
    </Card>
  );
}

function StackCard({ group }: { group: StackGroup }) {
  const throughputProbe = group.probes.find((p) => p.probe_type === 'throughput');
  const sweep = (throughputProbe?.data?.sweep as ThroughputSweepPoint[] | undefined) ?? [];
  const redeployedMidRun = throughputProbe?.data?.redeployed_mid_run === true;

  return (
    <Card data-testid={`live-check-stack-${group.stack}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-base font-semibold font-mono">{group.stack}</h3>
          <p className="text-xs text-muted-foreground">Last checked {group.date}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {group.probes
          .toSorted((a, b) => a.probe_type.localeCompare(b.probe_type))
          .map((probe) => (
            <div
              key={probe.probe_type}
              className="flex items-start justify-between gap-3 border-t pt-2 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium">
                  {PROBE_LABELS[probe.probe_type] ?? probe.probe_type}
                </span>
                {probe.detail && (
                  <span className="text-xs text-muted-foreground break-words">{probe.detail}</span>
                )}
              </div>
              <Badge variant={probe.ok ? 'secondary' : 'destructive'} className="shrink-0">
                {probe.ok ? 'PASS' : 'FAIL'}
              </Badge>
            </div>
          ))}
      </div>

      {sweep.length > 0 && (
        <div className="mt-3 border-t pt-2">
          {redeployedMidRun && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mb-1">
              Stack redeployed mid-sweep — these numbers mix two deployments, treat as invalid.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="live-check-throughput-table">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="pr-4 py-1 font-normal">Concurrency</th>
                  <th className="pr-4 py-1 font-normal">Total tok/s</th>
                  <th className="pr-4 py-1 font-normal">Mean TTFT (ms)</th>
                </tr>
              </thead>
              <tbody>
                {sweep.map((point, i) => (
                  <tr key={point.conc ?? point.max_concurrency ?? i} className="tabular-nums">
                    <td className="pr-4 py-1">{point.conc ?? point.max_concurrency ?? '—'}</td>
                    <td className="pr-4 py-1">{point.total_token_throughput?.toFixed(1) ?? '—'}</td>
                    <td className="pr-4 py-1">{point.mean_ttft_ms?.toFixed(1) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
