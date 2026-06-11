'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRfqDto, RfqDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Phase 5c — Hermes supplier RFQ hooks. The dispatch is recorded server-side
// (status DISPATCHED|FAILED — the webhook is best-effort), so sending always
// resolves with the row; callers branch on row.status rather than catching.

// The RFQs dispatched for a tender (newest-first). `enabled` off for a falsy id.
export function useTenderRfqs(tenderId: string | undefined) {
  return useQuery<RfqDto[], ApiError>({
    queryKey: queryKeys.tenders.rfqs(tenderId ?? ''),
    queryFn: ({ signal }) => api.tenders.listRfqs(tenderId as string, signal),
    enabled: Boolean(tenderId),
  });
}

// Dispatch an RFQ to suppliers. Refreshes the tender's RFQ history on success.
export function useSendRfq(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<RfqDto, ApiError, CreateRfqDto>({
    mutationFn: (input) => api.tenders.sendRfq(tenderId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.rfqs(tenderId),
      });
    },
  });
}
