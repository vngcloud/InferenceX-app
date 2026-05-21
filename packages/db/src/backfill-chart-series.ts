/**
 * Backfill `agentic_trace_replay.chart_series` for rows that are missing it
 * or were computed by an older `CHART_SERIES_VERSION`.
 *
 * The ingest path now computes the time-series inline, but existing rows
 * (and rows whose computation logic has since changed) still need this
 * pass. Run after applying migration 009 and any time `CHART_SERIES_VERSION`
 * bumps.
 *
 * Strategy:
 *   - Stream rows one at a time (server_metrics_json_gz can decompress
 *     past 500 MB on high-conc TP+EP points — one in memory at a time
 *     avoids OOM).
 *   - Skip rows whose stored version already matches.
 *   - Recompute via the same `computeChartSeries()` helper the ingest
 *     path uses, so behavior cannot drift.
 *
 * Usage:
 *   pnpm --filter @semianalysisai/inferencex-db db:backfill-chart-series
 *     [--limit N]   only process the first N candidate rows
 *     [--force]     recompute every row, even if version already matches
 *     [--yes]       skip the confirmation prompt
 */

import { confirm, hasNoSslFlag, hasYesFlag } from './cli-utils.js';
import { CHART_SERIES_VERSION, computeChartSeries } from './etl/compute-chart-series.js';
import { createAdminSql } from './etl/db-utils.js';

interface CliFlags {
  limit: number | null;
  force: boolean;
}

function parseFlags(): CliFlags {
  let limit: number | null = null;
  let force = false;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]!;
    if (arg === '--force') force = true;
    else if (arg === '--limit') {
      const next = process.argv[++i];
      if (!next || Number.isNaN(Number(next))) {
        console.error('--limit requires a numeric argument');
        process.exit(1);
      }
      limit = Number(next);
    }
  }
  return { limit, force };
}

const flags = parseFlags();

const sql = createAdminSql({
  noSsl: hasNoSslFlag(),
  max: 1,
  onnotice: () => {},
});

async function main(): Promise<void> {
  console.log('=== backfill-chart-series ===');
  console.log(`  CHART_SERIES_VERSION = ${CHART_SERIES_VERSION}`);
  console.log(`  force = ${flags.force}`);
  console.log(`  limit = ${flags.limit ?? 'none'}`);

  // Only rows that actually have a server_metrics blob can produce a
  // chart_series. Rows without the blob legitimately keep `chart_series`
  // null and the API serves them via the slow path (which also returns
  // null because there's no blob to parse — so the page falls into the
  // "no stored trace_replay blob" branch).
  const candidates = flags.force
    ? await sql<{ id: number }[]>`
        select id
        from agentic_trace_replay
        where server_metrics_json_gz is not null
        order by id
        ${flags.limit ? sql`limit ${flags.limit}` : sql``}
      `
    : await sql<{ id: number }[]>`
        select id
        from agentic_trace_replay
        where server_metrics_json_gz is not null
          and (
            chart_series is null
            or coalesce((chart_series->>'version')::int, -1) <> ${CHART_SERIES_VERSION}
          )
        order by id
        ${flags.limit ? sql`limit ${flags.limit}` : sql``}
      `;

  if (candidates.length === 0) {
    console.log('\n  Nothing to do — all rows up to date.');
    return;
  }

  console.log(`\n  ${candidates.length} candidate row(s).`);
  if (!hasYesFlag()) {
    const ok = await confirm('\nProceed? (y/N) ');
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }

  let ok = 0;
  let failed = 0;
  const t0 = Date.now();
  for (const { id } of candidates) {
    const start = Date.now();
    try {
      const [row] = await sql<{ server_metrics_json_gz: Buffer | null }[]>`
        select server_metrics_json_gz
        from agentic_trace_replay
        where id = ${id}
      `;
      if (!row) {
        console.warn(`  id=${id}: row vanished, skipping`);
        continue;
      }

      const series = await computeChartSeries(row.server_metrics_json_gz);

      await sql`
        update agentic_trace_replay
        set chart_series = ${
          series === null
            ? null
            : sql.json(structuredClone(series) as unknown as Parameters<typeof sql.json>[0])
        }
        where id = ${id}
      `;
      ok++;
      const elapsed = Math.round((Date.now() - start) / 1000);
      const elapsedTotal = Math.round((Date.now() - t0) / 1000);
      console.log(
        `  ✓ id=${id} (${elapsed}s, ${ok}/${candidates.length} done, ${elapsedTotal}s total)`,
      );
    } catch (error) {
      failed++;
      console.error(`  ✗ id=${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const totalSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== backfill complete: ${ok} ok, ${failed} failed in ${totalSec}s ===`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('backfill-chart-series failed:', error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
