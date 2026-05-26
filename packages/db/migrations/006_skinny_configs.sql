-- ============================================================
-- Migration 006 — skinny configs, techniques per measurement
-- ============================================================
--
-- Demotes spec_method from a config dimension to a measurement-level
-- "technique flag" stored in a jsonb bag. Same shape will absorb any future
-- runtime knob (mtp_layers, kv_cache_dtype, chunked_prefill, prefix_cache, …)
-- without further DDL — each lands as a key in techniques.
--
-- configs now describes the DEPLOYMENT (model, hw, framework, precision,
-- parallelism). techniques describes HOW THE RECIPE WAS TUNED for that run.
--
-- Full-rewrite migration: data tables are TRUNCATEd and re-ingested from
-- artifacts. Safe because ingest is idempotent and (for vngcloud fork) very
-- little production data exists.

-- 1. Drop spec_method from configs
alter table configs drop constraint configs_natural_key;
alter table configs drop constraint configs_spec_method_lowercase;
alter table configs drop column spec_method;
alter table configs add constraint configs_natural_key unique (
  hardware, framework, model, precision,
  disagg, is_multinode,
  prefill_tp, prefill_ep, prefill_dp_attention, prefill_num_workers,
  decode_tp,  decode_ep,  decode_dp_attention,  decode_num_workers,
  num_prefill_gpu, num_decode_gpu
);

-- 2. Add techniques jsonb on the two measurement tables
alter table benchmark_results add column techniques jsonb not null default '{}'::jsonb;
alter table eval_results      add column techniques jsonb not null default '{}'::jsonb;

-- 3. Expression indexes on the two hot technique keys
create index benchmark_results_spec_method_idx
  on benchmark_results ((techniques->>'spec_method')) where error is null;
create index benchmark_results_mtp_layers_idx
  on benchmark_results ((techniques->>'mtp_layers')) where error is null;

-- 4. Rebuild latest_benchmarks MV with techniques as part of row identity.
--    Without this, two formerly-different configs (same hw/fw/precision but
--    different spec_method) now share one config_id and would collide on the
--    MV's unique PK at (config_id, conc, isl, osl).
drop materialized view latest_benchmarks;

create materialized view latest_benchmarks as
select distinct on (br.config_id, br.conc, br.isl, br.osl, br.techniques)
  br.*
from benchmark_results br
join latest_workflow_runs wr on wr.id = br.workflow_run_id
where br.error is null
order by br.config_id, br.conc, br.isl, br.osl, br.techniques,
         br.date desc, wr.run_started_at desc nulls last;

create unique index latest_benchmarks_pk
  on latest_benchmarks (config_id, conc, isl, osl, techniques);
create index latest_benchmarks_model_idx on latest_benchmarks (config_id);

-- 5. Rebuild the seq-history covering index to include techniques so
--    historical-trends queries can still get an index-only scan when grouping
--    by technique.
drop index if exists benchmark_results_seq_history_idx;
create index benchmark_results_seq_history_idx
  on benchmark_results (isl, osl, date, config_id, conc, techniques)
  include (image, metrics)
  where error is null;

-- 6. Full-rewrite TRUNCATE. Re-ingest from artifacts after deploy.
--    configs is also truncated because its natural key changed shape.
truncate benchmark_results, eval_results, eval_samples, run_stats,
         availability, changelog_entries, server_logs, workflow_runs
  restart identity cascade;
truncate configs restart identity cascade;
