import { type NextRequest, NextResponse } from 'next/server';

import { DISPLAY_MODEL_TO_DB } from '@semianalysisai/inferencex-constants';
import { FIXTURES_MODE, JSON_MODE, getDb } from '@semianalysisai/inferencex-db/connection';
import * as jsonProvider from '@semianalysisai/inferencex-db/json-provider';
import { getLatestBenchmarks } from '@semianalysisai/inferencex-db/queries/benchmarks';

import { cachedJson, cachedQuery } from '@/lib/api-cache';
import { loadFixture } from '@/lib/test-fixtures';

export const dynamic = 'force-dynamic';

const getCachedBenchmarks = cachedQuery(
  (dbModelKeys: string[], date?: string, exact?: boolean) => {
    if (JSON_MODE)
      return Promise.resolve(jsonProvider.getLatestBenchmarks(dbModelKeys, date, exact));
    return getLatestBenchmarks(getDb(), dbModelKeys, date, exact);
  },
  'benchmarks',
  { blobOnly: true },
);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const model = params.get('model') ?? '';
  // Reject anything that isn't an ISO YYYY-MM-DD — otherwise postgres-js will
  // coerce `${date}::date` via `new Date(date)`, which on garbage produces NaN
  // and throws `Invalid time value` from toISOString → opaque 500.
  const rawDate = params.get('date');
  const date = rawDate && ISO_DATE_RE.test(rawDate) ? rawDate : undefined;
  const exact = params.get('exact') === 'true';
  const dbModelKeys = DISPLAY_MODEL_TO_DB[model];
  if (!dbModelKeys || dbModelKeys.length === 0) {
    return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
  }
  if (FIXTURES_MODE) return cachedJson(loadFixture('benchmarks'));

  try {
    const rows = await getCachedBenchmarks(dbModelKeys, date, exact || undefined);
    return cachedJson(rows);
  } catch (error) {
    console.error('Error fetching benchmarks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
