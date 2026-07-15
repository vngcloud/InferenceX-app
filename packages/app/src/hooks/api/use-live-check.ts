import { useQuery } from '@tanstack/react-query';

import { fetchLiveCheck } from '@/lib/api';

export function useLiveCheck() {
  return useQuery({
    queryKey: ['live-check'],
    queryFn: ({ signal }) => fetchLiveCheck(signal),
  });
}
