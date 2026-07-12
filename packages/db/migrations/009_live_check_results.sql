-- Live-check results: post-deploy smoke tests (metadata, tool-calling) and a
-- short live throughput sanity sweep, sourced from InferenceX's smoke-test.yml
-- workflow (artifact `smoke_test_results_<stack>`). One row per
-- (workflow_run, stack, probe_type). See design/new-test-design.md.
--
-- `stack` is a deploy name (e.g. "sglang-vanilla"), not a `configs` FK — no
-- config resolution is attempted here (see design doc's "configs natural-key
-- mismatch" section).

create table live_check_results (
  id              bigserial   primary key,
  workflow_run_id bigint      not null references workflow_runs(id),
  date            date        not null,  -- denormalized from workflow_runs
  stack           text        not null,
  probe_type      text        not null,  -- metadata | tool-calling | throughput
  run_type        text        not null default 'live-check',
  ok              boolean     not null,
  detail          text,
  data            jsonb       not null,

  constraint live_check_results_probe_type_lowercase check (probe_type = lower(probe_type)),
  constraint live_check_results_unique unique (workflow_run_id, stack, probe_type)
);

create index live_check_results_run_id_idx on live_check_results (workflow_run_id);

-- covering index for "latest live-check per stack/probe" list queries
create index live_check_results_stack_date_idx
  on live_check_results (stack, probe_type, date desc)
  include (ok, detail, data);
