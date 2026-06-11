import type { ListTendersQuery } from '@evertrust/shared';

// Central registry of TanStack Query keys so cache reads/invalidations stay in
// sync. Each resource exposes `all` (the invalidation root — invalidating it
// catches every list/detail under it), plus the specific list/detail keys.
export const queryKeys = {
  me: ['me'] as const,

  // Org user directory (assignee picker).
  users: {
    all: ['users'] as const,
    list: () => ['users', 'list'] as const,
  },

  // Admin user management (full rows; role/position/department editing).
  adminUsers: {
    all: ['admin-users'] as const,
    list: () => ['admin-users', 'list'] as const,
    stats: (id: string) => ['admin-users', 'stats', id] as const,
  },

  tenders: {
    all: ['tenders'] as const,
    list: (query?: ListTendersQuery) => ['tenders', 'list', query ?? {}] as const,
    detail: (id: string) => ['tenders', 'detail', id] as const,
    // Phase 4: the tender's ACTIVE assignment and its TYPE 1 documents.
    assignment: (id: string) => ['tenders', 'assignment', id] as const,
    documents: (id: string) => ['tenders', 'documents', id] as const,
    // Phase 5a: the tender's LV line items and its computed pricing view.
    lineItems: (id: string) => ['tenders', 'line-items', id] as const,
    pricing: (id: string) => ['tenders', 'pricing', id] as const,
    // Phase 6: the tender's customer-approval requests (gate state).
    approvals: (id: string) => ['tenders', 'approvals', id] as const,
    // Phase 5c: the tender's dispatched supplier RFQs.
    rfqs: (id: string) => ['tenders', 'rfqs', id] as const,
    // Phase 7: the tender's submission readiness (gate state + receipts).
    submission: (id: string) => ['tenders', 'submission', id] as const,
    // Phase 6b: the org-wide deadline at-risk worklist (no id — it's a roll-up).
    deadlineRisk: () => ['tenders', 'deadline-risk'] as const,
  },

  // Phase 5a: a single line's price observations (keyed by line-item id).
  lineItems: {
    all: ['line-items'] as const,
    observations: (id: string) => ['line-items', 'observations', id] as const,
  },

  // Growth Engine: the org's campaigns (the AIM sequence).
  campaigns: {
    all: ['campaigns'] as const,
    list: () => ['campaigns', 'list'] as const,
    detail: (id: string) => ['campaigns', 'detail', id] as const,
    files: (id: string) => ['campaigns', 'files', id] as const,
  },

  // Arsenal: ERP→n8n stage trigger runs + editable settings.
  arsenal: {
    all: ['arsenal'] as const,
    runs: () => ['arsenal', 'runs'] as const,
    settings: () => ['arsenal', 'settings'] as const,
    // Phase 7+: live per-stage n8n execution status.
    executions: () => ['arsenal', 'executions'] as const,
    // Marketing report, scoped by period (day/week/month) + optional campaign.
    report: (period: string, campaignId?: string | null) =>
      ['arsenal', 'report', period, campaignId ?? 'all'] as const,
  },

  // Sales Agent: synced, campaign-attributed meetings.
  meetings: {
    all: ['meetings'] as const,
    list: (
      f: {
        campaignId?: string;
        ae?: string;
        persona?: string;
        search?: string;
        bucket?: string;
      } = {},
    ) =>
      [
        'meetings',
        'list',
        f.campaignId ?? 'all',
        f.ae ?? 'all',
        f.persona ?? 'all',
        f.search ?? '',
        f.bucket ?? 'all',
      ] as const,
  },

  // Sales Agent: coaching personas (ERP-managed).
  personas: {
    all: ['personas'] as const,
    list: () => ['personas', 'list'] as const,
  },

  // Marketing: RAG draft-review queue (from the RAG Agent workflow).
  marketing: {
    all: ['marketing'] as const,
    drafts: () => ['marketing', 'drafts'] as const,
  },

  // Key Account: hot-lead CRM.
  leads: {
    all: ['leads'] as const,
    list: (stage?: string | null, campaignId?: string | null) =>
      ['leads', 'list', stage ?? 'all', campaignId ?? 'all'] as const,
  },

  suppliers: {
    all: ['suppliers'] as const,
    list: () => ['suppliers', 'list'] as const,
    detail: (id: string) => ['suppliers', 'detail', id] as const,
  },

  customers: {
    all: ['customers'] as const,
    list: () => ['customers', 'list'] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
  },

  // Performance Management System: scorecards + executive rollup, by period.
  performance: {
    all: ['performance'] as const,
    scorecards: (period: string) =>
      ['performance', 'scorecards', period] as const,
    overview: (period: string) => ['performance', 'overview', period] as const,
    brief: (period: string) => ['performance', 'brief', period] as const,
    definitions: () => ['performance', 'definitions'] as const,
    contributions: (tenderId: string) =>
      ['performance', 'contributions', tenderId] as const,
  },
};
