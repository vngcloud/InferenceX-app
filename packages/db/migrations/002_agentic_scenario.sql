-- Support agentic scenarios in benchmark_results.
--
-- Scenarios are discriminated by benchmark_type:
--   'single_turn'     — fixed-seq-len runs (1k1k, 1k8k, 8k1k, …). isl/osl set.
--   'agentic_traces'  — trace-replay agentic runs. isl/osl NULL.
--
-- conc retains its meaning (concurrent users/requests) for both.

-- 1) isl/osl become nullable for agentic rows
alter table benchmark_results
  alter column isl drop not null,
  alter column osl drop not null;

-- 2) CHECK constraints: positive-or-null
alter table benchmark_results
  drop constraint benchmark_results_isl_positive,
  drop constraint benchmark_results_osl_positive;

alter table benchmark_results
  add constraint benchmark_results_isl_positive check (isl is null or isl > 0),
  add constraint benchmark_results_osl_positive check (osl is null or osl > 0);

-- 3) Uniqueness must treat (NULL, NULL) pairs as equal so agentic rows
--    can't duplicate on (workflow_run_id, config_id, benchmark_type, conc).
alter table benchmark_results
  drop constraint benchmark_results_unique;

alter table benchmark_results
  add constraint benchmark_results_unique unique nulls not distinct
    (workflow_run_id, config_id, benchmark_type, isl, osl, conc);
