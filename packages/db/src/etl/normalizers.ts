/**
 * Pure normalizer functions and lookup tables shared across all ingest scripts.
 * No DB access, no state — safe to import anywhere.
 */

import {
  DB_MODEL_TO_DISPLAY,
  FRAMEWORK_ALIASES,
  GPU_KEYS,
} from '@semianalysisai/inferencex-constants';

export { GPU_KEYS };

/**
 * Strip everything from the first `-` onwards (and any trailing `_<digits>`
 * runner-index suffix) from a raw hardware identifier and return the canonical
 * lowercase GPU key. All keys in `GPU_KEYS` are single-segment, so this is
 * sufficient; unknown bases return `null`.
 *
 * @param hw - Raw hardware string from the benchmark artifact (e.g. `"h200-nv"`, `"mi355x-amds"`).
 * @returns The canonical GPU key (e.g. `"h200"`, `"mi355x"`), or `null` if the
 *   stripped base is not in `GPU_KEYS`.
 */
export function hwToGpuKey(hw: string): string | null {
  const base = hw.toLowerCase().split('-')[0];
  return GPU_KEYS.has(base) ? base : null;
}

/**
 * DB model keys derived from `DB_MODEL_TO_DISPLAY` — the single source of truth.
 * A prefix resolves automatically if it matches a DB key after stripping precision
 * suffixes (e.g. `-fp8`, `-fp4`). Only non-obvious aliases need explicit entries
 * in `PREFIX_ALIASES`.
 */
const DB_MODEL_KEYS = new Set(Object.keys(DB_MODEL_TO_DISPLAY));

/** Precision suffixes that can appear on `infmax_model_prefix` values. */
const PRECISION_SUFFIX = /-(?:fp4|fp8|mxfp4|nvfp4)(?:-.*)?$/iu;

/** Explicit aliases for prefixes that don't match any DB key after suffix stripping. */
const PREFIX_ALIASES: Record<string, string> = {
  gptoss: 'gptoss120b',
  dsv4pro: 'dsv4',
  // Legacy Gemma-4 MTP variants encoded layer count in the prefix
  // (`gemma4n4`/`gemma4n6`). New artifacts emit `gemma4` + a separate
  // `num_speculative_tokens` field; we keep the prefix aliases here as a
  // fallback for older runs (see parseTechniques).
  gemma4n4: 'gemma4',
  gemma4n6: 'gemma4',
};

/** Prefix → num_speculative_tokens, when the legacy artifact smuggled N into the model prefix. */
const PREFIX_TO_NUM_SPEC_TOKENS: Record<string, number> = {
  gemma4n4: 4,
  gemma4n6: 6,
};

function resolvePrefixToKey(prefix: string): string | null {
  const lower = prefix.toLowerCase();
  if (DB_MODEL_KEYS.has(lower)) return lower;
  if (PREFIX_ALIASES[lower]) return PREFIX_ALIASES[lower];
  const stripped = lower.replace(PRECISION_SUFFIX, '');
  if (DB_MODEL_KEYS.has(stripped)) return stripped;
  return PREFIX_ALIASES[stripped] ?? null;
}

/**
 * Full model path/name → DB model key. Covers all variants seen across the
 * backup history (HuggingFace paths, local mounts, shorthand names, etc.).
 */
export const MODEL_TO_KEY: Record<string, string> = {
  // DeepSeek-R1
  'nvidia/DeepSeek-R1-0528-FP4-V2': 'dsr1',
  'nvidia/DeepSeek-R1-0528-FP4-v2': 'dsr1',
  'nvidia/DeepSeek-R1-0528-FP4': 'dsr1',
  'deepseek-ai/DeepSeek-R1-0528': 'dsr1',
  'deepseek-ai/DeepSeek-R1': 'dsr1',
  'amd/DeepSeek-R1-0528-MXFP4': 'dsr1',
  'amd/DeepSeek-R1-0528-MXFP4-Preview': 'dsr1',
  '/mnt/lustre01/models/deepseek-r1-0528-fp4-v2': 'dsr1',
  '/models/DeepSeek-R1': 'dsr1',
  '/models/DeepSeek-R1-0528-MXFP4-Preview': 'dsr1',
  'DeepSeek-R1-0528': 'dsr1',
  'deepseek-r1-0528': 'dsr1',
  'deepseek-r1-0528-fp4-v2': 'dsr1',
  'deepseek-r1-0528-nvfp4-v2': 'dsr1',
  'dsr1-0528-fp8': 'dsr1',
  'dsr1-0528-nvfp4-v2': 'dsr1',
  'dsr1-fp8': 'dsr1',
  // GPT-OSS-120B
  'openai/gpt-oss-120b': 'gptoss120b',
  '/mnt/lustre01/models/gpt-oss-120b': 'gptoss120b',
  // Llama-3.3-70B
  'nvidia/Llama-3.3-70B-Instruct-FP8': 'llama70b',
  'nvidia/Llama-3.3-70B-Instruct-FP4': 'llama70b',
  'amd/Llama-3.3-70B-Instruct-FP8-KV': 'llama70b',
  'amd/Llama-3.3-70B-Instruct-MXFP4-Preview': 'llama70b',
  // Qwen3.5
  'Qwen/Qwen3.5-397B-A17B': 'qwen3.5',
  'Qwen/Qwen3.5-397B-A17B-FP8': 'qwen3.5',
  // Kimi-K2.5
  'moonshotai/Kimi-K2.5': 'kimik2.5',
  // MiniMax-M2.5
  'MiniMaxAI/MiniMax-M2.5': 'minimaxm2.5',
  // GLM-5
  'zai-org/GLM-5-FP8': 'glm5',
  'amd/GLM-5.1-MXFP4': 'glm5.1',
  // DeepSeek-V4-Pro
  'deepseek-ai/DeepSeek-V4-Pro': 'dsv4',
};

/**
 * Resolve a DB model key from a raw benchmark row.
 * Prefers `infmax_model_prefix` (canonical, present 2025-12-08+) over the
 * full `model` path, which may be a HuggingFace path, local mount, or shorthand.
 *
 * @param row - Raw benchmark dict from the artifact JSON.
 * @returns The canonical DB model key (e.g. `"dsr1"`, `"llama70b"`), or `null`
 *   if neither field can be resolved.
 */
export function resolveModelKey(row: Record<string, any>): string | null {
  // infmax_model_prefix is the canonical source when present;
  // eval artifacts use model_prefix instead.
  const prefix = row.infmax_model_prefix ?? row.model_prefix;
  if (prefix) {
    const k = resolvePrefixToKey(String(prefix));
    if (k) return k;
  }
  return row.model ? (MODEL_TO_KEY[String(row.model)] ?? null) : null;
}

/**
 * Normalize a raw framework string and derive the disaggregated-inference flag.
 * Handles special cases: `sglang-disagg` is normalized to `mori-sglang` + `disagg=true`;
 * `dynamo-trtllm` is renamed to `dynamo-trt`.
 *
 * Framework name carries disagg semantics: any canonical framework starting
 * with `dynamo-` or `mori-` implies disagg, regardless of what the artifact
 * wrote in its `disagg` field. Older artifacts (pre-2026-04) sometimes set
 * `disagg=false` under these frameworks, which produced mixed-date legend
 * lines in the frontend — see migration 002.
 *
 * @param fw - Raw framework value from the artifact (e.g. `"sglang"`, `"sglang-disagg"` → `"mori-sglang"`).
 * @param disaggField - Raw disagg field from the artifact (boolean or string `"True"`/`"true"`).
 * @returns An object with the canonical `framework` string and the `disagg` boolean flag.
 */
export function normalizeFramework(
  fw: string,
  disaggField: any,
): { framework: string; disagg: boolean } {
  const lower = fw.toLowerCase();
  const alias = FRAMEWORK_ALIASES[lower];
  const canonical = alias?.canonical ?? lower;
  const rawDisagg =
    alias?.disagg ?? (disaggField === true || disaggField === 'True' || disaggField === 'true');
  const disagg = rawDisagg || canonical.startsWith('dynamo-') || canonical.startsWith('mori-');
  return { framework: canonical, disagg };
}

/** Vendor-specific precision aliases → canonical DB key. */
const PRECISION_ALIASES: Record<string, string> = {
  nvfp4: 'fp4',
  mxfp4: 'fp4',
};

/**
 * Normalize a precision string to a canonical lowercase key.
 * Vendor-specific formats (e.g. `nvfp4`, `mxfp4`) are mapped to their canonical form.
 */
export function normalizePrecision(raw: string): string {
  const lower = raw.toLowerCase();
  return PRECISION_ALIASES[lower] ?? lower;
}

/**
 * Normalize a speculative decoding method to a lowercase string.
 * Absent, empty, or null values are canonicalized to `'none'`.
 *
 * @param spec - Raw `spec_decoding` value from the artifact.
 * @returns Lowercase method name, or `'none'` if absent/empty.
 */
export function normalizeSpecMethod(spec: any): string {
  if (!spec || spec === '') return 'none';
  return String(spec).toLowerCase();
}

/** Known technique keys we promote into the techniques jsonb explicitly. */
const TECHNIQUE_KEYS = [
  'spec_method',
  'num_speculative_tokens',
  'max_num_batched_tokens',
  'kv_cache_dtype',
  'prefix_cache',
] as const;

/**
 * Build the per-measurement `techniques` jsonb from a raw artifact row.
 *
 * The new-shape artifact emits the technique fields at the **top level** of
 * each row (not nested in a `techniques` object), e.g.:
 *   { "spec_decoding": "mtp", "num_speculative_tokens": 6, "max_num_batched_tokens": 4096, … }
 *
 * For forward-compat we also accept a nested `techniques: { ... }` object.
 *
 * Legacy artifacts (pre-rename) smuggled the layer count into the model prefix
 * (`gemma4n4`, `gemma4n6`); we keep that fallback so older runs still ingest.
 * Empty/absent values are dropped (no `spec_method: 'none'` keys).
 *
 * @param row - Raw artifact dict.
 * @returns Techniques jsonb. May be empty (`{}`) when no knobs were tuned.
 */
export function parseTechniques(row: Record<string, any>): Record<string, string | number> {
  const out: Record<string, string | number> = {};

  const setIfPresent = (key: (typeof TECHNIQUE_KEYS)[number], v: any) => {
    if (v === undefined || v === null || v === '') return;
    out[key] = typeof v === 'number' ? v : String(v).toLowerCase();
  };

  // Forward-compat: nested `techniques` object.
  if (row.techniques && typeof row.techniques === 'object') {
    for (const k of TECHNIQUE_KEYS) {
      setIfPresent(k, (row.techniques as Record<string, any>)[k]);
    }
  }

  // New-shape: technique fields at top level.
  setIfPresent('num_speculative_tokens', row.num_speculative_tokens);
  setIfPresent('max_num_batched_tokens', row.max_num_batched_tokens);
  setIfPresent('kv_cache_dtype', row.kv_cache_dtype);
  setIfPresent('prefix_cache', row.prefix_cache);

  // spec_decoding is the canonical top-level field name; map to spec_method
  // unless we already pulled one out of the nested techniques object.
  if (!('spec_method' in out)) {
    const legacy = row.spec_decoding;
    if (legacy && legacy !== '' && String(legacy).toLowerCase() !== 'none') {
      out.spec_method = String(legacy).toLowerCase();
    }
  }

  // Legacy fallback: layer count smuggled into the model prefix (gemma4n4/n6).
  if (!('num_speculative_tokens' in out)) {
    const rawPrefix = String(row.infmax_model_prefix ?? row.model_prefix ?? '').toLowerCase();
    const n = PREFIX_TO_NUM_SPEC_TOKENS[rawPrefix];
    if (n !== undefined) {
      out.num_speculative_tokens = n;
      // If spec_method wasn't set elsewhere but we have a layer count, infer mtp.
      if (!('spec_method' in out)) out.spec_method = 'mtp';
    }
  }

  return out;
}

/**
 * Coerce a loosely-typed value to a boolean.
 * Accepts JS `true`, the string `'true'`, and the Python-style string `'True'`.
 *
 * @param v - Value to coerce (any type).
 * @returns `true` if the value is one of the recognized truthy forms, `false` otherwise.
 */
export function parseBool(v: any): boolean {
  return v === true || v === 'true' || v === 'True';
}

/**
 * Parse a floating-point number from a loosely-typed value.
 * Handles both numeric and string representations.
 *
 * @param v - Value to parse (number, string, null, or undefined).
 * @returns The parsed number, or `undefined` if the input is null/undefined/NaN.
 */
export function parseNum(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return isNaN(n) ? undefined : n;
}

/**
 * Parse an integer from a loosely-typed value.
 * Strings are parsed with base 10; non-integer numbers are rounded.
 *
 * @param v - Value to parse (number, string, null, or undefined).
 * @returns The parsed integer, or `undefined` if the input is null/undefined/NaN.
 */
export function parseInt2(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'string' ? parseInt(v, 10) : Math.round(Number(v));
  return isNaN(n) ? undefined : n;
}

/**
 * Extract ISL (input sequence length) and OSL (output sequence length) in tokens
 * from a file/directory name that encodes them as `{n}k{m}k`.
 *
 * @example
 * parseIslOsl('Full_Sweep_-_1k1k_12345')            // { isl: 1024, osl: 1024 }
 * parseIslOsl('results_dsr1_1k8k_4305020262.zip')   // { isl: 1024, osl: 8192 }
 *
 * @param name - File or directory name containing the encoded sequence lengths.
 * @returns An object with `isl` and `osl` in tokens, or `null` if no match is found.
 */
export function parseIslOsl(name: string): { isl: number; osl: number } | null {
  const m = name.match(/[_-](\d+)k(\d+)k[_\-.]/iu);
  if (!m) return null;
  return { isl: parseInt(m[1], 10) * 1024, osl: parseInt(m[2], 10) * 1024 };
}
