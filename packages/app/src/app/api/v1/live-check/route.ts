import { NextResponse } from 'next/server';

import { FIXTURES_MODE, getDb } from '@semianalysisai/inferencex-db/connection';
import { getLatestLiveCheckResults } from '@semianalysisai/inferencex-db/queries/live-check';

import { cachedJson, cachedQuery } from '@/lib/api-cache';
import { loadFixture } from '@/lib/test-fixtures';

export const dynamic = 'force-dynamic';

const getCachedLiveCheckResults = cachedQuery(
  () => getLatestLiveCheckResults(getDb()),
  'live-check',
);

export async function GET() {
  if (FIXTURES_MODE) return cachedJson(loadFixture('live-check'));
  try {
    const rows = await getCachedLiveCheckResults();
    return cachedJson(rows);
  } catch (error) {
    console.error('Error fetching live-check results:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
