'use client';

import { ExternalLink } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useGlobalFilters } from '@/components/GlobalFilterContext';
import { useBenchmarks } from '@/hooks/api/use-benchmarks';
import { useEvaluations } from '@/hooks/api/use-evaluations';

import { buildRecipeRows, type RecipeRow } from './recipe-data';

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
  const { selectedModel, selectedRunDate } = useGlobalFilters();

  const {
    data: benchmarks,
    isLoading: bmkLoading,
    error: bmkError,
  } = useBenchmarks(selectedModel, selectedRunDate || undefined);
  const { data: evals, isLoading: evalLoading, error: evalError } = useEvaluations();

  const rows = useMemo(() => {
    if (!benchmarks || benchmarks.length === 0) return [];
    const built = buildRecipeRows(benchmarks, evals ?? []);
    // Sort: group rows together, baseline first within each group, then by speedup descending.
    return built.toSorted((a, b) => {
      if (a.groupKey !== b.groupKey) return a.groupKey.localeCompare(b.groupKey);
      if (a.isBaseline !== b.isBaseline) return a.isBaseline ? -1 : 1;
      return (b.speedup ?? 0) - (a.speedup ?? 0);
    });
  }, [benchmarks, evals]);

  const loading = bmkLoading || evalLoading;
  const error = bmkError ?? evalError;

  return (
    <section className="container mx-auto flex flex-col gap-4 px-4 py-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Recipe Comparison</h1>
        <p className="text-sm text-muted-foreground">
          Compare runtime knobs (speculative decoding, MTP layers, …) on the same deployment.
          Speedup is computed against the variant whose <code>techniques</code> is empty within the
          same (model × hw × precision × isl/osl × conc) group.
        </p>
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
          No data for <strong>{selectedModel || '(no model)'}</strong>
          {selectedRunDate ? (
            <>
              {' '}
              on <strong>{selectedRunDate}</strong>
            </>
          ) : null}
          . Pick a different model or date.
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
