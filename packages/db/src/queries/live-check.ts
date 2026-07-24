import type { DbClient } from '../connection.js';

export interface LiveCheckRow {
  stack: string;
  test_type: string;
  run_type: string;
  date: string;
  ok: boolean;
  detail: string | null;
  data: Record<string, unknown>;
  gpu_model: string | null;
  github_run_id: number;
  html_url: string | null;
}

/**
 * Get the latest live-check result per (stack, test_type) -- "what's
 * currently live on the system" (metadata + tool-calling smoke-test probes).
 * Throughput-test rows aren't ingested yet; see migration 009.
 */
export async function getLatestLiveCheckResults(sql: DbClient): Promise<LiveCheckRow[]> {
  const rows = await sql`
    SELECT
      lcr.stack, lcr.test_type, lcr.run_type, lcr.date::text,
      lcr.ok, lcr.detail, lcr.data, lcr.gpu_model,
      wr.github_run_id, wr.html_url
    FROM latest_live_check_results lcr
    JOIN workflow_runs wr ON wr.id = lcr.workflow_run_id
    ORDER BY lcr.stack, lcr.test_type
  `;
  return rows as unknown as LiveCheckRow[];
}
