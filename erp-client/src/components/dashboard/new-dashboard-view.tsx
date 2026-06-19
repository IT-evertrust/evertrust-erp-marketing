'use client';

import { useMemo } from 'react';
import {
  Activity,
  BarChart3,
  CalendarCheck,
  LayoutGrid,
  MailCheck,
  MessageSquare,
  TrendingUp,
  Users,
} from 'lucide-react';

import type { CampaignDto, MeetingDto } from '@evertrust/shared';
import { AppShell } from '@/components/shell/app-shell';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useMeetings } from '@/hooks/use-meetings';

type Kpi = {
  label: string;
  value: string;
  delta: string;
  spark: string;
};

type FunnelStage = {
  name: string;
  value: string;
  width: number;
  conversion: string;
};

type ActivityItem = {
  time: string;
  source: string;
  message: string;
};

const FALLBACK_KPIS: Kpi[] = [
  {
    label: 'NEW LEADS',
    value: '1,248',
    delta: '+18%',
    spark: '0,18 14,15 28,16 42,11 56,12 70,7 84,8 100,4',
  },
  {
    label: 'CONTACTED',
    value: '980',
    delta: '+12%',
    spark: '0,16 14,14 28,15 42,12 56,10 70,9 84,7 100,6',
  },
  {
    label: 'REPLY RATE',
    value: '21.8%',
    delta: '+3.1 pp',
    spark: '0,15 14,16 28,12 42,13 56,9 70,10 84,7 100,8',
  },
  {
    label: 'INTERESTED',
    value: '86',
    delta: '+9',
    spark: '0,17 14,15 28,14 42,12 56,11 70,9 84,8 100,5',
  },
  {
    label: 'MEETINGS',
    value: '31',
    delta: '+6',
    spark: '0,16 14,16 28,13 42,14 56,10 70,11 84,9 100,7',
  },
  {
    label: 'PIPELINE VALUE',
    value: '€184.5K',
    delta: '+€42K',
    spark: '0,18 14,17 28,15 42,13 56,12 70,8 84,6 100,3',
  },
];

const FALLBACK_ACTIVITY: ActivityItem[] = [
  {
    time: '08:42',
    source: 'REACH · SCRAPER',
    message: '42 new targets captured from iBau + housing',
  },
  {
    time: '08:30',
    source: 'REACH · SENDER',
    message: 'Round 2 follow-up sent to 38 contacts',
  },
  {
    time: '08:11',
    source: 'ENGAGE · SORTER',
    message: '3 replies classified as Interested',
  },
  {
    time: '07:58',
    source: 'ACTIVATE · BOOKER',
    message: 'Meeting booked: GeWoBa Bremen, Thu 14:00',
  },
  {
    time: '07:40',
    source: 'REACH · SCRAPER',
    message: '6 tenant-power tenders detected',
  },
  {
    time: '07:22',
    source: 'REACH · GENERATOR',
    message: '54 email drafts created — awaiting approval',
  },
  {
    time: '07:05',
    source: 'ACTIVATE · RESEARCH',
    message: 'Dossier created for WohnQuartier NRW',
  },
  {
    time: '06:48',
    source: 'NURTURE · PIPELINE',
    message: 'Northern Homebuild Co-op moved to Won',
  },
];

function numberFormat(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function buildFunnel(campaigns: CampaignDto[], meetings: MeetingDto[]): FunnelStage[] {
  const reach = campaigns.length;
  const engage = campaigns.filter((c) => c.lifecycle === 'ACTIVE').length;
  const activate = meetings.length;
  const nurture = meetings.filter((m) => m.analysis != null).length;

  // Use prototype values when there is no real data yet, so the cockpit does not look empty.
  if (reach === 0 && activate === 0) {
    return [
      { name: 'Reach', value: '1,248', width: 100, conversion: '100%' },
      { name: 'Engage', value: '214', width: 42, conversion: '22%' },
      { name: 'Activate', value: '31', width: 16, conversion: '36%' },
      { name: 'Nurture', value: '86', width: 26, conversion: '40%' },
      { name: 'Won', value: '12', width: 9, conversion: '39%' },
    ];
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
): ActivityItem[] {
  const feed: Array<ActivityItem & { at: number }> = [];

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

  if (realFeed.length === 0) return FALLBACK_ACTIVITY;

  return realFeed.map(({ at: _at, ...item }) => item);
}

function buildKpis(campaigns: CampaignDto[], meetings: MeetingDto[]): Kpi[] {
  if (campaigns.length === 0 && meetings.length === 0) return FALLBACK_KPIS;

  const activeCampaigns = campaigns.filter((c) => c.lifecycle === 'ACTIVE').length;
  const analyzedMeetings = meetings.filter((m) => m.analysis != null).length;
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

export function DashboardView() {
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

  return (
    <AppShell>
      <main
        className="min-h-[calc(100vh-64px)] bg-[#eef0f3] px-6 py-5 text-[#15171c]"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        <div className="mb-5 flex items-center justify-between border-b border-[#e4e7eb] pb-5">
          <div className="flex items-center gap-3">
            <LayoutGrid className="h-7 w-7 stroke-[2]" />
            <div>
              <h1 className="text-[30px] font-bold leading-none tracking-[-0.02em]">
                Overview
              </h1>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#959ca7]">
                Report · All phases · Last 30 days
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-[#d6dade] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5b626d] md:flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#15171c]" />
            Engine live
          </div>
        </div>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          {kpis.map((kpi, index) => (
            <KpiCard key={kpi.label} kpi={kpi} iconIndex={index} />
          ))}
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
          <Card title="R.E.A.N Funnel" hint="Reach → Nurture">
            <div className="flex flex-col gap-3">
              {funnel.map((stage) => (
                <FunnelRow key={stage.name} stage={stage} />
              ))}
            </div>
          </Card>

          <Card
            title="Engine Activity"
            hint={
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#15171c]" />
                Live log
              </span>
            }
          >
            <div className="max-h-[420px] overflow-y-auto pr-2">
              {activity.map((item, index) => (
                <ActivityRow key={`${item.time}-${index}`} item={item} />
              ))}
            </div>
          </Card>
        </section>
      </main>
    </AppShell>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[10px] border border-[#e4e7eb] bg-white">
      <div className="flex items-center justify-between border-b border-[#e4e7eb] px-4 py-[15px]">
        <h2 className="text-[13.5px] font-bold leading-none">{title}</h2>
        {hint ? (
          <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
            {hint}
          </div>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function KpiCard({ kpi, iconIndex }: { kpi: Kpi; iconIndex: number }) {
  const icons = [
    Users,
    MailCheck,
    MessageSquare,
    TrendingUp,
    CalendarCheck,
    BarChart3,
  ];

  const Icon = icons[iconIndex] ?? Activity;

  return (
    <article className="min-w-0 rounded-[10px] border border-[#e4e7eb] bg-white px-[15px] py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
          {kpi.label}
        </span>
        <Icon className="h-4 w-4 text-[#959ca7]" />
      </div>

      <div className="mt-2 text-[24px] font-bold leading-none tracking-[-0.02em]">
        {kpi.value}
      </div>

      <div className="mt-2 text-[10.5px] font-bold text-[#5b626d]">
        <span className="text-[#15171c]">▲</span> {kpi.delta}
      </div>

      <svg
        className="mt-2 h-[22px] w-full"
        viewBox="0 0 100 22"
        preserveAspectRatio="none"
      >
        <polyline
          points={kpi.spark}
          fill="none"
          stroke="#5b626d"
          strokeWidth="1.5"
          opacity="0.9"
        />
      </svg>
    </article>
  );
}

function FunnelRow({ stage }: { stage: FunnelStage }) {
  const width = Math.max(0, Math.min(100, stage.width));

  return (
    <div className="grid grid-cols-[108px_1fr_50px] items-center gap-3">
      <span className="text-[12.5px] text-[#5b626d]">{stage.name}</span>

      <div className="relative h-[26px] overflow-hidden rounded-md border border-[#d6dade] bg-[#eceef1]">
        <div
          className="absolute inset-y-0 left-0 flex items-center bg-[#15171c] pl-2.5 text-[11px] font-bold text-white transition-all duration-700"
          style={{ width: `${width}%` }}
        >
          {stage.value}
        </div>
      </div>

      <span className="text-right text-[10.5px] font-bold text-[#959ca7]">
        {stage.conversion}
      </span>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="grid grid-cols-[46px_1fr] gap-3 border-b border-dashed border-[#d6dade] py-2.5 last:border-b-0">
      <span className="text-[10.5px] font-bold text-[#959ca7]">
        {item.time}
      </span>

      <div>
        <span className="mb-1 inline-block rounded-[5px] border border-[#d6dade] bg-[#eceef1] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.1em] text-[#15171c]">
          {item.source}
        </span>
        <div className="text-[12.5px] text-[#5b626d]">{item.message}</div>
      </div>
    </div>
  );
}