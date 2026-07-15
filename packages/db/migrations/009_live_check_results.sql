-- Live-check results (smoke test): metadata drift + tool-calling probes
-- against already-deployed live stacks. See design/new-test-design.md.
--
-- Throughput test's `sweep[]` is deliberately NOT in this table yet -- it
-- needs its own config/hardware resolution story that isn't settled (no
-- live-check artifact or /discover response reports GPU/hardware).

create table live_check_results (
  id              bigserial   primary key,
  workflow_run_id bigint      not null references workflow_runs(id),
  stack           text        not null,  -- /discover's stack name, not a `configs` FK
  test_type       text        not null,  -- metadata | tool-calling
  run_type        text        not null default 'live-check',
  date            date        not null,  -- denormalized from workflow_runs
  ok              boolean     not null,
  detail          text,
  data            jsonb       not null,

  constraint live_check_results_stack_lowercase check (stack = lower(stack)),
  constraint live_check_results_test_type_lowercase check (test_type = lower(test_type)),
  constraint live_check_results_run_type_lowercase check (run_type = lower(run_type)),

  constraint live_check_results_unique unique (workflow_run_id, stack, test_type)
);

create index live_check_results_stack_idx on live_check_results (stack, test_type, date desc);

-- Latest result per (stack, test_type), for the "what's currently live" tab.
create view latest_live_check_results as
select distinct on (lcr.stack, lcr.test_type)
  lcr.*
from live_check_results lcr
join latest_workflow_runs wr on wr.id = lcr.workflow_run_id
order by lcr.stack, lcr.test_type, lcr.date desc, wr.created_at desc;
