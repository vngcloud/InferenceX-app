-- smoke-test now snapshots the live stack's GPU model (DCGM `modelName`,
-- e.g. "NVIDIA GeForce RTX 5090") into a top-level `gpu_model` field. Store
-- it verbatim (not lowercased -- it's a display string, not a lookup key;
-- resolving it to a HW_REGISTRY key is a mapper-side concern, not a DB
-- constraint). See design/new-test-design.md and the gpu-metrics discussion
-- with InferenceX for background.

alter table live_check_results add column gpu_model text;
