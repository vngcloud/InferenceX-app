-- ============================================================
-- Migration 008 — rename techniques.mtp_layers → techniques.num_speculative_tokens
-- and add max_num_batched_tokens
-- ============================================================
--
-- The benchmark artifact on the vngcloud/InferenceX side renamed its "MTP
-- layer count" field to the canonical vLLM/SGLang name `num_speculative_tokens`
-- (since it now applies to any draft method, not just MTP). It also gained a
-- new `max_num_batched_tokens` field per row.
--
-- We mirror both on the dashboard side. Drop the old expression index that
-- pointed at `mtp_layers`; add a new one for the renamed key plus one for the
-- new field. Re-truncate so re-ingest under the new shape starts clean.

drop index if exists benchmark_results_mtp_layers_idx;

create index benchmark_results_num_speculative_tokens_idx
  on benchmark_results ((techniques->>'num_speculative_tokens')) where error is null;

create index benchmark_results_max_num_batched_tokens_idx
  on benchmark_results ((techniques->>'max_num_batched_tokens')) where error is null;

-- Wipe existing rows (they have `mtp_layers` keys that wouldn't be touched by
-- the renamed parser anyway). Auto-ingest cron repopulates.
truncate benchmark_results, eval_results, eval_samples, run_stats,
         availability, changelog_entries, server_logs, workflow_runs
  restart identity cascade;
truncate configs restart identity cascade;
