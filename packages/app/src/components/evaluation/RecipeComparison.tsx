'use client';

import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useGlobalFilters } from '@/components/GlobalFilterContext';
import { useBenchmarks } from '@/hooks/api/use-benchmarks';
import { useEvaluations } from '@/hooks/api/use-evaluations';
import { track } from '@/lib/analytics';

import {
  buildRecipeRows,
  TECHNIQUE_CATEGORIES,
  type RecipeRow,
  type TechniqueCategory,
} from './recipe-data';

function fmtNum(n: number | null, digits = 2, suffix = ''): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtSpeedup(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}×`;
}

const COLUMNS: DataTableColumn<RecipeRow>[] = [
  {
    header: 'HW',
    align: 'left',
    cell: (r) => r.hardware,
    sortValue: (r) => r.hardware,
  },
  {
    header: 'Topology',
    align: 'left',
    cell: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.topology}</span>,
    sortValue: (r) => `${r.numPrefillGpu + r.numDecodeGpu}_${r.prefillTp}_${r.disagg ? 1 : 0}`,
  },
  {
    header: 'Precision',
    align: 'left',
    cell: (r) => r.precision,
    sortValue: (r) => r.precision,
  },
  {
    header: 'Seq',
    align: 'left',
    cell: (r) => `${r.isl / 1024}k/${r.osl / 1024}k`,
    sortValue: (r) => `${r.isl}_${r.osl}`,
  },
  {
    header: 'Conc',
    align: 'right',
    cell: (r) => String(r.conc),
    sortValue: (r) => r.conc,
  },
  {
    header: 'Variant',
    align: 'left',
    cell: (r) => (
      <span className={r.isBaseline ? 'text-muted-foreground' : 'font-medium'}>
        {r.variantLabel}
      </span>
    ),
    sortValue: (r) => r.variantLabel,
  },
  {
    header: 'Speedup',
    align: 'right',
    cell: (r) => {
      if (r.speedup === null) return <span className="text-muted-foreground">—</span>;
      const better = r.speedup > 1.01;
      const worse = r.speedup < 0.99;
      const cls = better ? 'text-green-500' : worse ? 'text-red-500' : '';
      return <span className={cls}>{fmtSpeedup(r.speedup)}</span>;
    },
    sortValue: (r) => r.speedup ?? -Infinity,
  },
  {
    header: 'tput/GPU',
    align: 'right',
    cell: (r) => fmtNum(r.tputPerGpu, 0),
    sortValue: (r) => r.tputPerGpu,
  },
  {
    header: 'TPOT (s)',
    align: 'right',
    cell: (r) => fmtNum(r.medianTpot, 4),
    sortValue: (r) => r.medianTpot,
  },
  {
    header: 'Accept Rate',
    align: 'right',
    cell: (r) => fmtPct(r.acceptanceRate),
    sortValue: (r) => r.acceptanceRate ?? -Infinity,
  },
  {
    header: 'Accuracy',
    align: 'right',
    cell: (r) => {
      if (r.accuracy === null) return <span className="text-muted-foreground">—</span>;
      const delta = r.accuracyDelta;
      return (
        <span>
          {fmtPct(r.accuracy)}
          {delta !== null && Math.abs(delta) >= 0.001 && (
            <span className={`ml-1 text-xs ${delta < 0 ? 'text-red-500' : 'text-green-500'}`}>
              {delta > 0 ? '+' : ''}
              {(delta * 100).toFixed(2)}pp
            </span>
          )}
        </span>
      );
    },
    sortValue: (r) => r.accuracy ?? -Infinity,
  },
  {
    header: 'Run',
    align: 'center',
    cell: (r) =>
      r.runUrl ? (
        <a
          href={r.runUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
          title="Open benchmark run on GitHub Actions"
        >
          <ExternalLink className="size-4" />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export default function RecipeComparison() {
  const { selectedModel } = useGlobalFilters();
  const [category, setCategory] = useState<TechniqueCategory | 'all'>('all');

  // Always use the no-date "latest state across all dates" path. The recipe
  // table is meant to surface current recipe variants, not historical data —
  // a stale `selectedRunDate` inherited from /inference would hide rows
  // ingested on more recent dates (e.g. the user reported missing the
  // batch-size filter chip because mnbt rows landed after the sticky date).
  const { data: benchmarks, isLoading: bmkLoading, error: bmkError } = useBenchmarks(selectedModel);
  const { data: evals, isLoading: evalLoading, error: evalError } = useEvaluations();

  const allRows = useMemo(() => {
    if (!benchmarks || benchmarks.length === 0) return [];
    const built = buildRecipeRows(benchmarks, evals ?? []);
    // Sort: group rows together, baseline first within each group, then by speedup descending.
    return built.toSorted((a, b) => {
      if (a.groupKey !== b.groupKey) return a.groupKey.localeCompare(b.groupKey);
      if (a.isBaseline !== b.isBaseline) return a.isBaseline ? -1 : 1;
      return (b.speedup ?? 0) - (a.speedup ?? 0);
    });
  }, [benchmarks, evals]);

  // Only show category chips for axes that actually have rows. Avoids empty
  // chips that lead to a blank table when selected.
  const availableCategories = useMemo(() => {
    const seen = new Set<TechniqueCategory>(allRows.map((r) => r.category));
    return TECHNIQUE_CATEGORIES.filter((c) => c.value === 'all' || seen.has(c.value));
  }, [allRows]);

  const rows = useMemo(() => {
    if (category === 'all') return allRows;
    // Always include baseline rows in any non-"all" filter so the user has a
    // reference variant on the page if one exists in the group.
    return allRows.filter((r) => r.category === category || r.isBaseline);
  }, [allRows, category]);

  const loading = bmkLoading || evalLoading;
  const error = bmkError ?? evalError;

  return (
    <section className="container mx-auto flex flex-col gap-4 px-4 py-6 lg:px-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Recipe Comparison</h1>
          <p className="text-sm text-muted-foreground">
            Compare runtime knobs (speculative decoding, batch size, …) on the same deployment.
            Speedup is computed against the variant whose <code>techniques</code> is empty within
            the same (model × topology × precision × isl/osl × conc) group.
          </p>
        </div>
        {availableCategories.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Filter by knob:</span>
            {availableCategories.map((c) => {
              const active = category === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setCategory(c.value);
                    track('evaluation_recipe_category_changed', { category: c.value });
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? 'border-brand bg-brand text-primary-foreground'
                      : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-500 bg-red-500/10 px-4 py-2 text-sm text-red-500">
          {error.message}
        </div>
      )}

      {loading && (
        <div className="text-sm text-muted-foreground">Loading benchmarks and evaluations…</div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          No data for <strong>{selectedModel || '(no model)'}</strong>. Pick a different model.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <DataTable
          data={rows}
          columns={COLUMNS}
          testId="recipe-comparison-table"
          analyticsPrefix="evaluation_recipe"
        />
      )}
    </section>
  );
}
