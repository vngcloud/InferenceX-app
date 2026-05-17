import { describe, expect, it } from 'vitest';

import { aucUnderFrontier, interpAlongFrontier, paretoFrontier, type Point2D } from '@/lib/pareto';

import eightConfigData from './__fixtures__/eight_config_data.json';

interface RawPoint {
  Conc: number;
  Interactivity_tok_s_user: number;
  Token_Throughput_per_GPU_tok_s_gpu: number;
  Median_TTFT_ms: number;
}

const toPoints = (raw: RawPoint[]): Point2D[] =>
  raw.map((p) => ({ x: p.Interactivity_tok_s_user, y: p.Token_Throughput_per_GPU_tok_s_gpu }));

// Independent fine-grid trapezoidal reference. Matches the Python np.interp
// + np.trapezoid approach used in the original spec. Used by the sanity
// check below — kept out of `src/lib/pareto.ts` because the production
// implementation is the closed-form piecewise integral, which agrees with
// this to fp drift on piecewise-linear input.
function referenceAuc(frontier: Point2D[], lo: number, hi: number): number {
  if (frontier.length === 0 || hi <= lo) return 0;
  const minX = frontier[0].x;
  const last = frontier.at(-1);
  if (!last) return 0;
  const maxX = last.x;
  const N = 100_001;
  const step = (hi - lo) / (N - 1);
  const ys: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = lo + i * step;
    if (x < minX || x > maxX) {
      ys.push(0);
      continue;
    }
    let j = 0;
    while (j < frontier.length - 1 && frontier[j + 1].x < x) j++;
    const a = frontier[j];
    const b = frontier[Math.min(j + 1, frontier.length - 1)];
    if (b.x === a.x) {
      ys.push(Math.max(a.y, b.y));
    } else {
      const t = (x - a.x) / (b.x - a.x);
      ys.push(a.y + t * (b.y - a.y));
    }
  }
  let area = 0;
  for (let i = 0; i < ys.length - 1; i++) {
    area += ((ys[i] + ys[i + 1]) / 2) * step;
  }
  return area;
}

describe('paretoFrontier', () => {
  it('returns empty for empty input', () => {
    expect(paretoFrontier([])).toEqual([]);
  });

  it('keeps only non-dominated points and sorts ascending x', () => {
    const pts: Point2D[] = [
      { x: 10, y: 100 },
      { x: 20, y: 90 }, // dominated by (10,100)? no — x is higher
      { x: 5, y: 110 },
      { x: 15, y: 50 }, // dominated by (20,90)
      { x: 30, y: 60 },
    ];
    const f = paretoFrontier(pts);
    // non-dominated: (5,110), (10,100)?, (20,90), (30,60)
    // (10,100) dominated by (5,110)? (5,110) has lower x but higher y → not dominated
    // For "higher x AND higher y both better", (10,100) is dominated iff some point has
    // x > 10 AND y > 100. (20,90)? no. (30,60)? no. So (10,100) is on the frontier.
    expect(f.map((p) => p.x)).toEqual([5, 10, 20, 30]);
    expect(f.map((p) => p.y)).toEqual([110, 100, 90, 60]);
  });
});

describe('interpAlongFrontier', () => {
  const f: Point2D[] = [
    { x: 10, y: 100 },
    { x: 20, y: 200 },
    { x: 50, y: 350 },
  ];

  it('returns null outside range', () => {
    expect(interpAlongFrontier(f, 5)).toBeNull();
    expect(interpAlongFrontier(f, 100)).toBeNull();
  });

  it('returns exact value at vertices', () => {
    expect(interpAlongFrontier(f, 10)).toBe(100);
    expect(interpAlongFrontier(f, 20)).toBe(200);
    expect(interpAlongFrontier(f, 50)).toBe(350);
  });

  it('linearly interpolates between vertices', () => {
    // midpoint of (10,100)-(20,200) → 15, 150
    expect(interpAlongFrontier(f, 15)).toBeCloseTo(150, 9);
    // 1/3 of the way (20→50, 0→1/3) at x=30 → y = 200 + (30-20)/(50-20) * (350-200) = 200 + 50 = 250
    expect(interpAlongFrontier(f, 30)).toBeCloseTo(250, 9);
  });
});

describe('aucUnderFrontier', () => {
  it('integrates a trivial triangle exactly', () => {
    // frontier y=x from x=0..10, AUC over [0,10] = 50
    const f = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(aucUnderFrontier(f, 0, 10)).toBeCloseTo(50, 9);
  });

  it('zeros the integrand outside the frontier x-range', () => {
    // frontier only covers x in [10, 20], integrate [0, 30]
    const f = [
      { x: 10, y: 5 },
      { x: 20, y: 5 },
    ];
    // y=5 over x in [10,20] → AUC = 50. Outside that range y treated as 0.
    expect(aucUnderFrontier(f, 0, 30)).toBeCloseTo(50, 9);
  });

  it('returns 0 when integration window is outside the frontier', () => {
    const f = [
      { x: 10, y: 5 },
      { x: 20, y: 5 },
    ];
    expect(aucUnderFrontier(f, 30, 40)).toBe(0);
  });

  // Sanity-check the full pipeline (pareto → AUC) on the spec's 8-config
  // sample dataset (FP4 DeepSeek V4 Pro, 8K/1K, TP=8) using the production
  // integration window: [10, floor(globalMax / 10) * 10].
  //
  // We re-derive the expected AUC for each config from first principles —
  // independent trapezoidal integration over the same Pareto frontier — and
  // assert that aucUnderFrontier matches. Hard-coding numeric expectations
  // would bake in whichever upper bound the test was written against; this
  // way the test continues to be a meaningful sanity check if the window
  // rule changes again.
  describe('matches independent trapezoidal AUCs on spec sample data', () => {
    const allXs = (Object.values(eightConfigData) as RawPoint[][]).flatMap((rows) =>
      rows.map((r) => r.Interactivity_tok_s_user),
    );
    const globalMax = Math.max(...allXs);
    const upperBound = Math.floor(globalMax / 10) * 10;
    const window: [number, number] = [10, upperBound];

    const names = Object.keys(eightConfigData as Record<string, RawPoint[]>);
    for (const name of names) {
      it(`${name} matches independent reference`, () => {
        const raw = (eightConfigData as Record<string, RawPoint[]>)[name];
        expect(raw, `fixture missing ${name}`).toBeTruthy();
        const f = paretoFrontier(toPoints(raw));
        const auc = aucUnderFrontier(f, window[0], window[1]);
        const expected = referenceAuc(f, window[0], window[1]);
        // Both methods are trapezoidal on the same piecewise-linear function;
        // they should agree to within tiny floating-point drift.
        expect(Math.abs(auc - expected) / Math.max(expected, 1)).toBeLessThan(0.001);
      });
    }
  });
});
