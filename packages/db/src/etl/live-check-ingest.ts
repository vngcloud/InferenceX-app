/**
 * Bulk DB insert for `live_check_results`.
 */

import type postgres from 'postgres';
import type { LiveCheckRow } from './live-check-mapper';

type Sql = ReturnType<typeof postgres>;

/**
 * Bulk-insert `live_check_results` rows for one workflow run in a single DB
 * round-trip. Rows are deduplicated within the batch on `(stack, probeType)`
 * before sending, since Postgres rejects an `ON CONFLICT DO UPDATE` statement
 * that would update the same row twice in one query.
 *
 * @param sql - Active `postgres` connection.
 * @param rows - Mapped live-check rows for this run.
 * @param workflowRunId - DB id of the parent `workflow_runs` row.
 * @param date - ISO date string (`YYYY-MM-DD`) for the `date` column.
 * @returns Counts of newly inserted rows and rows that hit the conflict path.
 */
export async function bulkIngestLiveCheckRows(
  sql: Sql,
  rows: LiveCheckRow[],
  workflowRunId: number,
  date: string,
): Promise<{ newCount: number; dupCount: number }> {
  if (rows.length === 0) return { newCount: 0, dupCount: 0 };

  const seen = new Map<string, LiveCheckRow>();
  for (const r of rows) seen.set(`${r.stack}|${r.probeType}`, r);
  const deduped = [...seen.values()];

  const result = await sql<{ inserted: boolean }[]>`
    insert into live_check_results (
      workflow_run_id, date, stack, probe_type, run_type, ok, detail, data
    )
    select
      ${workflowRunId},
      ${date}::date,
      unnest(${sql.array(deduped.map((r) => r.stack))}::text[]),
      unnest(${sql.array(deduped.map((r) => r.probeType))}::text[]),
      unnest(${sql.array(deduped.map((r) => r.runType))}::text[]),
      unnest(${sql.array(deduped.map((r) => r.ok))}::bool[]),
      unnest(${sql.array(deduped.map((r) => r.detail))}::text[]),
      unnest(${sql.array(deduped.map((r) => JSON.stringify(r.data)))}::jsonb[])
    on conflict (workflow_run_id, stack, probe_type)
    do update set ok = excluded.ok, detail = excluded.detail, data = excluded.data
    returning (xmax = 0) as inserted
  `;

  const newCount = result.filter((r) => r.inserted).length;
  return { newCount, dupCount: deduped.length - newCount };
}
