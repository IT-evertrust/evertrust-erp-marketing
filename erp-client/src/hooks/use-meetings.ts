'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CalendarFreeSlotsDto,
  CalendarUpcomingDto,
  MeetingDto,
  MeetingSyncResultDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export type MeetingFilters = {
  campaignId?: string;
  ae?: string;
  persona?: string;
  search?: string;
  bucket?: string;
};

export type CalendarRangeParams = {
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  durationMinutes?: number;
};

type CalendarUpcomingParams = Pick<CalendarRangeParams, 'timeMin' | 'timeMax' | 'timeZone'>;

type CalendarUpcomingApi = (
  params?: CalendarUpcomingParams,
  signal?: AbortSignal,
) => Promise<CalendarUpcomingDto>;

type CalendarFreeSlotsApi = (
  params?: CalendarRangeParams,
  signal?: AbortSignal,
) => Promise<CalendarFreeSlotsDto>;

function normalizeCalendarUpcomingParams(params: CalendarRangeParams = {}): CalendarUpcomingParams {
  return {
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    timeZone: params.timeZone,
  };
}

function normalizeCalendarFreeSlotsParams(params: CalendarRangeParams = {}): CalendarRangeParams {
  return {
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    timeZone: params.timeZone,
    durationMinutes: params.durationMinutes,
  };
}

function calendarUpcomingQueryKey(params: CalendarRangeParams = {}) {
  return [
    ...queryKeys.meetings.calendarUpcoming(),
    normalizeCalendarUpcomingParams(params),
  ] as const;
}

function calendarFreeSlotsQueryKey(params: CalendarRangeParams = {}) {
  return [
    ...queryKeys.meetings.calendarFreeSlots(),
    normalizeCalendarFreeSlotsParams(params),
  ] as const;
}

// Sales-Agent meetings synced from n8n. The page filters client-side (small
// per-org volume), so the list is fetched once; mutations invalidate it.
export function useMeetings(filters: MeetingFilters = {}) {
  return useQuery<MeetingDto[], ApiError>({
    queryKey: queryKeys.meetings.list(filters),
    queryFn: ({ signal }) => api.meetings.list(filters, signal),
  });
}

export function useSyncMeetings() {
  const qc = useQueryClient();

  return useMutation<MeetingSyncResultDto, ApiError, void>({
    mutationFn: () => api.meetings.sync(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.meetings.all }),
  });
}

export function useLinkMeeting() {
  const qc = useQueryClient();

  return useMutation<MeetingDto, ApiError, { id: string; campaignId: string | null }>({
    mutationFn: ({ id, campaignId }) => api.meetings.link(id, campaignId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.meetings.all }),
  });
}

// Re-analyze a meeting under a chosen persona (runs on the n8n Sales Agent
// workflow: OpenAI GPT-5-mini + the Drive persona of that name).
export function useAnalyzeMeeting() {
  const qc = useQueryClient();

  return useMutation<MeetingDto, ApiError, { id: string; persona: string }>({
    mutationFn: ({ id, persona }) => api.meetings.analyze(id, persona),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.meetings.all }),
  });
}

// Delete a meeting (e.g. a stale/test row that has no Drive counterpart).
export function useDeleteMeeting() {
  const qc = useQueryClient();

  return useMutation<{ id: string }, ApiError, string>({
    mutationFn: (id) => api.meetings.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.meetings.all }),
  });
}

// Activate · Meeting Booker: real events from the org's connected Google
// Calendar. Accepts a visible calendar range so the backend fetches the same
// week that the UI is showing instead of only fetching today/default data.
export function useCalendarUpcoming(params: CalendarRangeParams = {}) {
  const normalizedParams = normalizeCalendarUpcomingParams(params);

  return useQuery<CalendarUpcomingDto, ApiError>({
    queryKey: calendarUpcomingQueryKey(params),
    queryFn: ({ signal }) => {
      const calendarUpcoming = api.meetings.calendarUpcoming as unknown as CalendarUpcomingApi;

      return calendarUpcoming(normalizedParams, signal);
    },
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}

// Activate · Meeting Booker: proposed free slots from the same connected
// Google Calendar. Accepts the same visible range as upcoming events, plus
// durationMinutes for the slot length.
export function useCalendarFreeSlots(params: CalendarRangeParams = {}) {
  const normalizedParams = normalizeCalendarFreeSlotsParams(params);

  return useQuery<CalendarFreeSlotsDto, ApiError>({
    queryKey: calendarFreeSlotsQueryKey(params),
    queryFn: ({ signal }) => {
      const calendarFreeSlots = api.meetings.calendarFreeSlots as unknown as CalendarFreeSlotsApi;

      return calendarFreeSlots(normalizedParams, signal);
    },
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}
