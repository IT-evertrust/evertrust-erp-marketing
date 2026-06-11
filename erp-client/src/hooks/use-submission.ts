'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubmissionReceiptDto, SubmitTenderDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Phase 7 — submission readiness + the submit act. The readiness query is the SAME
// authority the API's submit() enforces (gate state + QC requirement), so the card
// and the server cannot drift.

// The tender's submission readiness (gate state, QC requirement, file list,
// receipts). `enabled` off for a falsy id while route params resolve.
export function useSubmission(tenderId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tenders.submission(tenderId ?? ''),
    queryFn: ({ signal }) => api.tenders.submission(tenderId as string, signal),
    enabled: Boolean(tenderId),
  });
}

// Record the submission proof. On success the tender becomes SUBMITTED, so refresh
// the submission readiness AND the tender detail/list (status changed).
export function useSubmitTender(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<SubmissionReceiptDto, ApiError, SubmitTenderDto>({
    mutationFn: (input) => api.tenders.submit(tenderId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.submission(tenderId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.detail(tenderId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tenders.list() });
    },
  });
}
