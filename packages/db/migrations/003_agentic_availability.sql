-- Extend the availability table to cover agentic scenarios.
--
-- The 002 migration relaxed benchmark_results.isl/osl to nullable; do the same
-- for availability and add benchmark_type so the frontend can enumerate
-- agentic vs single_turn scenarios per model/date.
--
-- Postgres primary keys require every column to be NOT NULL, so we drop the PK
-- and replace it with a UNIQUE NULLS NOT DISTINCT constraint — functionally
-- equivalent except it allows isl/osl to be NULL for agentic rows.

alter table availability
  drop constraint availability_pkey;

alter table availability
  alter column isl drop not null,
  alter column osl drop not null,
  add column benchmark_type text not null default 'single_turn';

alter table availability
  add constraint availability_natural_key unique nulls not distinct
    (model, isl, osl, precision, hardware, framework, spec_method, disagg, benchmark_type, date);
