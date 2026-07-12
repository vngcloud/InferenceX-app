import type { DbClient } from '../connection.js';

export interface LiveCheckRow {
  stack: string;
  probe_type: string;
  run_type: string;
  ok: boolean;
  detail: string | null;
  data: Record<string, unknown>;
  date: string;
}

/**
 * Get the latest live-check row per (stack, probe_type) — "what's currently
 * live on the system", not sweep history. Joins through `latest_workflow_runs`
 * so a re-attempted run doesn't double-count.
 */
export async function getLiveCheckResults(sql: DbClient): Promise<LiveCheckRow[]> {
  const rows = await sql`
    SELECT DISTINCT ON (lc.stack, lc.probe_type)
      lc.stack, lc.probe_type, lc.run_type, lc.ok, lc.detail, lc.data, lc.date::text
    FROM live_check_results lc
    JOIN latest_workflow_runs wr ON wr.id = lc.workflow_run_id
    ORDER BY lc.stack, lc.probe_type, lc.date DESC, lc.id DESC
  `;
  return rows as unknown as LiveCheckRow[];
}
