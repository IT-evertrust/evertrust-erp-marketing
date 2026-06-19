'use client';

import { useMemo } from 'react';

import type { CampaignDto, MeetingDto } from '@evertrust/shared';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useMeetings } from '@/hooks/use-meetings';

import {
  FALLBACK_ACTIVITY,
  FALLBACK_FUNNEL,
  FALLBACK_KPIS,
} from '../constant';

import type {
  EngineActivityItem,
  FunnelStage,
  OverviewKpi,
} from '../types';

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
      label: 'NEW LEADS',
      value: numberFormat(campaigns.length),
      delta: 'live',
      spark: FALLBACK_KPIS[0].spark,
    },
    {
      label: 'CONTACTED',
      value: numberFormat(activeCampaigns),
      delta: 'active',
      spark: FALLBACK_KPIS[1].spark,
    },
    {
      label: 'REPLY RATE',
      value: `${replyRate}%`,
      delta: 'from meetings',
      spark: FALLBACK_KPIS[2].spark,
    },
    {
      label: 'INTERESTED',
      value: numberFormat(meetings.length),
      delta: 'meeting intent',
      spark: FALLBACK_KPIS[3].spark,
    },
    {
      label: 'MEETINGS',
      value: numberFormat(meetings.length),
      delta: `${analyzedMeetings} analyzed`,
      spark: FALLBACK_KPIS[4].spark,
    },
    {
      label: 'PIPELINE VALUE',
      value: '—',
      delta: 'needs deals API',
      spark: FALLBACK_KPIS[5].spark,
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
      name: 'Reach',
      value: numberFormat(reach),
      width: reach ? 100 : 0,
      conversion: reach ? '100%' : '0%',
    },
    {
      name: 'Engage',
      value: numberFormat(engage),
      width: percent(engage, top),
      conversion: `${percent(engage, top)}%`,
    },
    {
      name: 'Activate',
      value: numberFormat(activate),
      width: percent(activate, top),
      conversion: `${percent(activate, top)}%`,
    },
    {
      name: 'Nurture',
      value: numberFormat(nurture),
      width: percent(nurture, top),
      conversion: `${percent(nurture, top)}%`,
    },
    {
      name: 'Won',
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
  const feed: Array<EngineActivityItem & { at: number }> = [];

  for (const campaign of campaigns) {
    const ts = Date.parse(campaign.activatedAt ?? campaign.createdAt);

    if (Number.isNaN(ts)) continue;

    const name = campaign.name?.trim() || campaign.project || 'Unnamed campaign';

    feed.push({
      at: ts,
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
      at: ts,
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

  const realFeed = feed.sort((a, b) => b.at - a.at).slice(0, 8);

  if (realFeed.length === 0) {
    return FALLBACK_ACTIVITY;
  }

  return realFeed.map(({ at: _at, ...item }) => item);
}

export function useOverview() {
  const campaigns = useCampaigns();
  const meetings = useMeetings();

  const campaignRows = campaigns.data ?? [];
  const meetingRows = meetings.data ?? [];

  const kpis = useMemo(
    () => buildKpis(campaignRows, meetingRows),
    [campaignRows, meetingRows],
  );

  const funnel = useMemo(
    () => buildFunnel(campaignRows, meetingRows),
    [campaignRows, meetingRows],
  );

  const activity = useMemo(
    () => buildActivity(campaignRows, meetingRows),
    [campaignRows, meetingRows],
  );

  return {
    kpis,
    funnel,
    activity,
    isLoading: campaigns.isLoading || meetings.isLoading,
    isError: campaigns.isError || meetings.isError,
  };
}