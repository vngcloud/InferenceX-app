# Store AIPerf fastfood search candidates in benchmark_results, not a dedicated table

We ingest the full AIPerf search ladder (every candidate, feasible and infeasible) as `benchmark_results` rows — one row per concurrency — under `benchmark_type = single_turn`, rather than building the dedicated `aiperf_search_candidates` table that the local working notes (`AGENTS.agentic_fastfood.md`) proposed.

## Why

`benchmark_results` is already keyed by `(workflow_run, config, benchmark_type, isl, osl, conc, techniques)`, so each candidate's concurrency makes it a distinct row, and the existing throughput-vs-latency charts plot the resulting curve with **zero new table, API, or UI**. Fastfood is a fixed single-turn synthetic workload, so it is genuinely `single_turn` data — not a foreign shape being forced in. Queries and charts do not filter on `benchmark_type`, so the points appear automatically.

## Considered and rejected

- **Dedicated `aiperf_search_candidates` table + ingest path + API + search-ladder UI.** Preserves search metadata (iteration index, objective, feasibility) as first-class fields. Rejected for the dev/experimental phase: large surface area for data the dashboard does not yet need. The cost we accept is that iteration index and an explicit feasibility flag are _not_ persisted — feasibility is inferred from the latency axis at view time. If the team later wants to explore the search space itself (not just the resulting curve), revisit this.

## Status

accepted — scoped to dev/experimental ingest. Productionizing to prod ingest requires separate approval.
