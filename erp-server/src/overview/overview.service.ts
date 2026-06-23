import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import type {
  ActivityLevel,
  EngineActivityItem,
  EngineAlert,
  FunnelStage,
  OverviewActivity,
  OverviewKpi,
  OverviewSummary,
} from './overview.model';

// arsenal stage -> the funnel-stage source label shown on the activity row.
const STAGE_LABEL: Record<string, string> = {
  LEAD_SATELLITE: 'REACH · SCRAPER',
  AMMO_FORGE: 'REACH · GENERATOR',
  REACH_BAZOOKA: 'REACH · SENDER',
  REPLY_GLOCK: 'ENGAGE · SORTER',
  SLEEPER_GRENADE: 'ENGAGE · SLEEPER',
};
const STAGE_NAME: Record<string, string> = {
  LEAD_SATELLITE: 'Lead Satellite',
  AMMO_FORGE: 'Ammo Forge',
  REACH_BAZOOKA: 'Reach Bazooka',
  REPLY_GLOCK: 'Reply Glock',
  SLEEPER_GRENADE: 'Sleeper Grenade',
};
const RUN_STATUS_LEVEL: Record<string, ActivityLevel> = {
  DISPATCHED: 'info',
  SUCCESS: 'success',
  FAILED: 'error',
  ERROR: 'error',
};
// Engage reply verdict -> activity level (a hard no / bounce is worth surfacing).
const VERDICT_LEVEL: Record<string, ActivityLevel> = {
  INTERESTED: 'success',
  MEETING_REQUEST: 'success',
  UNSURE: 'info',
  SNOOZE: 'info',
  AUTO_REPLY: 'info',
  NOT_INTERESTED: 'warning',
  BOUNCE: 'warning',
};

@Injectable()
export class OverviewService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // Real org KPIs + R-E-A-N funnel computed from the org's actual data: reach leads,
  // outreach sends, reply classifications, meetings, prospects, contracts. Each source
  // degrades to [] on its own error (drifted/empty table) so the dashboard never 500s.
  // Counts drive the headline values; the last 7 days' daily counts drive each card's
  // sparkline + "this week" delta. (Activity is the separate getActivity endpoint.)
  async getOverview(orgId: string): Promise<OverviewSummary> {
    const safe = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);

    const [leads, sends, replies, meetings, prospects, contracts] =
      await Promise.all([
        safe(
          this.db
            .select({ createdAt: schema.reachLeads.createdAt })
            .from(schema.reachLeads)
            .where(tenantScope(orgId, schema.reachLeads)),
        ),
        // outreach + replies carry no org column — tenancy is inherited via the
        // parent prospect, so scope the join on prospects.
        safe(
          this.db
            .select({ createdAt: schema.outreachMessages.createdAt })
            .from(schema.outreachMessages)
            .innerJoin(
              schema.prospects,
              eq(schema.outreachMessages.prospectId, schema.prospects.id),
            )
            .where(tenantScope(orgId, schema.prospects)),
        ),
        safe(
          this.db
            .select({
              createdAt: schema.replyClassifications.createdAt,
              verdict: schema.replyClassifications.verdict,
            })
            .from(schema.replyClassifications)
            .innerJoin(
              schema.prospects,
              eq(schema.replyClassifications.prospectId, schema.prospects.id),
            )
            .where(tenantScope(orgId, schema.prospects)),
        ),
        safe(
          this.db
            .select({ createdAt: schema.meetings.createdAt })
            .from(schema.meetings)
            .where(tenantScope(orgId, schema.meetings)),
        ),
        safe(
          this.db
            .select({ createdAt: schema.prospects.createdAt })
            .from(schema.prospects)
            .where(tenantScope(orgId, schema.prospects)),
        ),
        safe(
          this.db
            .select({ createdAt: schema.contracts.createdAt })
            .from(schema.contracts)
            .where(tenantScope(orgId, schema.contracts)),
        ),
      ]);

    const interested = replies.filter(
      (r) => r.verdict === 'INTERESTED' || r.verdict === 'MEETING_REQUEST',
    );

    const kpis: OverviewKpi[] = [
      buildKpi('NEW LEADS', leads.map((r) => r.createdAt)),
      buildKpi('CONTACTED', sends.map((r) => r.createdAt)),
      buildKpi('REPLIES', replies.map((r) => r.createdAt)),
      buildKpi('INTERESTED', interested.map((r) => r.createdAt)),
      buildKpi('MEETINGS', meetings.map((r) => r.createdAt)),
      buildKpi('PROSPECTS', prospects.map((r) => r.createdAt)),
    ];

    // Funnel = real per-stage volume across R-E-A-N. width scales to the largest
    // stage so the bars fit; conversion is each stage as a % of Reach.
    const stages = [
      { name: 'Reach', value: leads.length },
      { name: 'Engage', value: replies.length },
      { name: 'Activate', value: meetings.length },
      { name: 'Nurture', value: prospects.length },
      { name: 'Won', value: contracts.length },
    ];
    const maxStage = Math.max(1, ...stages.map((s) => s.value));
    const reach = Math.max(1, stages[0]!.value);
    const funnel: FunnelStage[] = stages.map((s) => ({
      name: s.name,
      value: numberFmt(s.value),
      width: Math.round((s.value / maxStage) * 100),
      conversion: `${Math.round((s.value / reach) * 100)}%`,
    }));

    return { kpis, funnel };
  }

  // The real cross-system Engine Activity feed + derived alerts for an org. Aggregates recent
  // rows from the arsenal-run log, n8n workflow executions, reply classifications and meetings,
  // and flags conditions that need attention (failures, revoked grants, due follow-ups, unread
  // system notifications). All reads are org-scoped and bounded.
  async getActivity(orgId: string): Promise<OverviewActivity> {
    const now = new Date();
    // Each source degrades to [] on its own error so a single drifted/empty table can never
    // 500 the whole feed. Explicit column lists avoid selecting columns this DB may not have.
    const safe = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
    const [runs, execs, meetings, classifications, grants, dueSnoozes, notifs] =
      await Promise.all([
        safe(
          this.db
            .select({
              id: schema.arsenalRuns.id,
              stage: schema.arsenalRuns.stage,
              status: schema.arsenalRuns.status,
              detail: schema.arsenalRuns.detail,
              metrics: schema.arsenalRuns.metrics,
              createdAt: schema.arsenalRuns.createdAt,
            })
            .from(schema.arsenalRuns)
            .where(tenantScope(orgId, schema.arsenalRuns))
            .orderBy(desc(schema.arsenalRuns.createdAt))
            .limit(25),
        ),
        safe(
          this.db
            .select({
              id: schema.workflowExecutions.id,
              workflowName: schema.workflowExecutions.workflowName,
              source: schema.workflowExecutions.source,
              status: schema.workflowExecutions.status,
              error: schema.workflowExecutions.error,
              at: schema.workflowExecutions.at,
            })
            .from(schema.workflowExecutions)
            .where(tenantScope(orgId, schema.workflowExecutions))
            .orderBy(desc(schema.workflowExecutions.at))
            .limit(15),
        ),
        safe(
          this.db
            .select({
              clientCompany: schema.meetings.clientCompany,
              analysis: schema.meetings.analysis,
              createdAt: schema.meetings.createdAt,
              updatedAt: schema.meetings.updatedAt,
            })
            .from(schema.meetings)
            .where(tenantScope(orgId, schema.meetings))
            .orderBy(desc(schema.meetings.updatedAt))
            .limit(15),
        ),
        safe(
          this.db
            .select({
              id: schema.replyClassifications.id,
              verdict: schema.replyClassifications.verdict,
              createdAt: schema.replyClassifications.createdAt,
              company: schema.prospects.companyName,
              email: schema.prospects.email,
            })
            .from(schema.replyClassifications)
            .innerJoin(
              schema.prospects,
              eq(schema.replyClassifications.prospectId, schema.prospects.id),
            )
            .where(tenantScope(orgId, schema.prospects))
            .orderBy(desc(schema.replyClassifications.createdAt))
            .limit(15),
        ),
        safe(
          this.db
            .select({
              id: schema.googleAccounts.id,
              email: schema.googleAccounts.email,
              status: schema.googleAccounts.status,
              lastError: schema.googleAccounts.lastError,
              updatedAt: schema.googleAccounts.updatedAt,
            })
            .from(schema.googleAccounts)
            .where(tenantScope(orgId, schema.googleAccounts)),
        ),
        safe(
          this.db
            .select({ id: schema.prospects.id })
            .from(schema.prospects)
            .where(
              and(
                tenantScope(orgId, schema.prospects),
                lte(schema.prospects.snoozeUntil, now),
              ),
            ),
        ),
        safe(
          this.db
            .select({
              id: schema.notifications.id,
              type: schema.notifications.type,
              title: schema.notifications.title,
              body: schema.notifications.body,
              createdAt: schema.notifications.createdAt,
            })
            .from(schema.notifications)
            .where(
              and(
                tenantScope(orgId, schema.notifications),
                isNull(schema.notifications.readAt),
              ),
            )
            .orderBy(desc(schema.notifications.createdAt))
            .limit(10),
        ),
      ]);

    // ---- activity feed ----
    const feed: Array<EngineActivityItem & { ts: number }> = [];
    const push = (at: Date | null, source: string, message: string, level: ActivityLevel) => {
      const d = at ?? now;
      feed.push({
        ts: d.getTime(),
        at: d.toISOString(),
        time: this.formatTime(d, now),
        source,
        message,
        level,
      });
    };

    for (const r of runs) {
      const name = STAGE_NAME[r.stage] ?? r.stage;
      const source = STAGE_LABEL[r.stage] ?? r.stage;
      const level = RUN_STATUS_LEVEL[r.status] ?? 'info';
      const metrics = this.summariseMetrics(r.metrics);
      let message: string;
      if (r.status === 'SUCCESS') message = `${name} run completed${metrics}`;
      else if (r.status === 'DISPATCHED') message = `${name} dispatched`;
      else message = `${name} run ${r.status.toLowerCase()}${r.detail ? `: ${r.detail}` : ''}`;
      push(r.createdAt, source, message, level);
    }

    for (const e of execs) {
      const failed = /fail|error/i.test(e.status);
      const level: ActivityLevel = failed ? 'error' : /success|ok|done/i.test(e.status) ? 'success' : 'info';
      const detail = failed && e.error ? `: ${e.error}` : '';
      push(e.at, `SYSTEM · ${e.source}`, `${e.workflowName} ${e.status.toLowerCase()}${detail}`, level);
    }

    for (const m of meetings) {
      const company = m.clientCompany?.trim() || 'Prospect';
      if (m.analysis != null) {
        push(m.updatedAt, 'ACTIVATE · READ AI', `Call analysis ready for ${company}`, 'success');
      } else {
        push(m.createdAt, 'ACTIVATE · BOOKER', `Meeting booked: ${company}`, 'info');
      }
    }

    for (const c of classifications) {
      const who = c.company?.trim() || c.email;
      const level = VERDICT_LEVEL[c.verdict] ?? 'info';
      push(c.createdAt, 'ENGAGE · GLOCK', `Reply classified ${c.verdict} — ${who}`, level);
    }

    const activity = feed
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 30)
      .map(({ ts: _ts, ...item }) => item);

    // ---- alerts ----
    const alerts: EngineAlert[] = [];

    for (const r of runs) {
      if (r.status === 'FAILED' || r.status === 'ERROR') {
        alerts.push({
          id: `run-${r.id}`,
          level: 'error',
          title: `${STAGE_NAME[r.stage] ?? r.stage} run ${r.status.toLowerCase()}`,
          detail: r.detail ?? null,
          source: STAGE_LABEL[r.stage] ?? r.stage,
          time: this.formatTime(r.createdAt, now),
        });
      }
    }

    for (const e of execs) {
      if (/fail|error/i.test(e.status)) {
        alerts.push({
          id: `exec-${e.id}`,
          level: 'error',
          title: `${e.workflowName} ${e.status.toLowerCase()}`,
          detail: e.error ?? null,
          source: `SYSTEM · ${e.source}`,
          time: this.formatTime(e.at, now),
        });
      }
    }

    for (const g of grants) {
      if (g.status !== 'CONNECTED') {
        alerts.push({
          id: `grant-${g.id}`,
          level: 'warning',
          title: `Google account ${g.email} needs reconnect`,
          detail: g.lastError ?? `Grant status: ${g.status}`,
          source: 'SYSTEM · GOOGLE',
          time: this.formatTime(g.updatedAt, now),
        });
      }
    }

    if (dueSnoozes.length > 0) {
      alerts.push({
        id: 'snoozes-due',
        level: 'warning',
        title: `${dueSnoozes.length} follow-up${dueSnoozes.length > 1 ? 's' : ''} due`,
        detail: 'Snoozed prospects are ready to re-engage.',
        source: 'ENGAGE · SLEEPER',
        time: this.formatTime(now, now),
      });
    }

    for (const n of notifs) {
      const level: EngineAlert['level'] = /fail|error|revok/i.test(`${n.type} ${n.title}`)
        ? 'error'
        : 'info';
      alerts.push({
        id: `notif-${n.id}`,
        level,
        title: n.title,
        detail: n.body ?? null,
        source: `NOTICE · ${n.type}`,
        time: this.formatTime(n.createdAt, now),
      });
    }

    const severity = { error: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => severity[a.level] - severity[b.level]);

    return { activity, alerts: alerts.slice(0, 8) };
  }

  // "14:32" for today, "18 Jun" for older — keeps the 46px time column readable.
  private formatTime(date: Date, now: Date): string {
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (sameDay) {
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  // Compact "· 40 emails sent" style suffix from a run's funnel-count metrics.
  private summariseMetrics(metrics: Record<string, number> | null): string {
    if (!metrics) return '';
    const parts = Object.entries(metrics)
      .filter(([, v]) => typeof v === 'number')
      .slice(0, 2)
      .map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`);
    return parts.length ? ` · ${parts.join(', ')}` : '';
  }
}

// ---- KPI helpers (module-level, pure) -------------------------------------

function numberFmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

// Build one KPI card from a metric's timestamps: the total count is the headline
// value; the last 7 days' daily counts become the sparkline polyline (viewBox
// 0 0 100 22, taller = more) and the "+N this week" delta (or "all time" when
// nothing landed in the window).
function buildKpi(label: string, timestamps: Array<Date | string>): OverviewKpi {
  const DAYS = 7;
  const now = Date.now();
  const buckets = new Array<number>(DAYS).fill(0);
  for (const ts of timestamps) {
    const t = ts instanceof Date ? ts.getTime() : Date.parse(ts);
    if (Number.isNaN(t)) continue;
    const daysAgo = Math.floor((now - t) / 86_400_000);
    if (daysAgo >= 0 && daysAgo < DAYS) buckets[DAYS - 1 - daysAgo]! += 1;
  }
  const max = Math.max(1, ...buckets);
  const spark = buckets
    .map((v, i) => {
      const x = (i / (DAYS - 1)) * 100;
      const y = 22 - (v / max) * 20; // 2px headroom at the top; taller = more
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const week = buckets.reduce((a, b) => a + b, 0);
  return {
    label,
    value: numberFmt(timestamps.length),
    delta: week > 0 ? `+${week} this week` : 'all time',
    spark,
  };
}
