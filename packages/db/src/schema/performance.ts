import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { users, tenders } from './core';
import {
  contributionRoleEnum,
  departmentEnum,
  kpiCategoryEnum,
  kpiPeriodEnum,
  kpiSourceEnum,
  reportPeriodEnum,
  reportScopeEnum,
  scorecardZoneEnum,
} from './enums';

// Performance Management System (PMS) — per-employee KPI scorecards, revenue
// attribution, and the AI Management Layer's reports. All org-scoped. Seeded from
// the two source PDFs (PMS Framework + KPI Scorecards); definitions are editable.

// One catalog row per (department, KPI). The weighting + category + target come
// from the KPI Scorecards PDF; `source` is the data-honesty tag (AUTO computed,
// MANUAL entered, PARTIAL approximated, NA no source yet → shown as "—").
export const kpiDefinitions = pgTable(
  'kpi_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // The scorecard group this KPI belongs to. NULL = applies to every department.
    department: departmentEnum('department'),
    // Stable machine key (e.g. 'submissions_per_week'); unique per dept per org.
    key: text('key').notNull(),
    label: text('label').notNull(),
    category: kpiCategoryEnum('category').notNull(),
    // Contribution of this KPI to its category/composite, 0-100.
    weightPct: integer('weight_pct').notNull().default(0),
    period: kpiPeriodEnum('period').notNull().default('WEEKLY'),
    // Target is mixed-unit ("10", "95%", "€1.0M") → stored as text for display.
    target: text('target'),
    source: kpiSourceEnum('source').notNull().default('MANUAL'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('kpi_definitions_organization_id_idx').on(t.organizationId),
    uniqueIndex('kpi_definitions_org_dept_key_uq').on(
      t.organizationId,
      t.department,
      t.key,
    ),
  ],
);

// One measured value per (user, KPI, period). numericValue feeds scoring;
// displayValue is the formatted string for the UI ("€1.4M", "100%"). AUTO rows are
// written by the scoring engine; MANUAL rows are entered by a manager (enteredBy).
export const kpiValues = pgTable(
  'kpi_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kpiKey: text('kpi_key').notNull(),
    period: kpiPeriodEnum('period').notNull().default('WEEKLY'),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    // Null when the source has no data (NA) — never zeroed/faked.
    numericValue: numeric('numeric_value'),
    displayValue: text('display_value'),
    source: kpiSourceEnum('source').notNull().default('MANUAL'),
    // Set for MANUAL entries (who recorded it); null for AUTO.
    enteredBy: uuid('entered_by').references(() => users.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('kpi_values_organization_id_idx').on(t.organizationId),
    index('kpi_values_user_id_idx').on(t.userId),
    uniqueIndex('kpi_values_user_kpi_period_uq').on(
      t.userId,
      t.kpiKey,
      t.periodStart,
    ),
  ],
);

// The computed scorecard for a user in a period: per-category scores + the
// weighted 0-100 composite + its zone. One row per (user, period, periodStart).
export const scorecards = pgTable(
  'scorecards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    period: kpiPeriodEnum('period').notNull().default('WEEKLY'),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    // { OUTPUT: 96, QUALITY: 95, ... } — null categories omitted (no data).
    categoryScores: jsonb('category_scores').$type<Record<string, number>>(),
    composite: integer('composite').notNull(),
    zone: scorecardZoneEnum('zone').notNull(),
    // Optional link to the AI report this scorecard fed into.
    reportId: uuid('report_id'),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('scorecards_organization_id_idx').on(t.organizationId),
    index('scorecards_user_id_idx').on(t.userId),
    uniqueIndex('scorecards_user_period_start_uq').on(
      t.userId,
      t.period,
      t.periodStart,
    ),
  ],
);

// Revenue attribution: who played each role on a tender. Drives contribution
// scores for bonuses/promotions. Auto-seeded where the ERP already knows (PIC,
// submittedBy, pricing approver, lead creator), manually set for the rest.
export const tenderContributions = pgTable(
  'tender_contributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: contributionRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('tender_contributions_tender_id_idx').on(t.tenderId),
    index('tender_contributions_user_id_idx').on(t.userId),
    uniqueIndex('tender_contributions_tender_user_role_uq').on(
      t.tenderId,
      t.userId,
      t.role,
    ),
  ],
);

// The AI Management Layer's output: a generated daily/weekly brief scoped to the
// company, a department, or a user. `summary` holds the structured Claude result;
// aiRunId links to the ai_runs cost ledger.
export const performanceReports = pgTable(
  'performance_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    scope: reportScopeEnum('scope').notNull(),
    // department value or userId for DEPARTMENT/USER scope; null for COMPANY.
    scopeId: text('scope_id'),
    period: reportPeriodEnum('period').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    summary: jsonb('summary'),
    aiRunId: uuid('ai_run_id'),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('performance_reports_organization_id_idx').on(t.organizationId)],
);
