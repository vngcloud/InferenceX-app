-- Pre-computed time-series for the agentic detail page chart.
--
-- Sibling to `aggregate_stats` (migration 008): that column stores
-- per-row percentile/derived *summaries*, this one stores the full
-- chart-ready time-series arrays (kvCacheUsage, prefixCacheHitRate,
-- queueDepth, prefillTps, decodeTps, promptTokensBySource).
--
-- Without this, the detail page parsed the entire `server_metrics_json_gz`
-- blob on every request and blew up with ERR_STRING_TOO_LONG on high-conc
-- TP+EP rows (the blob decompresses past Node's 512 MB max-string-length).
-- With pre-computed series the page is a single SQL row read.
--
-- Shape includes an inner `version` field so the backfill script can
-- recompute rows whose stored series were produced by an older algorithm.
-- Null when the series haven't been computed yet; the API has a slow-path
-- fallback (with stream-parse for oversized blobs) for that case.

alter table agentic_trace_replay
  add column chart_series jsonb;
