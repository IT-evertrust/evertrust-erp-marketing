'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignmentDto,
  AssignTenderDto,
  CreateTenderDto,
  DocumentDto,
  ListTendersQuery,
  TenderDeadlineRiskDto,
  TenderDto,
  TransitionTenderDto,
  UpdateTenderDto,
  UploadDocumentDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// List of tenders for the current tenant, optionally filtered by status. The
// query key includes the filter so each filter is cached independently.
export function useTenders(query?: ListTendersQuery) {
  return useQuery<TenderDto[], ApiError>({
    queryKey: queryKeys.tenders.list(query),
    queryFn: ({ signal }) => api.tenders.list(query, signal),
  });
}

// A single tender by id. `enabled` is off for a falsy id so the detail page can
// call it unconditionally while route params resolve.
export function useTender(id: string | undefined) {
  return useQuery<TenderDto, ApiError>({
    queryKey: queryKeys.tenders.detail(id ?? ''),
    queryFn: ({ signal }) => api.tenders.get(id as string, signal),
    enabled: Boolean(id),
  });
}

// Phase 6 (R31): the org's deadline at-risk worklist (most urgent first). Polled
// by the dashboard; the same computation the API exposes to n8n for escalation.
export function useDeadlineRisk() {
  return useQuery<TenderDeadlineRiskDto[], ApiError>({
    queryKey: queryKeys.tenders.deadlineRisk(),
    queryFn: ({ signal }) => api.tenders.deadlineRisk(signal),
  });
}

// Create. Invalidates every tenders list so the new row appears on next view.
export function useCreateTender() {
  const queryClient = useQueryClient();
  return useMutation<TenderDto, ApiError, CreateTenderDto>({
    mutationFn: (input) => api.tenders.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tenders.all });
    },
  });
}

// Patch writable fields. Seeds the detail cache with the fresh row and
// invalidates lists so any list view reflects the edit.
export function useUpdateTender(id: string) {
  const queryClient = useQueryClient();
  return useMutation<TenderDto, ApiError, UpdateTenderDto>({
    mutationFn: (input) => api.tenders.update(id, input),
    onSuccess: (tender) => {
      queryClient.setQueryData(queryKeys.tenders.detail(id), tender);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tenders.list() });
    },
  });
}

// Lifecycle transition. Same cache treatment as update — the status change must
// be reflected in both the detail and every list.
export function useTransitionTender(id: string) {
  const queryClient = useQueryClient();
  return useMutation<TenderDto, ApiError, TransitionTenderDto>({
    mutationFn: (input) => api.tenders.transition(id, input),
    onSuccess: (tender) => {
      queryClient.setQueryData(queryKeys.tenders.detail(id), tender);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tenders.list() });
    },
  });
}

// ---- Phase 4: assignment ----

// The tender's ACTIVE assignment (or null when unassigned). `enabled` off for a
// falsy id so the detail page can call it while route params resolve.
export function useTenderAssignment(id: string | undefined) {
  return useQuery<AssignmentDto | null, ApiError>({
    queryKey: queryKeys.tenders.assignment(id ?? ''),
    queryFn: ({ signal }) => api.tenders.getAssignment(id as string, signal),
    enabled: Boolean(id),
  });
}

// Assign the tender to a PIC. Invalidates the assignment query so the Assignee
// card reflects the new (or superseded) assignment.
export function useAssignTender(id: string) {
  const queryClient = useQueryClient();
  return useMutation<AssignmentDto, ApiError, AssignTenderDto>({
    mutationFn: (input) => api.tenders.assign(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.assignment(id),
      });
    },
  });
}

// ---- Phase 4: TYPE 1 documents ----

// The tender's documents (newest first). Same `enabled` guard as above.
export function useTenderDocuments(id: string | undefined) {
  return useQuery<DocumentDto[], ApiError>({
    queryKey: queryKeys.tenders.documents(id ?? ''),
    queryFn: ({ signal }) => api.tenders.listDocuments(id as string, signal),
    enabled: Boolean(id),
  });
}

// Upload a document to the tender. Invalidates the documents query so the new
// file appears in the list on success.
export function useUploadTenderDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation<
    DocumentDto,
    ApiError,
    { file: File; input: UploadDocumentDto }
  >({
    mutationFn: ({ file, input }) => api.tenders.uploadDocument(id, file, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.documents(id),
      });
    },
  });
}
