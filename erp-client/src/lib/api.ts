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
  GoogleCodeLoginDto,
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
  SetDefaultMailboxDto,
  AiEngineConfigDto,
  UpdateAiEngineDto,
  LeadScraperConfigDto,
  UpdateLeadScraperDto,
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
  // suppressions.
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
  UpdateProspectStageBody,
  UpdateProspectDealBody,
  ReachBoardResultDto,
  ReachBoardLeadDto,
  UpdateReachLeadStageBody,
  UpdateReachLeadDealBody,
  CreateReachLeadBody,
  ReplyDraftDto,
  OutreachMessageDto,
  ContractDto,
  ContractStatus,
  SuppressionListItemDto,

  // Google / Calendar / Gmail.
  CalendarListResultDto,
  CalendarUpcomingDto,
  CalendarFreeSlotsDto,
  EngageReplyListDto,
  EngageScanResultDto,
  EngageSendBodyDto,
} from '@evertrust/shared';
import { API_URL } from './env';

// List responses validated as arrays of the element schema, so a single drifted
// row fails the whole list loud instead of rendering undefined down the page.
const CustomerListDto = z.array(CustomerDto);
const UserListDto = z.array(UserListItemDto);
const AdminUserListDto = z.array(AdminUserDto);
const CampaignListDto = z.array(CampaignDto);
const NicheListItemListDto = z.array(NicheListItemDto);
const IndustryListItemListDto = z.array(IndustryListItemDto);
const NicheTargetListDto = z.array(NicheTargetDto);
const ReplyDraftListDto = z.array(ReplyDraftDto);
const OutreachMessageListDto = z.array(OutreachMessageDto);
const ContractListDto = z.array(ContractDto);
const SuppressionListDto = z.array(SuppressionListItemDto);
const NotificationListDto = z.array(NotificationDto);
const ArsenalRunListDto = z.array(ArsenalRunDto);
const LeadListDto = z.array(LeadDto);

const ProspectDetailDto = ProspectDto.extend({
  campaignName: z.string().nullable(),
  nicheTargetName: z.string().nullable(),
});

export type ProspectDetail = z.infer<typeof ProspectDetailDto>;

export type CalendarRangeParams = {
  timeMin?: string;
  timeMax?: string;
  timeZone?: string;
  durationMinutes?: number;
};

export type CalendarUpcomingParams = Pick<CalendarRangeParams, 'timeMin' | 'timeMax' | 'timeZone'>;

export type CalendarFreeSlotsParams = CalendarRangeParams;

// Thrown for any non-2xx response. `status` lets callers branch without parsing
// prose error bodies.
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
  schema?: z.ZodTypeAny;
  body?: unknown;
  signal?: AbortSignal;
};

// Response of the signature-image endpoints.
const SignatureImageResultDto = z.object({
  signatureImageUrl: z.string().url().nullable(),
});

const OrgSenderListDto = z.array(OrgSenderDto);

const UpsertOrgSenderBodyDto = z.object({
  key: z.string().min(1),
  email: z.string().email(),
  label: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export type UpsertOrgSenderBody = z.infer<typeof UpsertOrgSenderBodyDto>;

const ConnectedGoogleAccountListDto = z.array(ConnectedGoogleAccountDto);

// `?accountId=…` for the Engage inbox calls, or '' for the org default mailbox.
const engageAccountQuery = (accountId?: string) =>
  accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';

const GoogleConnectStartDto = z.object({
  url: z.string().url(),
});

function calendarQuery(params?: CalendarRangeParams): string {
  const q = new URLSearchParams();

  if (params?.timeMin) q.set('timeMin', params.timeMin);
  if (params?.timeMax) q.set('timeMax', params.timeMax);
  if (params?.timeZone) q.set('timeZone', params.timeZone);

  if (params?.durationMinutes != null) {
    q.set('durationMinutes', String(params.durationMinutes));
  }

  const qs = q.toString();

  return qs ? `?${qs}` : '';
}


// A 401 means the session is gone or expired (the edge middleware lets a present
// cookie through; the API is what actually rejects a dead token). Bounce the
// browser to /login so it re-authenticates instead of rendering empty data. We
// skip the redirect while already on a /login* route (the login bootstrap itself
// probes /auth/me and expects 401s there) and on the server (no window).
function redirectToLoginOnUnauthorized(status: number): void {
  if (status !== 401) return;
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  window.location.href = '/login?expired=1';
}

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
    throw new ApiError(0, 'Network error: could not reach the API.');
  }

  if (!res.ok) {
    redirectToLoginOnUnauthorized(res.status);
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

async function uploadRequest<T>(path: string, form: FormData, schema: z.ZodTypeAny): Promise<T> {
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
    redirectToLoginOnUnauthorized(res.status);
    throw new ApiError(res.status, await readErrorMessage(res));
  }

  const json: unknown = await res.json();
  const parsed = schema.safeParse(json);

  if (!parsed.success) {
    throw new ApiError(res.status, 'Unexpected response shape from API.');
  }

  return parsed.data as T;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();

    if (data && typeof data === 'object' && 'message' in data) {
      const m = (data as { message: unknown }).message;

      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
    }
  } catch {
    // Fall through to default.
  }

  return `Request failed (${res.status}).`;
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthDto>('/health', { schema: HealthDto, signal }),

  login: (input: z.infer<typeof LoginDto>) =>
    request<LoginResponseDto>('/auth/login', {
      method: 'POST',
      body: LoginDto.parse(input),
      schema: LoginResponseDto,
    }),

  googleLogin: (idToken: string) =>
    request<LoginResponseDto>('/auth/google', {
      method: 'POST',
      body: GoogleLoginDto.parse({ idToken }),
      schema: LoginResponseDto,
    }),

  googleCodeLogin: (code: string) =>
    request<LoginResponseDto>('/auth/google/code', {
      method: 'POST',
      body: GoogleCodeLoginDto.parse({ code }),
      schema: LoginResponseDto,
    }),

  me: (signal?: AbortSignal) => request<MeDto>('/auth/me', { schema: MeDto, signal }),

  updateMyName: (input: z.infer<typeof UpdateMyNameDto>) =>
    request<MeDto>('/users/me', {
      method: 'PATCH',
      body: UpdateMyNameDto.parse(input),
      schema: MeDto,
    }),

  users: {
    list: (signal?: AbortSignal) =>
      request<UserListItemDto[]>('/users', {
        schema: UserListDto,
        signal,
      }),
  },

  adminUsers: {
    list: (signal?: AbortSignal) =>
      request<AdminUserDto[]>('/admin/users', {
        schema: AdminUserListDto,
        signal,
      }),

    update: (id: string, input: z.infer<typeof UpdateUserDto>) =>
      request<AdminUserDto>(`/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: UpdateUserDto.parse(input),
        schema: AdminUserDto,
      }),

    create: (input: z.infer<typeof CreateUserDto>) =>
      request<AdminUserDto>('/admin/users', {
        method: 'POST',
        body: CreateUserDto.parse(input),
        schema: AdminUserDto,
      }),

    remove: (id: string) =>
      request<{ id: string }>(`/admin/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: z.object({ id: z.string() }),
      }),

    stats: (id: string, signal?: AbortSignal) =>
      request<UserStatsDto>(`/admin/users/${encodeURIComponent(id)}/stats`, {
        schema: UserStatsDto,
        signal,
      }),

    setPassword: (id: string, password: string) =>
      request<{ id: string }>(`/admin/users/${encodeURIComponent(id)}/password`, {
        method: 'POST',
        body: SetPasswordDto.parse({ password }),
        schema: z.object({ id: z.string() }),
      }),
  },

  campaigns: {
    list: (signal?: AbortSignal) =>
      request<CampaignDto[]>('/campaigns', {
        schema: CampaignListDto,
        signal,
      }),

    get: (id: string, signal?: AbortSignal) =>
      request<CampaignDto>(`/campaigns/${encodeURIComponent(id)}`, {
        schema: CampaignDto,
        signal,
      }),

    files: (id: string, signal?: AbortSignal) =>
      request<z.infer<typeof CampaignFilesDto>>(`/campaigns/${encodeURIComponent(id)}/files`, {
        schema: CampaignFilesDto,
        signal,
      }),

    create: (input: z.infer<typeof CreateCampaignDto>) =>
      request<CampaignDto>('/campaigns', {
        method: 'POST',
        body: CreateCampaignDto.parse(input),
        schema: CampaignDto,
      }),

    delete: (id: string) =>
      request<void>(`/campaigns/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),

    setLifecycle: (
      id: string,
      lifecycle: z.infer<typeof UpdateCampaignLifecycleDto>['lifecycle'],
    ) =>
      request<CampaignDto>(`/campaigns/${encodeURIComponent(id)}/lifecycle`, {
        method: 'PATCH',
        body: UpdateCampaignLifecycleDto.parse({ lifecycle }),
        schema: CampaignDto,
      }),
  },

  niches: {
    list: (signal?: AbortSignal) =>
      request<NicheListItemDto[]>('/niches', {
        schema: NicheListItemListDto,
        signal,
      }),

    targets: (id: string, signal?: AbortSignal) =>
      request<NicheTargetDto[]>(`/niches/${encodeURIComponent(id)}/targets`, {
        schema: NicheTargetListDto,
        signal,
      }),

    addTarget: (id: string, input: z.infer<typeof CreateNicheTargetDto>) =>
      request<NicheTargetDto>(`/niches/${encodeURIComponent(id)}/targets`, {
        method: 'POST',
        body: CreateNicheTargetDto.parse(input),
        schema: NicheTargetDto,
      }),

    assignIndustry: (id: string, industryId: string | null) =>
      request<NicheDto>(`/niches/${encodeURIComponent(id)}/industry`, {
        method: 'PATCH',
        body: AssignNicheIndustryDto.parse({ industryId }),
        schema: NicheDto,
      }),

    create: (input: z.infer<typeof CreateNicheDto>) =>
      request<NicheDto>('/niches', {
        method: 'POST',
        body: CreateNicheDto.parse(input),
        schema: NicheDto,
      }),

    rename: (id: string, input: z.infer<typeof UpdateNicheDto>) =>
      request<NicheDto>(`/niches/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: UpdateNicheDto.parse(input),
        schema: NicheDto,
      }),

    remove: (id: string) =>
      request<ClearResultDto>(`/niches/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  industries: {
    list: (signal?: AbortSignal) =>
      request<IndustryListItemDto[]>('/industries', {
        schema: IndustryListItemListDto,
        signal,
      }),

    create: (input: z.infer<typeof CreateIndustryDto>) =>
      request<IndustryDto>('/industries', {
        method: 'POST',
        body: CreateIndustryDto.parse(input),
        schema: IndustryDto,
      }),

    rename: (id: string, input: z.infer<typeof UpdateIndustryDto>) =>
      request<IndustryDto>(`/industries/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: UpdateIndustryDto.parse(input),
        schema: IndustryDto,
      }),

    remove: (id: string) =>
      request<ClearResultDto>(`/industries/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  nicheTargets: {
    update: (id: string, input: z.infer<typeof UpdateNicheTargetDto>) =>
      request<NicheTargetDto>(`/niche-targets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: UpdateNicheTargetDto.parse(input),
        schema: NicheTargetDto,
      }),

    delete: (id: string) =>
      request<ClearResultDto>(`/niche-targets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  prospects: {
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
      const q = new URLSearchParams();

      if (filters.campaignId) q.set('campaignId', filters.campaignId);
      if (filters.status) q.set('status', filters.status);
      if (filters.q) q.set('q', filters.q);
      if (filters.limit != null) q.set('limit', String(filters.limit));
      if (filters.offset != null) q.set('offset', String(filters.offset));

      const qs = q.toString();

      return request<z.infer<typeof ProspectListDto>>(`/prospects/board${qs ? `?${qs}` : ''}`, {
        schema: ProspectListDto,
        signal,
      });
    },

    detail: (id: string, signal?: AbortSignal) =>
      request<ProspectDetail>(`/prospects/${encodeURIComponent(id)}/detail`, {
        schema: ProspectDetailDto,
        signal,
      }),

    setStatus: (id: string, input: z.infer<typeof UpdateProspectStatusDto>) =>
      request<ProspectDto>(`/prospects/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: UpdateProspectStatusDto.parse(input),
        schema: ProspectDto,
      }),

    updateStage: (id: string, input: z.infer<typeof UpdateProspectStageBody>) =>
      request<ProspectDto>(`/prospects/${encodeURIComponent(id)}/stage`, {
        method: 'PATCH',
        body: UpdateProspectStageBody.parse(input),
        schema: ProspectDto,
      }),

    updateDeal: (id: string, input: z.infer<typeof UpdateProspectDealBody>) =>
      request<ProspectDto>(`/prospects/${encodeURIComponent(id)}/deal`, {
        method: 'PATCH',
        body: UpdateProspectDealBody.parse(input),
        schema: ProspectDto,
      }),
  },

  // The Nurture pipeline, now backed by reach_leads (the prospects board is retired
  // for Nurture). Mirrors `prospects` so the Nurture UI is a drop-in swap.
  reachBoard: {
    board: (
      filters: { aimId?: string; q?: string; limit?: number; offset?: number } = {},
      signal?: AbortSignal,
    ) => {
      const q = new URLSearchParams();
      if (filters.aimId) q.set('aimId', filters.aimId);
      if (filters.q) q.set('q', filters.q);
      if (filters.limit != null) q.set('limit', String(filters.limit));
      if (filters.offset != null) q.set('offset', String(filters.offset));
      const qs = q.toString();
      return request<z.infer<typeof ReachBoardResultDto>>(
        `/growth/reach/board${qs ? `?${qs}` : ''}`,
        { schema: ReachBoardResultDto, signal },
      );
    },

    updateStage: (id: string, input: z.infer<typeof UpdateReachLeadStageBody>) =>
      request<z.infer<typeof ReachBoardLeadDto>>(
        `/growth/reach/leads/${encodeURIComponent(id)}/stage`,
        {
          method: 'PATCH',
          body: UpdateReachLeadStageBody.parse(input),
          schema: ReachBoardLeadDto,
        },
      ),

    updateDeal: (id: string, input: z.infer<typeof UpdateReachLeadDealBody>) =>
      request<z.infer<typeof ReachBoardLeadDto>>(
        `/growth/reach/leads/${encodeURIComponent(id)}/deal`,
        {
          method: 'PATCH',
          body: UpdateReachLeadDealBody.parse(input),
          schema: ReachBoardLeadDto,
        },
      ),

    create: (input: z.infer<typeof CreateReachLeadBody>) =>
      request<z.infer<typeof ReachBoardLeadDto>>('/growth/reach/leads', {
        method: 'POST',
        body: CreateReachLeadBody.parse(input),
        schema: ReachBoardLeadDto,
      }),

    remove: (id: string) =>
      request<{ deleted: boolean }>(
        `/growth/reach/leads/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
  },

  replyDrafts: {
    queue: (filters: { prospectId?: string; limit?: number } = {}, signal?: AbortSignal) => {
      const q = new URLSearchParams();

      if (filters.prospectId) q.set('prospectId', filters.prospectId);
      if (filters.limit != null) q.set('limit', String(filters.limit));

      const qs = q.toString();

      return request<ReplyDraftDto[]>(`/reply-classifications/queue${qs ? `?${qs}` : ''}`, {
        schema: ReplyDraftListDto,
        signal,
      });
    },
  },

  outreach: {
    thread: (prospectId: string, signal?: AbortSignal) =>
      request<OutreachMessageDto[]>(
        `/outreach-messages/thread?prospectId=${encodeURIComponent(prospectId)}`,
        {
          schema: OutreachMessageListDto,
          signal,
        },
      ),
  },

  contracts: {
    list: (
      filters: {
        leadId?: string;
        campaignId?: string;
        status?: z.infer<typeof ContractStatus>;
      } = {},
      signal?: AbortSignal,
    ) => {
      const q = new URLSearchParams();

      if (filters.leadId) q.set('leadId', filters.leadId);
      if (filters.campaignId) q.set('campaignId', filters.campaignId);
      if (filters.status) q.set('status', filters.status);

      const qs = q.toString();

      return request<ContractDto[]>(`/contracts/list${qs ? `?${qs}` : ''}`, {
        schema: ContractListDto,
        signal,
      });
    },
  },

  suppressions: {
    list: (signal?: AbortSignal) =>
      request<SuppressionListItemDto[]>('/suppressions', {
        schema: SuppressionListDto,
        signal,
      }),

    delete: (id: string) =>
      request<ClearResultDto>(`/suppressions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  notifications: {
    listUnread: (signal?: AbortSignal) =>
      request<z.infer<typeof NotificationDto>[]>('/notifications?unread=true&limit=20', {
        schema: NotificationListDto,
        signal,
      }),

    markRead: (id: string) =>
      request<void>(`/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
      }),
  },

  arsenal: {
    listRuns: (signal?: AbortSignal) =>
      request<ArsenalRunDto[]>('/arsenal/runs', {
        schema: ArsenalRunListDto,
        signal,
      }),

    executions: (signal?: AbortSignal) =>
      request<ArsenalExecutionsDto>('/arsenal/executions', {
        schema: ArsenalExecutionsDto,
        signal,
      }),

    report: (
      period: z.infer<typeof MarketingReportPeriod>,
      campaignId?: string | null,
      signal?: AbortSignal,
    ) => {
      const q = new URLSearchParams();

      q.set('period', period);
      if (campaignId) q.set('campaignId', campaignId);

      return request<MarketingReportDto>(`/arsenal/report?${q.toString()}`, {
        schema: MarketingReportDto,
        signal,
      });
    },

    backfill: () =>
      request<ArsenalBackfillResultDto>('/arsenal/backfill', {
        method: 'POST',
        schema: ArsenalBackfillResultDto,
      }),

    clearRuns: () =>
      request<ClearResultDto>('/arsenal/runs', {
        method: 'DELETE',
        schema: ClearResultDto,
      }),

    run: (stage: ArsenalStage, input: z.infer<typeof RunArsenalDto>) =>
      request<ArsenalRunDto>(`/arsenal/${stage}/run`, {
        method: 'POST',
        body: RunArsenalDto.parse(input),
        schema: ArsenalRunDto,
      }),

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

    getConfig: (signal?: AbortSignal) =>
      request<z.infer<typeof WorkflowConfigDto>>('/arsenal/config', {
        schema: WorkflowConfigDto,
        signal,
      }),

    updateConfig: (input: z.infer<typeof UpdateWorkflowConfigDto>) =>
      request<z.infer<typeof WorkflowConfigDto>>('/arsenal/config', {
        method: 'PUT',
        body: UpdateWorkflowConfigDto.parse(input),
        schema: WorkflowConfigDto,
      }),

    leadStats: (signal?: AbortSignal) =>
      request<z.infer<typeof LeadStatsDto>>('/arsenal/lead-stats', {
        schema: LeadStatsDto,
        signal,
      }),

    testN8n: () =>
      request<z.infer<typeof TestN8nResultDto>>('/arsenal/config/test-n8n', {
        method: 'POST',
        schema: TestN8nResultDto,
      }),

    rotateToken: () =>
      request<z.infer<typeof RotateIngestTokenResultDto>>('/arsenal/config/rotate-token', {
        method: 'POST',
        schema: RotateIngestTokenResultDto,
      }),

    clearIngestToken: () =>
      request<z.infer<typeof WorkflowConfigDto>>('/arsenal/config/ingest-token', {
        method: 'DELETE',
        schema: WorkflowConfigDto,
      }),

    uploadSignatureImage: (file: File) => {
      const form = new FormData();

      form.append('file', file);

      return uploadRequest<z.infer<typeof SignatureImageResultDto>>(
        '/arsenal/config/signature-image',
        form,
        SignatureImageResultDto,
      );
    },

    setSignatureImageUrl: (url: string) =>
      request<z.infer<typeof SignatureImageResultDto>>('/arsenal/config/signature-image', {
        method: 'POST',
        body: { url },
        schema: SignatureImageResultDto,
      }),

    clearSignatureImage: () =>
      request<z.infer<typeof SignatureImageResultDto>>('/arsenal/config/signature-image', {
        method: 'DELETE',
        schema: SignatureImageResultDto,
      }),

    listSenders: (signal?: AbortSignal) =>
      request<OrgSenderDto[]>('/arsenal/config/senders', {
        schema: OrgSenderListDto,
        signal,
      }),

    listCalendars: (signal?: AbortSignal) =>
      request<CalendarListResultDto>('/arsenal/config/calendars', {
        schema: CalendarListResultDto,
        signal,
      }),

    upsertSender: (input: UpsertOrgSenderBody) =>
      request<OrgSenderDto[]>('/arsenal/config/senders', {
        method: 'POST',
        body: UpsertOrgSenderBodyDto.parse(input),
        schema: OrgSenderListDto,
      }),

    removeSender: (key: string) =>
      request<OrgSenderDto[]>(`/arsenal/config/senders/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        schema: OrgSenderListDto,
      }),

    getAiEngine: (signal?: AbortSignal) =>
      request<z.infer<typeof AiEngineConfigDto>>('/arsenal/config/ai-engine', {
        schema: AiEngineConfigDto,
        signal,
      }),

    updateAiEngine: (input: z.infer<typeof UpdateAiEngineDto>) =>
      request<z.infer<typeof AiEngineConfigDto>>('/arsenal/config/ai-engine', {
        method: 'PUT',
        body: UpdateAiEngineDto.parse(input),
        schema: AiEngineConfigDto,
      }),

    getLeadScraper: (signal?: AbortSignal) =>
      request<z.infer<typeof LeadScraperConfigDto>>('/arsenal/config/lead-scraper', {
        schema: LeadScraperConfigDto,
        signal,
      }),

    updateLeadScraper: (input: z.infer<typeof UpdateLeadScraperDto>) =>
      request<z.infer<typeof LeadScraperConfigDto>>('/arsenal/config/lead-scraper', {
        method: 'PUT',
        body: UpdateLeadScraperDto.parse(input),
        schema: LeadScraperConfigDto,
      }),
  },

  google: {
    start: (signal?: AbortSignal) =>
      request<z.infer<typeof GoogleConnectStartDto>>('/google/connect/start', {
        schema: GoogleConnectStartDto,
        signal,
      }),

    list: (signal?: AbortSignal) =>
      request<ConnectedGoogleAccountDto[]>('/google/accounts', {
        schema: ConnectedGoogleAccountListDto,
        signal,
      }),

    setDefaults: (body: SetGoogleDefaultsDto) =>
      request<ConnectedGoogleAccountDto[]>('/google/accounts/defaults', {
        method: 'POST',
        body: SetGoogleDefaultsDto.parse(body),
        schema: ConnectedGoogleAccountListDto,
      }),

    setDefaultMailbox: (body: SetDefaultMailboxDto) =>
      request<ConnectedGoogleAccountDto[]>('/google/accounts/default', {
        method: 'POST',
        body: SetDefaultMailboxDto.parse(body),
        schema: ConnectedGoogleAccountListDto,
      }),

    disconnect: (id: string) =>
      request<ConnectedGoogleAccountDto[]>(`/google/accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: ConnectedGoogleAccountListDto,
      }),
  },

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
        const value = params[k];

        if (value) q.set(k, value);
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
      request<MeetingDto>(`/sales/meetings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: LinkMeetingDto.parse({ campaignId }),
        schema: MeetingDto,
      }),

    analyze: (id: string, persona: string) =>
      request<MeetingDto>(`/sales/meetings/${encodeURIComponent(id)}/analyze`, {
        method: 'POST',
        body: AnalyzeMeetingDto.parse({ persona }),
        schema: MeetingDto,
      }),

    remove: (id: string) =>
      request<{ id: string }>(`/sales/meetings/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: z.object({ id: z.string() }),
      }),

    //   calendarUpcoming({ timeMin, timeMax, timeZone }, signal)
    calendarUpcoming: (params: CalendarUpcomingParams = {}, signal?: AbortSignal) =>
      request<CalendarUpcomingDto>(`/meetings/calendar/upcoming${calendarQuery(params)}`, {
        schema: CalendarUpcomingDto,
        signal,
      }),

    //   calendarFreeSlots({ timeMin, timeMax, timeZone, durationMinutes }, signal)
    calendarFreeSlots: (params: CalendarFreeSlotsParams = {}, signal?: AbortSignal) =>
      request<CalendarFreeSlotsDto>(`/meetings/calendar/free-slots${calendarQuery(params)}`, {
        schema: CalendarFreeSlotsDto,
        signal,
      }),
  },

  engage: {
    // The org's connected Google mailboxes — feeds the inbox switcher. An optional
    // `accountId` on the other calls targets a specific inbox (omitted = org default).
    accounts: (signal?: AbortSignal) =>
      request<ConnectedGoogleAccountDto[]>('/engage/accounts', {
        schema: ConnectedGoogleAccountListDto,
        signal,
      }),

    replies: (accountId?: string, signal?: AbortSignal) =>
      request<EngageReplyListDto>(`/engage/replies${engageAccountQuery(accountId)}`, {
        schema: EngageReplyListDto,
        signal,
      }),

    scan: (accountId?: string) =>
      request<EngageScanResultDto>(`/engage/scan${engageAccountQuery(accountId)}`, {
        method: 'POST',
        schema: EngageScanResultDto,
      }),

    send: (id: string, text: string, accountId?: string) =>
      request<EngageReplyListDto>(
        `/engage/replies/${encodeURIComponent(id)}/send${engageAccountQuery(accountId)}`,
        {
          method: 'POST',
          body: EngageSendBodyDto.parse({ text }),
          schema: EngageReplyListDto,
        },
      ),

    redraft: (id: string, accountId?: string) =>
      request<EngageReplyListDto>(
        `/engage/replies/${encodeURIComponent(id)}/redraft${engageAccountQuery(accountId)}`,
        {
          method: 'POST',
          schema: EngageReplyListDto,
        },
      ),
  },

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

  personas: {
    list: (signal?: AbortSignal) =>
      request<z.infer<typeof PersonaListDto>>('/sales/personas', {
        schema: PersonaListDto,
        signal,
      }),
  },

  leads: {
    list: (
      params: {
        stage?: LeadStage;
        campaignId?: string;
      } = {},
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
      request<LeadDto>(`/leads/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: UpdateLeadDto.parse(input),
        schema: LeadDto,
      }),

    convert: (id: string) =>
      request<LeadDto>(`/leads/${encodeURIComponent(id)}/convert`, {
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

    clear: () =>
      request<ClearResultDto>('/leads', {
        method: 'DELETE',
        schema: ClearResultDto,
      }),
  },

  customers: {
    list: (signal?: AbortSignal) =>
      request<CustomerDto[]>('/customers', {
        schema: CustomerListDto,
        signal,
      }),

    get: (id: string, signal?: AbortSignal) =>
      request<CustomerDto>(`/customers/${encodeURIComponent(id)}`, {
        schema: CustomerDto,
        signal,
      }),

    create: (input: z.infer<typeof CreateCustomerDto>) =>
      request<CustomerDto>('/customers', {
        method: 'POST',
        body: CreateCustomerDto.parse(input),
        schema: CustomerDto,
      }),

    update: (id: string, input: z.infer<typeof UpdateCustomerDto>) =>
      request<CustomerDto>(`/customers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: UpdateCustomerDto.parse(input),
        schema: CustomerDto,
      }),
  },

  performance: {
    scorecards: (period = 'WEEKLY', signal?: AbortSignal) =>
      request<ScorecardDto[]>(`/performance/scorecards?period=${encodeURIComponent(period)}`, {
        schema: z.array(ScorecardDto),
        signal,
      }),

    overview: (period = 'WEEKLY', signal?: AbortSignal) =>
      request<PerformanceOverviewDto>(
        `/performance/overview?period=${encodeURIComponent(period)}`,
        {
          schema: PerformanceOverviewDto,
          signal,
        },
      ),

    definitions: (signal?: AbortSignal) =>
      request<KpiDefinitionDto[]>('/performance/definitions', {
        schema: z.array(KpiDefinitionDto),
        signal,
      }),

    brief: (period = 'WEEKLY', signal?: AbortSignal) =>
      request<PerformanceBriefDto>(`/performance/brief?period=${encodeURIComponent(period)}`, {
        schema: PerformanceBriefDto,
        signal,
      }),

    generateBrief: (period = 'WEEKLY') =>
      request<PerformanceBriefDto>(
        `/performance/brief/generate?period=${encodeURIComponent(period)}`,
        {
          method: 'POST',
          schema: PerformanceBriefDto,
        },
      ),

    createKpiValue: (input: z.infer<typeof CreateKpiValueDto>) =>
      request<{ ok: true }>('/performance/kpi-values', {
        method: 'POST',
        body: CreateKpiValueDto.parse(input),
        schema: z.object({ ok: z.literal(true) }),
      }),
  },
};
