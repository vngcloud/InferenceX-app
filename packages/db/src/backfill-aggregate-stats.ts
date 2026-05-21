/**
 * Backfill `agentic_trace_replay.aggregate_stats` for rows that are missing it
 * or were computed by an older `STATS_VERSION`.
 *
 * The ingest path now computes stats inline, but existing rows (and rows
 * whose computation logic has since changed) still need this pass. Run after
 * applying migration 008 and any time `STATS_VERSION` bumps.
 *
 * Strategy:
 *   - Stream rows one at a time (server_metrics_json_gz can be hundreds of
 *     MB decompressed for TP+EP / high-conc points — keeping one in memory
 *     at a time avoids OOM).
 *   - Skip rows whose stored `aggregate_stats.version` already matches.
 *   - Recompute via the same `computeAggregateStats()` helper the ingest
 *     path uses, so behavior cannot drift.
 *
 * Usage:
 *   pnpm --filter @semianalysisai/inferencex-db db:backfill-aggregate-stats
 *     [--limit N]   only process the first N candidate rows (useful for
 *                   smoke-tests on a fresh deploy)
 *     [--force]     recompute every row, even if version already matches
 *     [--yes]       skip the confirmation prompt
 */

import { confirm, hasNoSslFlag, hasYesFlag } from './cli-utils.js';
import { computeAggregateStats, STATS_VERSION } from './etl/compute-aggregate-stats.js';
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
  console.log('=== backfill-aggregate-stats ===');
  console.log(`  STATS_VERSION = ${STATS_VERSION}`);
  console.log(`  force = ${flags.force}`);
  console.log(`  limit = ${flags.limit ?? 'none'}`);

  // Find candidates: rows missing stats, or whose stored version is stale.
  // Using >>'version'::int comparison would error on null; coalesce to -1 so
  // null-stats rows always count as stale.
  const candidates = flags.force
    ? await sql<{ id: number }[]>`
        select id
        from agentic_trace_replay
        order by id
        ${flags.limit ? sql`limit ${flags.limit}` : sql``}
      `
    : await sql<{ id: number }[]>`
        select id
        from agentic_trace_replay
        where aggregate_stats is null
           or coalesce((aggregate_stats->>'version')::int, -1) <> ${STATS_VERSION}
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
      // Fetch one row at a time — the json_gz blob is the heavy field.
      const [row] = await sql<
        { profile_export_jsonl_gz: Buffer | null; server_metrics_json_gz: Buffer | null }[]
      >`
        select profile_export_jsonl_gz, server_metrics_json_gz
        from agentic_trace_replay
        where id = ${id}
      `;
      if (!row) {
        console.warn(`  id=${id}: row vanished, skipping`);
        continue;
      }

      const stats = await computeAggregateStats({
        profileBlob: row.profile_export_jsonl_gz,
        serverBlob: row.server_metrics_json_gz,
      });

      await sql`
        update agentic_trace_replay
        set aggregate_stats = ${sql.json(structuredClone(stats) as unknown as Parameters<typeof sql.json>[0])}
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
    console.error('backfill-aggregate-stats failed:', error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
