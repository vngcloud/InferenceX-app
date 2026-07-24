# New test design — smoke test & throughput test (from InferenceX)

A handoff doc from `InferenceX` (the benchmark repo). Two new, equally
important checks now run against live deployments — this describes what
each produces so InferenceX-app can decide how to ingest and present them.
POV: what InferenceX produces; the ingest/schema/presentation design is
InferenceX-app's call.

**Two separate workflows, two separate artifacts.** These are not one
bundle to split apart — they're independent GitHub Actions workflows in
`InferenceX`, each with its own artifact, cadence, and failure domain.

## The two tests

1. **Smoke test** — `InferenceX/.github/workflows/smoke-test.yml`. Runs
   `metadata` (drift check: live-reported model/framework/precision/tp vs.
   expected) and `tool-calling` (real chat-completion request with tools,
   asserts a `tool_calls` response) against each live stack. Pass/fail, no
   numeric metrics.
2. **Throughput test** — `InferenceX/.github/workflows/throughput-test.yml`
   (fully separate workflow). A short live `aiperf` concurrency sweep using
   `semianalysis_cc_traces_weka`, a real Claude Code coding-session trace
   dataset (949 traces, 136k requests, public on HuggingFace) — not
   synthetic isl/osl padding. Produces numeric throughput/latency metrics
   per concurrency level.

Both trigger the same way (`repository_dispatch: stack-deployed` from
`inference-cicd`, plus manual `workflow_dispatch`), and both target an
already-deployed live stack via `inference-cicd`'s `/discover` endpoint —
neither is a benchmark sweep in the usual sense (that's `run-sweep.yml`).

## Ingest contract

InferenceX does not call `trigger-ingest` or any InferenceX-app endpoint —
InferenceX-app owns pulling both artifacts (however fits your existing
`ingest-results.yml`/`auto-ingest.yml` pattern) and owns retention. Every
result from both tests is tagged `"run_type": "live-check"` so it can
present as **"what's currently live on the system"**, in its own tab,
separate from regular sweep history.

**Note if matching workflow runs by name**: GitHub Actions reports a run's
name from the workflow's `name:` key, not its filename — match `Smoke Test`
and `Throughput Test`, not `smoke-test`/`throughput-test`. Also: smoke-test
intentionally fails its job (non-zero exit) whenever any probe is
`ok: false` — e.g. `tool-calling` is failing on every stack right now by
design, not a fluke — but still uploads a valid results artifact. Don't
filter ingest to `conclusion: success` only, or you'll silently miss every
run.

## Smoke test artifact — `smoke_test_results_<stack>`

```jsonc
{
  "stack": "sglang-vanilla", // /discover's stack name, not a `configs` FK
  "run_type": "live-check",
  "probes": {
    "metadata": {
      "ok": true,
      "detail": "...",
      "data": {
        "model": "...",
        "framework": "sglang",
        "precision": "fp8",
        "tp": 2,
        "chart": "...",
        "image": "...",
      },
    },
    "tool-calling": {
      "ok": false,
      "detail": "server did not invoke the tool -- got a plain content response instead of tool_calls",
      "data": { "role": "assistant", "content": "..." },
    },
  },
}
```

- `metadata.data` is the live stack's `/version` payload verbatim — field
  set varies per stack (e.g. `sglang-pd-disaggregation` adds
  `disaggregation: true`), don't assume a fixed key set.
- `tool-calling.data` shape varies by failure mode: `{"response_text": ...}`
  for non-200, the raw assistant message for a plain-text (non-tool-call)
  reply, or the full raw response body for anything malformed.
- Neither probe fits `benchmark_results` (keyed on conc/isl/osl) or
  `eval_results` (keyed on eval task) — no numeric metrics, no sweep axis.

## Throughput test artifact — `throughput_test_results_<stack>`

```jsonc
{
  "stack": "sglang-vanilla",
  "test_type": "throughput",
  "run_type": "live-check",
  "ok": true,
  "detail": "completed sweep at conc=[1, 8, 32]",
  "data": {
    "dataset": "semianalysis_cc_traces_weka",
    "num_dataset_entries": 100,
    "sweep": [
      {
        "conc": 1,
        "model_id": "...",
        "max_concurrency": 1,
        "total_token_throughput": 251.4,
        "output_throughput": 121.3,
        "mean_ttft_ms": 286.7,
      },
      { "conc": 8, "...": "..." },
      { "conc": 32, "...": "..." },
    ],
    "redeployed_mid_run": false,
  },
}
```

- Flat shape (no `probes` nesting) — throughput is the only thing in this
  artifact.
- `sweep[]` entries match what `benchmark-mapper.ts` already expects per
  point (`model_id`, `max_concurrency`, `total_token_throughput`,
  `output_throughput`, `mean/p50/p75/p90/p95/p99_{ttft,tpot,itl,e2el}_ms`).
  New fields vs. a regular sweep: `dataset` and `num_dataset_entries`, worth
  surfacing since they say what the sweep actually ran against.
- `redeployed_mid_run: true` means the stack redeployed mid-sweep (before/
  after `/version` diff) — `ok` is `false`, don't chart these points.
- Mapping `stack` to a `config_id` (if wanted) needs its own resolver —
  `/discover` strings like `sglang-mooncake-store` won't pass
  `normalizeFramework`/`hwToGpuKey`/`resolveModelKey` as-is.

## Open question for you: one table or two paths?

Both artifacts need a home; neither fits existing tables. Worth weighing:

- **One new table**, e.g. `live_check_results` keyed on
  `(stack, test_type, run)` — `ok boolean`, `detail text`, `data jsonb`,
  `run_type text`. Covers all three checks (metadata, tool-calling,
  throughput) uniformly from two different artifact patterns. Closest
  analog to `run_stats` in the existing schema.
- **Split it**: metadata/tool-calling into that new table, throughput's
  `sweep[]` into `benchmark_results` (`benchmark_type = 'live-check'`) to
  reuse existing throughput-vs-latency charts. Cheaper for throughput's
  presentation, but worth confirming the "own tab" framing still holds if
  those rows live in the same table as regular sweep data.

Either way, treat both tests as equally worth getting right — don't let
throughput's metric-shape resemblance to a regular sweep make it an
afterthought, and don't let the smoke test's lack of metrics make it a
bolt-on.
