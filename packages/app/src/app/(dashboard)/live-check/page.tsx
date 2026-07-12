import type { Metadata } from 'next';

import LiveCheckDisplay from '@/components/live-check/LiveCheckDisplay';
import { tabMetadata } from '@/lib/tab-meta';

export const metadata: Metadata = tabMetadata('live-check');

export default function LiveCheckPage() {
  return <LiveCheckDisplay />;
}
