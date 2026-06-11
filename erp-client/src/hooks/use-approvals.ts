'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApprovalRequestDto,
  CreateApprovalRequestDto,
  DecideApprovalDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Phase 6 customer-approval gate hooks. The approvals query is the SAME authority
// the transition control reads to decide whether →SUBMITTED is unblocked, so both
// the approval card and the lifecycle control share one cache entry and update
// together. Every mutation invalidates the tender's approvals; recording a
// decision also touches the tender detail/list so the (now un/blocked) submit
// affordance re-renders.

// The tender's approval requests (newest-first). `enabled` off for a falsy id so
// the detail page can call it while route params resolve.
export function useTenderApprovals(tenderId: string | undefined) {
  return useQuery<ApprovalRequestDto[], ApiError>({
    queryKey: queryKeys.tenders.approvals(tenderId ?? ''),
    queryFn: ({ signal }) =>
      api.tenders.listApprovals(tenderId as string, signal),
    enabled: Boolean(tenderId),
  });
}

// Open a PENDING approval request on the tender. Invalidates the approvals query
// so the card reflects the new request. Also refreshes the Phase 7 submission
// readiness — opening a QC request makes QC required there.
export function useRequestApproval(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<ApprovalRequestDto, ApiError, CreateApprovalRequestDto>({
    mutationFn: (input) => api.tenders.requestApproval(tenderId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.approvals(tenderId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.submission(tenderId),
      });
    },
  });
}

// Record a decision (APPROVED | REJECTED) on an approval. Invalidates the
// approvals query (the gate state) AND the tender detail/list, since an APPROVED
// customer decision is what unblocks the →SUBMITTED transition affordance.
export function useDecideApproval(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    ApprovalRequestDto,
    ApiError,
    { approvalId: string; input: DecideApprovalDto }
  >({
    mutationFn: ({ approvalId, input }) =>
      api.approvals.decide(approvalId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.approvals(tenderId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.detail(tenderId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.list(),
      });
      // A customer OR QC decision changes the submission gate state.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.submission(tenderId),
      });
    },
  });
}
