import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import type {
  ActivityLevel,
  EngineActivityItem,
  EngineAlert,
  OverviewActivity,
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

  getOverview() {
    return { kpis: [], funnel: [], activity: [] };
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
