-- Pre-computed aggregate stats for each agentic_trace_replay row.
--
-- Previously the agentic detail page parsed the (huge) profile_export.jsonl
-- and server_metrics_json blobs on every request to compute distribution
-- stats for ISL/OSL/KV-util/prefix-hit-rate, plus the per-point derived
-- metrics (session-time, p90 prefill TPS). That took ~20s per row and the
-- worst rows (high-conc TP+EP server_metrics blobs that decompress past
-- Node's 512 MB string cap) couldn't be parsed without a stream fallback.
--
-- This column holds the computed stats so the API serves the page from a
-- single SQL row read. Shape mirrors the existing benchmark_results.metrics
-- JSONB convention; an inner `version` field lets the backfill script
-- detect rows whose stats were computed by an older algorithm and
-- recompute them. Null when stats haven't been computed yet (existing
-- rows pre-backfill; the API has a slow-path fallback for that case).

alter table agentic_trace_replay
  add column aggregate_stats jsonb;
