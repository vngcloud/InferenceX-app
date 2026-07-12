import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockGetLiveCheckResults, mockGetDb } = vi.hoisted(() => ({
  mockGetLiveCheckResults: vi.fn(),
  mockGetDb: vi.fn(() => 'mock-sql'),
}));

vi.mock('@semianalysisai/inferencex-db/connection', () => ({
  getDb: mockGetDb,
  JSON_MODE: false,
  FIXTURES_MODE: false,
}));

vi.mock('@semianalysisai/inferencex-db/queries/live-check', () => ({
  getLiveCheckResults: mockGetLiveCheckResults,
}));

vi.mock('@/lib/api-cache', () => ({
  cachedQuery: (fn: (...args: any[]) => any) => fn,
  cachedJson: (data: unknown) => Response.json(data),
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/live-check', () => {
  it('returns live check rows', async () => {
    const mockRows = [
      {
        stack: 'sglang-vanilla',
        probe_type: 'metadata',
        run_type: 'live-check',
        ok: true,
        detail: '',
        data: { framework: 'sglang' },
        date: '2026-07-12',
      },
    ];
    mockGetLiveCheckResults.mockResolvedValueOnce(mockRows);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockRows);
    expect(mockGetLiveCheckResults).toHaveBeenCalledWith('mock-sql');
  });

  it('returns empty array when no data', async () => {
    mockGetLiveCheckResults.mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns 500 when query throws', async () => {
    mockGetLiveCheckResults.mockRejectedValueOnce(new Error('DB unreachable'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });
});
