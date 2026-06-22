'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ArrowUpRight,
  CircleCheck,
  Clock,
  KeyRound,
  Mail,
  Cpu,
} from 'lucide-react';
import { ARSENAL_STAGE_META, type ArsenalStage } from '@evertrust/shared';
import { useArsenalRuns, useArsenalSettings } from '@/hooks/use-arsenal';
import {
  latestRunFor,
  isRunning,
  timeAgo,
  OUTCOME_LABEL,
  type StageStatus,
} from '@/lib/arsenal-sequence';
import { StatusDot } from '@/components/growth/status-dot';
import { RunStageButton } from '@/components/growth/run-stage-button';
import { Can } from '@/components/auth/can';
import { GrowthCard, StatusPill } from '@/modules/(growth)/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The five autonomous arsenal stages — the ones with REAL ERP run/status wiring
// (arsenal_runs + the per-stage AGENT_*_URL dispatch). `code` is the AIM-sequence
// codename; `endpoint` is the Python agent's route the ERP dispatches to.
const STAGES: {
  stage: ArsenalStage;
  code: string;
  schedule: string;
  endpoint: string;
}[] = [
  { stage: 'LEAD_SATELLITE', code: '01', schedule: 'Auto · ~1 min after launch', endpoint: 'POST /satellite/run' },
  { stage: 'AMMO_FORGE', code: '02', schedule: 'Auto · on campaign launch', endpoint: 'POST /ammoforge/run' },
  { stage: 'REACH_BAZOOKA', code: '03', schedule: 'Auto · daily 08:00', endpoint: 'POST /reach/run' },
  { stage: 'REPLY_GLOCK', code: '04', schedule: 'Auto · every 15 min', endpoint: 'POST /glock/run' },
  { stage: 'SLEEPER_GRENADE', code: '05', schedule: 'Auto · daily 08:15', endpoint: 'POST /sleeper/run' },
];

// The four lifecycle agents driven from their R.E.A.N. surface rather than the
// arsenal run feed — surfaced here for visibility, with a deep link to where they
// are operated. No fabricated run state.
const LIFECYCLE_AGENTS: {
  code: string;
  name: string;
  what: string;
  where: string;
  href: string;
}[] = [
  { code: '06', name: 'RAG Drafts', what: 'Drafts replies to "unsure" leads for human review.', where: 'Engage', href: '/marketing/drafts' },
  { code: '07', name: 'Sales Agent', what: 'Scores meeting transcripts into a coaching report.', where: 'Activate', href: '/activate' },
  { code: '08', name: 'Contract Maker', what: 'Turns a signed meeting into a cooperation-contract PDF.', where: 'Nurture', href: '/nurture' },
  { code: '09', name: 'CRM Customer', what: 'Promotes hot leads and graduates won companies to customers.', where: 'Nurture', href: '/nurture' },
];

// Shared eyebrow label — uppercase, tracked, muted. Matches the GrowthShell idiom.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </span>
  );
}

export function AutomationView() {
  const runs = useArsenalRuns();
  const settings = useArsenalSettings();
  const [open, setOpen] = useState<ArsenalStage | null>(null);

  const runList = runs.data ?? [];
  const rows = STAGES.map((s) => {
    const st = latestRunFor(runList, s.stage);
    return { ...s, st, running: isRunning(st) };
  });
  const healthy = rows.filter((r) => r.running || r.st.outcome === 'ok').length;
  const failed = rows.filter((r) => !r.running && r.st.outcome === 'failed').length;
  const idle = rows.filter((r) => r.st.outcome === 'idle').length;
  const nextSend = settings.data?.bazookaDailyAt ?? null;

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      {/* Page title lives in the GrowthTopbar — only the action stays here. */}
      <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/configuration">
            <Cpu /> Configure agents
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {/* Summary strip */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-[10px] border border-sidebar-border bg-card px-4 py-3.5 text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-foreground" />
            <b className="tabular-nums text-foreground">{healthy}</b>
            <span className="text-muted-foreground">healthy</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-destructive" />
            <b className="tabular-nums text-foreground">{failed}</b>
            <span className="text-muted-foreground">failed</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <b className="tabular-nums text-foreground">{idle}</b>
            <span className="text-muted-foreground">idle</span>
          </span>
          <span className="hidden text-sidebar-border sm:inline">·</span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3.5" /> Next send{' '}
            <b className="text-foreground tabular-nums">{nextSend ?? 'manual'}</b>
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-sidebar-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            <CircleCheck className="size-3.5" /> Dispatched by the ERP
          </span>
        </div>

        {/* Pipeline agents — dense table with master-detail */}
        <GrowthCard
          title="Pipeline agents"
          hint={<StatusPill live>Engine live</StatusPill>}
        >
          <p className="mb-4 text-xs text-muted-foreground">
            The five autonomous stages. Each self-runs on its schedule; “Run now” is
            an optional manual nudge. Click a row for wiring + recent runs.
          </p>
          <div className="overflow-hidden rounded-[10px] border border-sidebar-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sidebar-border bg-muted/40 text-left">
                  <th className="px-4 py-2.5">
                    <Eyebrow>Agent</Eyebrow>
                  </th>
                  <th className="px-4 py-2.5">
                    <Eyebrow>Status</Eyebrow>
                  </th>
                  <th className="hidden px-4 py-2.5 sm:table-cell">
                    <Eyebrow>Last run</Eyebrow>
                  </th>
                  <th className="hidden px-4 py-2.5 md:table-cell">
                    <Eyebrow>Schedule</Eyebrow>
                  </th>
                  <th className="px-4 py-2.5 text-right">
                    <Eyebrow>Actions</Eyebrow>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sidebar-border">
                {rows.map((r) => {
                  const meta = ARSENAL_STAGE_META[r.stage];
                  const isOpen = open === r.stage;
                  return (
                    <Fragment key={r.stage}>
                      <tr
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-muted/40',
                          isOpen && 'bg-muted/40',
                        )}
                        onClick={() => setOpen(isOpen ? null : r.stage)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <ChevronDown
                              className={cn(
                                'size-4 shrink-0 text-muted-foreground transition-transform',
                                !isOpen && '-rotate-90',
                              )}
                            />
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                                {r.code}
                              </div>
                              <div className="font-semibold text-foreground">{meta.label}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot outcome={r.st.outcome} running={r.running} />
                            <span className="text-muted-foreground">
                              {r.running ? 'running' : OUTCOME_LABEL[r.st.outcome]}
                            </span>
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                          {r.st.at ? timeAgo(r.st.at) : '—'}
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                          {r.stage === 'REACH_BAZOOKA' && nextSend
                            ? `Auto · daily ${nextSend}`
                            : r.schedule}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <Can permission="campaigns:write">
                            <RunStageButton stage={r.stage} label="Run now" variant="outline" size="sm" />
                          </Can>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/20">
                          <td colSpan={5} className="px-4 pb-4 pt-1">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-[10px] border border-sidebar-border bg-card p-4">
                                <p className="text-sm text-muted-foreground">{meta.what}</p>
                                <dl className="mt-3 space-y-2 text-sm">
                                  <Row k="Endpoint" v={<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.endpoint}</code>} />
                                  <Row
                                    k={<span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" /> Google account</span>}
                                    v={<span className="text-muted-foreground">org default mailbox</span>}
                                  />
                                  <Row
                                    k={<span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" /> Auth</span>}
                                    v={<code className="rounded bg-muted px-1.5 py-0.5 text-xs">x-arsenal-token</code>}
                                  />
                                </dl>
                              </div>
                              <div className="rounded-[10px] border border-sidebar-border bg-card p-4">
                                <Eyebrow>Recent runs</Eyebrow>
                                <RecentRuns stage={r.stage} status={r.st} running={r.running} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GrowthCard>

        {/* Lifecycle agents */}
        <GrowthCard title="Reply & lifecycle agents">
          <p className="mb-4 text-xs text-muted-foreground">
            Operated from their R.E.A.N. surface rather than the run feed.
          </p>
          <div className="overflow-hidden rounded-[10px] border border-sidebar-border">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-sidebar-border">
                {LIFECYCLE_AGENTS.map((a) => (
                  <tr key={a.code} className="hover:bg-muted/40">
                    <td className="px-4 py-3 align-top">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        {a.code}
                      </div>
                      <div className="font-semibold text-foreground">{a.name}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{a.what}</td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={a.href}>
                          {a.where} <ArrowUpRight />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GrowthCard>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium text-foreground">{v}</dd>
    </div>
  );
}

// Recent runs for a stage from the real run feed (newest first). Empty until the
// stage has dispatched — never fabricated.
function RecentRuns({
  stage,
  status,
  running,
}: {
  stage: ArsenalStage;
  status: StageStatus;
  running: boolean;
}) {
  const runs = useArsenalRuns();
  const list = (runs.data ?? []).filter((r) => r.stage === stage).slice(0, 3);
  if (list.length === 0) {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        {running ? 'Running…' : status.at ? `Last run ${timeAgo(status.at)}` : 'No runs yet.'}
      </p>
    );
  }
  return (
    <ul className="mt-2 space-y-1.5 text-sm">
      {list.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground tabular-nums">{timeAgo(r.createdAt)}</span>
          <span className="text-xs text-muted-foreground">{r.status}</span>
        </li>
      ))}
    </ul>
  );
}
