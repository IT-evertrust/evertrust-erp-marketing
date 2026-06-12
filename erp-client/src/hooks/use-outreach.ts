'use client';

import { useQuery } from '@tanstack/react-query';
import type { OutreachMessageDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// A prospect's outreach conversation timeline (the message ledger, newest-first).
// `enabled` gates the fetch so it only fires when a prospect is selected (drawer
// open / draft expanded).
export function useOutreachThread(prospectId: string | null, enabled = true) {
  return useQuery<OutreachMessageDto[], ApiError>({
    queryKey: queryKeys.outreachThread.byProspect(prospectId ?? 'none'),
    queryFn: ({ signal }) => api.outreach.thread(prospectId as string, signal),
    enabled: enabled && !!prospectId,
  });
}
