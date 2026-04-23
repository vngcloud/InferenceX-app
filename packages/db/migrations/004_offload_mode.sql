-- Add offload_mode as a first-class dimension on benchmark_results.
--
-- KV-cache offload (on/off) is a meaningful sweep dimension for agentic-trace
-- runs: a single run may emit two rows for the same (config, isl, osl, conc)
-- — one with offload disabled, one enabled. The pre-existing unique key
-- collapsed those into one row, forcing the ingest to skip variants.
--
-- For fixed-seq runs `offload_mode` defaults to 'off', which matches the
-- assumption baked into the existing 5,500+ rows.

alter table benchmark_results
  add column offload_mode text not null default 'off';

-- Backfill agentic rows from the offload_mode value already living in metrics
-- JSONB (set during the earlier agentic ingest backfill).
update benchmark_results
   set offload_mode = metrics->>'offload_mode'
 where benchmark_type = 'agentic_traces'
   and metrics ? 'offload_mode';

-- Replace the unique constraint so on/off variants can coexist.
alter table benchmark_results
  drop constraint benchmark_results_unique;

alter table benchmark_results
  add constraint benchmark_results_unique unique nulls not distinct
    (workflow_run_id, config_id, benchmark_type, isl, osl, conc, offload_mode);

-- Rebuild the latest-per-config materialized view to dedupe by offload_mode too.
drop materialized view if exists latest_benchmarks cascade;

create materialized view latest_benchmarks as
select distinct on (br.config_id, br.conc, br.isl, br.osl, br.offload_mode)
  br.*
from benchmark_results br
join latest_workflow_runs wr on wr.id = br.workflow_run_id
where br.error is null
order by br.config_id, br.conc, br.isl, br.osl, br.offload_mode, br.date desc;

create unique index latest_benchmarks_pk
  on latest_benchmarks (config_id, conc, isl, osl, offload_mode) nulls not distinct;
create index latest_benchmarks_model_idx on latest_benchmarks (config_id);
