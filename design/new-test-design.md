# New test design — smoke test & throughput test (from InferenceX)

A handoff doc from `InferenceX` (the benchmark repo). Describes two new,
equally important test types it now produces against live deployments, and
the input schema each needs InferenceX-app to present properly (and, where
needed, add schema for). POV: what InferenceX now produces; the
ingest/table/presentation design is InferenceX-app's call.

Companion design docs on the InferenceX side (for full context, not required
reading to act on this): `design/smoke-test-matrix.md`,
`design/throughput-test.md`.

## What this is

`InferenceX`'s `smoke-test.yml` workflow runs after every `inference-cicd`
deploy (via `repository_dispatch: stack-deployed`, or manually) against
already-deployed, live endpoints. Source of truth for what's deployed is
`inference-cicd`'s live `/discover` endpoint, not a config file in
InferenceX. Two distinct test types come out of this, both new to
InferenceX-app and both need a presentation decision:

1. **Smoke test** (`metadata` + `tool-calling` probes) — correctness/drift
   checks, pass/fail, no numeric metrics.
2. **Throughput test** (`throughput` probe) — a short live `aiperf` sweep,
   numeric metrics, but sourced and framed differently from a regular
   benchmark sweep (see below).

Neither is a benchmark sweep in the usual sense — this is deliberately a
fast post-deploy check, not the heavier `run-sweep.yml` pipeline.

## No cross-repo push wiring exists yet — you own the pull

Per a 2026-07-12 sync between the two teams: **InferenceX does not call
`trigger-ingest` or any InferenceX-app endpoint for these results.**
InferenceX-app owns deciding how/when to pull them (poll the GH Actions
artifact API, a new `repository_dispatch` listener, whatever fits your
existing `ingest-results.yml` pattern) and retention/pruning of raw
live-check data stays on InferenceX's side. The one contract InferenceX
commits to: every result (both test types) is tagged `"run_type":
"live-check"` so it can be routed to a separate view/tab instead of mixed
into regular sweep history — per your ask, this should present as **"what's
currently live on the system"**, not another sweep entry.

## Where the data lives today

One GitHub Actions artifact per `(stack, run)`, name `smoke_test_results_<stack>`
(e.g. `smoke_test_results_sglang-vanilla`), uploaded by the `smoke-test`
job in `InferenceX/.github/workflows/smoke-test.yml`. Both test types for a
given stack land in the same artifact/envelope — this name doesn't match any
of your existing `bmk_*` / `results_*` / `gpu_metrics_*` / `run-stats_*` /
`eval_*` artifact patterns, so a new mapper + artifact-name pattern (e.g.
`smoke_test_results_*`) is needed regardless of which table(s) each test
type lands in.

## Envelope schema

The artifact's JSON content, one per stack per run:

```jsonc
{
  "stack": "sglang-vanilla",        // matches /discover's stack "name" — not a `configs` FK today
  "run_type": "live-check",
  "probes": {
    // key present only for probes actually run for this stack
    // (smoke-tests.yaml's `test-cases:` list, default ["metadata", "tool-calling"])
    "metadata":     { "ok": true,  "detail": "...", "data": { ... } },  // smoke test
    "tool-calling": { "ok": false, "detail": "...", "data": { ... } },  // smoke test
    "throughput":   { "ok": true,  "detail": "...", "data": { ... } }  // throughput test
  }
}
```

`ok`/`detail`/`data` is a fixed shape across all three probes
(`utils/smoke_tests/result.py:ProbeResult` on the InferenceX side).
`ok=false` on ANY probe fails the whole GH Actions job for that stack — this
is a correctness gate, not a soft signal.

---

## Test 1: Smoke test (`metadata` + `tool-calling`)

Neither probe fits `benchmark_results` (keyed on conc/isl/osl) or
`eval_results` (keyed on eval task) — no numeric metrics, no sweep axis.
This is genuinely new input shape for InferenceX-app.

### `metadata` probe

**Purpose**: drift check. Fetches the stack's live `<stack>-version`
self-report and diffs it against an optional `expect:` block in
InferenceX's `smoke-tests.yaml` (framework/precision/tp/model). Empty
`expect` → no assertions, this just captures live state.

`data` = the live version payload verbatim (whatever fields the deployed
stack's own `/version` endpoint returns — NOT curated by InferenceX). Seen
in practice:

```jsonc
{
  "model": "RedHatAI/DeepSeek-Coder-V2-Lite-Instruct-FP8",
  "framework": "sglang",
  "precision": "fp8",
  "tp": 2,
  "chart": "sglang-vanilla-0.3.1",
  "image": "...",
}
```

Caveat: field set is NOT fixed across stacks — e.g.
`sglang-pd-disaggregation` adds `"disaggregation": true` and reports a flat
`"tp": 1` that doesn't capture separate prefill/decode parallelism (a known
gap, tracked on InferenceX's side, not blocking here). Don't assume every
stack's `data` has an identical key set.

`ok=false` detail example: `"metadata drift: framework: expected 'sglang', live reports 'vllm'"`.

### `tool-calling` probe

**Purpose**: functional check, not a benchmark. Sends one real
`/v1/chat/completions` request with `tools=[get_current_weather]` and
`tool_choice: "auto"`, asserts the model actually returns a `tool_calls`
array instead of plain text.

`data` on success:

```jsonc
{
  "tool_calls": [
    {
      "id": "...",
      "type": "function",
      "function": { "name": "get_current_weather", "arguments": "{\"city\":\"Hanoi\"}" },
    },
  ],
}
```

`data` on failure — shape varies by failure mode, all raw/unprocessed:

- non-200 response: `{ "response_text": "<raw body string>" }`
- 200 but no `tool_calls` (model answered in plain text): the raw OpenAI
  `message` dict, e.g. `{ "role": "assistant", "content": "The weather in Hanoi is..." }`
- malformed response shape (missing `choices[0].message`): the full raw
  response body, whatever shape that turned out to be

`detail` examples: `"server did not invoke the tool -- got a plain content response instead of tool_calls"`, `"HTTP 500"`.

**Known current state** (as of 2026-07-11 testing): this probe fails against
all 3 live stacks today — none of the deployed charts have a tool-call
parser configured for the served model. This is being treated as a real red
signal (fix belongs in `inference-cicd`'s chart config), not something to
soften on the probe side. Expect to see `ok: false` rows for this probe
until that's fixed upstream — don't treat that as an ingest bug.

---

## Test 2: Throughput test (`throughput`)

Uses `aiperf_adapter.py`, the same aiperf wrapper the regular sweep pipeline
uses, so `data.sweep[]` entries are already shaped like what your
`benchmark-mapper.ts` expects per point: `model_id`, `max_concurrency`,
`total_token_throughput`, `output_throughput`, `mean/p50/p75/p90/p95/p99_{ttft,tpot,itl,e2el}_ms`,
optional `duration`.

```jsonc
{
  "sweep": [
    {
      "conc": 8,
      "model_id": "...",
      "max_concurrency": 8,
      "total_token_throughput": 1234.5,
      "mean_ttft_ms": 45.2,
      "...": "...",
    },
    {
      "conc": 32,
      "model_id": "...",
      "max_concurrency": 32,
      "total_token_throughput": 3900.1,
      "...": "...",
    },
  ],
  "redeployed_mid_run": false,
}
```

If `redeployed_mid_run: true`, the stack redeployed between the sweep's
start and end (detected via a before/after `/version` diff) — the numbers
mix two deployments and `ok` is `false`; don't ingest/chart these as valid
points.

This is still a genuinely new test to present, not a drop-in extra row on
existing charts: it's a small, synthetic, short-duration (e.g. 15-30s per
concurrency level) live-endpoint check meant to answer "is the thing that's
live right now still performing" — a different question from the regular
sweep's "what's the best achievable curve for this recipe." Mixing the two
without a clear `run_type` distinction in the UI would misrepresent a
lightweight sanity ping as a full sweep result.

**Config resolution wrinkle**: `configs` resolution here would need to come
from the live `/discover` self-report strings (stack name, plus
`framework`/`precision`/`tp` if you want them), not from a benchmark-repo
config declaration — those live strings may not already pass
`normalizeFramework`/`hwToGpuKey`/`resolveModelKey` cleanly (e.g. a stack
named `sglang-mooncake-store` isn't itself a `framework` value). If you want
to fold `throughput` live-check points into `benchmark_results`, this
mapping needs its own small resolver, not a blind reuse of the sweep mapper's
input assumptions.

---

## What needs a schema decision (open question for you)

Both test types need a home, and both deserve equal design attention — don't
let the throughput test's superficial metric-shape resemblance to
`benchmark_results` make it an afterthought, and don't let the smoke test's
lack of metrics make it a bolt-on. Two shapes worth weighing, given your
"separate tab, shows what's currently live" framing:

- **A new table**, e.g. `live_check_results` — one row per
  `(stack, probe_type, run)`: `stack text`, `probe_type text` (`metadata` |
  `tool-calling` | `throughput`), `ok boolean`, `detail text`, `data jsonb`,
  `run_type text` (currently always `'live-check'`, kept as a column rather
  than assumed, in case a second live-check flavor shows up later), `date`,
  optionally a `workflow_runs` FK if you want GH-run linkage the way
  `benchmark_results` does. Covers all three probes (smoke test's two plus
  throughput) uniformly. This is the closest analog to `run_stats` in your
  existing schema (a small reliability-rollup leaf table hanging off a run)
  — reuses the "3-layer projection" pattern instead of inventing a new one.
- **Split it**: `metadata`/`tool-calling` into a new table as above, but
  `throughput`'s `sweep[]` points into `benchmark_results` (via
  `benchmark_type = 'live-check'`) so they can reuse existing
  throughput-vs-latency chart components. Cheaper to wire for throughput's
  presentation, but `benchmark_results`' hot indexes/MV (`latest_benchmarks`,
  `error IS NULL` partials) are built around a conc/isl/osl-keyed shape that
  fits here reasonably well — worth confirming the "own tab" requirement
  still reads clearly if throughput rows live in the same table as regular
  sweep rows, just tagged differently.

Given the "own tab, own presentation" requirement, the unified new-table
approach reads as the cleaner fit for keeping smoke test and throughput test
presented with equal weight as one coherent "live-check" view — but that's
your call, not InferenceX's; this doc's job is just making sure the actual
shapes above are correct before you commit to one.

## `configs` natural-key mismatch, worth flagging up front

Whatever table(s) you choose, note that `stack` (e.g. `"sglang-vanilla"`,
`"sglang-mooncake-store"`, `"sglang-pd-disaggregation"`) is a deploy name,
not a `configs` row — mapping it to an existing `config_id` (if you want
that FK) requires resolving `model`/`framework`/`precision`/`tp` off the
live `/discover`/`version` payload through your existing normalizers, the
same wrinkle noted under the throughput test above. `metadata`'s own `data`
blob already carries those fields raw per stack if you need them for that
resolution.
