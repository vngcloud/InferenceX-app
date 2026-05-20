'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { BenchmarkSibling, BenchmarkSku } from '@/hooks/api/use-benchmark-siblings';

const HW_LABELS: Record<string, string> = {
  b200: 'B200',
  b300: 'B300',
  gb200: 'GB200',
  gb300: 'GB300',
  h100: 'H100',
  h200: 'H200',
  mi300x: 'MI300X',
  mi325x: 'MI325X',
  mi355x: 'MI355X',
};

const MODEL_LABELS: Record<string, string> = {
  dsr1: 'DeepSeek R1',
  dsv4: 'DeepSeek V4 Pro',
  glm5: 'GLM-5',
  'glm5.1': 'GLM-5.1',
  gptoss120b: 'gpt-oss 120B',
  kimik2: 'Kimi K2',
  'kimik2.5': 'Kimi K2.5',
  'kimik2.6': 'Kimi K2.6',
  llama70b: 'Llama 3.3 70B',
  'minimaxm2.5': 'MiniMax M2.5',
  'minimaxm2.7': 'MiniMax M2.7',
  'qwen3.5': 'Qwen 3.5',
};

function hwLabel(hw: string) {
  return HW_LABELS[hw] ?? hw.toUpperCase();
}
function modelLabel(m: string) {
  return MODEL_LABELS[m] ?? m;
}
function frameworkLabel(fw: string) {
  if (fw === 'vllm') return 'vLLM';
  if (fw === 'sglang') return 'SGLang';
  if (fw === 'trt') return 'TRT';
  if (fw === 'mori-sglang') return 'Mori-SGLang';
  if (fw.startsWith('dynamo-')) return `Dynamo ${fw.slice('dynamo-'.length).toUpperCase()}`;
  return fw;
}

/** Short label for a sibling chip: parallelism + concurrency. */
function chipLabel(s: BenchmarkSibling): string {
  const parallel = s.disagg
    ? `${s.num_prefill_gpu}P+${s.num_decode_gpu}D`
    : `TP${s.decode_tp}${s.decode_ep > 1 ? `EP${s.decode_ep}` : ''}`;
  const offload = s.offload_mode === 'on' ? ' • off=ON' : '';
  return `${parallel} • c=${s.conc}${offload}`;
}

export function SiblingNav({ sku, siblings }: { sku: BenchmarkSku; siblings: BenchmarkSibling[] }) {
  const router = useRouter();
  const currentIdx = siblings.findIndex((s) => s.is_current);
  const prev = currentIdx > 0 ? siblings[currentIdx - 1] : null;
  const next =
    currentIdx !== -1 && currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;

  const skuLabel = `${hwLabel(sku.hardware)} · ${modelLabel(sku.model)} · ${sku.precision.toUpperCase()} · ${frameworkLabel(sku.framework)}`;

  return (
    <div className="border-b border-border/40 pb-4 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h1 className="text-2xl font-semibold text-foreground">{skuLabel}</h1>
        <span className="text-xs text-muted-foreground">
          {siblings.length} point{siblings.length === 1 ? '' : 's'} in this run · {sku.date}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={!prev}
          onClick={() => prev && router.push(`/inference/agentic/${prev.id}`)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-border/40 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous point"
        >
          <ChevronLeft className="size-3.5" /> prev
        </button>
        <div className="flex items-center gap-1 flex-wrap">
          {siblings.map((s) => {
            const active = s.is_current;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => !active && router.push(`/inference/agentic/${s.id}`)}
                className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground font-medium'
                    : 'border-border/40 text-foreground hover:bg-accent'
                } ${s.has_trace ? '' : 'opacity-60'}`}
                title={s.has_trace ? undefined : 'No stored trace data'}
              >
                {chipLabel(s)}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={!next}
          onClick={() => next && router.push(`/inference/agentic/${next.id}`)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-border/40 hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next point"
        >
          next <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
