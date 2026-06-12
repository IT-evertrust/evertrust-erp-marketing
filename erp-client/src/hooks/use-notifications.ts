'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// The topbar bell feed: unread notifications, newest-first, capped at 20. Polled
// every 30s so a new n8n→ERP notification surfaces without a manual refresh. Only
// runs while `enabled` (i.e. an authenticated shell is mounted).
export function useUnreadNotifications(enabled = true) {
  return useQuery<NotificationDto[], ApiError>({
    queryKey: queryKeys.notifications.unread(),
    queryFn: ({ signal }) => api.notifications.listUnread(signal),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
}

// Mark a single notification read. Optimistically drops it from the unread feed so
// the count + list update instantly; re-fetches on settle for authority.
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const key = queryKeys.notifications.unread();
  return useMutation<
    void,
    ApiError,
    string,
    { previous?: NotificationDto[] }
  >({
    mutationFn: (id) => api.notifications.markRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationDto[]>(key);
      if (previous) {
        queryClient.setQueryData<NotificationDto[]>(
          key,
          previous.filter((n) => n.id !== id),
        );
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}

// Mark every currently-unread notification read. PATCHes each in parallel (there's
// no bulk endpoint), optimistically clearing the feed; settles with a re-fetch.
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const key = queryKeys.notifications.unread();
  return useMutation<void, ApiError, void, { previous?: NotificationDto[] }>({
    mutationFn: async () => {
      const current = queryClient.getQueryData<NotificationDto[]>(key) ?? [];
      await Promise.all(current.map((n) => api.notifications.markRead(n.id)));
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationDto[]>(key);
      queryClient.setQueryData<NotificationDto[]>(key, []);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}
