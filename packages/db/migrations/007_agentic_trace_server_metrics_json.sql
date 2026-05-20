-- Add the full server-metrics time-series JSON to agentic_trace_replay.
--
-- The existing `server_metrics_csv` column holds aiperf's summary export —
-- one row per metric with avg/min/max/std/p1..p99 across the entire run.
-- That's enough for the cumulative cache-hit number but not for any
-- "metric over time" view (KV cache utilization curve, queue depth, prefix
-- hit rate per interval, cumulative prefill token source).
--
-- The harness also writes `server_metrics_export.json` which contains the
-- raw per-scrape (~1Hz) values for every Prometheus metric over the whole
-- benchmark window. Raw size is ~250 MB per point but it compresses ~42x
-- to ~6 MB gzipped (text with repeated metric names + numeric values).
-- That's the file we store here for any future time-series chart.

alter table agentic_trace_replay
  add column server_metrics_json_gz bytea,
  add column server_metrics_json_uncompressed_size bigint;
