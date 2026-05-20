import { type NextRequest, NextResponse } from 'next/server';

import { getDb } from '@semianalysisai/inferencex-db/connection';
import {
  getBenchmarkSiblings,
  type BenchmarkSiblings,
} from '@semianalysisai/inferencex-db/queries/benchmark-siblings';

import { cachedJson, cachedQuery } from '@/lib/api-cache';

export const dynamic = 'force-dynamic';

const getCachedSiblings = cachedQuery(
  (id: number): Promise<BenchmarkSiblings | null> => getBenchmarkSiblings(getDb(), id),
  'benchmark-siblings',
);

/**
 * GET /api/v1/benchmark-siblings?id=N
 *
 * Returns the SKU (hw/framework/model/precision/spec/benchmark_type) of the
 * benchmark_result + all sibling rows that share that SKU within the same
 * workflow_run. Used by the agentic detail page to render a navigator.
 */
export async function GET(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'id is required (benchmark_result_id)' }, { status: 400 });
  }
  try {
    const data = await getCachedSiblings(id);
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return cachedJson(data);
  } catch (error) {
    console.error('Error fetching benchmark siblings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
