import { type NextRequest, NextResponse } from 'next/server';

import { getDb } from '@semianalysisai/inferencex-db/connection';
import {
  getTraceHistograms,
  type TraceHistogramMap,
} from '@semianalysisai/inferencex-db/queries/trace-histograms';

import { cachedJson, cachedQuery } from '@/lib/api-cache';

export const dynamic = 'force-dynamic';

// blobOnly: a 50-id histogram payload can easily exceed Next.js's 2MB
// unstable_cache limit (each point carries one int per request, ~500-1000+
// requests for agentic), which manifests as a 500 from the route. Blob
// storage lets us cache the larger response without losing the warm-cache hit.
const getCachedTraceHistograms = cachedQuery(
  (ids: number[]): Promise<TraceHistogramMap> => getTraceHistograms(getDb(), ids),
  'trace-histograms',
  { blobOnly: true },
);

const MAX_IDS_PER_REQUEST = 200;

/**
 * GET /api/v1/trace-histograms?ids=1,2,3
 *
 * Returns per-request ISL/OSL arrays parsed from the stored aiperf
 * `profile_export.jsonl` blobs, keyed by `benchmark_results.id`.
 * Ids without a trace_replay blob are omitted from the response.
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
    // Sort the cache key so the same set of ids in any order hits the same entry.
    const sorted = [...ids].toSorted((a, b) => a - b);
    const histograms = await getCachedTraceHistograms(sorted);
    return cachedJson(histograms);
  } catch (error) {
    console.error('Error fetching trace histograms:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
