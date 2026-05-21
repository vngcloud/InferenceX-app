import { type NextRequest, NextResponse } from 'next/server';

import { getDb } from '@semianalysisai/inferencex-db/connection';
import {
  getAgenticAggregates,
  type AgenticAggregateMap,
} from '@semianalysisai/inferencex-db/queries/agentic-aggregates';

import { cachedJson, cachedQuery } from '@/lib/api-cache';

export const dynamic = 'force-dynamic';

// blobOnly: response stays small (a few numbers per id), but generating it
// parses ~5-10 MB of decompressed JSONL + JSON per id. Cache so the
// "Aggregates" toggle stays snappy.
const getCachedAgenticAggregates = cachedQuery(
  (ids: number[]): Promise<AgenticAggregateMap> => getAgenticAggregates(getDb(), ids),
  'agentic-aggregates',
  { blobOnly: true },
);

const MAX_IDS_PER_REQUEST = 200;

/**
 * GET /api/v1/agentic-aggregates?ids=1,2,3
 *
 * Returns per-id mean/p50/p75/p90/p99 for ISL, OSL, KV cache utilization,
 * and prefix cache hit rate — computed live from the stored aiperf
 * profile_export.jsonl + server_metrics_json blobs. Ids without a
 * trace_replay blob (or with no usable samples) get nulls.
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
    const result = await getCachedAgenticAggregates(sorted);
    return cachedJson(result);
  } catch (error) {
    console.error('Error fetching agentic aggregates:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
