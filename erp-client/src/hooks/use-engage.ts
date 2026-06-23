'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  ConnectedGoogleAccountDto,
  EngageReplyListDto,
  EngageScanResultDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Engage · ERP-direct Gmail reply triage. Every call is mailbox-aware: an
// `accountId` selects WHICH connected inbox to read/act on (a central operator can
// triage a colleague's inbox), or is omitted to use the org default mailbox.

// The org's connected Google mailboxes — the data source for the inbox switcher.
export function useEngageAccounts() {
  return useQuery<ConnectedGoogleAccountDto[], ApiError>({
    queryKey: queryKeys.engage.accounts(),
    queryFn: ({ signal }) => api.engage.accounts(signal),
    staleTime: 60_000,
  });
}

// The queue for ONE inbox. Refetches on focus so a freshly-arrived reply shows
// without a manual scan; the staleTime keeps quick tab switches from re-hitting
// Google. Disabled until an account is selected.
export function useEngageReplies(accountId: string | undefined) {
  return useQuery<EngageReplyListDto, ApiError>({
    queryKey: queryKeys.engage.replies(accountId),
    queryFn: ({ signal }) => api.engage.replies(accountId, signal),
    enabled: !!accountId,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

// "Scan inbox" — read recent replies for the selected mailbox now, classify +
// draft, then refresh that inbox's queue. Toasts the per-bucket counts (or the
// not-connected hint).
export function useScanReplies() {
  const qc = useQueryClient();
  const t = useTranslations('engage');
  return useMutation<EngageScanResultDto, ApiError, string | undefined>({
    mutationFn: (accountId) => api.engage.scan(accountId),
    onSuccess: (res, accountId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.engage.replies(accountId) });
      if (!res.configured) {
        // Show the precise server reason when present (e.g. "no Gmail access",
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

// Approve & send a reply via the selected Gmail mailbox. The endpoint returns the
// refreshed queue, so seed that inbox's cache from it directly (the sent row drops
// out) — no extra refetch.
export function useSendReply() {
  const qc = useQueryClient();
  const t = useTranslations('engage');
  return useMutation<
    EngageReplyListDto,
    ApiError,
    { id: string; text: string; accountId?: string }
  >({
    mutationFn: ({ id, text, accountId }) => api.engage.send(id, text, accountId),
    onSuccess: (list, { accountId }) => {
      qc.setQueryData(queryKeys.engage.replies(accountId), list);
      toast.success(t('send.sent'));
    },
    onError: (err) => toast.error(t('send.failed', { message: err.message })),
  });
}

// Re-draft a reply (re-run Claude on the same inbound). Seeds that inbox's cache
// from the returned queue and invalidates as a belt-and-braces refresh.
export function useRedraftReply() {
  const qc = useQueryClient();
  const t = useTranslations('engage');
  return useMutation<
    EngageReplyListDto,
    ApiError,
    { id: string; accountId?: string }
  >({
    mutationFn: ({ id, accountId }) => api.engage.redraft(id, accountId),
    onSuccess: (list, { accountId }) => {
      qc.setQueryData(queryKeys.engage.replies(accountId), list);
      void qc.invalidateQueries({ queryKey: queryKeys.engage.replies(accountId) });
      toast.success(t('redraft.done'));
    },
    onError: (err) => toast.error(t('redraft.failed', { message: err.message })),
  });
}
