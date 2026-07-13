/**
 * Ingest a single Smoke Test or Throughput Test workflow run's artifacts
 * into `live_check_results`. The two are separate GitHub Actions workflows
 * with no shared run ID (see design/new-test-design.md) -- this script
 * handles either one, detecting which artifact family is present.
 *
 * Two modes:
 *   --download <run-url-or-id> [repo]  Download artifacts from GitHub then ingest
 *   (no flag)                          Read from INGEST_ARTIFACTS_PATH (CI mode)
 *
 * Usage:
 *   pnpm admin:db:live-check:ingest:run https://github.com/vngcloud/InferenceX/actions/runs/123
 *   pnpm admin:db:live-check:ingest:run 123
 *   pnpm admin:db:live-check:ingest:run 123 vngcloud/InferenceX
 *   pnpm admin:db:live-check:ingest:ci   (reads INGEST_* env vars, used by CI workflow)
 *
 * Environment variables:
 *   DATABASE_WRITE_URL     — Postgres connection string (direct, non-pooled)
 *   GITHUB_TOKEN           — GitHub PAT for fetching run metadata
 *   INGEST_RUN_ID          — (CI mode) Workflow run ID
 *   INGEST_ARTIFACTS_PATH  — (CI mode) Local path to pre-downloaded artifacts
 *   INGEST_REPO            — (CI mode) Source repo slug (owner/name)
 *
 * Note: unlike the benchmark-sweep ingest, this does NOT filter on run
 * conclusion -- smoke-test intentionally exits non-zero whenever any probe
 * fails (e.g. tool-calling), but still uploads a valid results artifact.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { hasNoSslFlag } from './cli-utils';
import { createAdminSql } from './etl/db-utils';
import { isRunAttemptPurged } from './etl/run-overrides';
import { createWorkflowRunServices } from './etl/workflow-run';
import { mapSmokeTestRow, mapThroughputTestRow } from './etl/live-check-mapper';
import { bulkIngestLiveCheckResults } from './etl/live-check-ingest';

// ── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_REPO = 'vngcloud/InferenceX';
const isDownloadMode = process.argv[2] === '--download';

let artifactsDir: string;
let runIdStr: string;
let runAttemptNum: number;
let REPO: string;
let tempDir: string | null = null;

if (isDownloadMode) {
  const args = process.argv.slice(3).filter((a) => a !== '--');
  const input = args[0];
  if (!input) {
    console.error('Usage: pnpm admin:db:live-check:ingest:run <run-url-or-id> [repo]');
    process.exit(1);
  }

  const match = input.match(/\/runs\/(\d+)/u);
  const parsedId = match ? match[1] : /^\d+$/u.test(input) ? input : null;
  if (!parsedId) {
    console.error(`Could not parse run ID from: ${input}`);
    process.exit(1);
  }

  runIdStr = parsedId;
  REPO = args[1] ?? DEFAULT_REPO;

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-live-check-'));
  artifactsDir = tempDir;

  console.log('=== ingest-live-check (download mode) ===');
  console.log(`  Run ID: ${runIdStr}`);
  console.log(`  Repo:   ${REPO}`);
  console.log(`\n--- Downloading artifacts to ${artifactsDir} ---`);

  const artifactListJson = execSync(
    `gh api "repos/${REPO}/actions/runs/${runIdStr}/artifacts" --paginate --jq '.artifacts[]'`,
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );

  const allArtifacts: { name: string; archive_download_url: string; created_at: string }[] = [];
  for (const line of artifactListJson.trim().split('\n')) {
    if (!line) continue;
    try {
      allArtifacts.push(JSON.parse(line));
    } catch {}
  }

  const byName = new Map<string, (typeof allArtifacts)[0]>();
  for (const a of allArtifacts) {
    if (
      !a.name.startsWith('smoke_test_results_') &&
      !a.name.startsWith('throughput_test_results_')
    ) {
      continue;
    }
    const existing = byName.get(a.name);
    if (!existing || a.created_at > existing.created_at) {
      byName.set(a.name, a);
    }
  }

  for (const [name, artifact] of byName) {
    console.log(`  ${name}`);
    const zipPath = path.join(artifactsDir, 'artifact.zip');
    execSync(`gh api "${artifact.archive_download_url}" > "${zipPath}"`, {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const destDir = path.join(artifactsDir, name);
    fs.mkdirSync(destDir, { recursive: true });
    execSync(`unzip -oq "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
    fs.unlinkSync(zipPath);
  }

  console.log(`\n  Downloaded ${byName.size} live-check artifact(s)`);

  const attemptStr = execSync(
    `gh api "repos/${REPO}/actions/runs/${runIdStr}" --jq '.run_attempt'`,
    { encoding: 'utf8' },
  ).trim();
  runAttemptNum = parseInt(attemptStr || '1', 10);
} else {
  for (const key of [
    'DATABASE_WRITE_URL',
    'GITHUB_TOKEN',
    'INGEST_RUN_ID',
    'INGEST_ARTIFACTS_PATH',
    'INGEST_REPO',
  ]) {
    if (!process.env[key]) {
      console.error(`${key} is required`);
      process.exit(1);
    }
  }

  runIdStr = process.env.INGEST_RUN_ID!;
  runAttemptNum = parseInt(process.env.INGEST_RUN_ATTEMPT ?? '1', 10);
  artifactsDir = process.env.INGEST_ARTIFACTS_PATH!;
  REPO = process.env.INGEST_REPO!;
}

if (!process.env.DATABASE_WRITE_URL || !process.env.GITHUB_TOKEN) {
  console.error('DATABASE_WRITE_URL and GITHUB_TOKEN are required');
  process.exit(1);
}

const runIdNum = parseInt(runIdStr, 10);
if (isRunAttemptPurged(runIdNum, runAttemptNum)) {
  console.log(`  Run ${runIdStr} attempt ${runAttemptNum} is purged via run-overrides — skipping.`);
  process.exit(0);
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;

const sql = createAdminSql({
  noSsl: hasNoSslFlag(),
  max: 5,
  idle_timeout: 60,
});

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error: any) {
    console.warn(`  [WARN] Failed to parse ${path.basename(filePath)}: ${error.message}`);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { fetchGithubRun, getOrCreateWorkflowRun } = createWorkflowRunServices(sql, GITHUB_TOKEN);

  const runId = parseInt(runIdStr, 10);
  const ghInfo = await fetchGithubRun(runId);

  console.log('\n=== ingest-live-check ===');
  console.log(`  Run ID:      ${runIdStr}`);
  console.log(`  Attempt:     ${runAttemptNum}`);
  console.log(`  Artifacts:   ${artifactsDir}`);
  console.log(`  Repo:        ${REPO}`);
  if (ghInfo?.name && ghInfo.name !== 'Smoke Test' && ghInfo.name !== 'Throughput Test') {
    // GitHub reports a run's name from the workflow's `name:` key, not its
    // filename -- warn (don't fail) if this doesn't look like a live-check
    // run, since that usually means the wrong run ID was passed.
    console.warn(
      `  [WARN] run name is "${ghInfo.name}", expected "Smoke Test" or "Throughput Test"`,
    );
  }
  if (ghInfo?.htmlUrl) {
    console.log(`  Run URL:     ${ghInfo.htmlUrl}/attempts/${runAttemptNum}`);
  }

  if (!fs.existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory does not exist: ${artifactsDir}`);
  }

  const date = ghInfo?.createdAt
    ? ghInfo.createdAt.split('T')[0]
    : new Date().toISOString().split('T')[0];

  const workflowRunId = await getOrCreateWorkflowRun({
    githubRunId: runId,
    runAttempt: runAttemptNum,
    name: ghInfo?.name || `Live Check ${runIdStr}`,
    date,
    headBranch: ghInfo?.headBranch,
    headSha: ghInfo?.headSha,
    createdAt: ghInfo?.createdAt || new Date().toISOString(),
    ghInfo,
  });
  if (workflowRunId === null) {
    console.log(
      `  Run ${runId} attempt ${runAttemptNum} is purged via run-overrides — skipping ingest.`,
    );
    return;
  }
  console.log(`  Workflow run DB id: ${workflowRunId}`);

  const allDirs = fs.readdirSync(artifactsDir).map((d) => path.join(artifactsDir, d));
  const smokeDirs = allDirs
    .filter((d) => path.basename(d).startsWith('smoke_test_results_'))
    .filter((d) => fs.statSync(d).isDirectory());
  const throughputDirs = allDirs
    .filter((d) => path.basename(d).startsWith('throughput_test_results_'))
    .filter((d) => fs.statSync(d).isDirectory());

  console.log('\n--- Live-Check Results ---');
  console.log(`  Found ${smokeDirs.length} smoke_test_results_* artifact(s)`);
  console.log(`  Found ${throughputDirs.length} throughput_test_results_* artifact(s)`);

  const allRows = [];
  let badArtifacts = 0;
  for (const { dir, mapper, label } of [
    ...smokeDirs.map((d) => ({ dir: d, mapper: mapSmokeTestRow, label: 'smoke-test' })),
    ...throughputDirs.map((d) => ({
      dir: d,
      mapper: mapThroughputTestRow,
      label: 'throughput-test',
    })),
  ]) {
    const jsonFile = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
    if (!jsonFile) {
      console.warn(`  [WARN] ${path.basename(dir)}: no JSON file found`);
      badArtifacts++;
      continue;
    }
    const data = readJson(path.join(dir, jsonFile));
    const rows = mapper(data);
    if (rows.length === 0) {
      console.warn(`  [WARN] ${path.basename(dir)}: no valid ${label} rows mapped`);
      badArtifacts++;
      continue;
    }
    allRows.push(...rows);
  }

  const { newCount, dupCount } = await bulkIngestLiveCheckResults(
    sql,
    allRows,
    workflowRunId,
    date,
  );
  console.log(`  Live-check results: +${newCount} new, ${dupCount} dup`);
  if (badArtifacts > 0) console.log(`  Skipped: ${badArtifacts} malformed artifact(s)`);

  const [liveCheckCount] = await sql`select count(*)::int as n from live_check_results`;
  console.log('\n=== Summary ===');
  console.log(`  live_check_results total: ${liveCheckCount.n}`);
  console.log('\n=== ingest-live-check complete ===');
}

main()
  .catch((error) => {
    console.error('ingest-live-check failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
    return sql.end();
  });
