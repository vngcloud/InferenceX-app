import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockGetLatestLiveCheckResults, mockGetDb } = vi.hoisted(() => ({
  mockGetLatestLiveCheckResults: vi.fn(),
  mockGetDb: vi.fn(() => 'mock-sql'),
}));

vi.mock('@semianalysisai/inferencex-db/connection', () => ({
  getDb: mockGetDb,
  FIXTURES_MODE: false,
}));

vi.mock('@semianalysisai/inferencex-db/queries/live-check', () => ({
  getLatestLiveCheckResults: mockGetLatestLiveCheckResults,
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
  it('returns live-check rows', async () => {
    const mockRows = [
      {
        stack: 'sglang-vanilla',
        test_type: 'metadata',
        run_type: 'live-check',
        date: '2026-07-13',
        ok: true,
        detail: 'metadata matches expectations',
        data: { model: 'RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8', tp: 2 },
        gpu_model: 'NVIDIA GeForce RTX 5090',
        github_run_id: 29214012782,
        html_url: 'https://github.com/vngcloud/InferenceX/actions/runs/29214012782',
      },
    ];
    mockGetLatestLiveCheckResults.mockResolvedValueOnce(mockRows);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockRows);
    expect(mockGetLatestLiveCheckResults).toHaveBeenCalledWith('mock-sql');
  });

  it('returns empty array when no data', async () => {
    mockGetLatestLiveCheckResults.mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns 500 when query throws', async () => {
    mockGetLatestLiveCheckResults.mockRejectedValueOnce(new Error('DB unreachable'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });
});
