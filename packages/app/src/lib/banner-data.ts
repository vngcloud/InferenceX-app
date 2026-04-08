/**
 * Announcement banner helpers.
 *
 * The banner is fully automated — it fetches the latest changelog entry from the
 * workflow-info API and displays it. No manual configuration needed.
 *
 * Dismissals are tracked per changelog date in localStorage so users see each
 * new day's announcements once.
 */

import { DB_MODEL_TO_DISPLAY } from '@semianalysisai/inferencex-constants';

import type { ChangelogRow, WorkflowInfoResponse } from '@/lib/api';
import { type Precision, MODEL_PREFIX_MAPPING, getPrecisionLabel } from '@/lib/data-mappings';
import { getFrameworkLabel } from '@/lib/utils';

const DISMISS_KEY_PREFIX = 'banner-dismissed-';

/** Check if a banner has been dismissed by the user. */
export function isDismissed(id: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(`${DISMISS_KEY_PREFIX}${id}`) === '1';
}

/** Mark a banner as dismissed. */
export function dismiss(id: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${DISMISS_KEY_PREFIX}${id}`, '1');
}

export interface BannerInfo {
  /** Dismiss key — e.g. "changelog-2026-04-07" */
  id: string;
  /** Human-readable summary, e.g. "New data: Kimi-K2.5 FP4 GB200 (Dynamo vLLM)" */
  message: string;
  /** Display date, e.g. "Apr 7, 2026" */
  date: string;
  /** Deep-link to the inference tab with the relevant model/precision pre-selected. */
  linkHref: string;
}

/**
 * Extract a banner from a workflow-info response.
 * Takes the most recent changelog entry and builds a human-readable message.
 */
export function buildBannerFromWorkflowInfo(
  date: string,
  data: WorkflowInfoResponse,
): BannerInfo | null {
  if (!data.changelogs || data.changelogs.length === 0) return null;

  // Take the most recent entry (last in the array)
  const entry: ChangelogRow = data.changelogs.at(-1)!;
  const configKey = entry.config_keys[0];
  if (!configKey) return null;

  // Parse config key: model-precision-gpu-framework[-variant]
  const parts = configKey.split('-');
  const modelPrefix = parts[0] ?? '';
  const precision = parts[1] ?? '';
  const gpu = parts[2] ?? '';
  const framework = parts.slice(3).join('-');
  const displayModel = DB_MODEL_TO_DISPLAY[modelPrefix];

  // Build human-readable label: Model | Precision | GPU | Framework
  const model = MODEL_PREFIX_MAPPING[modelPrefix] ?? modelPrefix;
  const precLabel = getPrecisionLabel(precision as Precision);
  const isMtp = framework.endsWith('-mtp');
  const baseFramework = isMtp ? framework.slice(0, -4) : framework;
  const fwLabel = isMtp
    ? `${getFrameworkLabel(baseFramework)}, MTP`
    : getFrameworkLabel(baseFramework);
  const label = `${model} ${precLabel} ${gpu.toUpperCase()} (${fwLabel})`;
  const extra = data.changelogs.length > 1 ? ` (+${data.changelogs.length - 1} more)` : '';

  // Detect eval-only changelogs by description text
  const isEval = entry.description.toLowerCase().includes('eval');
  const tab = isEval ? 'evaluation' : 'inference';

  const linkParams = new URLSearchParams();
  if (displayModel) linkParams.set('g_model', displayModel);
  linkParams.set('g_rundate', date);
  if (!isEval && precision) linkParams.set('i_prec', precision);
  const search = linkParams.toString();

  // Format date as "Apr 7, 2026"
  const displayDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return {
    id: `changelog-${date}`,
    message: `New data: ${label}${extra}`,
    date: displayDate,
    linkHref: `/${tab}?${search}`,
  };
}
