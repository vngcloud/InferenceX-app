import type { Metadata } from 'next';

import { tabMetadata } from '@/lib/tab-meta';
import { LiveCheckContent } from '@/components/live-check/live-check-content';

export const metadata: Metadata = tabMetadata('live-check');

export default function LiveCheckPage() {
  return <LiveCheckContent />;
}
