'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { EngageReplyListDto, EngageScanResultDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Engage · ERP-direct Gmail reply triage. The queue is read straight from the
// org's connected default Gmail mailbox (no n8n) — classified + drafted by
// Claude. Refetches on focus so a freshly-arrived reply shows without a manual
// scan; the staleTime keeps quick tab switches from re-hitting Google.
export function useEngageReplies() {
  return useQuery<EngageReplyListDto, ApiError>({
    queryKey: queryKeys.engage.replies(),
    queryFn: ({ signal }) => api.engage.replies(signal),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

// "Scan inbox" — read recent replies now, classify + draft, then refresh the
// queue. Toasts the per-bucket counts (or the not-connected hint).
export function useScanReplies() {
  const qc = useQueryClient();
  const t = useTranslations('engage');
  return useMutation<EngageScanResultDto, ApiError, void>({
    mutationFn: () => api.engage.scan(),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: queryKeys.engage.all });
      if (!res.configured) {
        // Show the precise server reason when present (e.g. "no Calendar access",
        // "token could not be refreshed — reconnect"), else the generic hint.
        toast.error(res.reason ?? t('scan.notConfigured'));
        return;
      }
      toast.success(
        t('scan.done', {
          scanned: res.scanned,
          interested: res.interested,
          unsure: res.unsure,
          notInterested: res.notInterested,
          drafted: res.drafted,
        }),
      );
    },
    onError: (err) => toast.error(t('scan.failed', { message: err.message })),
  });
}

// Approve & send a reply via Gmail. The endpoint returns the refreshed queue, so
// seed the cache from it directly (the sent row drops out) — no extra refetch.
export function useSendReply() {
  const qc = useQueryClient();
  const t = useTranslations('engage');
  return useMutation<EngageReplyListDto, ApiError, { id: string; text: string }>({
    mutationFn: ({ id, text }) => api.engage.send(id, text),
    onSuccess: (list) => {
      qc.setQueryData(queryKeys.engage.replies(), list);
      toast.success(t('send.sent'));
    },
    onError: (err) => toast.error(t('send.failed', { message: err.message })),
  });
}

// Re-draft a reply (re-run Claude on the same inbound). Seeds the cache from the
// returned queue and invalidates as a belt-and-braces refresh.
export function useRedraftReply() {
  const qc = useQueryClient();
  const t = useTranslations('engage');
  return useMutation<EngageReplyListDto, ApiError, { id: string }>({
    mutationFn: ({ id }) => api.engage.redraft(id),
    onSuccess: (list) => {
      qc.setQueryData(queryKeys.engage.replies(), list);
      void qc.invalidateQueries({ queryKey: queryKeys.engage.all });
      toast.success(t('redraft.done'));
    },
    onError: (err) => toast.error(t('redraft.failed', { message: err.message })),
  });
}
