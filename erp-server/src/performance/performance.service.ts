import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  DEPARTMENT_LABELS,
  OPERATIONAL_VALIDATION_KPIS,
  PerformanceBriefSummary,
  zoneForScore,
  type CreateKpiValueDto,
  type Department,
  type DepartmentRollupDto,
  type KpiCategory,
  type KpiDefinitionDto,
  type KpiPeriod,
  type PerformanceBriefDto,
  type PerformanceBriefSummary as PerformanceBriefSummaryT,
  type PerformanceOverviewDto,
  type ScorecardDto,
  type ScorecardKpiDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { ClaudeService } from '../ai/claude.service';
import { tenantScope } from '../common/tenant';

type DefRow = typeof schema.kpiDefinitions.$inferSelect;
type ValRow = typeof schema.kpiValues.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

const CATEGORIES: KpiCategory[] = [
  'OUTPUT',
  'QUALITY',
  'SPEED',
  'COMPLIANCE',
  'REVENUE',
];

// Pull the first number out of a mixed-unit string ("€1.4M" -> 1.4, "95%" -> 95,
// "4/6" -> 4). Returns null when there's no number.
function parseNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
const clamp = (n: number) => Math.max(0, Math.min(100, n));

// The current weekly period [Monday 00:00 UTC, +7d).
function currentWeek(): { start: Date; end: Date } {
  const start = new Date();
  const day = (start.getUTCDay() + 6) % 7; // 0 = Monday
  start.setUTCDate(start.getUTCDate() - day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

// Score one KPI 0-100 from value vs target (higher-is-better). When there's no
// target, treat the value as an already-0-100 score. Null when no value.
function kpiScore(value: number | null, target: number | null): number | null {
  if (value == null) return null;
  if (target == null || target === 0) return clamp(Math.round(value));
  return clamp(Math.round((value / target) * 100));
}

@Injectable()
export class PerformanceService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly claude: ClaudeService,
  ) {}

  // Active KPI definitions for the org (drives the manual-entry KPI picker).
  async listDefinitions(orgId: string): Promise<KpiDefinitionDto[]> {
    const rows = await this.db
      .select()
      .from(schema.kpiDefinitions)
      .where(
        and(
          tenantScope(orgId, schema.kpiDefinitions),
          eq(schema.kpiDefinitions.active, true),
        ),
      );
    return rows.map((d) => ({
      id: d.id,
      organizationId: d.organizationId,
      department: d.department as Department | null,
      key: d.key,
      label: d.label,
      category: d.category,
      weightPct: d.weightPct,
      period: d.period,
      target: d.target,
      source: d.source,
      active: d.active,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  // The latest stored AI brief for the org (or a not-yet-generated placeholder).
  async getBrief(
    orgId: string,
    period: KpiPeriod = 'WEEKLY',
  ): Promise<PerformanceBriefDto> {
    const rows = await this.db
      .select()
      .from(schema.performanceReports)
      .where(
        and(
          tenantScope(orgId, schema.performanceReports),
          eq(schema.performanceReports.scope, 'COMPANY'),
        ),
      )
      .orderBy(desc(schema.performanceReports.generatedAt))
      .limit(1);
    const row = rows[0];
    return {
      configured: this.claude.isConfigured(),
      generatedAt: row ? row.generatedAt.toISOString() : null,
      period,
      summary: row ? (row.summary as PerformanceBriefSummaryT) : null,
    };
  }

  // Generate a fresh AI brief from the current scorecards via Claude, store it, and
  // return it. Degrades to { configured:false } when ANTHROPIC_API_KEY is unset —
  // never fabricates a summary.
  async generateBrief(
    orgId: string,
    period: KpiPeriod = 'WEEKLY',
  ): Promise<PerformanceBriefDto> {
    if (!this.claude.isConfigured()) {
      return { configured: false, generatedAt: null, period, summary: null };
    }
    const [cards, ov] = await Promise.all([
      this.listScorecards(orgId, period),
      this.overview(orgId, period),
    ]);
    const lines = cards
      .map(
        (c) =>
          `- ${c.userName} (${c.department ? DEPARTMENT_LABELS[c.department] : 'Unassigned'}): ${c.composite}/100 [${c.zone}]; ` +
          c.kpis
            .map((k) => `${k.label}=${k.value ?? '—'}/${k.target ?? '—'}`)
            .join(', '),
      )
      .join('\n');
    const prompt =
      `Company average ${ov.companyAvg}/100 across ${ov.members} members ` +
      `(${ov.highPerformers} high performers, ${ov.needsAttention} need attention).\n` +
      `Department averages: ${ov.departments.map((d) => `${d.label} ${d.avg}`).join(', ')}.\n\n` +
      `Per-employee scorecards (this ${period.toLowerCase()}):\n${lines}\n\n` +
      `Write a management brief. Use ONLY these numbers — do not invent data. ` +
      `KPIs shown as "—" have no data; never guess them.`;

    const { data } = await this.claude.structured<PerformanceBriefSummaryT>({
      system:
        'You are an operations performance analyst for a tender business. Be concise, factual, and specific with names and numbers. Never fabricate metrics.',
      prompt,
      toolName: 'performance_brief',
      toolDescription:
        'Return a management brief: one-sentence headline, 3-5 factual bullet observations, and one recommended top action.',
      schema: PerformanceBriefSummary,
      jsonSchema: {
        type: 'object',
        properties: {
          headline: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          topAction: { type: 'string' },
        },
        required: ['headline', 'bullets', 'topAction'],
      },
      maxTokens: 700,
    });

    const { start, end } = currentWeek();
    await this.db.insert(schema.performanceReports).values({
      organizationId: orgId,
      scope: 'COMPANY',
      scopeId: null,
      period: 'WEEKLY',
      periodStart: start,
      periodEnd: end,
      summary: data,
    });
    return {
      configured: true,
      generatedAt: new Date().toISOString(),
      period,
      summary: data,
    };
  }

  // Idempotently seed the Operational Tender Validation Team KPI catalog (the
  // data-richest scorecard, Phase B). Other departments are added in Phase C.
  async ensureDefinitions(orgId: string): Promise<void> {
    const existing = await this.db
      .select({ key: schema.kpiDefinitions.key })
      .from(schema.kpiDefinitions)
      .where(
        and(
          tenantScope(orgId, schema.kpiDefinitions),
          eq(schema.kpiDefinitions.department, 'OPERATIONS'),
        ),
      );
    const have = new Set(existing.map((d) => d.key));
    const missing = OPERATIONAL_VALIDATION_KPIS.filter((k) => !have.has(k.key));
    if (missing.length === 0) return;
    await this.db.insert(schema.kpiDefinitions).values(
      missing.map((k) => ({
        organizationId: orgId,
        department: 'OPERATIONS' as Department,
        key: k.key,
        label: k.label,
        category: k.category,
        weightPct: k.weightPct,
        period: k.period,
        target: k.target,
        source: k.source,
      })),
    );
  }

  // Upsert one AUTO/PARTIAL value (idempotent on user+kpi+periodStart). AUTO keys
  // never collide with MANUAL keys, so this won't clobber manager-entered values.
  private async upsertAuto(
    orgId: string,
    userId: string,
    kpiKey: string,
    periodStart: Date,
    periodEnd: Date,
    num: number,
    display: string,
    source: 'AUTO' | 'PARTIAL',
  ): Promise<void> {
    await this.db
      .insert(schema.kpiValues)
      .values({
        organizationId: orgId,
        userId,
        kpiKey,
        period: 'WEEKLY',
        periodStart,
        periodEnd,
        numericValue: String(num),
        displayValue: display,
        source,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.kpiValues.userId,
          schema.kpiValues.kpiKey,
          schema.kpiValues.periodStart,
        ],
        set: {
          numericValue: String(num),
          displayValue: display,
          source,
          updatedAt: new Date(),
        },
      });
  }

  // Derive AUTO KPI values for the current week from REAL ERP activity (meetings,
  // leads). Idempotent; runs on every read so scorecards always reflect live data.
  // KPIs with no source (content, bugs, cost-per-lead, submissions_per_week,
  // deadline_compliance, profit_maximization, etc.) are left to MANUAL entry —
  // never invented.
  async collectAuto(orgId: string): Promise<void> {
    const { start, end } = currentWeek();
    const users = await this.db
      .select()
      .from(schema.users)
      .where(tenantScope(orgId, schema.users));

    // Meetings booked (PARTIAL: meetings.aeName matched to a user by display name).
    const mtgs = await this.db
      .select({ ae: schema.meetings.aeName })
      .from(schema.meetings)
      .where(
        and(
          eq(schema.meetings.organizationId, orgId),
          gte(schema.meetings.createdAt, start),
          lt(schema.meetings.createdAt, end),
        ),
      );
    const byName = new Map(users.map((u) => [u.name.toLowerCase(), u.id]));
    const mtgAgg = new Map<string, number>();
    for (const m of mtgs) {
      const uid = m.ae ? byName.get(m.ae.toLowerCase()) : undefined;
      if (uid) mtgAgg.set(uid, (mtgAgg.get(uid) ?? 0) + 1);
    }
    for (const [uid, n] of mtgAgg) {
      await this.upsertAuto(orgId, uid, 'meetings_booked', start, end, n, String(n), 'PARTIAL');
    }

    // Leads generated + qualified (per creator, from leads.createdBy).
    const lds = await this.db
      .select({ by: schema.leads.createdBy, stage: schema.leads.stage })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.organizationId, orgId),
          isNotNull(schema.leads.createdBy),
          gte(schema.leads.createdAt, start),
          lt(schema.leads.createdAt, end),
        ),
      );
    const ldAgg = new Map<string, { n: number; q: number }>();
    for (const l of lds) {
      if (!l.by) continue;
      const a = ldAgg.get(l.by) ?? { n: 0, q: 0 };
      a.n += 1;
      if (l.stage !== 'INTERESTED' && l.stage !== 'ARCHIVED') a.q += 1;
      ldAgg.set(l.by, a);
    }
    for (const [uid, a] of ldAgg) {
      await this.upsertAuto(orgId, uid, 'leads_generated', start, end, a.n, String(a.n), 'AUTO');
      await this.upsertAuto(orgId, uid, 'qualified_leads', start, end, a.q, String(a.q), 'AUTO');
    }
  }

  // Build one user's scorecard from their KPI values for a period.
  private buildScorecard(
    user: UserRow,
    defs: DefRow[],
    values: ValRow[],
    period: KpiPeriod,
    periodStart: Date | null,
    periodEnd: Date | null,
  ): ScorecardDto {
    const defByKey = new Map(defs.map((d) => [d.key, d]));
    const kpis: ScorecardKpiDto[] = [];
    const catScores: Record<string, number[]> = {};
    let wSum = 0;
    let wScore = 0;

    for (const v of values) {
      const def = defByKey.get(v.kpiKey);
      if (!def) continue;
      const val = v.numericValue == null ? null : Number(v.numericValue);
      const score = kpiScore(val, parseNum(def.target));
      kpis.push({
        key: def.key,
        label: def.label,
        category: def.category,
        value: v.displayValue ?? (val == null ? null : String(val)),
        target: def.target,
        source: v.source,
      });
      if (score != null) {
        (catScores[def.category] ||= []).push(score);
        if (def.weightPct > 0) {
          wSum += def.weightPct;
          wScore += score * def.weightPct;
        }
      }
    }

    const categoryScores: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      const arr = catScores[cat];
      if (arr && arr.length) {
        categoryScores[cat] = Math.round(
          arr.reduce((a, b) => a + b, 0) / arr.length,
        );
      }
    }
    const allScores = Object.values(catScores).flat();
    const composite =
      wSum > 0
        ? Math.round(wScore / wSum)
        : allScores.length
          ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
          : 0;

    return {
      id: null,
      userId: user.id,
      userName: user.name,
      department: user.department as Department | null,
      position: user.position ?? null,
      period,
      periodStart: (periodStart ?? new Date(0)).toISOString(),
      periodEnd: (periodEnd ?? new Date(0)).toISOString(),
      categoryScores: Object.keys(categoryScores).length
        ? (categoryScores as Record<KpiCategory, number>)
        : null,
      composite,
      zone: zoneForScore(composite),
      kpis,
      generatedAt: null,
    };
  }

  // All scorecards for the most recent period that has any KPI values. Returns
  // one card per user that has values, sorted high → low.
  async listScorecards(
    orgId: string,
    period: KpiPeriod = 'WEEKLY',
  ): Promise<ScorecardDto[]> {
    await this.ensureDefinitions(orgId);
    // Compute-on-read: refresh AUTO values from live ERP activity first.
    await this.collectAuto(orgId);
    const [defs, users, values] = await Promise.all([
      this.db
        .select()
        .from(schema.kpiDefinitions)
        .where(
          and(
            tenantScope(orgId, schema.kpiDefinitions),
            eq(schema.kpiDefinitions.active, true),
          ),
        ),
      this.db
        .select()
        .from(schema.users)
        .where(
          and(tenantScope(orgId, schema.users), eq(schema.users.active, true)),
        ),
      this.db
        .select()
        .from(schema.kpiValues)
        .where(
          and(
            tenantScope(orgId, schema.kpiValues),
            eq(schema.kpiValues.period, period),
          ),
        ),
    ]);

    if (values.length === 0) return [];
    // Most recent period present.
    const maxStart = values.reduce(
      (m, v) => (v.periodStart > m ? v.periodStart : m),
      values[0]!.periodStart,
    );
    const periodEnd = values.find(
      (v) => +v.periodStart === +maxStart,
    )!.periodEnd;
    const current = values.filter((v) => +v.periodStart === +maxStart);
    const byUser = new Map<string, ValRow[]>();
    for (const v of current) (byUser.get(v.userId) ?? byUser.set(v.userId, []).get(v.userId)!).push(v);

    const userById = new Map(users.map((u) => [u.id, u]));
    const cards: ScorecardDto[] = [];
    for (const [userId, vals] of byUser) {
      const user = userById.get(userId);
      if (!user) continue;
      cards.push(
        this.buildScorecard(user, defs, vals, period, maxStart, periodEnd),
      );
    }
    return cards.sort((a, b) => b.composite - a.composite);
  }

  async getScorecard(
    orgId: string,
    userId: string,
    period: KpiPeriod = 'WEEKLY',
  ): Promise<ScorecardDto | null> {
    const all = await this.listScorecards(orgId, period);
    return all.find((c) => c.userId === userId) ?? null;
  }

  // Manager records a MANUAL KPI value (upsert by user+kpi+periodStart).
  async createKpiValue(
    orgId: string,
    enteredBy: string,
    dto: CreateKpiValueDto,
  ): Promise<void> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    await this.db
      .insert(schema.kpiValues)
      .values({
        organizationId: orgId,
        userId: dto.userId,
        kpiKey: dto.kpiKey,
        period: dto.period ?? 'WEEKLY',
        periodStart,
        periodEnd,
        numericValue:
          dto.numericValue == null ? null : String(dto.numericValue),
        displayValue: dto.displayValue ?? null,
        source: 'MANUAL',
        enteredBy,
        note: dto.note ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          schema.kpiValues.userId,
          schema.kpiValues.kpiKey,
          schema.kpiValues.periodStart,
        ],
        set: {
          numericValue:
            dto.numericValue == null ? null : String(dto.numericValue),
          displayValue: dto.displayValue ?? null,
          source: 'MANUAL',
          enteredBy,
          note: dto.note ?? null,
          updatedAt: new Date(),
        },
      });
  }

  // Executive rollup for the CEO tab — department averages + who needs attention.
  async overview(
    orgId: string,
    period: KpiPeriod = 'WEEKLY',
  ): Promise<PerformanceOverviewDto> {
    const cards = await this.listScorecards(orgId, period);
    const byDept = new Map<string, ScorecardDto[]>();
    for (const c of cards) {
      const key = c.department ?? '__none__';
      (byDept.get(key) ?? byDept.set(key, []).get(key)!).push(c);
    }
    const departments: DepartmentRollupDto[] = [...byDept.entries()].map(
      ([dept, list]) => ({
        department: dept === '__none__' ? null : (dept as Department),
        label:
          dept === '__none__'
            ? 'Unassigned'
            : DEPARTMENT_LABELS[dept as Department],
        avg: Math.round(
          list.reduce((a, c) => a + c.composite, 0) / list.length,
        ),
        count: list.length,
        topName:
          list.slice().sort((a, b) => b.composite - a.composite)[0]?.userName ??
          null,
      }),
    );
    departments.sort((a, b) => b.avg - a.avg);

    const companyAvg = cards.length
      ? Math.round(cards.reduce((a, c) => a + c.composite, 0) / cards.length)
      : 0;

    return {
      period,
      periodStart: cards[0]?.periodStart ?? null,
      periodEnd: cards[0]?.periodEnd ?? null,
      companyAvg,
      members: cards.length,
      highPerformers: cards.filter((c) => c.zone === 'GREEN').length,
      needsAttention: cards.filter(
        (c) => c.zone === 'ORANGE' || c.zone === 'RED',
      ).length,
      departments,
      attention: cards
        .slice()
        .sort((a, b) => a.composite - b.composite)
        .slice(0, 5),
    };
  }
}
