'use client';

import { Info } from 'lucide-react';

import { LabelWithTooltip } from '@/components/ui/label-with-tooltip';
import { track } from '@/lib/analytics';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipContent, TooltipRoot, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type Model,
  type Precision,
  type Sequence,
  type Percentile,
  PERCENTILE_OPTIONS,
  getModelCategory,
  getModelLabel,
  getPercentileLabel,
  getPrecisionLabel,
  getSequenceCategory,
  getSequenceLabel,
  groupByCategory,
  sequenceKind,
} from '@/lib/data-mappings';

function DeprecatedLabel({ reason }: { reason: string }) {
  return (
    <SelectLabel>
      <span className="flex items-center gap-1">
        Deprecated
        <TooltipRoot>
          <TooltipTrigger asChild>
            <Info className="size-3 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="top" collisionPadding={10}>
            <span>{reason}</span>
          </TooltipContent>
        </TooltipRoot>
      </span>
    </SelectLabel>
  );
}

interface ModelSelectorProps {
  id?: string;
  value: string;
  onChange: (value: Model) => void;
  availableModels: string[];
  'data-testid'?: string;
}

export function ModelSelector({
  id = 'model-select',
  value,
  onChange,
  availableModels,
  'data-testid': testId,
}: ModelSelectorProps) {
  const groups = groupByCategory(availableModels, (m) => getModelCategory(m as Model));

  return (
    <div className="flex flex-col space-y-1.5 lg:col-span-2">
      <LabelWithTooltip
        htmlFor={id}
        label="Model"
        tooltip="The language model being benchmarked."
      />
      <Select
        value={value}
        onValueChange={(v) => {
          track('selector_model_changed', { model: v });
          onChange(v as Model);
        }}
      >
        <SelectTrigger id={id} data-testid={testId} className="w-full">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {groups.default.map((model) => (
            <SelectItem key={model} value={model}>
              {getModelLabel(model as Model)}
            </SelectItem>
          ))}
          {groups.experimental.length > 0 && (
            <SelectGroup>
              <SelectLabel>Experimental Support (WIP)</SelectLabel>
              {groups.experimental.map((model) => (
                <SelectItem key={model} value={model}>
                  {getModelLabel(model as Model)}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {groups.deprecated.length > 0 && (
            <SelectGroup>
              <DeprecatedLabel reason="Model is no longer actively benchmarked." />
              {groups.deprecated.map((model) => (
                <SelectItem key={model} value={model}>
                  {getModelLabel(model as Model)}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

interface SequenceSelectorProps {
  id?: string;
  value: string;
  onChange: (value: Sequence) => void;
  availableSequences: string[];
  'data-testid'?: string;
}

export function SequenceSelector({
  id = 'sequence-select',
  value,
  onChange,
  availableSequences,
  'data-testid': testId,
}: SequenceSelectorProps) {
  const groups = groupByCategory(availableSequences, (s) => getSequenceCategory(s as Sequence));

  return (
    <div className="flex flex-col space-y-1.5 lg:col-span-1">
      <LabelWithTooltip
        htmlFor={id}
        label="ISL / OSL"
        tooltip="Input Sequence Length / Output Sequence Length. Defines the number of input and output tokens for the benchmark (e.g., 1K/8K means 1,024 input tokens and 8,192 output tokens)."
      />
      <Select
        value={value}
        onValueChange={(v) => {
          track('selector_sequence_changed', { sequence: v });
          onChange(v as Sequence);
        }}
      >
        <SelectTrigger id={id} data-testid={testId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups.default.map((seq) => (
            <SelectItem key={seq} value={seq}>
              {getSequenceLabel(seq as Sequence)}
            </SelectItem>
          ))}
          {groups.deprecated.length > 0 && (
            <SelectGroup>
              <DeprecatedLabel reason="CI capacity was reallocated to agentic coding and multi-turn chat scenarios." />
              {groups.deprecated.map((seq) => (
                <SelectItem key={seq} value={seq}>
                  {getSequenceLabel(seq as Sequence)}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

interface ScenarioSelectorProps {
  id?: string;
  value: string;
  onChange: (value: Sequence) => void;
  availableSequences: string[];
  'data-testid'?: string;
}

/**
 * Scenario selector — fixed-seq-len rows grouped under "Fixed Sequence Length",
 * agentic-trace rows rendered flat below. Label is "Scenario" (the ISL/OSL
 * framing only applies to the fixed-seq subset).
 */
export function ScenarioSelector({
  id = 'scenario-select',
  value,
  onChange,
  availableSequences,
  'data-testid': testId,
}: ScenarioSelectorProps) {
  const fixedSeq = availableSequences.filter((s) => sequenceKind(s as Sequence) === 'fixed-seq');
  const agentic = availableSequences.filter((s) => sequenceKind(s as Sequence) === 'agentic');
  const fixedGroups = groupByCategory(fixedSeq, (s) => getSequenceCategory(s as Sequence));

  return (
    <div className="flex flex-col space-y-1.5 lg:col-span-1">
      <LabelWithTooltip
        htmlFor={id}
        label="Scenario"
        tooltip="Benchmark scenario. Fixed Sequence Length runs use a defined input/output token count (ISL/OSL). Agentic Traces replay real agentic workloads with variable inputs/outputs."
      />
      <Select
        value={value}
        onValueChange={(v) => {
          track('selector_scenario_changed', { scenario: v });
          onChange(v as Sequence);
        }}
      >
        <SelectTrigger id={id} data-testid={testId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fixedSeq.length > 0 && (
            <SelectGroup>
              <SelectLabel>Fixed Sequence Length</SelectLabel>
              {fixedGroups.default.map((seq) => (
                <SelectItem key={seq} value={seq}>
                  {getSequenceLabel(seq as Sequence)}
                </SelectItem>
              ))}
              {fixedGroups.deprecated.length > 0 && (
                <>
                  <DeprecatedLabel reason="CI capacity was reallocated to agentic coding and multi-turn chat scenarios." />
                  {fixedGroups.deprecated.map((seq) => (
                    <SelectItem key={seq} value={seq}>
                      {getSequenceLabel(seq as Sequence)}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectGroup>
          )}
          {agentic.map((seq) => (
            <SelectItem key={seq} value={seq}>
              {getSequenceLabel(seq as Sequence)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface PercentileSelectorProps {
  id?: string;
  value: string;
  onChange: (value: Percentile) => void;
  'data-testid'?: string;
}

/**
 * Latency percentile selector for agentic-trace charts. The selected value
 * rewrites the chart x-axis metric from `median_*` to `{percentile}_*`, so
 * picking p99 plots p99 e2e latency / interactivity instead of the median.
 */
export function PercentileSelector({
  id = 'percentile-select',
  value,
  onChange,
  'data-testid': testId,
}: PercentileSelectorProps) {
  return (
    <div className="flex flex-col space-y-1.5 lg:col-span-1">
      <LabelWithTooltip
        htmlFor={id}
        label="Latency Percentile"
        tooltip="Percentile of the latency distribution used for the chart x-axis. Agentic runs carry median/p90/p99/p99.9 variants; switch percentiles to see tail-latency behavior."
      />
      <Select
        value={value}
        onValueChange={(v) => {
          track('selector_percentile_changed', { percentile: v });
          onChange(v as Percentile);
        }}
      >
        <SelectTrigger id={id} data-testid={testId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERCENTILE_OPTIONS.map((p) => (
            <SelectItem key={p} value={p}>
              {getPercentileLabel(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface PrecisionSelectorProps {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  availablePrecisions: string[];
  'data-testid'?: string;
}

export function PrecisionSelector({
  id = 'precision-select',
  value,
  onChange,
  availablePrecisions,
  'data-testid': testId,
}: PrecisionSelectorProps) {
  return (
    <div className="flex flex-col space-y-1.5 lg:col-span-1">
      <LabelWithTooltip
        htmlFor={id}
        label="Precision"
        tooltip="Numerical precision used for model weights. Lower precision like 'FP4' uses less memory and increases throughput but may slightly reduce accuracy compared to higher precisions like 'FP8'."
      />
      <div data-testid={testId}>
        <MultiSelect
          options={availablePrecisions.map((p) => ({
            value: p,
            label: getPrecisionLabel(p as Precision),
          }))}
          value={value}
          onChange={onChange}
          placeholder=""
          minSelections={1}
          showClearAll={false}
          searchable={false}
        />
      </div>
    </div>
  );
}
