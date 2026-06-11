'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  AlertTriangle,
  Briefcase,
  CalendarCheck,
  CheckCircle2,
  Contact,
  Crosshair,
  Filter,
  FileText,
  Layers,
  RefreshCw,
  Trophy,
  Unlink,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from 'recharts';
import {
  DEPARTMENT_LABELS,
  ROLE_LABELS,
  type TenderDto,
  type TenderStatus,
  type CampaignStatus,
} from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import { useTenders, useDeadlineRisk } from '@/hooks/use-tenders';
import { useCampaigns } from '@/hooks/use-campaigns';
import { useMeetings } from '@/hooks/use-meetings';
import { useLeads } from '@/hooks/use-leads';
import { useCustomers } from '@/hooks/use-customers';
import { AppShell } from '@/components/shell/app-shell';
import { Can } from '@/components/auth/can';
import { LogoutButton } from '@/components/auth/logout-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/common/page-header';
import { StatTile } from '@/components/common/stat-tile';
import { DeadlineAtRiskCard } from '@/components/tenders/deadline-at-risk-card';
import { AimLaunchDialog } from '@/components/growth/aim-launch-dialog';

function isOpen(t: TenderDto): boolean {
  return (
    t.status !== 'SUBMITTED' && t.status !== 'AWARDED' && t.status !== 'LOST'
  );
}

// Tender lifecycle stages (label + colour) — the SAME closed set as the shared
// TenderStatus enum, so the pipeline chart can't drift from the state machine.
const TENDER_STAGES: ReadonlyArray<[TenderStatus, string, string]> = [
  ['NOT_STARTED', 'Not started', '#64748b'],
  ['PIC_PRICING', 'PIC pricing', '#38bdf8'],
  ['CUSTOMER_PRICING', 'Cust. pricing', '#22d3ee'],
  ['DOCUMENTS', 'Documents', '#a78bfa'],
  ['SUBMITTED', 'Submitted', '#34d399'],
  ['AWARDED', 'Awarded', '#fbbf24'],
  ['LOST', 'Lost', '#f87171'],
];
const CAMPAIGN_STATES: ReadonlyArray<[CampaignStatus, string, string]> = [
  ['DEPLOYED', 'Deployed', '#34d399'],
  ['DRAFT', 'Draft', '#64748b'],
  ['FAILED', 'Failed', '#f87171'],
];

// Dark tooltip matching the app theme.
function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: { fill?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {label ? <div className="text-muted-foreground">{label}</div> : null}
      {payload.map((p, i) => (
        <div key={i} className="font-medium">
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

// The landing cockpit: a greeting, a live KPI row, the acquisition→pipeline
// charts, a needs-attention queue and the deadline-at-risk frame. Every number
// comes from a hook a module already fetches — no decorative/fabricated values —
// and every tile/chart is gated by the same read permission as its source.
export function DashboardView() {
  const { data: user, isLoading, isError, error } = useMe();
  const queryClient = useQueryClient();

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {isLoading ? (
          <DashboardSkeleton />
        ) : isError ? (
          <>
            <PageHeader
              title="Dashboard"
              description="Your Evertrust operations workspace."
            />
            <Card className="max-w-xl">
              <CardHeader>
                <CardTitle>Could not load your account</CardTitle>
                <CardDescription>{error.message}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
                <p>
                  Your session may have expired or the account is no longer
                  available. Sign out and log in again.
                </p>
                <LogoutButton>Sign out</LogoutButton>
              </CardContent>
            </Card>
          </>
        ) : user ? (
          <>
            <PageHeader
              title={`Welcome back, ${user.name.split(/\s+/)[0] || user.name}`}
              description={
                <>
                  Acquisition → pipeline → won, at a glance
                  {user.organizationName ? (
                    <>
                      {' · '}
                      <span className="text-foreground">
                        {user.organizationName}
                      </span>
                    </>
                  ) : null}
                </>
              }
              actions={
                <div className="flex items-center gap-2">
                  <Can permission="campaigns:write">
                    <AimLaunchDialog />
                  </Can>
                  <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
                  {user.department ? (
                    <Badge variant="outline">
                      {DEPARTMENT_LABELS[user.department]}
                    </Badge>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void queryClient.invalidateQueries()}
                  >
                    <RefreshCw className="size-4" />
                    Refresh
                  </Button>
                </div>
              }
            />

            <StatRow />

            <div className="grid gap-6 lg:grid-cols-3">
              <Can permission="campaigns:read">
                <AcquisitionFunnelCard />
              </Can>
              <NeedsAttentionCard />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Can permission="tenders:read">
                <TenderPipelineCard />
              </Can>
              <Can permission="campaigns:read">
                <CampaignStatusCard />
              </Can>
            </div>

            <Can permission="tenders:read">
              <DeadlineAtRiskCard />
            </Can>

            <p className="text-xs text-muted-foreground">
              Every figure above is read live from operational data. Panels that
              need historical tracking — acquisition-over-time, reply topics and
              week-over-week trends — appear here once the Arsenal logs daily
              metrics to the ERP; they are deliberately not shown rather than
              fabricated.
            </p>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

// ---- KPI tiles (all real counts) ----
function StatRow() {
  const tenders = useTenders();
  const atRisk = useDeadlineRisk();
  const campaigns = useCampaigns();
  const meetings = useMeetings();
  const leads = useLeads();
  const customers = useCustomers();

  const tenderRows = tenders.data ?? [];
  const openTenders = tenderRows.filter(isOpen).length;
  const atRiskCount = atRisk.data?.length ?? 0;
  const overdue =
    atRisk.data?.filter((r) => r.risk.level === 'OVERDUE').length ?? 0;
  const deployed = (campaigns.data ?? []).filter(
    (c) => c.status === 'DEPLOYED',
  ).length;

  const num = (loading: boolean, value: number) =>
    loading ? <Skeleton className="h-6 w-8" /> : value;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Can permission="campaigns:read">
        <StatTile
          label="Campaigns"
          value={num(campaigns.isLoading, deployed)}
          hint={
            campaigns.isError
              ? 'Could not load'
              : `${campaigns.data?.length ?? 0} total · ${deployed} live`
          }
          accent="bg-violet-400"
          icon={<Crosshair className="size-4" />}
        />
      </Can>
      <Can permission="campaigns:read">
        <StatTile
          label="Hot leads"
          value={num(leads.isLoading, leads.data?.length ?? 0)}
          hint={leads.isError ? 'Could not load' : 'Interested in pipeline'}
          accent="bg-sky-400"
          icon={<Contact className="size-4" />}
        />
      </Can>
      <Can permission="campaigns:read">
        <StatTile
          label="Meetings"
          value={num(meetings.isLoading, meetings.data?.length ?? 0)}
          hint={meetings.isError ? 'Could not load' : 'Analyzed calls'}
          accent="bg-amber-400"
          icon={<CalendarCheck className="size-4" />}
        />
      </Can>
      <Can permission="campaigns:read">
        <StatTile
          label="Customers"
          value={num(customers.isLoading, customers.data?.length ?? 0)}
          hint={customers.isError ? 'Could not load' : 'Won accounts'}
          accent="bg-emerald-400"
          icon={<Trophy className="size-4" />}
        />
      </Can>
      <Can permission="tenders:read">
        <StatTile
          label="Open tenders"
          value={num(tenders.isLoading, openTenders)}
          hint={
            tenders.isError ? 'Could not load' : `${tenderRows.length} total`
          }
          accent="bg-sky-400"
          icon={<FileText className="size-4" />}
        />
      </Can>
      <Can permission="tenders:read">
        <StatTile
          label="At deadline risk"
          value={num(atRisk.isLoading, atRiskCount)}
          hint={
            atRisk.isError
              ? 'Could not load'
              : overdue > 0
                ? `${overdue} overdue`
                : atRiskCount > 0
                  ? 'Within T-2 window'
                  : 'All on track'
          }
          accent={atRiskCount > 0 ? 'bg-orange-400' : 'bg-emerald-400'}
          icon={<AlarmClock className="size-4" />}
        />
      </Can>
    </div>
  );
}

// ---- Acquisition funnel (real: hot leads → meetings → customers won) ----
function AcquisitionFunnelCard() {
  const leads = useLeads();
  const meetings = useMeetings();
  const customers = useCustomers();

  const loading = leads.isLoading || meetings.isLoading || customers.isLoading;
  const stages = [
    {
      label: 'Hot leads',
      value: leads.data?.length ?? 0,
      color: '#a78bfa',
    },
    {
      label: 'Meetings',
      value: meetings.data?.length ?? 0,
      color: '#38bdf8',
    },
    {
      label: 'Customers won',
      value: customers.data?.length ?? 0,
      color: '#34d399',
    },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));
  const anyData = stages.some((s) => s.value > 0);

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Filter className="size-4 text-muted-foreground" /> Acquisition funnel
        </CardTitle>
        <CardDescription>Hot leads → meetings → customers won</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : !anyData ? (
          <EmptyChart label="No acquisition data yet" h={180} />
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {stages.map((s, i) => {
              const prev = i > 0 ? (stages[i - 1]?.value ?? null) : null;
              const conv =
                prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-muted/40">
                    <div
                      className="flex h-full items-center justify-end rounded-md px-2 text-xs font-semibold text-background transition-all"
                      style={{
                        width: `${Math.max(7, (s.value / max) * 100)}%`,
                        background: s.color,
                      }}
                    >
                      {s.value}
                    </div>
                  </div>
                  <div className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {conv !== null ? `${conv}%` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Needs attention (real: deadline risk + unattributed meetings + failed campaigns) ----
function NeedsAttentionCard() {
  const atRisk = useDeadlineRisk();
  const meetings = useMeetings();
  const campaigns = useCampaigns();

  const loading =
    atRisk.isLoading || meetings.isLoading || campaigns.isLoading;

  const riskRows = atRisk.data ?? [];
  const mostUrgent = riskRows[0];
  const unattributed = (meetings.data ?? []).filter((m) => !m.campaignId);
  const failed = (campaigns.data ?? []).filter((c) => c.status === 'FAILED');

  type Item = {
    icon: ReactNode;
    tone: string;
    title: string;
    sub: string;
    href?: string;
    cta?: string;
  };
  const items: Item[] = [];
  if (riskRows.length > 0) {
    items.push({
      icon: <AlarmClock className="size-4" />,
      tone: 'text-orange-400',
      title: `${riskRows.length} tender${riskRows.length > 1 ? 's' : ''} at deadline risk`,
      sub: mostUrgent
        ? `Most urgent: ${mostUrgent.tender.title}`
        : 'Within the T-2 window',
      href: mostUrgent ? `/tenders/${mostUrgent.tender.id}` : undefined,
      cta: 'Open',
    });
  }
  if (unattributed.length > 0) {
    items.push({
      icon: <Unlink className="size-4" />,
      tone: 'text-amber-400',
      title: `${unattributed.length} unattributed meeting${unattributed.length > 1 ? 's' : ''}`,
      sub: 'Sales · no campaign matched',
      href: '/sales',
      cta: 'Link',
    });
  }
  if (failed.length > 0) {
    items.push({
      icon: <AlertTriangle className="size-4" />,
      tone: 'text-red-400',
      title: `${failed.length} campaign${failed.length > 1 ? 's' : ''} failed`,
      sub: 'Growth Engine · check the run log',
      href: '/marketing',
      cta: 'View',
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-muted-foreground" /> Needs
          attention
        </CardTitle>
        <CardDescription>
          {loading
            ? 'Checking…'
            : items.length === 0
              ? 'Nothing needs attention'
              : `${items.length} item${items.length > 1 ? 's' : ''} to clear`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : items.length === 0 ? (
          <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-7 text-emerald-400" />
            All clear — no deadlines at risk, every meeting attributed.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it, i) => {
              const body = (
                <div className="flex items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-muted/40">
                  <span className={it.tone}>{it.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {it.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {it.sub}
                    </div>
                  </div>
                  {it.cta ? (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {it.cta}
                    </span>
                  ) : null}
                </div>
              );
              return (
                <li key={i}>
                  {it.href ? (
                    <Link href={it.href} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Tender pipeline (bar, real) ----
function TenderPipelineCard() {
  const tenders = useTenders();
  const rows = tenders.data ?? [];
  const data = TENDER_STAGES.map(([s, label, fill]) => ({
    stage: label,
    n: rows.filter((t) => t.status === s).length,
    fill,
  }));
  const open = rows.filter(isOpen).length;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-muted-foreground" /> Tender pipeline
        </CardTitle>
        <CardDescription>{open} open · by stage</CardDescription>
      </CardHeader>
      <CardContent>
        {tenders.isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : rows.length === 0 ? (
          <EmptyChart label="No tenders yet" />
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="stage"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                  interval={0}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  allowDecimals={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.03)' }} />
                <Bar dataKey="n" name="Tenders" radius={[6, 6, 0, 0]} maxBarSize={44}>
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                  <LabelList
                    dataKey="n"
                    position="top"
                    fill="var(--muted-foreground)"
                    fontSize={11}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Campaign status (donut, real) ----
function CampaignStatusCard() {
  const campaigns = useCampaigns();
  const rows = campaigns.data ?? [];
  const data = CAMPAIGN_STATES.map(([s, label, fill]) => ({
    name: label,
    value: rows.filter((c) => c.status === s).length,
    fill,
  })).filter((d) => d.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="size-4 text-muted-foreground" /> Campaigns
        </CardTitle>
        <CardDescription>{rows.length} total · by status</CardDescription>
      </CardHeader>
      <CardContent>
        {campaigns.isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : rows.length === 0 ? (
          <EmptyChart label="No campaigns yet" />
        ) : (
          <div className="flex h-[220px] items-center gap-3">
            <div className="h-full flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {data.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-1.5 pr-2">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: d.fill }}
                  />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyChart({ label, h = 220 }: { label: string; h?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
      style={{ height: h }}
    >
      {label}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] w-full rounded-lg" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[260px] w-full rounded-lg lg:col-span-2" />
        <Skeleton className="h-[260px] w-full rounded-lg" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[300px] w-full rounded-lg lg:col-span-2" />
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </div>
    </>
  );
}
