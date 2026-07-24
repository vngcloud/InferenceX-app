-- `latest_live_check_results` (migration 009) uses `select lcr.*`, but a
-- view's column list is fixed at CREATE VIEW time -- it does NOT pick up
-- columns added later to the underlying table via plain ALTER TABLE. Adding
-- `gpu_model` in migration 010 left the view still missing it, breaking
-- `GET /api/v1/live-check` with "column lcr.gpu_model does not exist".
-- Recreate the view so its column list matches the table's current shape.

drop view latest_live_check_results;

create view latest_live_check_results as
select distinct on (lcr.stack, lcr.test_type)
  lcr.*
from live_check_results lcr
join latest_workflow_runs wr on wr.id = lcr.workflow_run_id
order by lcr.stack, lcr.test_type, lcr.date desc, wr.created_at desc;
