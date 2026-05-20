-- Capture raw aiperf trace files per agentic benchmark point.
--
-- The aiperf harness produces two per-point export files inside each
-- `agentic_<suffix>` artifact:
--   - profile_export.jsonl         (~2 MB raw, per-request data)
--   - server_metrics_export.csv    (~20 KB raw, periodic Prometheus snapshots)
--
-- We persist them so the dashboard can later show per-request distributions,
-- KV cache utilization over time, and conversation traces without needing to
-- re-download the GitHub artifacts. Storage stays in Postgres (TOASTed) — at
-- ~500 KB per point post-gzip the total fits comfortably without a separate
-- blob service.
--
-- Mirrors the existing `server_logs` pattern (id-keyed sibling table + FK
-- column on benchmark_results). Older, non-aiperf agentic runs simply have a
-- NULL `trace_replay_id`.

create table agentic_trace_replay (
  id                                bigserial   primary key,
  -- gzip(profile_export.jsonl); null when only the server metrics file existed
  profile_export_jsonl_gz           bytea,
  profile_export_uncompressed_size  bigint,
  -- raw csv bytes; null when only the profile file existed
  server_metrics_csv                bytea,
  server_metrics_csv_size           bigint,
  created_at                        timestamptz not null default now()
);

alter table benchmark_results
  add column trace_replay_id bigint references agentic_trace_replay(id);

create index benchmark_results_trace_replay_idx
  on benchmark_results (trace_replay_id)
  where trace_replay_id is not null;
