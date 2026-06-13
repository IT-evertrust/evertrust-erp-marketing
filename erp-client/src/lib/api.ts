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
  ApprovalRequestDto,
  ArsenalBackfillResultDto,
  ArsenalExecutionsDto,
  ArsenalRunDto,
  ArsenalSettingsDto,
  ArsenalStage,
  AssignmentDto,
  AssignTenderDto,
  CampaignDto,
  CampaignFilesDto,
  CreateApprovalRequestDto,
  CreateCampaignDto,
  NotificationDto,
  UpdateCampaignLifecycleDto,
  CreateCustomerDto,
  CreateLineItemDto,
  CreatePriceObservationDto,
  CreateRfqDto,
  CreateSupplierDto,
  CreateTenderDto,
  CustomerDto,
  DecideApprovalDto,
  DocumentDto,
  HealthDto,
  LineItemDto,
  ListTendersQuery,
  LoginDto,
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
  TenderContributionDto,
  CreateTenderContributionDto,
  MeDto,
  PriceAssistResultDto,
  PriceObservationDto,
  RfqDto,
  RunArsenalDto,
  SubmissionReadinessDto,
  SubmissionReceiptDto,
  SubmitTenderDto,
  SupplierDto,
  TenderDeadlineRiskDto,
  TenderDto,
  TenderPricingDto,
  TransitionTenderDto,
  UpdateArsenalSettingsDto,
  WorkflowConfigDto,
  UpdateWorkflowConfigDto,
  LeadStatsDto,
  TestN8nResultDto,
  RotateIngestTokenResultDto,
  UpdateCustomerDto,
  UpdateLineItemDto,
  UpdateMyNameDto,
  UpdateSupplierDto,
  UpdateTenderDto,
  UpdateUserDto,
  UploadDocumentDto,
  UpsertPricingDto,
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
} from '@evertrust/shared';
import { API_URL } from './env';

// List responses validated as arrays of the element schema, so a single drifted
// row fails the whole list loud instead of rendering undefined down the page.
const TenderListDto = z.array(TenderDto);
const SupplierListDto = z.array(SupplierDto);
const CustomerListDto = z.array(CustomerDto);
const UserListDto = z.array(UserListItemDto);
const AdminUserListDto = z.array(AdminUserDto);
const DocumentListDto = z.array(DocumentDto);
// Phase 5a pricing: list shapes validated as arrays so a single drifted row
// fails the whole list loud instead of rendering undefined down the page.
const LineItemListDto = z.array(LineItemDto);
const PriceObservationListDto = z.array(PriceObservationDto);
// Phase 6: the tender's approval requests, validated as an array so a single
// drifted row fails the whole list loud.
const ApprovalListDto = z.array(ApprovalRequestDto);
// Phase 6b: the org's deadline at-risk worklist.
const TenderDeadlineRiskListDto = z.array(TenderDeadlineRiskDto);
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
// Phase 5c: the RFQs dispatched for a tender.
const RfqListDto = z.array(RfqDto);
// GET /tenders/:id/assignment returns the ACTIVE assignment or null.
const AssignmentOrNullDto = AssignmentDto.nullable();

// Build a `?status=...` query string from the (optional) typed list filter. Kept
// tiny and explicit; only adds keys that are set.
function tendersQuery(query?: z.infer<typeof ListTendersQuery>): string {
  if (!query?.status) return '';
  const params = new URLSearchParams({ status: query.status });
  return `?${params.toString()}`;
}

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

  // ---- Tenders ----
  tenders: {
    list: (query?: z.infer<typeof ListTendersQuery>, signal?: AbortSignal) =>
      request<TenderDto[]>(`/tenders${tendersQuery(query)}`, {
        schema: TenderListDto,
        signal,
      }),

    get: (id: string, signal?: AbortSignal) =>
      request<TenderDto>(`/tenders/${id}`, { schema: TenderDto, signal }),

    // Phase 6 (R31): the org's deadline at-risk worklist (most urgent first).
    deadlineRisk: (signal?: AbortSignal) =>
      request<TenderDeadlineRiskDto[]>('/tenders/deadline-risk', {
        schema: TenderDeadlineRiskListDto,
        signal,
      }),

    create: (input: z.infer<typeof CreateTenderDto>) =>
      request<TenderDto>('/tenders', {
        method: 'POST',
        body: CreateTenderDto.parse(input),
        schema: TenderDto,
      }),

    update: (id: string, input: z.infer<typeof UpdateTenderDto>) =>
      request<TenderDto>(`/tenders/${id}`, {
        method: 'PATCH',
        body: UpdateTenderDto.parse(input),
        schema: TenderDto,
      }),

    transition: (id: string, input: z.infer<typeof TransitionTenderDto>) =>
      request<TenderDto>(`/tenders/${id}/transition`, {
        method: 'POST',
        body: TransitionTenderDto.parse(input),
        schema: TenderDto,
      }),

    // ---- Phase 4: assignment ----
    getAssignment: (id: string, signal?: AbortSignal) =>
      request<AssignmentDto | null>(`/tenders/${id}/assignment`, {
        schema: AssignmentOrNullDto,
        signal,
      }),

    assign: (id: string, input: z.infer<typeof AssignTenderDto>) =>
      request<AssignmentDto>(`/tenders/${id}/assign`, {
        method: 'POST',
        body: AssignTenderDto.parse(input),
        schema: AssignmentDto,
      }),

    // ---- Phase 4: TYPE 1 documents ----
    listDocuments: (id: string, signal?: AbortSignal) =>
      request<DocumentDto[]>(`/tenders/${id}/documents`, {
        schema: DocumentListDto,
        signal,
      }),

    uploadDocument: (
      id: string,
      file: File,
      input: z.infer<typeof UploadDocumentDto>,
    ) => {
      const form = new FormData();
      form.append('file', file);
      form.append('type', input.type);
      if (input.kind) form.append('kind', input.kind);
      return uploadRequest<DocumentDto>(
        `/tenders/${id}/documents`,
        form,
        DocumentDto,
      );
    },

    // ---- Phase 5a: LV line items (read/create are tender-scoped) ----
    listLineItems: (id: string, signal?: AbortSignal) =>
      request<LineItemDto[]>(`/tenders/${id}/line-items`, {
        schema: LineItemListDto,
        signal,
      }),

    createLineItem: (id: string, input: z.infer<typeof CreateLineItemDto>) =>
      request<LineItemDto>(`/tenders/${id}/line-items`, {
        method: 'POST',
        body: CreateLineItemDto.parse(input),
        schema: LineItemDto,
      }),

    // ---- Phase 5a: computed pricing view + margin + finalize ----
    getPricing: (id: string, signal?: AbortSignal) =>
      request<TenderPricingDto>(`/tenders/${id}/pricing`, {
        schema: TenderPricingDto,
        signal,
      }),

    setMargin: (id: string, input: z.infer<typeof UpsertPricingDto>) =>
      request<TenderPricingDto>(`/tenders/${id}/pricing`, {
        method: 'PUT',
        body: UpsertPricingDto.parse(input),
        schema: TenderPricingDto,
      }),

    // Lock pricing FINAL; the server also transitions the tender to
    // CUSTOMER_PRICING (so callers invalidate the tender query too).
    finalizePricing: (id: string) =>
      request<TenderPricingDto>(`/tenders/${id}/pricing/finalize`, {
        method: 'POST',
        schema: TenderPricingDto,
      }),

    // ---- Phase 6: customer-approval gate (list + open a request) ----
    listApprovals: (id: string, signal?: AbortSignal) =>
      request<ApprovalRequestDto[]>(`/tenders/${id}/approvals`, {
        schema: ApprovalListDto,
        signal,
      }),

    requestApproval: (
      id: string,
      input: z.infer<typeof CreateApprovalRequestDto>,
    ) =>
      request<ApprovalRequestDto>(`/tenders/${id}/approvals`, {
        method: 'POST',
        body: CreateApprovalRequestDto.parse(input),
        schema: ApprovalRequestDto,
      }),

    // ---- Phase 5c: Hermes supplier RFQ (list + dispatch) ----
    listRfqs: (id: string, signal?: AbortSignal) =>
      request<RfqDto[]>(`/tenders/${id}/rfqs`, {
        schema: RfqListDto,
        signal,
      }),

    // Dispatch an RFQ to suppliers (fires the Hermes webhook server-side). Returns
    // the recorded row (status DISPATCHED | FAILED — the webhook is best-effort).
    sendRfq: (id: string, input: z.infer<typeof CreateRfqDto>) =>
      request<RfqDto>(`/tenders/${id}/rfqs`, {
        method: 'POST',
        body: CreateRfqDto.parse(input),
        schema: RfqDto,
      }),

    // ---- Phase 7: submission readiness (the gate state) + the submit act ----
    submission: (id: string, signal?: AbortSignal) =>
      request<SubmissionReadinessDto>(`/tenders/${id}/submission`, {
        schema: SubmissionReadinessDto,
        signal,
      }),

    // Record the human submission proof; the API enforces the full gate, logs the
    // receipt and advances the tender to SUBMITTED. Returns the receipt.
    submit: (id: string, input: z.infer<typeof SubmitTenderDto>) =>
      request<SubmissionReceiptDto>(`/tenders/${id}/submit`, {
        method: 'POST',
        body: SubmitTenderDto.parse(input),
        schema: SubmissionReceiptDto,
      }),
  },

  // ---- Phase 6: approvals addressed by their own id (record a decision) ----
  approvals: {
    decide: (id: string, input: z.infer<typeof DecideApprovalDto>) =>
      request<ApprovalRequestDto>(`/approvals/${id}/decide`, {
        method: 'POST',
        body: DecideApprovalDto.parse(input),
        schema: ApprovalRequestDto,
      }),
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

  // ---- Phase 5a: line items addressed by their own id (update/delete) ----
  lineItems: {
    update: (id: string, input: z.infer<typeof UpdateLineItemDto>) =>
      request<LineItemDto>(`/line-items/${id}`, {
        method: 'PATCH',
        body: UpdateLineItemDto.parse(input),
        schema: LineItemDto,
      }),

    delete: (id: string) =>
      request<void>(`/line-items/${id}`, { method: 'DELETE' }),

    // A line's price evidence (newest-first; the engine treats input order as
    // such on equal-weight ties).
    listObservations: (id: string, signal?: AbortSignal) =>
      request<PriceObservationDto[]>(`/line-items/${id}/observations`, {
        schema: PriceObservationListDto,
        signal,
      }),

    addObservation: (
      id: string,
      input: z.infer<typeof CreatePriceObservationDto>,
    ) =>
      request<PriceObservationDto>(`/line-items/${id}/observations`, {
        method: 'POST',
        body: CreatePriceObservationDto.parse(input),
        schema: PriceObservationDto,
      }),

    // Phase 5b: ask Claude for a unit-price SUGGESTION (never auto-applied — the
    // human records it as an AI_ESTIMATE observation). { configured:false } when
    // Claude isn't wired up; { error } on a model failure (the call still 200s).
    priceAssist: (id: string) =>
      request<PriceAssistResultDto>(`/line-items/${id}/price-assist`, {
        method: 'POST',
        schema: PriceAssistResultDto,
      }),
  },

  // ---- Phase 5a: price observations addressed by their own id (delete) ----
  priceObservations: {
    delete: (id: string) =>
      request<void>(`/price-observations/${id}`, { method: 'DELETE' }),
  },

  // ---- Documents (binary download) ----
  documents: {
    // The browser navigates/links straight to this URL; the httpOnly auth cookie
    // rides along (same-site) so no Authorization header is needed.
    downloadUrl: (id: string) => `${API_URL}/documents/${id}/download`,
  },

  // ---- Suppliers ----
  suppliers: {
    list: (signal?: AbortSignal) =>
      request<SupplierDto[]>('/suppliers', { schema: SupplierListDto, signal }),

    get: (id: string, signal?: AbortSignal) =>
      request<SupplierDto>(`/suppliers/${id}`, { schema: SupplierDto, signal }),

    create: (input: z.infer<typeof CreateSupplierDto>) =>
      request<SupplierDto>('/suppliers', {
        method: 'POST',
        body: CreateSupplierDto.parse(input),
        schema: SupplierDto,
      }),

    update: (id: string, input: z.infer<typeof UpdateSupplierDto>) =>
      request<SupplierDto>(`/suppliers/${id}`, {
        method: 'PATCH',
        body: UpdateSupplierDto.parse(input),
        schema: SupplierDto,
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

    contributions: (tenderId: string, signal?: AbortSignal) =>
      request<TenderContributionDto[]>(
        `/tenders/${tenderId}/contributions`,
        { schema: z.array(TenderContributionDto), signal },
      ),

    addContribution: (
      tenderId: string,
      input: z.infer<typeof CreateTenderContributionDto>,
    ) =>
      request<{ ok: true }>(`/tenders/${tenderId}/contributions`, {
        method: 'POST',
        body: CreateTenderContributionDto.parse(input),
        schema: z.object({ ok: z.literal(true) }),
      }),

    removeContribution: (tenderId: string, contributionId: string) =>
      request<{ ok: true }>(
        `/tenders/${tenderId}/contributions/${contributionId}`,
        { method: 'DELETE', schema: z.object({ ok: z.literal(true) }) },
      ),
  },
};
