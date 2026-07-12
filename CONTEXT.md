# InferenceX-app

The dashboard that ingests InferenceX benchmark-run data into Postgres and renders throughput-vs-latency, evaluation, and reliability views. This glossary covers the language of benchmark data as it flows from AIPerf artifacts into the dashboard.

## Language

### Benchmark data shapes

**Candidate**:
One measurement at a single concurrency level, produced by one AIPerf search iteration. Carries its own throughput and latency metrics.
_Avoid_: trial, sample, data point (reserve "point" for the rendered chart dot).

**Search ladder**:
The full set of candidates an AIPerf search produces for one run, spanning the concurrencies it visited. Maps to one curve's worth of points for a given (model, hardware, engine, isl, osl, precision).
_Avoid_: sweep (a sweep enumerates a fixed grid; a search navigates toward an objective).

**Full ladder**:
The decision to ingest _every_ candidate of a run — feasible and infeasible alike — rather than only the selected best. The opposite of best-run-only.

**Feasible**:
A candidate whose metrics satisfy the run's SLA filter (for fastfood: `inter_token_latency.p95 < 50 ms`). Sourced from `search_history.json`, not recomputed. Infeasible candidates are still ingested; they sit at the high-latency end of the chart.
_Avoid_: passing, valid, within-SLA (use "feasible" to match AIPerf).

**Best run**:
The single candidate AIPerf selects per run — max `output_token_throughput.avg` among feasible candidates. Recorded in `best_by_run.json`. One best run = one chart point; a full ladder = the whole curve.
_Avoid_: optimal, winner.

**Fastfood**:
A fixed synthetic single-turn workload at a fixed input/output shape (`8k1k` = 8192/1024, `16k1k` = 16384/1024). Distinct from agentic-coding, which is a trace-distribution workload with no fixed isl/osl.
_Avoid_: synthetic benchmark (too broad).

### Storage

**benchmark_results**:
The table holding one row per `(workflow_run, config, benchmark_type, isl, osl, conc, techniques)`. Because `conc` is in the key, a full ladder lands as many rows — one per concurrency — which existing charts plot directly. Fastfood candidates are stored here under `benchmark_type = single_turn`.

**aiperf_search_candidates**:
A hypothetical dedicated table for search-space data (candidate identity, iteration index, feasibility, objective). Considered and _not_ built — see `docs/adr/0001`. Listed here so the term is not reintroduced as if it exists.

## Flagged ambiguities

- **"best run" vs "full ladder"** — early framing treated ingest as a binary "best run only" vs "modify code for full candidates." Resolved: best-run-only is _not_ cheaper (these runs emit only `aiperf_search_*`, never `results_bmk`, so a new mapper is required either way), and the chart's value is the curve, so we ingest the full ladder.

## Example dialogue

> **Dev:** The run only has `aiperf_search_*` artifacts. Do I just ingest the best run?
> **Expert:** Best run is one candidate — one dot. The dashboard's whole point is the throughput-vs-latency curve, so ingest the full ladder: every candidate becomes a `benchmark_results` row keyed by its concurrency.
> **Dev:** Even the infeasible ones?
> **Expert:** Yes. Infeasible just means it broke the 50 ms ITL SLA — it still belongs on the curve, at the high-latency end. We read the SLA crossover off the latency axis; there's no feasibility flag in the chart.
> **Dev:** So nothing goes into `aiperf_search_candidates`?
> **Expert:** That table doesn't exist. We reuse `benchmark_results` — see ADR 0001.
