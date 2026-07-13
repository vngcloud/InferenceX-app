import { NextResponse } from 'next/server';

import { getDb } from '@semianalysisai/inferencex-db/connection';
import { getLatestLiveCheckResults } from '@semianalysisai/inferencex-db/queries/live-check';

import { cachedJson, cachedQuery } from '@/lib/api-cache';

export const dynamic = 'force-dynamic';

const getCachedLiveCheckResults = cachedQuery(
  () => getLatestLiveCheckResults(getDb()),
  'live-check',
);

export async function GET() {
  try {
    const rows = await getCachedLiveCheckResults();
    return cachedJson(rows);
  } catch (error) {
    console.error('Error fetching live-check results:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
