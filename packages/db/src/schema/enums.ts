import { pgEnum } from 'drizzle-orm/pg-core';

// Centralized pgEnum definitions. Every bracketed [A|B|C] field in the data
// model maps to exactly one of these. Enum names are snake_case + `_enum`.

export const userRoleEnum = pgEnum('user_role', [
  'OWNER',
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'EMPLOYEE',
]);

// Department (org unit) a user belongs to. Replaces the former `lane` enum;
// NULLABLE on the users table (a user may belong to no single department).
export const departmentEnum = pgEnum('department', [
  'OPERATIONS',
  'IT',
  'CONSULTING',
  'MARKETING',
  'BUSINESS',
  'HR',
]);

// Job title / position. NULLABLE on the users table; descriptive only (carries
// no authority — that comes from the role's permissions).
export const userPositionEnum = pgEnum('user_position', [
  'CEO',
  'CTO',
  'CFO',
  'COO',
  'DEPT_MANAGER',
  'EXECUTIVE',
  'OFFICER',
  'SPECIALIST',
]);

export const tenderRegimeEnum = pgEnum('tender_regime', [
  'VOB_A',
  'VgV',
  'UVgO',
]);

export const tenderStatusEnum = pgEnum('tender_status', [
  'NOT_STARTED',
  'PIC_PRICING',
  'CUSTOMER_PRICING',
  'DOCUMENTS',
  'SUBMITTED',
  'AWARDED',
  'LOST',
]);

export const documentTypeEnum = pgEnum('document_type', ['TYPE1', 'TYPE2']);

export const ocrStatusEnum = pgEnum('ocr_status', ['PENDING', 'DONE', 'FAILED']);

// Provenance of a single price_observation. Named `price_obs_source` (NOT
// reusing any prior enum name) so drizzle never has to ALTER an existing enum's
// values — value changes on a live enum are unreliable (see tasks/lessons.md).
// REAL vs estimate weighting lives in @evertrust/shared (SOURCE_WEIGHT).
export const priceObsSourceEnum = pgEnum('price_obs_source', [
  'SUPPLIER_QUOTE',
  'MANUAL',
  'AI_ESTIMATE',
  'COMPETITOR_WINNER',
  'OUR_SUBMITTED',
  'OUR_BENCHMARK',
  'IBAU_HISTORICAL',
]);

export const pricingStatusEnum = pgEnum('pricing_status', [
  'DRAFT',
  'REVIEW',
  'FINAL',
]);

export const approvalTypeEnum = pgEnum('approval_type', [
  'PRICING',
  'CUSTOMER',
  'QC',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

export const auditActorTypeEnum = pgEnum('audit_actor_type', [
  'USER',
  'SYSTEM',
  'N8N',
  'DEEPSEEK',
  'CLAUDE',
]);

// The outbound arsenal stages the ERP can fire as n8n webhooks (AIM excluded — it
// is the campaign launch, handled by the campaigns module).
export const arsenalStageEnum = pgEnum('arsenal_stage', [
  'LEAD_SATELLITE',
  'AMMO_FORGE',
  'REACH_BAZOOKA',
  'REPLY_GLOCK',
  'SLEEPER_GRENADE',
]);

// What initiated an arsenal run: a human pressing "Run now" (MANUAL), the ERP's
// own daily scheduler (SCHEDULED, e.g. the Bazooka daily send), or an autonomous
// run that n8n reported back via the callback (N8N — it ran itself, no ERP trigger).
export const arsenalRunSourceEnum = pgEnum('arsenal_run_source', [
  'MANUAL',
  'SCHEDULED',
  'N8N',
]);

// Outcome of an arsenal run. DISPATCHED = the ERP→n8n hand-off was accepted (n8n
// then runs async); FAILED = the ERP could not reach it / non-2xx. SUCCESS / ERROR
// = the FINAL outcome of an autonomous n8n run, reported back via the callback —
// the ERP owns the hand-off, n8n owns (and now reports) the downstream execution.
export const arsenalRunStatusEnum = pgEnum('arsenal_run_status', [
  'DISPATCHED',
  'FAILED',
  'SUCCESS',
  'ERROR',
]);

// Outcome of a Hermes supplier-RFQ dispatch (Phase 5c). Same 2-state ERP→n8n
// hand-off model as arsenal runs: DISPATCHED = the Hermes webhook accepted the RFQ
// (n8n emails suppliers async); FAILED = the ERP could not reach it / non-2xx.
// Supplier replies land as SUPPLIER_QUOTE price observations, not on this row.
export const rfqStatusEnum = pgEnum('rfq_status', ['DISPATCHED', 'FAILED']);

// Key Account hot-lead pipeline stage. Mirrors the n8n hot_leads vocabulary:
// INTERESTED / MEETING_SCHEDULED (the "Hot Reason"), ONGOING (deal in progress —
// ERP-only, set manually), CUSTOMER (graduated), and ARCHIVED (dismissed). The
// board columns are INTERESTED -> MEETING_SCHEDULED -> ONGOING -> CUSTOMER.
export const leadStageEnum = pgEnum('lead_stage', [
  'INTERESTED',
  'MEETING_SCHEDULED',
  'ONGOING',
  'CUSTOMER',
  'ARCHIVED',
]);

// Where a lead came from: N8N = imported from the Hot Leads Pipeline; MANUAL =
// added by hand in the ERP.
export const leadSourceEnum = pgEnum('lead_source', ['N8N', 'MANUAL']);

// ---- Performance Management System (PMS) ----
// The five KPI categories every scorecard rolls up to (PMS Framework PDF).
export const kpiCategoryEnum = pgEnum('kpi_category', [
  'OUTPUT',
  'QUALITY',
  'SPEED',
  'COMPLIANCE',
  'REVENUE',
]);
// Scorecard / KPI cadence.
export const kpiPeriodEnum = pgEnum('kpi_period', ['WEEKLY', 'MONTHLY']);
// Where a KPI value comes from — the data-honesty tag. AUTO = computed from real
// ERP data; MANUAL = manager-entered; PARTIAL = approximated from related data;
// NA = no source yet (rendered as "—", never fabricated).
export const kpiSourceEnum = pgEnum('kpi_source', [
  'AUTO',
  'MANUAL',
  'PARTIAL',
  'NA',
]);
// Score zones (PMS PDF): GREEN 90-100, YELLOW 75-89, ORANGE 60-74, RED <60.
export const scorecardZoneEnum = pgEnum('scorecard_zone', [
  'GREEN',
  'YELLOW',
  'ORANGE',
  'RED',
]);
// Revenue attribution role on a tender (who found/qualified/validated/sold/managed).
export const contributionRoleEnum = pgEnum('contribution_role', [
  'RESEARCH',
  'QUALIFICATION',
  'VALIDATION',
  'SALES',
  'ACCOUNT_MANAGER',
]);
// AI Management Layer report cadence + scope.
export const reportPeriodEnum = pgEnum('report_period', ['DAILY', 'WEEKLY']);
export const reportScopeEnum = pgEnum('report_scope', [
  'COMPANY',
  'DEPARTMENT',
  'USER',
]);

// ---- Growth-Engine v2 (niches, prospects, outreach, contracts) ----
// Campaign lifecycle. Replaces the retired deploy-centric `campaign_status` as
// a NEW type (never alter an existing enum's values — see tasks/lessons.md):
// DRAFT = saved, ACTIVE = running, PAUSED = sends suspended, ARCHIVED = soft-
// deleted (kept for attribution).
export const campaignStateEnum = pgEnum('campaign_state', [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'ARCHIVED',
]);

// Provenance of a niche_targets row: AI = generated by the NICHE ANALYTICS
// workflow; MANUAL = human-entered (or preserved legacy free-text targets).
export const nicheTargetSourceEnum = pgEnum('niche_target_source', [
  'AI',
  'MANUAL',
]);

// Cold-outreach funnel state of a prospect. A projection of the conversation —
// the append-only reply_classifications rows are the evidence behind it.
export const prospectStatusEnum = pgEnum('prospect_status', [
  'NEW',
  'EMAILED',
  'REPLIED',
  'INTERESTED',
  'MEETING_SCHEDULED',
  'NOT_INTERESTED',
  'RE_ENGAGED',
  'DO_NOT_CONTACT',
]);

// Direction of an outreach_messages row: OUTBOUND = we sent it (Bazooka),
// INBOUND = the prospect replied.
export const messageDirectionEnum = pgEnum('message_direction', [
  'OUTBOUND',
  'INBOUND',
]);

// Delivery state of an outreach message: SENT / FAILED / BOUNCED apply to
// OUTBOUND sends, RECEIVED to INBOUND replies.
export const messageStatusEnum = pgEnum('message_status', [
  'SENT',
  'FAILED',
  'BOUNCED',
  'RECEIVED',
]);

// AI classification of an inbound reply (Reply Glock fast pass + the RAG
// agent's deeper UNSURE pass).
export const replyVerdictEnum = pgEnum('reply_verdict', [
  'INTERESTED',
  'NOT_INTERESTED',
  'SNOOZE',
  'MEETING_REQUEST',
  'UNSURE',
  'AUTO_REPLY',
  'BOUNCE',
]);

// What kind of Drive artifact a campaign_assets row points at.
export const assetKindEnum = pgEnum('asset_kind', [
  'EMAIL_TEMPLATE',
  'NEWS_BRIEF',
  'NICHE_ANALYSIS',
  'COACH_REPORT',
  'CONTRACT_TEMPLATE',
  'OTHER',
]);

// ContractMaker contract lifecycle: GENERATED → SENT → SIGNED; FAILED = the
// generation/send errored (detail in contracts.error).
export const contractStatusEnum = pgEnum('contract_status', [
  'GENERATED',
  'SENT',
  'SIGNED',
  'FAILED',
]);
