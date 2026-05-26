'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Card } from '@/components/ui/card';
import { track } from '@/lib/analytics';
import { navigateInApp } from '@/lib/client-navigation';

interface WorkflowEntry {
  href: string;
  label: string;
  description: string;
}

const WORKFLOW: WorkflowEntry[] = [
  {
    href: '/inference',
    label: 'Inference',
    description:
      'Pick a serving config to deploy. Throughput-vs-latency frontier across hardware, framework, precision, and parallelism.',
  },
  {
    href: '/evaluation',
    label: 'Recipe Compare',
    description:
      'Compare runtime knobs (MTP layers, speculative decoding, kv-cache dtype, …) on the same deployment. Speedup, TPOT, acceptance rate, accuracy delta side-by-side.',
  },
  {
    href: '/historical',
    label: 'Historical Trends',
    description:
      'Week-over-week throughput at a fixed config. Track software improvement and regressions with PR-level changelogs.',
  },
  {
    href: '/calculator',
    label: 'TCO Calculator',
    description:
      'Capacity × cost sizing. Given QPS and SLO, how many GPUs are needed and what does the deployment cost.',
  },
  {
    href: '/gpu-specs',
    label: 'GPU Specs',
    description:
      'Reference card for FLOPS, memory bandwidth, and $/hr across the GPUs we benchmark.',
  },
];

export function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    track('landing_page_viewed');
  }, []);

  return (
    <main className="relative">
      <div className="container mx-auto px-4 lg:px-8 flex flex-col gap-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl lg:text-3xl font-semibold">MLOps Team Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Self-hosted inference benchmark for the VNGCloud / GreenNode team. Pick the tab that
            matches what you&apos;re doing.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          {WORKFLOW.map((entry) => {
            const slug = entry.href.slice(1).replaceAll('-', '_');
            return (
              <Card key={entry.href}>
                <Link
                  href={entry.href}
                  onClick={(e) => {
                    track(`landing_${slug}_clicked`);
                    navigateInApp(e, router, entry.href);
                  }}
                  className="group flex items-start justify-between gap-4"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-lg font-semibold transition-colors group-hover:text-brand">
                      {entry.label}
                    </span>
                    <span className="text-sm text-muted-foreground">{entry.description}</span>
                    <span className="mt-1 font-mono text-xs text-muted-foreground/70">
                      {entry.href}
                    </span>
                  </div>
                  <ArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-brand" />
                </Link>
              </Card>
            );
          })}
        </section>
      </div>
    </main>
  );
}
