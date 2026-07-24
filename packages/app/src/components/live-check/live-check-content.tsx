'use client';

import { useMemo } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveCheck } from '@/hooks/api/use-live-check';
import type { LiveCheckRow } from '@/lib/api';
import { track } from '@/lib/analytics';

const TEST_TYPE_LABEL: Record<LiveCheckRow['test_type'], string> = {
  metadata: 'Metadata Drift',
  'tool-calling': 'Tool Calling',
  throughput: 'Throughput Sweep',
};

const TEST_TYPE_ORDER: LiveCheckRow['test_type'][] = ['metadata', 'tool-calling', 'throughput'];

/** Sweep-point fields already surfaced as their own table columns. */
const SWEEP_CORE_KEYS = new Set(['conc', 'model_id', 'max_concurrency']);

interface StackGroup {
  stack: string;
  gpuModel: string | null;
  checks: Partial<Record<LiveCheckRow['test_type'], LiveCheckRow>>;
}

function groupByStack(rows: LiveCheckRow[]): StackGroup[] {
  const groups = new Map<string, StackGroup>();
  for (const row of rows) {
    let group = groups.get(row.stack);
    if (!group) {
      group = { stack: row.stack, gpuModel: null, checks: {} };
      groups.set(row.stack, group);
    }
    group.checks[row.test_type] = row;
    if (row.gpu_model) group.gpuModel = row.gpu_model;
  }
  return [...groups.values()].toSorted((a, b) => a.stack.localeCompare(b.stack));
}

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge className="border-transparent bg-emerald-600 text-white dark:bg-emerald-500">OK</Badge>
  ) : (
    <Badge variant="destructive">Failing</Badge>
  );
}

/** "servedName" / "num_dataset_entries" -> "Served Name" / "Num Dataset Entries". */
function humanizeKey(key: string): string {
  return key
    .replaceAll('_', ' ')
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, '$<lower> $<upper>')
    .replace(/^./u, (c) => c.toUpperCase());
}

function formatDataValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/**
 * Renders every field in a probe's `data` generically -- these are verbatim
 * snapshots of a live stack's self-report (`/version`, a chat response,
 * etc.), and the field set varies per stack/failure-mode (design doc:
 * "don't assume a fixed key set"). A hand-picked field list would silently
 * hide anything not on the list.
 */
function DataFieldList({
  data,
  skipKeys,
}: {
  data: Record<string, unknown>;
  skipKeys?: Set<string>;
}) {
  const entries = Object.entries(data).filter(([k]) => !skipKeys?.has(k));
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {entries.map(([key, value]) => {
        const formatted = formatDataValue(value);
        const isLong = formatted.length > 40;
        return (
          <div key={key} className={isLong ? 'col-span-2 sm:col-span-3' : undefined}>
            <dt className="text-muted-foreground text-xs">{humanizeKey(key)}</dt>
            <dd className={isLong ? 'break-all font-mono text-xs' : 'text-xs'}>{formatted}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function MetadataDetail({ row }: { row: LiveCheckRow }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">{row.detail}</p>
      <DataFieldList data={row.data} />
    </div>
  );
}

function ToolCallingDetail({ row }: { row: LiveCheckRow }) {
  const content = typeof row.data.content === 'string' ? row.data.content : null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">{row.detail}</p>
      {content && (
        <blockquote className="rounded-md border-l-2 border-muted-foreground/30 bg-muted/30 p-3 text-xs whitespace-pre-wrap">
          {content}
        </blockquote>
      )}
      {/* Failure shape varies: {"response_text": ...} for non-200, the raw
          assistant message for a plain-text reply, or the full raw response
          body for anything malformed -- show whatever else is here. */}
      <DataFieldList data={row.data} skipKeys={content ? new Set(['content']) : undefined} />
    </div>
  );
}

function ThroughputDetail({ row }: { row: LiveCheckRow }) {
  const d = row.data;
  const sweep = Array.isArray(d.sweep) ? (d.sweep as Record<string, unknown>[]) : [];
  const extraKeys = [
    ...new Set(sweep.flatMap((point) => Object.keys(point).filter((k) => !SWEEP_CORE_KEYS.has(k)))),
  ].toSorted();

  const redeployed = d.redeployed_mid_run;
  const redeployLabel =
    redeployed === null || redeployed === undefined
      ? 'unconfirmed (post-sweep check failed)'
      : redeployed
        ? 'yes — points may span two deployments'
        : 'no';

  // sweep is rendered as its own table below; gpu_model is already shown as
  // the stack-level badge; redeployed_mid_run gets custom null/true/false
  // labeling above the generic fields rather than a raw JSON dump.
  const skipKeys = new Set(['sweep', 'gpu_model', 'redeployed_mid_run']);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{row.detail}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground text-xs">Redeployed Mid-Run</dt>
          <dd className={redeployed ? 'text-amber-500' : undefined}>{redeployLabel}</dd>
        </div>
      </dl>
      <DataFieldList data={d} skipKeys={skipKeys} />
      {sweep.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 text-left font-semibold">Concurrency</th>
                {extraKeys.map((k) => (
                  <th key={k} className="px-3 py-2 text-left font-semibold">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sweep.map((point, i) => (
                // conc is stable per row within one sweep artifact; index is a safe
                // fallback key since sweeps don't reorder or duplicate concurrencies.
                <tr
                  key={`${String(point.conc)}-${i}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-3 py-2 tabular-nums">{String(point.conc ?? '—')}</td>
                  {extraKeys.map((k) => (
                    <td key={k} className="px-3 py-2 tabular-nums">
                      {point[k] === undefined ? '—' : String(point[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CheckDetail({ row }: { row: LiveCheckRow }) {
  if (row.test_type === 'metadata') return <MetadataDetail row={row} />;
  if (row.test_type === 'tool-calling') return <ToolCallingDetail row={row} />;
  return <ThroughputDetail row={row} />;
}

function StackCard({ group }: { group: StackGroup }) {
  const presentChecks = TEST_TYPE_ORDER.filter((t) => group.checks[t]);
  const missingChecks = TEST_TYPE_ORDER.filter((t) => !group.checks[t]);

  return (
    <Card>
      <CardHeader className="mb-2 flex flex-row flex-wrap items-center justify-between gap-2 px-0">
        <CardTitle className="text-lg">{group.stack}</CardTitle>
        {group.gpuModel && <Badge variant="outline">{group.gpuModel}</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <Accordion
          type="multiple"
          onValueChange={(values) => {
            track('live_check_check_expanded', { stack: group.stack, checks: values.join(',') });
          }}
        >
          {presentChecks.map((testType) => {
            const row = group.checks[testType]!;
            return (
              <AccordionItem
                key={testType}
                value={testType}
                data-testid={`live-check-item-${group.stack}-${testType}`}
              >
                <AccordionTrigger className="text-sm">
                  <span className="flex flex-1 items-center gap-3">
                    <StatusBadge ok={row.ok} />
                    <span className="font-medium">{TEST_TYPE_LABEL[testType]}</span>
                    <span className="text-muted-foreground text-xs">{row.date}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <CheckDetail row={row} />
                  {row.html_url && (
                    <a
                      href={row.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-secondary hover:underline dark:text-primary"
                      onClick={() =>
                        track('live_check_run_link_clicked', {
                          stack: group.stack,
                          test_type: testType,
                        })
                      }
                    >
                      View GitHub Actions run →
                    </a>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        {missingChecks.length > 0 && (
          <p className="text-muted-foreground text-xs">
            No {missingChecks.map((t) => TEST_TYPE_LABEL[t]).join(', ')} data yet for this stack.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function LiveCheckContent() {
  const { data, isLoading, error } = useLiveCheck();
  const groups = useMemo(() => (data ? groupByStack(data) : []), [data]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Live Check</h1>
        <p className="mt-2 text-muted-foreground">
          What is currently live on already-deployed inference stacks — metadata drift, tool-calling
          correctness, and a live throughput sweep. Separate from historical sweep data; this
          reflects the most recent post-deploy check per stack.
        </p>
      </div>

      {isLoading && <div className="py-12 text-center text-muted-foreground">Loading...</div>}

      {error && (
        <div className="py-12 text-center text-destructive">Failed to load live-check data.</div>
      )}

      {data && groups.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">No live-check data available.</div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-col gap-4" data-testid="live-check-stack-list">
          {groups.map((group) => (
            <StackCard key={group.stack} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
