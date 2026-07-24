'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Card } from '@/components/ui/card';
import { track } from '@/lib/analytics';
import { navigateInApp } from '@/lib/client-navigation';
import type { Locale } from '@/lib/i18n';

interface WorkflowEntry {
  href: string;
  label: string;
  description: string;
}

const STRINGS: Record<Locale, { heading: string; subheading: string; workflow: WorkflowEntry[] }> =
  {
    en: {
      heading: 'MLOps Team Dashboard',
      subheading:
        "Self-hosted inference benchmark for the VNGCloud / GreenNode team. Pick the tab that matches what you're doing.",
      workflow: [
        {
          href: '/live-check',
          label: 'Pipelines',
          description:
            "What's currently live on already-deployed inference stacks — metadata drift, tool-calling correctness, and a live throughput sweep, refreshed on every deploy.",
        },
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
      ],
    },
    zh: {
      heading: 'MLOps 团队仪表板',
      subheading:
        'VNGCloud / GreenNode 团队的自托管推理基准测试平台。选择与您当前工作对应的标签页。',
      workflow: [
        {
          href: '/live-check',
          label: '流水线',
          description:
            '查看已部署推理栈的实时状态——元数据漂移、工具调用（tool-calling）正确性，以及每次部署后触发的实时吞吐量扫描。',
        },
        {
          href: '/inference',
          label: '推理性能',
          description:
            '挑选一套服务配置进行部署。跨硬件、框架、精度与并行策略对比吞吐量-延迟前沿（frontier）。',
        },
        {
          href: '/evaluation',
          label: '配方对比',
          description:
            '在同一部署上对比运行时参数（MTP 层数、推测解码、KV 缓存数据类型等）：加速比、TPOT、接受率、准确率差异一目了然。',
        },
        {
          href: '/historical',
          label: '历史趋势',
          description: '固定配置下的周环比吞吐量。通过 PR 级别的变更日志追踪软件改进与回归。',
        },
        {
          href: '/calculator',
          label: 'TCO 计算器',
          description: '容量 × 成本估算。给定 QPS 与 SLO，估算所需 GPU 数量及部署成本。',
        },
        {
          href: '/gpu-specs',
          label: 'GPU 规格',
          description: '我们所测试 GPU 的 FLOPS、显存带宽与每小时价格（$/hr）参考卡片。',
        },
      ],
    },
  };

export function LandingPage({ locale = 'en' }: { locale?: Locale } = {}) {
  const router = useRouter();
  const t = STRINGS[locale];
  // Internal links stay within the current language tree.
  const prefix = locale === 'zh' ? '/zh' : '';

  useEffect(() => {
    track('landing_page_viewed');
  }, []);

  return (
    <main className="relative">
      <div className="container mx-auto px-4 lg:px-8 flex flex-col gap-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl lg:text-3xl font-semibold">{t.heading}</h1>
          <p className="text-sm text-muted-foreground">{t.subheading}</p>
        </header>

        <section className="flex flex-col gap-3">
          {t.workflow.map((entry) => {
            const href = `${prefix}${entry.href}`;
            const slug = entry.href.slice(1).replaceAll('-', '_');
            return (
              <Card key={entry.href}>
                <Link
                  href={href}
                  onClick={(e) => {
                    track(`landing_${slug}_clicked`);
                    navigateInApp(e, router, href);
                  }}
                  className="group flex items-start justify-between gap-4"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-lg font-semibold transition-colors group-hover:text-brand">
                      {entry.label}
                    </span>
                    <span className="text-sm text-muted-foreground">{entry.description}</span>
                    <span className="mt-1 font-mono text-xs text-muted-foreground/70">{href}</span>
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
