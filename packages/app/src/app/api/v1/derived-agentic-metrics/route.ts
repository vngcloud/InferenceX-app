import { type NextRequest, NextResponse } from 'next/server';

import { getDb } from '@semianalysisai/inferencex-db/connection';
import {
  getDerivedAgenticMetrics,
  type DerivedAgenticMetricMap,
} from '@semianalysisai/inferencex-db/queries/derived-agentic-metrics';

import { cachedJson, cachedQuery } from '@/lib/api-cache';

export const dynamic = 'force-dynamic';

// blobOnly: the response is one entry per id with two numbers, but the
// derivation work parses thousands of JSONL records per blob — cache the
// computed result so a chart-refresh hits the warm path.
const getCachedDerivedAgenticMetrics = cachedQuery(
  (ids: number[]): Promise<DerivedAgenticMetricMap> => getDerivedAgenticMetrics(getDb(), ids),
  'derived-agentic-metrics',
  { blobOnly: true },
);

const MAX_IDS_PER_REQUEST = 200;

/**
 * GET /api/v1/derived-agentic-metrics?ids=1,2,3
 *
 * Returns per-id derived metrics computed live from the stored aiperf
 * profile_export.jsonl blobs:
 *  - normalized_session_time_s: mean across sessions of session e2e time
 *    (Σ per-turn request_latency) rescaled by mean_load / session_load.
 *  - mean_p90_prefill_tps_per_user: mean across sessions of P90 (over the
 *    session's turns) prefill TPS/user (ISL / TTFT).
 *
 * Ids without a trace_replay blob or with unparseable records are omitted.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('ids');
  if (!raw) {
    return NextResponse.json({ error: 'ids query param is required' }, { status: 400 });
  }

  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'no valid ids provided' }, { status: 400 });
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json(
      { error: `too many ids (max ${MAX_IDS_PER_REQUEST})` },
      { status: 400 },
    );
  }

  try {
    const sorted = [...ids].toSorted((a, b) => a - b);
    const result = await getCachedDerivedAgenticMetrics(sorted);
    return cachedJson(result);
  } catch (error) {
    console.error('Error fetching derived agentic metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
