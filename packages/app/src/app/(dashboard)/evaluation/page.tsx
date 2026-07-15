import type { Metadata } from 'next';

import RecipeComparison from '@/components/evaluation/RecipeComparison';
import { NudgeEngine } from '@/components/nudge-engine';
import { tabMetadata } from '@/lib/tab-meta';

export const metadata: Metadata = tabMetadata('evaluation');

export default function EvaluationPage() {
  return (
    <>
      <RecipeComparison />
      <NudgeEngine scope="evaluation" />
    </>
  );
}
