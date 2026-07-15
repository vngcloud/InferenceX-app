-- ============================================================
-- Migration 007 — include techniques in result-row uniqueness
-- ============================================================
--
-- Migration 006 made techniques a per-measurement dimension but left
-- benchmark_results_unique and eval_results_unique unchanged. Result: two
-- measurements at the same (workflow_run, config, isl, osl, conc) but with
-- DIFFERENT techniques (e.g. mtp_layers=4 vs 6 — same gemma4 deployment, two
-- MTP variants) collide on insert and the later one silently overwrites the
-- earlier one.
--
-- Hot-fix discovered during the first post-006 ingest: gemma4 run 26387431571
-- landed only 6 of ~24 expected rows because n4 and n6 variants now share a
-- config_id and clobbered each other.
--
-- Fix: add the techniques jsonb to both unique constraints. Postgres b-tree
-- works on jsonb (used in latest_benchmarks PK already), so this is a clean
-- add. Also re-truncate so the re-ingest after this migration is from scratch.

alter table benchmark_results drop constraint benchmark_results_unique;
alter table benchmark_results add constraint benchmark_results_unique
  unique (workflow_run_id, config_id, benchmark_type, isl, osl, conc, techniques);

alter table eval_results drop constraint eval_results_unique;
alter table eval_results add constraint eval_results_unique
  unique (workflow_run_id, config_id, task, isl, osl, conc, techniques);

-- Wipe partially-clobbered data; auto-ingest will repopulate.
truncate benchmark_results, eval_results, eval_samples, run_stats,
         availability, changelog_entries, server_logs, workflow_runs
  restart identity cascade;
truncate configs restart identity cascade;
