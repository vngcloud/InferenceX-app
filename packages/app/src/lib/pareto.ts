/**
 * Shared 2-D Pareto-frontier utilities for "higher x AND higher y both better"
 * curves, plus linear interpolation along the frontier and trapezoidal AUC.
 *
 * The chart layer has its own metric-aware helpers (calculateRoofline et al)
 * that operate on full InferenceData points and `upper_left | upper_right | …`
 * directions. This module is the plain numeric core — it works on
 * `{ x, y }`-shaped points and is what tables / non-chart consumers should use.
 *
 * Sorting note: the frontier is always returned in ascending-x order so
 * downstream interp/AUC can treat the xs as a sorted grid.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Pareto frontier for "higher x AND higher y is better" (upper-right). Returns
 * non-dominated points sorted by ascending x.
 *
 * On the interactivity vs tok/s/gpu chart the visible frontier looks like
 * "upper-left" because as concurrency rises x falls while y rises — but the
 * non-domination relation is the same: a point is on the frontier when no
 * other point has BOTH greater x AND greater y. So the same algorithm works.
 */
export function paretoFrontier<T extends Point2D>(points: readonly T[]): T[] {
  if (points.length === 0) return [];
  // Sort by descending x. The point with max x is always kept; then walk down
  // and keep any point whose y exceeds the running max y.
  const sorted = [...points].toSorted((a, b) => b.x - a.x);
  const front: T[] = [];
  let maxY = -Infinity;
  for (const p of sorted) {
    if (p.y > maxY) {
      front.push(p);
      maxY = p.y;
    }
  }
  // Return ascending x for downstream consumers.
  return front.toSorted((a, b) => a.x - b.x);
}

/**
 * Linear interpolation along a frontier that's already sorted by ascending x.
 * Returns null when x is outside [minX, maxX] of the frontier.
 */
export function interpAlongFrontier(frontier: readonly Point2D[], x: number): number | null {
  const last = frontier.at(-1);
  if (frontier.length === 0 || !last) return null;
  const minX = frontier[0].x;
  const maxX = last.x;
  if (x < minX || x > maxX) return null;
  if (frontier.length === 1) return frontier[0].y;
  // Binary-search insertion point.
  let lo = 0;
  let hi = frontier.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (frontier[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = frontier[lo];
  const b = frontier[hi];
  if (b.x === a.x) return Math.max(a.y, b.y);
  const t = (x - a.x) / (b.x - a.x);
  return a.y + t * (b.y - a.y);
}

/**
 * Trapezoidal AUC under the linearly-interpolated frontier between [lo, hi].
 * Outside the frontier's x-range y is treated as 0, so a config that doesn't
 * reach part of the integration range contributes 0 to that part. Matches the
 * Python reference: np.interp on a fine grid with the out-of-range region
 * zeroed, then np.trapezoid.
 *
 * Closed-form rather than 10 001-sample grid — same answer to machine
 * precision because the integrand is piecewise-linear, and avoids allocating
 * arrays on every render.
 */
export function aucUnderFrontier(frontier: readonly Point2D[], lo: number, hi: number): number {
  const last = frontier.at(-1);
  if (frontier.length === 0 || !last || hi <= lo) return 0;
  const minX = frontier[0].x;
  const maxX = last.x;
  const effLo = Math.max(lo, minX);
  const effHi = Math.min(hi, maxX);
  if (effHi <= effLo) return 0;

  // Build the integration breakpoints: clip the frontier vertices to
  // [effLo, effHi] and add the boundaries.
  const xs: number[] = [effLo];
  for (const p of frontier) {
    if (p.x > effLo && p.x < effHi) xs.push(p.x);
  }
  xs.push(effHi);

  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const y0 = interpAlongFrontier(frontier, x0) ?? 0;
    const y1 = interpAlongFrontier(frontier, x1) ?? 0;
    area += ((y0 + y1) / 2) * (x1 - x0);
  }
  return area;
}
