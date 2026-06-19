// Central registry of TanStack Query keys so cache reads/invalidations stay in
// sync. Each resource exposes `all` (the invalidation root — invalidating it
// catches every list/detail under it), plus the specific list/detail keys.
export const queryKeys = {
  me: ['me'] as const,

  // Public API health probe (status/db) — the Configuration integrations panel.
  health: ['health'] as const,

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

  // Growth Engine: the org's campaigns (the AIM sequence).
  campaigns: {
    all: ['campaigns'] as const,
    list: () => ['campaigns', 'list'] as const,
    detail: (id: string) => ['campaigns', 'detail', id] as const,
    files: (id: string) => ['campaigns', 'files', id] as const,
  },

  // Growth Engine: the org's niche catalog (AIM pick-or-create combobox + the
  // niche management list) and each niche's targets.
  niches: {
    all: ['niches'] as const,
    list: () => ['niches', 'list'] as const,
    targets: (id: string) => ['niches', 'targets', id] as const,
  },

  // Growth Engine: the org's industries (niche grouping parents). Assigning a
  // niche to an industry mutates both this list (nicheCount) and the niche list.
  industries: {
    all: ['industries'] as const,
    list: () => ['industries', 'list'] as const,
  },

  // Growth Engine: the cold-outreach prospect board + per-prospect drawer.
  prospects: {
    all: ['prospects'] as const,
    board: (
      f: {
        campaignId?: string | null;
        status?: string | null;
        q?: string | null;
        limit?: number | null;
        offset?: number | null;
      } = {},
    ) =>
      [
        'prospects',
        'board',
        f.campaignId ?? 'all',
        f.status ?? 'all',
        f.q ?? '',
        f.limit ?? 50,
        f.offset ?? 0,
      ] as const,
    detail: (id: string) => ['prospects', 'detail', id] as const,
  },

  // Growth Engine: a prospect's outreach conversation timeline.
  outreachThread: {
    all: ['outreach-thread'] as const,
    byProspect: (prospectId: string) => ['outreach-thread', prospectId] as const,
  },

  // Growth Engine: the RAG reply-draft review queue.
  replyDrafts: {
    all: ['reply-drafts'] as const,
    queue: (prospectId?: string | null) =>
      ['reply-drafts', 'queue', prospectId ?? 'all'] as const,
  },

  // Growth Engine: contracts (ContractMaker output), filtered by lead/campaign/status.
  contracts: {
    all: ['contracts'] as const,
    list: (
      f: {
        leadId?: string | null;
        campaignId?: string | null;
        status?: string | null;
      } = {},
    ) =>
      [
        'contracts',
        'list',
        f.leadId ?? 'all',
        f.campaignId ?? 'all',
        f.status ?? 'all',
      ] as const,
  },

  // Growth Engine: the org's do-not-contact (suppression) list.
  suppressions: {
    all: ['suppressions'] as const,
    list: () => ['suppressions', 'list'] as const,
  },

  // Notification bell: the unread feed (polled by the topbar).
  notifications: {
    all: ['notifications'] as const,
    unread: () => ['notifications', 'unread'] as const,
  },

  // Per-org Google connect: the connected Gmail/Calendar accounts list
  // (Configuration > Connected Google accounts card).
  google: {
    all: ['google'] as const,
    accounts: () => ['google', 'accounts'] as const,
  },

  // Arsenal: ERP→n8n stage trigger runs + editable settings.
  arsenal: {
    all: ['arsenal'] as const,
    runs: () => ['arsenal', 'runs'] as const,
    settings: () => ['arsenal', 'settings'] as const,
    // The editable Growth-Engine workflow config (webhooks, n8n wiring, cadence).
    config: () => ['arsenal', 'config'] as const,
    // The org's resolved email senders (Configuration > Senders + the AIM sender picker).
    senders: () => ['arsenal', 'senders'] as const,
    // The org's Google calendars (live scan) for the AIM calendar picker.
    calendars: () => ['arsenal', 'calendars'] as const,
    // Org-scoped lead/prospect/suppression tallies for the Configuration metric strip.
    leadStats: () => ['arsenal', 'lead-stats'] as const,
    // The org's resolved AI engine config (Configuration > AI engine card).
    aiEngine: () => ['arsenal', 'ai-engine'] as const,
    // The org's resolved Lead Scraper tuning (Configuration > Lead scraper card).
    leadScraper: () => ['arsenal', 'lead-scraper'] as const,
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
    // Activate: live Google Calendar reads (next events + proposed free slots).
    calendarUpcoming: () => ['meetings', 'calendar', 'upcoming'] as const,
    calendarFreeSlots: () => ['meetings', 'calendar', 'free-slots'] as const,
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

  // Engage: ERP-direct Gmail reply triage queue.
  engage: {
    all: ['engage'] as const,
    replies: () => ['engage', 'replies'] as const,
  },

  // Key Account: hot-lead CRM.
  leads: {
    all: ['leads'] as const,
    list: (stage?: string | null, campaignId?: string | null) =>
      ['leads', 'list', stage ?? 'all', campaignId ?? 'all'] as const,
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
  },
};
