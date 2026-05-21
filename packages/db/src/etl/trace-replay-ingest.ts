/**
 * Insert per-point aiperf trace files (`profile_export.jsonl` +
 * `server_metrics_export.csv`) into `agentic_trace_replay` and link the new row
 * to each provided benchmark_results row via `trace_replay_id`.
 *
 * Mirrors the {@link insertServerLog} idempotency contract: rows that already
 * have a non-null `trace_replay_id` are left alone so a re-ingest doesn't
 * duplicate the sibling blob.
 */

import { gzipSync } from 'node:zlib';

import type postgres from 'postgres';

import { computeAggregateStats } from './compute-aggregate-stats.js';

type Sql = ReturnType<typeof postgres>;

/**
 * Persist the per-point trace files and link them to `benchmarkResultIds`.
 *
 * @param sql                 Active `postgres` connection.
 * @param benchmarkResultIds  DB ids of the benchmark_results rows produced by
 *                            the same `bmk_agentic_<suffix>` artifact whose
 *                            sibling `agentic_<suffix>` directory holds these
 *                            trace files.
 * @param profileExportJsonl  Raw bytes of `profile_export.jsonl`, or null.
 *                            Gzipped before storage.
 * @param serverMetricsCsv    Raw bytes of `server_metrics_export.csv`, or null.
 *                            Stored as-is.
 * @param serverMetricsJson   Raw bytes of `server_metrics_export.json` —
 *                            per-scrape time-series of every Prometheus metric.
 *                            Optional, gzipped before storage (~42x ratio).
 */
export async function insertTraceReplay(
  sql: Sql,
  benchmarkResultIds: number[],
  profileExportJsonl: Buffer | null,
  serverMetricsCsv: Buffer | null,
  serverMetricsJson: Buffer | null = null,
): Promise<void> {
  if (benchmarkResultIds.length === 0) return;
  if (!profileExportJsonl && !serverMetricsCsv && !serverMetricsJson) return;

  // Only link rows that don't already point at a trace_replay row — keeps
  // re-ingest from inserting duplicate sibling blobs.
  const unlinked = await sql<{ id: number }[]>`
    select id from benchmark_results
    where id = any(${sql.array(benchmarkResultIds)}::bigint[])
      and trace_replay_id is null
  `;
  if (unlinked.length === 0) return;

  const profileGz = profileExportJsonl ? gzipSync(profileExportJsonl) : null;
  const profileSize = profileExportJsonl ? profileExportJsonl.length : null;
  const csvSize = serverMetricsCsv ? serverMetricsCsv.length : null;
  const metricsJsonGz = serverMetricsJson ? gzipSync(serverMetricsJson) : null;
  const metricsJsonSize = serverMetricsJson ? serverMetricsJson.length : null;

  // Pre-compute the aggregate stats so the detail page / aggregates view
  // doesn't have to re-parse these blobs on every request. The compute
  // function tolerates one-or-both blobs being null and falls back to a
  // streaming parser for oversized server_metrics blobs.
  const aggregateStats = await computeAggregateStats({
    profileBlob: profileGz,
    serverBlob: metricsJsonGz,
  });

  const [{ id: traceReplayId }] = await sql<{ id: number }[]>`
    insert into agentic_trace_replay (
      profile_export_jsonl_gz,
      profile_export_uncompressed_size,
      server_metrics_csv,
      server_metrics_csv_size,
      server_metrics_json_gz,
      server_metrics_json_uncompressed_size,
      aggregate_stats
    )
    values (
      ${profileGz},
      ${profileSize},
      ${serverMetricsCsv},
      ${csvSize},
      ${metricsJsonGz},
      ${metricsJsonSize},
      ${sql.json(structuredClone(aggregateStats) as unknown as Parameters<typeof sql.json>[0])}
    )
    returning id
  `;

  await sql`
    update benchmark_results
    set trace_replay_id = ${traceReplayId}
    where id = any(${sql.array(unlinked.map((r) => r.id))}::bigint[])
  `;
}
