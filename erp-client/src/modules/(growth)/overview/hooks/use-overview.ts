'use client';

import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import type { CampaignDto, MeetingDto } from '@evertrust/shared';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useMeetings } from '@/hooks/use-meetings';
import { API_URL } from '@/lib/env';

import {
  FALLBACK_ACTIVITY,
  FALLBACK_FUNNEL,
  FALLBACK_KPIS,
} from '../constant';

import type {
  EngineActivityItem,
  EngineAlert,
  FunnelStage,
  FunnelStageKey,
  OverviewKpi,
  OverviewKpiKey,
} from '../types';

type OverviewActivityResponse = {
  activity: EngineActivityItem[];
  alerts: EngineAlert[];
};

// The real metrics endpoint. KPIs/funnel arrive as display-ready strings; the
// components keep rendering their i18n labels, so we only adopt the live numbers.
type OverviewMetricsKpi = {
  label: string;
  value: string;
  delta: string;
  spark: string;
};

type OverviewMetricsFunnelStage = {
  name: string;
  value: string;
  width: number;
  conversion: string;
};

type OverviewMetricsResponse = {
  kpis: OverviewMetricsKpi[];
  funnel: OverviewMetricsFunnelStage[];
};

// Fixed order the backend returns its 6 KPIs in — used to re-attach the stable
// i18n label keys the cards render with (so backend `label` strings stay unused
// and the copy remains locale-driven).
const KPI_KEY_ORDER: OverviewKpiKey[] = [
  'newLeads',
  'contacted',
  'replyRate',
  'interested',
  'meetings',
  'pipelineValue',
];

// Fixed order of the backend's 5 funnel stages (Reach/Engage/Activate/Nurture/Won).
const FUNNEL_KEY_ORDER: FunnelStageKey[] = [
  'reach',
  'engage',
  'activate',
  'nurture',
  'won',
];

// The live cross-system KPIs + R-E-A-N funnel from the backend. Polled like the
// activity feed; falls back to the client-synthesized values if it errors.
function useOverviewMetrics() {
  return useQuery<OverviewMetricsResponse, Error>({
    queryKey: ['growth', 'overview', 'metrics'],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${API_URL}/growth/overview`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!res.ok) throw new Error(`overview metrics -> ${res.status}`);
      return (await res.json()) as OverviewMetricsResponse;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// Map the backend KPI rows onto the key-based shape the cards expect, preserving
// the i18n label keys by index. Empty input -> [] so the grid renders nothing.
function mapMetricsKpis(rows: OverviewMetricsKpi[] | undefined): OverviewKpi[] {
  if (!rows || rows.length === 0) return [];
  return rows.map((row, index) => ({
    labelKey: KPI_KEY_ORDER[index] ?? 'pipelineValue',
    value: row.value,
    delta: row.delta,
    spark: row.spark,
  }));
}

function mapMetricsFunnel(
  rows: OverviewMetricsFunnelStage[] | undefined,
): FunnelStage[] {
  if (!rows || rows.length === 0) return [];
  return rows.map((row, index) => ({
    nameKey: FUNNEL_KEY_ORDER[index] ?? 'won',
    value: row.value,
    width: row.width,
    conversion: row.conversion,
  }));
}

// The real cross-system Engine Activity feed + alerts from the backend. Polled so the
// dashboard stays roughly live; falls back to the client-synthesized feed if it errors.
function useEngineActivity() {
  return useQuery<OverviewActivityResponse, Error>({
    queryKey: ['growth', 'overview', 'activity'],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${API_URL}/growth/overview/activity`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!res.ok) throw new Error(`overview activity -> ${res.status}`);
      return (await res.json()) as OverviewActivityResponse;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function numberFormat(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function buildKpis(
  campaigns: CampaignDto[],
  meetings: MeetingDto[],
): OverviewKpi[] {
  if (campaigns.length === 0 && meetings.length === 0) {
    return FALLBACK_KPIS;
  }

  const activeCampaigns = campaigns.filter(
    (campaign) => campaign.lifecycle === 'ACTIVE',
  ).length;

  const analyzedMeetings = meetings.filter(
    (meeting) => meeting.analysis != null,
  ).length;

  const replyRate = percent(meetings.length, Math.max(1, campaigns.length));

  return [
    {
      labelKey: 'newLeads',
      value: numberFormat(campaigns.length),
      delta: 'live',
      spark: FALLBACK_KPIS[0]?.spark ?? '',
    },
    {
      labelKey: 'contacted',
      value: numberFormat(activeCampaigns),
      delta: 'active',
      spark: FALLBACK_KPIS[1]?.spark ?? '',
    },
    {
      labelKey: 'replyRate',
      value: `${replyRate}%`,
      delta: 'from meetings',
      spark: FALLBACK_KPIS[2]?.spark ?? '',
    },
    {
      labelKey: 'interested',
      value: numberFormat(meetings.length),
      delta: 'meeting intent',
      spark: FALLBACK_KPIS[3]?.spark ?? '',
    },
    {
      labelKey: 'meetings',
      value: numberFormat(meetings.length),
      delta: `${analyzedMeetings} analyzed`,
      spark: FALLBACK_KPIS[4]?.spark ?? '',
    },
    {
      labelKey: 'pipelineValue',
      value: '—',
      delta: 'needs deals API',
      spark: FALLBACK_KPIS[5]?.spark ?? '',
    },
  ];
}

function buildFunnel(
  campaigns: CampaignDto[],
  meetings: MeetingDto[],
): FunnelStage[] {
  const reach = campaigns.length;
  const engage = campaigns.filter(
    (campaign) => campaign.lifecycle === 'ACTIVE',
  ).length;
  const activate = meetings.length;
  const nurture = meetings.filter((meeting) => meeting.analysis != null).length;

  if (reach === 0 && activate === 0) {
    return FALLBACK_FUNNEL;
  }

  const top = Math.max(1, reach);

  return [
    {
      nameKey: 'reach',
      value: numberFormat(reach),
      width: reach ? 100 : 0,
      conversion: reach ? '100%' : '0%',
    },
    {
      nameKey: 'engage',
      value: numberFormat(engage),
      width: percent(engage, top),
      conversion: `${percent(engage, top)}%`,
    },
    {
      nameKey: 'activate',
      value: numberFormat(activate),
      width: percent(activate, top),
      conversion: `${percent(activate, top)}%`,
    },
    {
      nameKey: 'nurture',
      value: numberFormat(nurture),
      width: percent(nurture, top),
      conversion: `${percent(nurture, top)}%`,
    },
    {
      nameKey: 'won',
      value: '—',
      width: 0,
      conversion: '—',
    },
  ];
}

function buildActivity(
  campaigns: CampaignDto[],
  meetings: MeetingDto[],
): EngineActivityItem[] {
  const feed: Array<EngineActivityItem & { sortTs: number }> = [];

  for (const campaign of campaigns) {
    const ts = Date.parse(campaign.activatedAt ?? campaign.createdAt);

    if (Number.isNaN(ts)) continue;

    const name = campaign.name?.trim() || campaign.project || 'Unnamed campaign';

    feed.push({
      sortTs: ts,
      time: new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ts)),
      source:
        campaign.lifecycle === 'ACTIVE'
          ? 'REACH · SENDER'
          : 'REACH · SCRAPER',
      message:
        campaign.lifecycle === 'ACTIVE'
          ? `${name} is active in campaign`
          : `${name} created`,
    });
  }

  for (const meeting of meetings) {
    const ts = Date.parse(meeting.meetingDate ?? meeting.createdAt);

    if (Number.isNaN(ts)) continue;

    const company = meeting.clientCompany?.trim() || 'Prospect';

    feed.push({
      sortTs: ts,
      time: new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ts)),
      source: meeting.analysis ? 'ACTIVATE · READ AI' : 'ACTIVATE · BOOKER',
      message: meeting.analysis
        ? `Analysis created for ${company}`
        : `Meeting booked: ${company}`,
    });
  }

  const realFeed = feed.sort((a, b) => b.sortTs - a.sortTs).slice(0, 8);

  if (realFeed.length === 0) {
    return FALLBACK_ACTIVITY;
  }

  return realFeed.map(({ sortTs: _sortTs, ...item }) => item);
}

export function useOverview() {
  const campaigns = useCampaigns();
  const meetings = useMeetings();
  const engine = useEngineActivity();
  const metrics = useOverviewMetrics();

  const campaignRows = campaigns.data ?? [];
  const meetingRows = meetings.data ?? [];

  // Real backend KPIs/funnel (mapped onto the key-based shape the components want).
  const serverKpis = useMemo(
    () => mapMetricsKpis(metrics.data?.kpis),
    [metrics.data?.kpis],
  );
  const serverFunnel = useMemo(
    () => mapMetricsFunnel(metrics.data?.funnel),
    [metrics.data?.funnel],
  );

  // Client-synthesized KPIs/funnel — the graceful fallback while the real
  // endpoint is loading or if it errors, so the cards are never blank.
  const clientKpis = useMemo(
    () => buildKpis(campaignRows, meetingRows),
    [campaignRows, meetingRows],
  );
  const clientFunnel = useMemo(
    () => buildFunnel(campaignRows, meetingRows),
    [campaignRows, meetingRows],
  );

  const kpis = serverKpis.length > 0 ? serverKpis : clientKpis;
  const funnel = serverFunnel.length > 0 ? serverFunnel : clientFunnel;

  // Prefer the real backend feed; fall back to the client-synthesized one if it's
  // unavailable or empty (so the card is never blank).
  const clientActivity = useMemo(
    () => buildActivity(campaignRows, meetingRows),
    [campaignRows, meetingRows],
  );
  const serverActivity = engine.data?.activity ?? [];
  const activity = serverActivity.length > 0 ? serverActivity : clientActivity;
  const alerts = engine.data?.alerts ?? [];

  // We are genuinely on the hardcoded demo cockpit ONLY when there is no live
  // endpoint data AND nothing real to synthesize from (no campaigns/meetings). If
  // any real data is on screen — even client-synthesized because the metrics
  // endpoint errored — we are NOT on fallback, so we must not show the scary
  // "showing fallback metrics" banner (that mismatch is what confused users).
  const usingFallback =
    serverKpis.length === 0 &&
    serverFunnel.length === 0 &&
    serverActivity.length === 0 &&
    campaignRows.length === 0 &&
    meetingRows.length === 0;

  return {
    kpis,
    funnel,
    activity,
    alerts,
    isLoading: campaigns.isLoading || meetings.isLoading || metrics.isLoading,
    isError: campaigns.isError || meetings.isError || metrics.isError,
    // Drives the "showing fallback cockpit metrics" notice — true only when the
    // displayed numbers are the hardcoded demo set, never when real data is shown.
    usingFallback,
  };
}