import { z } from 'zod';
import {
  AdminUserDto,
  CreateUserDto,
  SetPasswordDto,
  UserStatsDto,
  MeetingDto,
  MeetingListDto,
  MeetingSyncResultDto,
  LinkMeetingDto,
  AnalyzeMeetingDto,
  PersonaListDto,
  ArsenalBackfillResultDto,
  ArsenalExecutionsDto,
  ArsenalRunDto,
  ArsenalSettingsDto,
  ArsenalStage,
  CampaignDto,
  CampaignFilesDto,
  CreateCampaignDto,
  NotificationDto,
  UpdateCampaignLifecycleDto,
  CreateCustomerDto,
  CustomerDto,
  HealthDto,
  LoginDto,
  GoogleLoginDto,
  LoginResponseDto,
  MarketingDraftListDto,
  MarketingReportDto,
  MarketingReportPeriod,
  ScanLeadsResultDto,
  SendDraftDto,
  SendDraftResultDto,
  ScorecardDto,
  PerformanceOverviewDto,
  PerformanceBriefDto,
  KpiDefinitionDto,
  CreateKpiValueDto,
  MeDto,
  RunArsenalDto,
  UpdateArsenalSettingsDto,
  WorkflowConfigDto,
  UpdateWorkflowConfigDto,
  OrgSenderDto,
  ConnectedGoogleAccountDto,
  SetGoogleDefaultsDto,
  LeadStatsDto,
  TestN8nResultDto,
  RotateIngestTokenResultDto,
  UpdateCustomerDto,
  UpdateMyNameDto,
  UpdateUserDto,
  UserListItemDto,
  CreateLeadDto,
  UpdateLeadDto,
  LeadDto,
  LeadBackfillResultDto,
  ProvisionHotLeadsResultDto,
  RunHotLeadsPipelineResultDto,
  ClearResultDto,
  type LeadStage,
  // Growth Engine: prospects, niche targets, reply drafts, outreach, contracts,
  // suppressions (the cold-outreach surface).
  IndustryDto,
  IndustryListItemDto,
  CreateIndustryDto,
  UpdateIndustryDto,
  AssignNicheIndustryDto,
  NicheDto,
  NicheListItemDto,
  CreateNicheDto,
  UpdateNicheDto,
  NicheTargetDto,
  CreateNicheTargetDto,
  UpdateNicheTargetDto,
  ProspectDto,
  ProspectListDto,
  ProspectStatus,
  UpdateProspectStatusDto,
  ReplyDraftDto,
  OutreachMessageDto,
  ContractDto,
  ContractStatus,
  SuppressionListItemDto,
  CalendarListResultDto,
} from '@evertrust/shared';
import { API_URL } from './env';

// List responses validated as arrays of the element schema, so a single drifted
// row fails the whole list loud instead of rendering undefined down the page.
const CustomerListDto = z.array(CustomerDto);
const UserListDto = z.array(UserListItemDto);
const AdminUserListDto = z.array(AdminUserDto);
// Growth Engine: the org's campaigns.
const CampaignListDto = z.array(CampaignDto);
// Growth Engine: the niche management list — catalog rows enriched with rollup
// target/campaign counts. A superset of the combobox shape (id/name/slug), so the
// AIM pick-or-create combobox still reads from the same /niches response.
const NicheListItemListDto = z.array(NicheListItemDto);
// Growth Engine: the org's industries (niche grouping parents) with their rollup
// niche counts. Grouping/search only — never part of the lead-research payload.
const IndustryListItemListDto = z.array(IndustryListItemDto);
// Growth Engine: a niche's targets (enabled + disabled) for the management view.
const NicheTargetListDto = z.array(NicheTargetDto);
// Growth Engine: the RAG reply-draft review queue.
const ReplyDraftListDto = z.array(ReplyDraftDto);
// Growth Engine: a prospect's conversation timeline (the outreach ledger).
const OutreachMessageListDto = z.array(OutreachMessageDto);
// Growth Engine: the contract list (ContractMaker output).
const ContractListDto = z.array(ContractDto);
// Growth Engine: the org's do-not-contact (suppression) list.
const SuppressionListDto = z.array(SuppressionListItemDto);
// GET /prospects/:id/detail — the prospect plus its resolved display names. The
// API returns ProspectDto & { campaignName, nicheTargetName } (an inline shape,
// not a named shared DTO), so the client owns this validation schema + type.
const ProspectDetailDto = ProspectDto.extend({
  campaignName: z.string().nullable(),
  nicheTargetName: z.string().nullable(),
});
export type ProspectDetail = z.infer<typeof ProspectDetailDto>;
// Notification bell: the unread feed.
const NotificationListDto = z.array(NotificationDto);
// Arsenal: recent ERP→n8n trigger runs.
const ArsenalRunListDto = z.array(ArsenalRunDto);
const LeadListDto = z.array(LeadDto);

// Thrown for any non-2xx response. `status` lets callers branch (e.g. 401 ->
// show "invalid credentials") without parsing prose error bodies.
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = {
  method?: string;
  // Parsed-and-validated against this schema. Pass undefined for no body (e.g. 204).
  schema?: z.ZodTypeAny;
  body?: unknown;
  signal?: AbortSignal;
};

// Response of the signature-image endpoints (POST upload, POST {url}, DELETE).
// The server returns only the resolved URL ({ signatureImageUrl }) — null after a
// clear. There is no shared DTO for this small response, so it's validated here.
const SignatureImageResultDto = z.object({
  signatureImageUrl: z.string().url().nullable(),
});

// The org's resolved senders (GET, and the body returned by upsert/remove). Validated
// as an array so a single drifted row fails the whole list loud.
const OrgSenderListDto = z.array(OrgSenderDto);

// POST /arsenal/config/senders body — the upsert shape. Shared only ships the READ
// DTO (OrgSenderDto), so the write body is validated here (mirrors the server's
// UpsertOrgSenderSchema): key + email required, label optional, isDefault optional.
const UpsertOrgSenderBodyDto = z.object({
  key: z.string().min(1),
  email: z.string().email(),
  label: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type UpsertOrgSenderBody = z.infer<typeof UpsertOrgSenderBodyDto>;

// The org's connected Google accounts (GET, and the body returned by set-defaults /
// disconnect). Validated as an array so a single drifted row fails the whole list loud.
const ConnectedGoogleAccountListDto = z.array(ConnectedGoogleAccountDto);

// GET /google/connect/start response — the consent-screen URL the browser redirects to.
const GoogleConnectStartDto = z.object({
  url: z.string().url(),
});

// Single choke point for every API call:
//  - always credentials:'include' so the httpOnly access_token cookie rides along
//    (cross-origin; the API enables CORS with credentials),
//  - validates the response against the @evertrust/shared contract so the UI fails
//    loud on drift instead of rendering undefined.
async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', schema, body, signal } = opts;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    // Network/CORS failure — surface as a 0-status ApiError so callers handle it
    // the same way as HTTP errors.
    throw new ApiError(0, 'Network error: could not reach the API.');
  }

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorMessage(res));
  }

  if (!schema) {
    return undefined as T;
  }

  const json: unknown = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, 'Unexpected response shape from API.');
  }
  return parsed.data as T;
}

// Multipart POST for file uploads. Distinct from request() because the body is a
// FormData (the browser sets the multipart Content-Type + boundary itself — we
// must NOT set it). Still credentials:'include' (cookie auth) and still validates
// the JSON response against the shared contract.
async function uploadRequest<T>(
  path: string,
  form: FormData,
  schema: z.ZodTypeAny,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
  } catch {
    throw new ApiError(0, 'Network error: could not reach the API.');
  }

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorMessage(res));
  }

  const json: unknown = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, 'Unexpected response shape from API.');
  }
  return parsed.data as T;
}

// Best-effort human message from a NestJS error body ({ message } | { message: [] }).
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'message' in data) {
      const m = (data as { message: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
    }
  } catch {
    // ignore — fall through to the status-based default
  }
  return `Request failed (${res.status}).`;
}

export const api = {
  health: (signal?: AbortSignal) =>
    request<HealthDto>('/health', { schema: HealthDto, signal }),

  login: (input: z.infer<typeof LoginDto>) =>
    request<LoginResponseDto>('/auth/login', {
      method: 'POST',
      body: LoginDto.parse(input),
      schema: LoginResponseDto,
    }),

  // Google-only login: POST the Google ID token (the GIS credential) to the API,
  // which verifies it and resolves/auto-provisions the user + org. Returns the same
  // { accessToken, user } shape as the password path. 401 = invalid token, 403 =
  // public/free email domain, 503 = GOOGLE_CLIENT_ID not configured on the API.
  googleLogin: (idToken: string) =>
    request<LoginResponseDto>('/auth/google', {
      method: 'POST',
      body: GoogleLoginDto.parse({ idToken }),
      schema: LoginResponseDto,
    }),

  me: (signal?: AbortSignal) =>
    request<MeDto>('/auth/me', { schema: MeDto, signal }),

  updateMyName: (input: z.infer<typeof UpdateMyNameDto>) =>
    request<MeDto>('/users/me', {
      method: 'PATCH',
      body: UpdateMyNameDto.parse(input),
      schema: MeDto,
    }),

  // ---- Users (org directory for pickers) ----
  users: {
    list: (signal?: AbortSignal) =>
      request<UserListItemDto[]>('/users', { schema: UserListDto, signal }),
  },

  // ---- Admin: user management (users:manage) ----
  adminUsers: {
    list: (signal?: AbortSignal) =>
      request<AdminUserDto[]>('/admin/users', {
        schema: AdminUserListDto,
        signal,
      }),

    // Change a user's role / position / department (async per-cell edit).
    update: (id: string, input: z.infer<typeof UpdateUserDto>) =>
      request<AdminUserDto>(`/admin/users/${id}`, {
        method: 'PATCH',
        body: UpdateUserDto.parse(input),
        schema: AdminUserDto,
      }),

    // Create a new user (admin sets the initial password — no register flow).
    create: (input: z.infer<typeof CreateUserDto>) =>
      request<AdminUserDto>('/admin/users', {
        method: 'POST',
        body: CreateUserDto.parse(input),
        schema: AdminUserDto,
      }),

    // Hard-delete a user (server guards self / Super Admin; 409 if referenced).
    remove: (id: string) =>
      request<{ id: string }>(`/admin/users/${id}`, {
        method: 'DELETE',
        schema: z.object({ id: z.string() }),
      }),

    // Real per-user contribution stats for the profile page.
    stats: (id: string, signal?: AbortSignal) =>
      request<UserStatsDto>(`/admin/users/${id}/stats`, {
        schema: UserStatsDto,
        signal,
      }),

    // Admin password reset (sets a new password for the user).
    setPassword: (id: string, password: string) =>
      request<{ id: string }>(`/admin/users/${id}/password`, {
        method: 'POST',
        body: SetPasswordDto.parse({ password }),
        schema: z.object({ id: z.string() }),
      }),
  },

  // ---- Growth Engine: campaigns (the AIM sequence) ----
  campaigns: {
    list: (signal?: AbortSignal) =>
      request<CampaignDto[]>('/campaigns', { schema: CampaignListDto, signal }),

    get: (id: string, signal?: AbortSignal) =>
      request<CampaignDto>(`/campaigns/${id}`, { schema: CampaignDto, signal }),

    // Every file in the campaign's Drive folder (each row links into Drive).
    files: (id: string, signal?: AbortSignal) =>
      request<z.infer<typeof CampaignFilesDto>>(`/campaigns/${id}/files`, {
        schema: CampaignFilesDto,
        signal,
      }),

    // "Lock & Load": persists the campaign and fires the AIM webhook server-side.
    create: (input: z.infer<typeof CreateCampaignDto>) =>
      request<CampaignDto>('/campaigns', {
        method: 'POST',
        body: CreateCampaignDto.parse(input),
        schema: CampaignDto,
      }),

    // Delete a campaign (ERP record only — the Drive folder + leads are untouched).
    delete: (id: string) =>
      request<void>(`/campaigns/${id}`, { method: 'DELETE' }),

    // Pause / resume / archive: move the campaign through its lifecycle. The body
    // enum excludes DRAFT (a campaign only ever moves forward out of DRAFT).
    setLifecycle: (
      id: string,
      lifecycle: z.infer<typeof UpdateCampaignLifecycleDto>['lifecycle'],
    ) =>
      request<CampaignDto>(`/campaigns/${id}/lifecycle`, {
        method: 'PATCH',
        body: UpdateCampaignLifecycleDto.parse({ lifecycle }),
        schema: CampaignDto,
      }),
  },

  // ---- Growth Engine: niches (org-scoped; targets derive per-niche) ----
  niches: {
    // The management list: catalog rows enriched with target/campaign counts. A
    // superset of the combobox shape (id/name/slug), so the AIM combobox still works.
    list: (signal?: AbortSignal) =>
      request<NicheListItemDto[]>('/niches', {
        schema: NicheListItemListDto,
        signal,
      }),

    // A niche's targets for the management view — enabled AND disabled.
    targets: (id: string, signal?: AbortSignal) =>
      request<NicheTargetDto[]>(`/niches/${id}/targets`, {
        schema: NicheTargetListDto,
        signal,
      }),

    // Add a MANUAL target to a niche (upserts by slug server-side).
    addTarget: (id: string, input: z.infer<typeof CreateNicheTargetDto>) =>
      request<NicheTargetDto>(`/niches/${id}/targets`, {
        method: 'POST',
        body: CreateNicheTargetDto.parse(input),
        schema: NicheTargetDto,
      }),

    // Assign the niche to an industry (or unassign with industryId = null).
    // Grouping only — does not touch the campaign config or the arsenal payload.
    assignIndustry: (id: string, industryId: string | null) =>
      request<NicheDto>(`/niches/${id}/industry`, {
        method: 'PATCH',
        body: AssignNicheIndustryDto.parse({ industryId }),
        schema: NicheDto,
      }),

    // Create a niche directly (deduped by org + slugify(name) server-side; a slug
    // clash is a 409). `industryId` optionally assigns the grouping parent.
    create: (input: z.infer<typeof CreateNicheDto>) =>
      request<NicheDto>('/niches', {
        method: 'POST',
        body: CreateNicheDto.parse(input),
        schema: NicheDto,
      }),

    // Rename a niche (409 on a sibling slug clash in the same org).
    rename: (id: string, input: z.infer<typeof UpdateNicheDto>) =>
      request<NicheDto>(`/niches/${id}`, {
        method: 'PATCH',
        body: UpdateNicheDto.parse(input),
        schema: NicheDto,
      }),

    // Delete a niche (409 if it still has campaigns or prospects).
    remove: (id: string) =>
      request<ClearResultDto>(`/niches/${id}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  // ---- Growth Engine: industries (org-scoped niche grouping; search only) ----
  industries: {
    // The management list: industry rows enriched with their niche counts.
    list: (signal?: AbortSignal) =>
      request<IndustryListItemDto[]>('/industries', {
        schema: IndustryListItemListDto,
        signal,
      }),

    // Create an industry (deduped by org + slugify(name) server-side).
    create: (input: z.infer<typeof CreateIndustryDto>) =>
      request<IndustryDto>('/industries', {
        method: 'POST',
        body: CreateIndustryDto.parse(input),
        schema: IndustryDto,
      }),

    // Rename an industry (409 on a sibling slug clash in the same org).
    rename: (id: string, input: z.infer<typeof UpdateIndustryDto>) =>
      request<IndustryDto>(`/industries/${id}`, {
        method: 'PATCH',
        body: UpdateIndustryDto.parse(input),
        schema: IndustryDto,
      }),

    // Delete an industry (409 if niches are still assigned to it).
    remove: (id: string) =>
      request<ClearResultDto>(`/industries/${id}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  // ---- Growth Engine: niche targets addressed by their own id (root path) ----
  nicheTargets: {
    // Enable/disable, rename, or re-hint one target.
    update: (id: string, input: z.infer<typeof UpdateNicheTargetDto>) =>
      request<NicheTargetDto>(`/niche-targets/${id}`, {
        method: 'PATCH',
        body: UpdateNicheTargetDto.parse(input),
        schema: NicheTargetDto,
      }),

    // Delete one target.
    delete: (id: string) =>
      request<ClearResultDto>(`/niche-targets/${id}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  // ---- Growth Engine: prospects (the cold-outreach board) ----
  prospects: {
    // The campaign/board view: page + total + per-status tally. Filters are all
    // optional; only set keys ride along on the query string.
    board: (
      filters: {
        campaignId?: string;
        status?: z.infer<typeof ProspectStatus>;
        q?: string;
        limit?: number;
        offset?: number;
      } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      if (filters.campaignId) params.set('campaignId', filters.campaignId);
      if (filters.status) params.set('status', filters.status);
      if (filters.q) params.set('q', filters.q);
      if (filters.limit != null) params.set('limit', String(filters.limit));
      if (filters.offset != null) params.set('offset', String(filters.offset));
      const qs = params.toString();
      return request<z.infer<typeof ProspectListDto>>(
        `/prospects/board${qs ? `?${qs}` : ''}`,
        { schema: ProspectListDto, signal },
      );
    },

    // One prospect for the drawer: the row + its resolved campaign/niche-target names.
    detail: (id: string, signal?: AbortSignal) =>
      request<ProspectDetail>(`/prospects/${id}/detail`, {
        schema: ProspectDetailDto,
        signal,
      }),

    // Manual status override from the UI (archive / re-open / mark do-not-contact).
    setStatus: (id: string, input: z.infer<typeof UpdateProspectStatusDto>) =>
      request<ProspectDto>(`/prospects/${id}/status`, {
        method: 'PATCH',
        body: UpdateProspectStatusDto.parse(input),
        schema: ProspectDto,
      }),
  },

  // ---- Growth Engine: the RAG reply-draft review queue ----
  replyDrafts: {
    // reply_classifications rows WITH a suggestedReply, joined to prospect identity.
    queue: (
      filters: { prospectId?: string; limit?: number } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      if (filters.prospectId) params.set('prospectId', filters.prospectId);
      if (filters.limit != null) params.set('limit', String(filters.limit));
      const qs = params.toString();
      return request<ReplyDraftDto[]>(
        `/reply-classifications/queue${qs ? `?${qs}` : ''}`,
        { schema: ReplyDraftListDto, signal },
      );
    },
  },

  // ---- Growth Engine: a prospect's outreach conversation timeline ----
  outreach: {
    // The message ledger for a prospect, newest-first.
    thread: (prospectId: string, signal?: AbortSignal) =>
      request<OutreachMessageDto[]>(
        `/outreach-messages/thread?prospectId=${prospectId}`,
        { schema: OutreachMessageListDto, signal },
      ),
  },

  // ---- Growth Engine: contracts (ContractMaker output; read-only here) ----
  contracts: {
    // The contract list, newest-first. Filters are optional; defaults to 50 rows.
    list: (
      filters: {
        leadId?: string;
        campaignId?: string;
        status?: z.infer<typeof ContractStatus>;
      } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      if (filters.leadId) params.set('leadId', filters.leadId);
      if (filters.campaignId) params.set('campaignId', filters.campaignId);
      if (filters.status) params.set('status', filters.status);
      const qs = params.toString();
      // JWT, org-scoped route (GET /contracts is the machine/token route — a
      // browser session would 401 on it). /contracts/list is the UI's path.
      return request<ContractDto[]>(`/contracts/list${qs ? `?${qs}` : ''}`, {
        schema: ContractListDto,
        signal,
      });
    },
  },

  // ---- Growth Engine: suppressions (the org do-not-contact list) ----
  suppressions: {
    // The org's suppression list, newest-first.
    list: (signal?: AbortSignal) =>
      request<SuppressionListItemDto[]>('/suppressions', {
        schema: SuppressionListDto,
        signal,
      }),

    // Un-suppress (the human override): remove one suppression.
    delete: (id: string) =>
      request<ClearResultDto>(`/suppressions/${id}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  // ---- Notifications: the topbar bell feed ----
  notifications: {
    // Unread only, newest first, capped — the bell shows at most one page.
    listUnread: (signal?: AbortSignal) =>
      request<z.infer<typeof NotificationDto>[]>(
        '/notifications?unread=true&limit=20',
        { schema: NotificationListDto, signal },
      ),

    // Mark one notification read (response body ignored).
    markRead: (id: string) =>
      request<void>(`/notifications/${id}/read`, { method: 'PATCH' }),
  },

  // ---- Arsenal: manual stage triggers + run history ----
  arsenal: {
    listRuns: (signal?: AbortSignal) =>
      request<ArsenalRunDto[]>('/arsenal/runs', {
        schema: ArsenalRunListDto,
        signal,
      }),

    // Live per-stage n8n execution status (real run-state sync).
    executions: (signal?: AbortSignal) =>
      request<ArsenalExecutionsDto>('/arsenal/executions', {
        schema: ArsenalExecutionsDto,
        signal,
      }),

    // Marketing report — Growth-Engine sequence aggregated by period, optionally
    // scoped to one campaign.
    report: (
      period: z.infer<typeof MarketingReportPeriod>,
      campaignId?: string | null,
      signal?: AbortSignal,
    ) =>
      request<MarketingReportDto>(
        `/arsenal/report?period=${period}${campaignId ? `&campaignId=${campaignId}` : ''}`,
        { schema: MarketingReportDto, signal },
      ),

    // Backfill the report from n8n execution history (imports recent runs +
    // metrics). Idempotent server-side. Returns an import summary.
    backfill: () =>
      request<ArsenalBackfillResultDto>('/arsenal/backfill', {
        method: 'POST',
        schema: ArsenalBackfillResultDto,
      }),

    // Clear the run feed (test-data reset).
    clearRuns: () =>
      request<ClearResultDto>('/arsenal/runs', {
        method: 'DELETE',
        schema: ClearResultDto,
      }),

    // Fire a stage's n8n webhook (records + returns the run; status DISPATCHED |
    // FAILED). campaignId is required for PER_CAMPAIGN stages.
    run: (stage: ArsenalStage, input: z.infer<typeof RunArsenalDto>) =>
      request<ArsenalRunDto>(`/arsenal/${stage}/run`, {
        method: 'POST',
        body: RunArsenalDto.parse(input),
        schema: ArsenalRunDto,
      }),

    // Editable Growth-Engine settings (the daily Bazooka send time).
    getSettings: (signal?: AbortSignal) =>
      request<ArsenalSettingsDto>('/arsenal/settings', {
        schema: ArsenalSettingsDto,
        signal,
      }),

    updateSettings: (input: z.infer<typeof UpdateArsenalSettingsDto>) =>
      request<ArsenalSettingsDto>('/arsenal/settings', {
        method: 'PUT',
        body: UpdateArsenalSettingsDto.parse(input),
        schema: ArsenalSettingsDto,
      }),

    // The resolved Growth-Engine workflow config: per-stage webhooks + n8n wiring
    // (each {value, overridden}), plus secret-status flags and cadence/sender.
    getConfig: (signal?: AbortSignal) =>
      request<z.infer<typeof WorkflowConfigDto>>('/arsenal/config', {
        schema: WorkflowConfigDto,
        signal,
      }),

    // Partial update of the workflow config: a string sets an override, null (or
    // "") clears it back to the env default, an omitted key is left untouched.
    // Returns the freshly-resolved config.
    updateConfig: (input: z.infer<typeof UpdateWorkflowConfigDto>) =>
      request<z.infer<typeof WorkflowConfigDto>>('/arsenal/config', {
        method: 'PUT',
        body: UpdateWorkflowConfigDto.parse(input),
        schema: WorkflowConfigDto,
      }),

    // Org-scoped tallies (leads / prospects / suppressions) behind the
    // Configuration > Leads metric strip. Pure counts — no override semantics.
    leadStats: (signal?: AbortSignal) =>
      request<z.infer<typeof LeadStatsDto>>('/arsenal/lead-stats', {
        schema: LeadStatsDto,
        signal,
      }),

    // Probe the n8n public API with the resolved base URL + env key. Never throws
    // server-side — failures come back in `detail` (the endpoint always 200s).
    testN8n: () =>
      request<z.infer<typeof TestN8nResultDto>>('/arsenal/config/test-n8n', {
        method: 'POST',
        schema: TestN8nResultDto,
      }),

    // Rotate the machine ingest token. The plaintext `token` is returned EXACTLY
    // ONCE (only its hash is stored) — surface it to the admin to copy, then it's
    // gone. Flips ingestTokenSource → 'rotated'.
    rotateToken: () =>
      request<z.infer<typeof RotateIngestTokenResultDto>>(
        '/arsenal/config/rotate-token',
        { method: 'POST', schema: RotateIngestTokenResultDto },
      ),

    // Revert machine-route auth to the env token (deletes the stored hash).
    // Returns the freshly-resolved config (ingestTokenSource → 'env' or 'none').
    clearIngestToken: () =>
      request<z.infer<typeof WorkflowConfigDto>>('/arsenal/config/ingest-token', {
        method: 'DELETE',
        schema: WorkflowConfigDto,
      }),

    // Upload a signature image (multipart). Stores the bytes server-side and points
    // the per-org pref at an absolute hotlinkable URL; returns just that URL. The
    // caller invalidates the config query so the resolved templates pick it up.
    uploadSignatureImage: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return uploadRequest<z.infer<typeof SignatureImageResultDto>>(
        '/arsenal/config/signature-image',
        form,
        SignatureImageResultDto,
      );
    },

    // Point the signature image at a pasted URL (a Google Drive share link or any
    // image URL). The server normalizes Drive links to a hotlinkable form.
    setSignatureImageUrl: (url: string) =>
      request<z.infer<typeof SignatureImageResultDto>>(
        '/arsenal/config/signature-image',
        {
          method: 'POST',
          body: { url },
          schema: SignatureImageResultDto,
        },
      ),

    // Clear the signature image (nulls the per-org pref). Already-sent emails keep
    // resolving their embedded hotlink — this only affects future sends.
    clearSignatureImage: () =>
      request<z.infer<typeof SignatureImageResultDto>>(
        '/arsenal/config/signature-image',
        { method: 'DELETE', schema: SignatureImageResultDto },
      ),

    // The org's resolved email senders (its own rows, or DEFAULT_SENDERS when none).
    listSenders: (signal?: AbortSignal) =>
      request<OrgSenderDto[]>('/arsenal/config/senders', {
        schema: OrgSenderListDto,
        signal,
      }),

    // The org's Google calendars (live scan). { configured:false, calendars:[] } when no
    // Google token is wired or the scan failed — the AIM dialog then uses the org default.
    listCalendars: (signal?: AbortSignal) =>
      request<CalendarListResultDto>('/arsenal/config/calendars', {
        schema: CalendarListResultDto,
        signal,
      }),

    // Upsert one sender on (org, key). isDefault unsets the others. Returns the
    // resolved sender list.
    upsertSender: (input: UpsertOrgSenderBody) =>
      request<OrgSenderDto[]>('/arsenal/config/senders', {
        method: 'POST',
        body: UpsertOrgSenderBodyDto.parse(input),
        schema: OrgSenderListDto,
      }),

    // Remove a sender by key. 409 on the last remaining sender, 400 on an unknown
    // key (surfaced to the caller via ApiError). Returns the resolved list.
    removeSender: (key: string) =>
      request<OrgSenderDto[]>(
        `/arsenal/config/senders/${encodeURIComponent(key)}`,
        { method: 'DELETE', schema: OrgSenderListDto },
      ),
  },

  // ---- Per-org Google connect (Gmail / Calendar OAuth) ----
  // Connect is open to any authenticated user; list/defaults/disconnect require
  // admin:config (server-enforced). The caller redirects the full page to `url`.
  google: {
    // Begin the OAuth connect flow. Returns the Google consent-screen URL. 503 (an
    // ApiError with status 503) when the API isn't configured for Google connect —
    // callers branch on that to show a disabled "ask your admin" hint.
    start: (signal?: AbortSignal) =>
      request<z.infer<typeof GoogleConnectStartDto>>('/google/connect/start', {
        schema: GoogleConnectStartDto,
        signal,
      }),

    // The org's connected Google accounts (admin:config).
    list: (signal?: AbortSignal) =>
      request<ConnectedGoogleAccountDto[]>('/google/accounts', {
        schema: ConnectedGoogleAccountListDto,
        signal,
      }),

    // Set the org-level default Gmail / Calendar accounts. Returns the resolved
    // account list (defaults reflected). admin:config.
    setDefaults: (body: SetGoogleDefaultsDto) =>
      request<ConnectedGoogleAccountDto[]>('/google/accounts/defaults', {
        method: 'POST',
        body: SetGoogleDefaultsDto.parse(body),
        schema: ConnectedGoogleAccountListDto,
      }),

    // Disconnect an account by id. Returns the resolved account list. admin:config.
    disconnect: (id: string) =>
      request<ConnectedGoogleAccountDto[]>(
        `/google/accounts/${encodeURIComponent(id)}`,
        { method: 'DELETE', schema: ConnectedGoogleAccountListDto },
      ),
  },

  // ---- Sales Agent: meetings (Read.ai analyses synced from n8n) ----
  meetings: {
    list: (
      params: {
        campaignId?: string;
        ae?: string;
        persona?: string;
        search?: string;
        bucket?: string;
      } = {},
      signal?: AbortSignal,
    ) => {
      const q = new URLSearchParams();
      for (const k of ['campaignId', 'ae', 'persona', 'search', 'bucket'] as const) {
        const v = params[k];
        if (v) q.set(k, v);
      }
      const qs = q.toString();
      return request<MeetingDto[]>(`/sales/meetings${qs ? `?${qs}` : ''}`, {
        schema: MeetingListDto,
        signal,
      });
    },

    sync: () =>
      request<MeetingSyncResultDto>('/sales/meetings/sync', {
        method: 'POST',
        schema: MeetingSyncResultDto,
      }),

    link: (id: string, campaignId: string | null) =>
      request<MeetingDto>(`/sales/meetings/${id}`, {
        method: 'PATCH',
        body: LinkMeetingDto.parse({ campaignId }),
        schema: MeetingDto,
      }),

    analyze: (id: string, persona: string) =>
      request<MeetingDto>(`/sales/meetings/${id}/analyze`, {
        method: 'POST',
        body: AnalyzeMeetingDto.parse({ persona }),
        schema: MeetingDto,
      }),

    remove: (id: string) =>
      request<{ id: string }>(`/sales/meetings/${id}`, {
        method: 'DELETE',
        schema: z.object({ id: z.string() }),
      }),
  },

  // ---- Marketing: RAG Draft Review (via the EVERTRUST - RAG AGENT workflow) ----
  marketing: {
    listDrafts: (signal?: AbortSignal) =>
      request<z.infer<typeof MarketingDraftListDto>>('/marketing/drafts', {
        schema: MarketingDraftListDto,
        signal,
      }),
    sendDraft: (input: z.infer<typeof SendDraftDto>) =>
      request<z.infer<typeof SendDraftResultDto>>('/marketing/drafts/send', {
        method: 'POST',
        body: SendDraftDto.parse(input),
        schema: SendDraftResultDto,
      }),
    scanLeads: () =>
      request<z.infer<typeof ScanLeadsResultDto>>('/marketing/drafts/scan', {
        method: 'POST',
        schema: ScanLeadsResultDto,
      }),
  },

  // ---- Sales Agent: coaching personas (Drive folder, via the n8n workflow) ----
  personas: {
    list: (signal?: AbortSignal) =>
      request<z.infer<typeof PersonaListDto>>('/sales/personas', {
        schema: PersonaListDto,
        signal,
      }),
  },

  // ---- Key Account: hot-lead CRM ----
  leads: {
    list: (
      params: { stage?: LeadStage; campaignId?: string } = {},
      signal?: AbortSignal,
    ) => {
      const q = new URLSearchParams();
      if (params.stage) q.set('stage', params.stage);
      if (params.campaignId) q.set('campaignId', params.campaignId);
      const qs = q.toString();
      return request<LeadDto[]>(`/leads${qs ? `?${qs}` : ''}`, {
        schema: LeadListDto,
        signal,
      });
    },

    create: (input: z.infer<typeof CreateLeadDto>) =>
      request<LeadDto>('/leads', {
        method: 'POST',
        body: CreateLeadDto.parse(input),
        schema: LeadDto,
      }),

    update: (id: string, input: z.infer<typeof UpdateLeadDto>) =>
      request<LeadDto>(`/leads/${id}`, {
        method: 'PATCH',
        body: UpdateLeadDto.parse(input),
        schema: LeadDto,
      }),

    convert: (id: string) =>
      request<LeadDto>(`/leads/${id}/convert`, {
        method: 'POST',
        schema: LeadDto,
      }),

    backfill: () =>
      request<LeadBackfillResultDto>('/leads/backfill', {
        method: 'POST',
        schema: LeadBackfillResultDto,
      }),

    provision: (campaignId: string) =>
      request<ProvisionHotLeadsResultDto>('/leads/provision', {
        method: 'POST',
        body: { campaignId },
        schema: ProvisionHotLeadsResultDto,
      }),

    runPipeline: (campaignId?: string) =>
      request<RunHotLeadsPipelineResultDto>('/leads/run-pipeline', {
        method: 'POST',
        body: campaignId ? { campaignId } : {},
        schema: RunHotLeadsPipelineResultDto,
      }),

    // Clear all leads (test-data reset).
    clear: () =>
      request<ClearResultDto>('/leads', {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  // ---- Customers ----
  customers: {
    list: (signal?: AbortSignal) =>
      request<CustomerDto[]>('/customers', { schema: CustomerListDto, signal }),

    get: (id: string, signal?: AbortSignal) =>
      request<CustomerDto>(`/customers/${id}`, { schema: CustomerDto, signal }),

    create: (input: z.infer<typeof CreateCustomerDto>) =>
      request<CustomerDto>('/customers', {
        method: 'POST',
        body: CreateCustomerDto.parse(input),
        schema: CustomerDto,
      }),

    update: (id: string, input: z.infer<typeof UpdateCustomerDto>) =>
      request<CustomerDto>(`/customers/${id}`, {
        method: 'PATCH',
        body: UpdateCustomerDto.parse(input),
        schema: CustomerDto,
      }),
  },

  // ---- Performance (PMS) ----
  performance: {
    scorecards: (period = 'WEEKLY', signal?: AbortSignal) =>
      request<ScorecardDto[]>(`/performance/scorecards?period=${period}`, {
        schema: z.array(ScorecardDto),
        signal,
      }),

    overview: (period = 'WEEKLY', signal?: AbortSignal) =>
      request<PerformanceOverviewDto>(`/performance/overview?period=${period}`, {
        schema: PerformanceOverviewDto,
        signal,
      }),

    definitions: (signal?: AbortSignal) =>
      request<KpiDefinitionDto[]>('/performance/definitions', {
        schema: z.array(KpiDefinitionDto),
        signal,
      }),

    brief: (period = 'WEEKLY', signal?: AbortSignal) =>
      request<PerformanceBriefDto>(`/performance/brief?period=${period}`, {
        schema: PerformanceBriefDto,
        signal,
      }),

    generateBrief: (period = 'WEEKLY') =>
      request<PerformanceBriefDto>(
        `/performance/brief/generate?period=${period}`,
        { method: 'POST', schema: PerformanceBriefDto },
      ),

    createKpiValue: (input: z.infer<typeof CreateKpiValueDto>) =>
      request<{ ok: true }>('/performance/kpi-values', {
        method: 'POST',
        body: CreateKpiValueDto.parse(input),
        schema: z.object({ ok: z.literal(true) }),
      }),
  },
};
