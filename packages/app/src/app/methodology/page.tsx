import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_REPO_FULL,
  SITE_URL,
} from '@semianalysisai/inferencex-constants';

import {
  METHODOLOGY_SECTIONS,
  METRIC_GROUPS,
  FORMULAS,
  GLOSSARY_GROUPS,
  CAVEATS,
  EVAL_TASKS,
  PRICING_TIERS,
  BENCH_PROTOCOL_FLAGS,
  SEQ_LEN_PAIRS,
} from '@/components/methodology/methodology-data';

const REPO_URL = `https://github.com/${GITHUB_REPO_FULL}`;
const APP_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}-app`;

const definedTermSetJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'DefinedTermSet',
  name: 'InferenceX Methodology and Glossary',
  url: `${SITE_URL}/methodology`,
  hasDefinedTerm: GLOSSARY_GROUPS.flatMap((group) =>
    group.terms.map((term) => ({
      '@type': 'DefinedTerm',
      name: term.term,
      description: term.definition,
      inDefinedTermSet: `${SITE_URL}/methodology`,
    })),
  ),
};

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How InferenceX measures LLM inference: benchmark protocol, formulas for tokens per GPU, tokens per MW, joules per token, cost per million tokens, evaluation tasks, and the full glossary of terms used on the dashboard.',
  alternates: { canonical: `${SITE_URL}/methodology` },
  openGraph: {
    title: 'Methodology | InferenceX',
    description:
      'How InferenceX measures LLM inference: benchmark protocol, formulas, evaluation, and glossary.',
    url: `${SITE_URL}/methodology`,
  },
  twitter: {
    title: 'Methodology | InferenceX',
    description:
      'How InferenceX measures LLM inference: benchmark protocol, formulas, evaluation, and glossary.',
  },
};

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <header className="mb-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.28em] text-brand">{eyebrow}</p>
      <h2 id={id} className="scroll-mt-24 text-2xl font-semibold tracking-[-0.02em]">
        {title}
      </h2>
    </header>
  );
}

function Formula({
  expression,
  source,
  description,
}: {
  expression: string;
  source: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/30 p-3">
      <code className="block whitespace-pre-wrap break-words font-mono text-sm text-foreground">
        {expression}
      </code>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      <p className="mt-2 text-xs text-muted-foreground/80">
        Source: <code className="font-mono">{source}</code>
      </p>
    </div>
  );
}

export default function MethodologyPage() {
  return (
    <main className="relative">
      <script type="application/ld+json">{JSON.stringify(definedTermSetJsonLd)}</script>
      <div className="container mx-auto px-4 lg:px-8 flex flex-col gap-6 lg:gap-4 pb-8">
        <Card>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.32em] text-brand">
            Methodology
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">
            Formulas, definitions, and the protocol behind every chart on this site.
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base">
            Every dashboard data point is the output of a public GitHub Actions workflow run on real
            hardware, ingested into a public database, and rendered with the formulas below. This
            page documents what we measure, how we measure it, and the exact equations the dashboard
            uses to derive efficiency and cost.
          </p>
          <nav aria-label="On this page" className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              On this page
            </p>
            <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {METHODOLOGY_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-brand hover:underline">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </Card>

        <section>
          <Card>
            <SectionHeading id="scope" eyebrow="01" title="Scope" />
            <p className="text-sm leading-6 text-muted-foreground">
              InferenceX continuously benchmarks LLM serving frameworks on real GPUs and publishes
              every result with a link back to the workflow run that produced it. We measure
              latency, throughput, interactivity, power efficiency, and cost across hardware,
              framework, model, precision, parallelism, and concurrency combinations. We do not
              measure model intelligence directly. Accuracy is validated separately as a guardrail
              against optimizations that silently regress output quality (see{' '}
              <a href="#evaluation" className="text-brand hover:underline">
                Evaluation
              </a>
              ).
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The official InferenceX result set lives in{' '}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                {GITHUB_REPO_FULL}
              </a>
              . Forks running the same recipes on different hardware or clouds produce unofficial
              numbers and must label them as such.
            </p>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="how-benchmarks-run" eyebrow="02" title="How benchmarks run" />
            <p className="text-sm leading-6 text-muted-foreground mb-4">
              Each benchmark configuration is a shell script in the public repo. GitHub Actions
              schedules the workflow on a self-hosted runner attached to the target accelerator,
              which launches the inference server and runs the benchmark client against it. Results
              are uploaded as artifacts, ingested into the database, and surfaced on the dashboard.
            </p>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Recipe.</strong>{' '}
                <code className="font-mono text-xs">benchmarks/single_node/&lt;config&gt;.sh</code>{' '}
                or{' '}
                <code className="font-mono text-xs">benchmarks/multi_node/&lt;config&gt;.sh</code>.
                The exact image, command line, parallelism, and quantization are pinned here.
              </li>
              <li>
                <strong className="text-foreground">Config matrix.</strong>{' '}
                <code className="font-mono text-xs">.github/configs/nvidia-master.yaml</code> and{' '}
                <code className="font-mono text-xs">amd-master.yaml</code> enumerate every supported
                combination of model × framework × precision × parallelism × sequence length ×
                concurrency.
              </li>
              <li>
                <strong className="text-foreground">Trigger.</strong>{' '}
                <code className="font-mono text-xs">perf-changelog.yaml</code> selects which configs
                re-run when something changes (image bump, recipe edit, new entry). Push-to-main
                runs the full sweep; PR runs use a trimmed sweep that keeps only the highest
                concurrency per config.
              </li>
              <li>
                <strong className="text-foreground">Orchestration.</strong>{' '}
                <code className="font-mono text-xs">.github/workflows/run-sweep.yml</code>{' '}
                dispatches each config as a job to a self-hosted runner with the matching GPU.
              </li>
              <li>
                <strong className="text-foreground">Server + client.</strong> The recipe starts the
                inference server (vLLM, SGLang, TensorRT-LLM, ATOM, or NVIDIA Dynamo with one of
                those backends) and runs the vLLM-derived benchmark client against the
                OpenAI-compatible endpoint with a fixed protocol (next section).
              </li>
              <li>
                <strong className="text-foreground">Artifacts.</strong> Per-request latencies, token
                counts, GPU power telemetry, server logs, and a per-run aggregate JSON (
                <code className="font-mono text-xs">agg_bmk.json</code>) are uploaded to the run
                page. GitHub Actions retains these for 90 days; a weekly snapshot of the full DB is
                published as a public Release.
              </li>
              <li>
                <strong className="text-foreground">Ingest.</strong> The aggregate JSON is loaded
                into the database keyed by GitHub Actions run ID, and the dashboard renders the
                latest result per (config, concurrency). Every chart tooltip carries the run link.
              </li>
            </ol>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              <a
                href={`${REPO_URL}/tree/main/benchmarks`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-accent transition-colors"
              >
                Recipes
              </a>
              <a
                href={`${REPO_URL}/tree/main/.github/configs`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-accent transition-colors"
              >
                Master configs
              </a>
              <a
                href={`${REPO_URL}/blob/main/perf-changelog.yaml`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-accent transition-colors"
              >
                perf-changelog.yaml
              </a>
              <a
                href={`${REPO_URL}/blob/main/.github/workflows/run-sweep.yml`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-accent transition-colors"
              >
                run-sweep.yml
              </a>
              <a
                href={`${REPO_URL}/releases?q=db-dump`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-accent transition-colors"
              >
                Weekly DB dumps
              </a>
              <Link
                href="/about#reproducibility"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-accent transition-colors"
              >
                Reproducibility →
              </Link>
            </div>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading
              id="benchmark-protocol"
              eyebrow="03"
              title="Benchmark client protocol"
            />
            <p className="text-sm leading-6 text-muted-foreground mb-4">
              Every benchmark script in the repo invokes the same vLLM-derived client (
              <code className="font-mono text-xs">utils/bench_serving/benchmark_serving.py</code>)
              with the same protocol against the framework&apos;s OpenAI-compatible endpoint. The
              flags below are invariant across hardware and framework so that results compare apples
              to apples.
            </p>
            <div className="rounded-lg border border-border/40 bg-background/30 p-4">
              <dl className="grid gap-y-3 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
                {BENCH_PROTOCOL_FLAGS.map((f) => (
                  <div key={f.flag} className="contents">
                    <dt className="font-mono text-xs text-foreground">{f.flag}</dt>
                    <dd className="text-muted-foreground">{f.purpose}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Because input is random tokens with prefix caching disabled and{' '}
              <code className="font-mono text-xs">--ignore-eos</code> forces the full output length,
              dashboard numbers represent worst-case input. Production traffic with prefix caching,
              structured prompts, or shorter outputs will typically perform better.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Sequence length pairs (ISL / OSL) tested:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
              {SEQ_LEN_PAIRS.map((p) => (
                <li key={p.label}>
                  <strong className="text-foreground">{p.label}.</strong> {p.description}
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="metrics" eyebrow="04" title="Performance metrics" />
            <p className="text-sm leading-6 text-muted-foreground mb-4">
              Latency, throughput, and interactivity are reported directly from the benchmark
              client. Power efficiency and cost are derived per-GPU from hardware specs and the
              SemiAnalysis TCO model. See{' '}
              <a href="#formulas" className="text-brand hover:underline">
                Formulas
              </a>
              .
            </p>
            <div className="space-y-6">
              {METRIC_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </h3>
                  <dl className="divide-y divide-border/60">
                    {group.metrics.map((m) => (
                      <div key={m.name} className="grid gap-2 py-3 sm:grid-cols-[12rem_1fr]">
                        <dt>
                          <p className="font-medium text-foreground">{m.name}</p>
                          {m.units && (
                            <p className="font-mono text-xs text-muted-foreground">{m.units}</p>
                          )}
                        </dt>
                        <dd className="text-sm leading-6 text-muted-foreground">
                          {m.definition}
                          {m.field && (
                            <>
                              {' '}
                              <span className="text-muted-foreground/70">
                                (DB field: <code className="font-mono text-xs">{m.field}</code>)
                              </span>
                            </>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="formulas" eyebrow="05" title="Formulas" />
            <p className="text-sm leading-6 text-muted-foreground mb-4">
              All derived metrics are computed in{' '}
              <a
                href={`${APP_REPO_URL}/blob/master/packages/app/src/lib/chart-utils.ts`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                <code className="font-mono text-xs">chart-utils.ts</code>
              </a>
              . The expressions below are reproduced verbatim from that file.
            </p>
            <div className="grid gap-3">
              {FORMULAS.map((f) => (
                <div key={f.name}>
                  <p className="mb-1 text-sm font-medium text-foreground">{f.name}</p>
                  <Formula
                    expression={f.expression}
                    source={f.source}
                    description={f.description}
                  />
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="pricing" eyebrow="06" title="Pricing assumptions" />
            <p className="text-sm leading-6 text-muted-foreground mb-4">
              Cost per million tokens is computed from per-GPU TCO. The dashboard shows three cost
              tiers in parallel so users can pick whichever matches their economics.
            </p>
            <dl className="space-y-4">
              {PRICING_TIERS.map((t) => (
                <div key={t.name}>
                  <dt className="font-medium text-foreground">{t.name}</dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{t.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Per-GPU TCO and rental price inputs are sourced from the{' '}
              <a
                href="https://semianalysis.com/ai-cloud-tco-model/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                SemiAnalysis AI Cloud TCO Model
              </a>{' '}
              (server-level TCO across networking architectures and accelerators) and the{' '}
              <a
                href="https://semianalysis.com/gpu-cloud-clustermax-rating-system-h100-pricing/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                GPU Cloud Market Rental Price Report
              </a>{' '}
              (rental prices surveyed across 70+ GPU clouds and 100+ end users).
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Users can override these inputs in the{' '}
              <Link href="/calculator" className="text-brand hover:underline">
                throughput calculator
              </Link>{' '}
              to compute cost under their own assumptions.
            </p>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="power" eyebrow="07" title="Power assumptions" />
            <p className="text-sm leading-6 text-muted-foreground mb-3">
              Tokens per MW and joules per token are normalized to{' '}
              <strong className="text-foreground">all-in provisioned utility power</strong>: the
              total power drawn at the meter, including everything needed to keep the GPUs running
              at scale, not just the GPUs themselves.
            </p>
            <p className="text-sm leading-6 text-muted-foreground mb-3">
              All-in provisioned utility MW includes:
            </p>
            <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
              <li>GPU power (TDP-bounded but typically lower under memory-bound decode)</li>
              <li>Host CPUs and system memory</li>
              <li>Networking equipment (NVLink/IB/Ethernet switches and NICs)</li>
              <li>Other cluster IT equipment</li>
              <li>
                Facility overhead: electrical distribution losses, chillers, CDUs, cooling towers
              </li>
            </ul>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              This differs from <strong className="text-foreground">critical IT MW</strong>, which
              excludes facility overhead, and from <strong className="text-foreground">TDP</strong>,
              which is a per-component peak rating. Total cluster power is built up by summing the
              TDP of each component, with cluster-level overheads from the{' '}
              <a
                href="https://semianalysis.com/datacenter-industry-model/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                SemiAnalysis AI Datacenter Industry Model
              </a>
              . Dashboard joules-per-token is therefore <em>conservative</em>: real workloads
              typically draw less than TDP at the GPU.
            </p>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="evaluation" eyebrow="08" title="Evaluation methodology" />
            <p className="text-sm leading-6 text-muted-foreground mb-4">
              Throughput optimizations (kernel choices, parallelism, quantization) can silently
              change model outputs. To catch this, evals run as{' '}
              <strong className="text-foreground">separate workflow jobs</strong> that exercise the
              same server with the same recipe and check accuracy against published thresholds.
            </p>
            <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Tasks
            </h3>
            <dl className="space-y-3">
              {EVAL_TASKS.map((t) => (
                <div key={t.name}>
                  <dt className="font-medium text-foreground">
                    {t.name}{' '}
                    <span className="font-normal text-muted-foreground">
                      (pass ≥ {t.threshold})
                    </span>
                  </dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{t.description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Evals run via{' '}
              <a
                href="https://github.com/EleutherAI/lm-evaluation-harness"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                EleutherAI lm-evaluation-harness
              </a>{' '}
              against the inference server&apos;s OpenAI-compatible endpoint. Selection covers the{' '}
              <strong className="text-foreground">highest and median concurrency</strong> per
              (model, runner, framework, precision, ISL, OSL, spec-decoding, dp-attn) on the{' '}
              <strong className="text-foreground">8k/1k</strong> sequence length pair only. Pass
              thresholds are committed in{' '}
              <a
                href={`${REPO_URL}/blob/main/utils/evals/thresholds.json`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                <code className="font-mono text-xs">utils/evals/thresholds.json</code>
              </a>
              ; results below threshold fail the workflow but do not block the dashboard.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Per-eval reported metrics: <code className="font-mono text-xs">score</code>,{' '}
              <code className="font-mono text-xs">em_strict</code>,{' '}
              <code className="font-mono text-xs">em_flexible</code>,{' '}
              <code className="font-mono text-xs">n_eff</code>,{' '}
              <code className="font-mono text-xs">task</code>.
            </p>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="glossary" eyebrow="09" title="Glossary" />
            <div className="space-y-6">
              {GLOSSARY_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </h3>
                  <dl className="divide-y divide-border/60">
                    {group.terms.map((t) => (
                      <div key={t.term} className="grid gap-2 py-3 sm:grid-cols-[10rem_1fr]">
                        <dt className="font-medium text-foreground" id={t.id}>
                          {t.term}
                        </dt>
                        <dd className="text-sm leading-6 text-muted-foreground">{t.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="caveats" eyebrow="10" title="Caveats" />
            <p className="text-sm leading-6 text-muted-foreground mb-4">
              Things to keep in mind when interpreting numbers on the dashboard.
            </p>
            <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
              {CAVEATS.map((c) => (
                <li key={c.title}>
                  <strong className="text-foreground">{c.title}.</strong> {c.body}
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="official" eyebrow="11" title="Official vs unofficial results" />
            <p className="text-sm leading-6 text-muted-foreground">
              Only{' '}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                {GITHUB_REPO_FULL}
              </a>{' '}
              contains official InferenceX™ results, ingested into the database that powers this
              dashboard. Forks running the same recipes on different machines or clouds may produce
              different numbers because of host CPU, networking, NUMA layout, BIOS, driver version,
              or thermal envelope. Such numbers must be explicitly labeled as unofficial.
            </p>
          </Card>
        </section>

        <section>
          <Card>
            <SectionHeading id="references" eyebrow="12" title="References" />
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href="/blog/inferencemax-open-source-inference-benchmarking"
                  className="text-brand hover:underline"
                >
                  InferenceX v1: Open Source Continuous Inference Benchmarking
                </Link>
                . Original methodology writeup.
              </li>
              <li>
                <Link
                  href="/blog/inferencex-v2-nvidia-blackwell-vs-amd-vs-hopper"
                  className="text-brand hover:underline"
                >
                  InferenceX v2: Blackwell vs AMD vs Hopper
                </Link>
                . Disaggregated serving, wide-EP, MTP, scale-up vs scale-out tradeoffs.
              </li>
              <li>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  {GITHUB_REPO_FULL}
                </a>
                . Benchmark recipes, configs, workflows.
              </li>
              <li>
                <a
                  href={APP_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  {GITHUB_OWNER}/{GITHUB_REPO}-app
                </a>
                . Dashboard source, including{' '}
                <code className="font-mono text-xs">chart-utils.ts</code> with all derived-metric
                formulas.
              </li>
              <li>
                <a
                  href="https://semianalysis.com/ai-cloud-tco-model/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  SemiAnalysis AI Cloud TCO Model
                </a>
                . Per-GPU TCO inputs.
              </li>
              <li>
                <a
                  href="https://semianalysis.com/datacenter-industry-model/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  SemiAnalysis AI Datacenter Industry Model
                </a>
                . All-in utility power inputs.
              </li>
              <li>
                <Link href="/about" className="text-brand hover:underline">
                  About InferenceX
                </Link>
                . Supported hardware, models, frameworks, and FAQ.
              </li>
            </ul>
          </Card>
        </section>
      </div>
    </main>
  );
}
