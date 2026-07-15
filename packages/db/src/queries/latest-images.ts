import type { DbClient } from '../connection.js';

export interface LatestImageRow {
  model: string;
  hardware: string;
  framework: string;
  precision: string;
  /** Derived from techniques.spec_method via SQL COALESCE; 'none' when absent. */
  spec_method: string;
  isl: number;
  osl: number;
  image: string;
  date: string;
}

/**
 * Fetch the latest non-null image tag per unique
 * (model, hardware, framework, precision, spec_method, isl, osl).
 * Uses the latest_benchmarks materialized view for fast lookups. spec_method is
 * projected from techniques->>'spec_method' since it was demoted from configs in
 * migration 006.
 */
export async function getLatestImages(sql: DbClient): Promise<LatestImageRow[]> {
  const rows = await sql`
    WITH latest AS (
      SELECT
        c.model,
        c.hardware,
        c.framework,
        c.precision,
        COALESCE(lb.techniques->>'spec_method', 'none') AS spec_method,
        lb.isl,
        lb.osl,
        lb.image,
        lb.date::text AS date
      FROM latest_benchmarks lb
      JOIN configs c ON c.id = lb.config_id
      WHERE lb.image IS NOT NULL
    )
    SELECT DISTINCT ON (model, hardware, framework, precision, spec_method, isl, osl)
      model, hardware, framework, precision, spec_method, isl, osl, image, date
    FROM latest
    ORDER BY model, hardware, framework, precision, spec_method, isl, osl, date DESC
  `;
  return rows as unknown as LatestImageRow[];
}
