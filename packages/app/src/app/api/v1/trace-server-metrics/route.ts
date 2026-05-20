import { type NextRequest, NextResponse } from 'next/server';

import { getDb } from '@semianalysisai/inferencex-db/connection';
import {
  getTraceServerMetrics,
  type TraceServerMetrics,
} from '@semianalysisai/inferencex-db/queries/trace-server-metrics';

import { cachedJson, cachedQuery } from '@/lib/api-cache';

export const dynamic = 'force-dynamic';

const getCachedTraceServerMetrics = cachedQuery(
  (id: number): Promise<TraceServerMetrics | null> => getTraceServerMetrics(getDb(), id),
  'trace-server-metrics',
  { blobOnly: true },
);

/**
 * GET /api/v1/trace-server-metrics?id=N
 *
 * Returns parsed time-series for the agentic detail view: KV cache usage,
 * prefix cache hit rate per interval, queue depth, and per-source prompt
 * token rates. Times are in seconds from benchmark start. 404 if the point
 * has no stored server_metrics_export.json blob.
 */
export async function GET(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'id is required (benchmark_result_id)' }, { status: 400 });
  }
  try {
    const data = await getCachedTraceServerMetrics(id);
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return cachedJson(data);
  } catch (error) {
    console.error('Error fetching trace server metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
