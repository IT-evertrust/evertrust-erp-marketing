// @evertrust/shared — single source of truth for DTOs/types shared by api + web.
// Every API contract lives here as a Zod schema so client and server cannot drift.
import { z } from 'zod';

export const HealthDto = z.object({
  status: z.literal('ok'),
  service: z.string(),
  at: z.string(),
  // false when the DB `select 1` probe fails; the endpoint still returns 200 so
  // it can be used as a container healthcheck that does not flap on DB blips.
  db: z.boolean(),
});
export type HealthDto = z.infer<typeof HealthDto>;

// User role mirrors the `user_role` pgEnum in @evertrust/db. Five authority
// tiers, highest → lowest: OWNER (platform owner — the ONLY cross-org role:
// full control PLUS access to every org's users on the admin surface),
// SUPER_ADMIN (full control within its OWN org, incl. user management), ADMIN
// (everything except managing users), MANAGER (lead-level: pricing approval,
// approvals decisions, campaign launches), EMPLOYEE (operational read +
// day-to-day write). Authority is enforced via permissions, never the role
// literal — see ROLE_PERMISSIONS; the cross-org reach is gated by isOwner().
// Kept as a literal union here so @evertrust/shared has no dependency on the DB.
export const UserRole = z.enum(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EMPLOYEE']);
export type UserRole = z.infer<typeof UserRole>;

// Human-readable role labels for UI display (SSOT so api + web never drift).
export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Owner',
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

// Department (org unit) a user belongs to. Mirrors the `department` pgEnum in
// @evertrust/db. Orthogonal to the role tier and NULLABLE — e.g. a CEO may sit
// across the whole company with no single department.
export const Department = z.enum([
  'OPERATIONS',
  'IT',
  'CONSULTING',
  'MARKETING',
  'BUSINESS',
  'HR',
]);
export type Department = z.infer<typeof Department>;
export const DEPARTMENT_LABELS: Record<Department, string> = {
  OPERATIONS: 'Operations',
  IT: 'IT',
  CONSULTING: 'Consulting',
  MARKETING: 'Marketing',
  BUSINESS: 'Business',
  HR: 'HR',
};

// Job title / position. Mirrors the `user_position` pgEnum in @evertrust/db.
// Orthogonal to role + department and NULLABLE. Descriptive only — it carries no
// authority (authority comes from the role's permissions).
export const Position = z.enum([
  'CEO',
  'CTO',
  'CFO',
  'COO',
  'DEPT_MANAGER',
  'EXECUTIVE',
  'OFFICER',
  'SPECIALIST',
]);
export type Position = z.infer<typeof Position>;
export const POSITION_LABELS: Record<Position, string> = {
  CEO: 'CEO',
  CTO: 'CTO',
  CFO: 'CFO',
  COO: 'COO',
  DEPT_MANAGER: 'Dept. Manager',
  EXECUTIVE: 'Executive',
  OFFICER: 'Officer',
  SPECIALIST: 'Specialist',
};

// ---- Permissions (single source of truth for RBAC) ----
// Roles are coarse identity; permissions are the fine-grained authority the API
// enforces. A role expands to a set of permissions via ROLE_PERMISSIONS, and the
// API's PermissionsGuard checks permissions — never roles — so authorization
// rules live in one place and the role->permission mapping can evolve freely.
export const PERMISSIONS = [
  'customers:read',
  'customers:write',
  'campaigns:read',
  'campaigns:write',
  'performance:read',
  'performance:write',
  'performance:admin',
  'audit:read',
  'users:manage',
  'org:manage',
  'admin:config',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Zod enum over the permission catalog — validates permission arrays on the wire
// (per-user permission editing).
export const PermissionEnum = z.enum(
  [...PERMISSIONS] as [Permission, ...Permission[]],
);

// Authoritative role -> permissions mapping. SUPER_ADMIN holds every permission;
// ADMIN is SUPER_ADMIN minus users:manage; MANAGER and EMPLOYEE are explicit
// allow-lists. Changing access policy means changing this table, nothing else.
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  // Owner (platform owner): every permission, AND the only role whose reach
  // crosses the org boundary — but ONLY over the Users admin surface (see
  // isOwner / users.service). All other data stays tenant-scoped for an Owner.
  OWNER: [...PERMISSIONS],
  // Super Admin (CEO / org owner): every permission, within its OWN org only.
  SUPER_ADMIN: [...PERMISSIONS],
  // Admin: everything except managing other users.
  ADMIN: PERMISSIONS.filter((p) => p !== 'users:manage'),
  // Manager (lead-level): full customer/campaign authority.
  MANAGER: [
    'customers:read',
    'customers:write',
    'campaigns:read',
    'campaigns:write',
    // Managers see scorecards and record manual KPIs, but editing KPI definitions
    // + weights stays an admin (performance:admin) action.
    'performance:read',
    'performance:write',
    'audit:read',
  ],
  // Employee (operator): read across the board, write where day-to-day work
  // happens, but no campaign launches.
  EMPLOYEE: [
    'customers:read',
    'campaigns:read',
    'audit:read',
  ],
};

// Permissions granted to a role. Returns a fresh array so callers can't mutate
// the shared mapping.
export function permissionsForRole(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

// True when the role's permission set includes `perm`.
export function hasPermission(role: UserRole, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

// A user's EFFECTIVE permissions: their explicit per-user set when customized,
// otherwise their role's defaults. OWNER and SUPER_ADMIN ALWAYS hold every
// permission (full control, not editable) so the org can never be locked out of
// admin.
export function effectivePermissions(
  role: UserRole,
  stored: readonly string[] | null | undefined,
): Permission[] {
  if (role === 'OWNER' || role === 'SUPER_ADMIN') return [...PERMISSIONS];
  return stored ? ([...stored] as Permission[]) : permissionsForRole(role);
}

// True for the platform Owner — the only role whose authority crosses the org
// boundary. That reach is confined to the Users admin surface (list/edit/reset/
// delete users in any org); all other data stays tenant-scoped even for an
// Owner. Granting the Owner role is itself Owner-only (enforced in the API).
export function isOwner(role: UserRole): boolean {
  return role === 'OWNER';
}

// ---- Organization (tenant) contract ----
// The tenant boundary. The app runs single-tenant today, but every user and
// org-scoped entity carries an organizationId so it is SaaS-ready by construction.
export const OrganizationDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  // The company email domain this org was auto-provisioned from (e.g.
  // 'evertrust-germany.de'). NULL for orgs created by other means; OPTIONAL too,
  // for rolling-deploy safety — older api/web that neither send nor expect it
  // keep validating before the coordinated redeploy.
  domain: z.string().nullable().optional(),
});
export type OrganizationDto = z.infer<typeof OrganizationDto>;

// ---- Auth contracts (single source of truth for api <-> web) ----

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDto>;

// Google-only login: the client posts the Google ID token (the JWT credential
// returned by Google Identity Services); the API verifies it, then resolves or
// auto-provisions the user + org. The legacy email/password LoginDto above stays
// for backward compatibility.
export const GoogleLoginDto = z.object({
  idToken: z.string().min(1),
});
export type GoogleLoginDto = z.infer<typeof GoogleLoginDto>;

// Google login via the OAuth 2.0 AUTHORIZATION-CODE flow: the client runs the
// GIS `initCodeClient` popup (scope 'openid email profile') and posts the
// short-lived authorization `code`. The API exchanges it server-side (needs the
// client SECRET) for an ID token, then resolves/auto-provisions exactly as the
// idToken path does. This exists purely so the web can use a fully custom
// sign-in button (the GIS-rendered button can't be restyled; the code flow can
// be triggered from any element). The idToken flow above is unaffected.
export const GoogleCodeLoginDto = z.object({
  code: z.string().min(1),
});
export type GoogleCodeLoginDto = z.infer<typeof GoogleCodeLoginDto>;

// ---- Email-domain → org provisioning helpers (SSOT for api + web) ----
// Personal / free / consumer mailbox providers. A login from one of these MUST
// NOT auto-create a company organization (the domain is not a company). Lowercase.
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.de',
  'icloud.com',
  'aol.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  'proton.me',
  'protonmail.com',
  't-online.de',
]);

// The domain part of an email address, lowercased + trimmed. Total + ''-safe:
// returns '' for empty/malformed input (no '@', trailing '@', etc.). Never throws.
export function companyEmailDomain(email: string): string {
  if (typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

// True when the domain is a known personal/free mailbox provider (case-insensitive).
export function isPublicEmailDomain(domain: string): boolean {
  if (typeof domain !== 'string') return false;
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

// Human-readable org display name derived from a domain. Strips the public suffix
// (TLD) and titleizes the remaining label(s): 'evertrust-germany.de' -> 'Evertrust
// Germany', 'acme.co.uk' -> 'Acme'. Total: falls back to the cleaned domain, then ''.
export function orgNameFromDomain(domain: string): string {
  const d = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  if (!d) return '';
  const labels = d.split('.').filter(Boolean);
  if (labels.length === 0) return '';
  // Drop the TLD (last label); for short second-level suffixes like 'co.uk' /
  // 'com.au', drop that too so we titleize the actual company label.
  const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);
  let core = labels.slice(0, -1);
  const lastCore = core[core.length - 1];
  if (core.length > 1 && lastCore !== undefined && SECOND_LEVEL_SUFFIXES.has(lastCore)) {
    core = core.slice(0, -1);
  }
  if (core.length === 0) core = labels;
  const titleize = (s: string) =>
    s
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const name = core.map(titleize).filter(Boolean).join(' ').trim();
  return name || d;
}

// URL-safe slug derived from a domain: lowercase, every run of non-alphanumeric
// chars collapsed to a single '-', no leading/trailing '-'. 'evertrust-germany.de'
// -> 'evertrust-germany-de'. Total: returns '' for empty/malformed input.
export function orgSlugFromDomain(domain: string): string {
  const d = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  if (!d) return '';
  return d
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Public shape of a user returned to clients. Never includes the password hash.
// organizationId is the tenant the user belongs to (carried into the JWT).
export const MeDto = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: UserRole,
  // Department + job title. NULLABLE (a user may have neither) and optional too,
  // for rolling-deploy safety. See the `department`/`user_position` pgEnums.
  department: Department.nullable().optional(),
  position: Position.nullable().optional(),
  // The user's EFFECTIVE permissions (per-user set or role defaults) so the web
  // gates the UI off real authority. Optional for rolling-deploy safety — the
  // client falls back to role defaults when an older API omits it.
  permissions: z.array(PermissionEnum).optional(),
  organizationId: z.string().uuid(),
  // OPTIONAL on purpose: the human-readable org name is added by the M1 /auth/me
  // join. Keeping it optional means the currently-deployed api/web (which does
  // not yet send/expect it) keep validating before the coordinated redeploy.
  organizationName: z.string().optional(),
});
export type MeDto = z.infer<typeof MeDto>;

export const LoginResponseDto = z.object({
  accessToken: z.string(),
  user: MeDto,
});
export type LoginResponseDto = z.infer<typeof LoginResponseDto>;

export const UpdateMyNameDto = z.object({
  name: z.string().min(1).max(200),
});
export type UpdateMyNameDto = z.infer<typeof UpdateMyNameDto>;

// ============================================================================
// ERP CORE: customer registry
// All read DTOs mirror the @evertrust/db rows AS THEY ARRIVE OVER HTTP:
//   numeric  -> string (postgres-js keeps numeric precision as a string)
//   timestamp-> ISO string (Date is JSON-serialized to an ISO string)
//   uuid     -> string
// nullable DB columns are .nullable() here so the read shape can't drift.
// ============================================================================

// ---- Customers ----

export const CustomerDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  contact: z.string().nullable(),
  niches: z.array(z.string()),
  createdAt: z.string(),
});
export type CustomerDto = z.infer<typeof CustomerDto>;

export const CreateCustomerDto = z.object({
  name: z.string().min(1),
  contact: z.string().optional(),
  niches: z.array(z.string()).optional(),
});
export type CreateCustomerDto = z.infer<typeof CreateCustomerDto>;

export const UpdateCustomerDto = CreateCustomerDto.partial();
export type UpdateCustomerDto = z.infer<typeof UpdateCustomerDto>;

// ============================================================================
// Users (org directory + admin management)
// ============================================================================

// ---- Users (org directory, read-only list) ----
// Lightweight user shape for org-scoped pickers (e.g. the assignee Select). Never
// exposes auth/credential fields. department/position are nullable + optional.
export const UserListItemDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: UserRole,
  department: Department.nullable().optional(),
  position: Position.nullable().optional(),
});
export type UserListItemDto = z.infer<typeof UserListItemDto>;

// Full user row for the admin user-management table (users:manage only). Adds
// active + createdAt to the directory shape.
export const AdminUserDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  // Contact phone. Optional for rolling-deploy safety (an older API may omit it);
  // null = not set.
  phone: z.string().nullable().optional(),
  role: UserRole,
  position: Position.nullable(),
  department: Department.nullable(),
  // Stored per-user permission override; null = "follow role defaults".
  // Effective permissions = effectivePermissions(role, permissions).
  permissions: z.array(PermissionEnum).nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  // The owning organization. Surfaced so the Owner's cross-org user list can
  // show which org each user belongs to. Optional for rolling-deploy safety
  // (an older API may omit them); for non-Owners every row is the caller's org.
  organizationId: z.string().uuid().optional(),
  organizationName: z.string().nullable().optional(),
});
export type AdminUserDto = z.infer<typeof AdminUserDto>;

// Patch a user's role / position / department, or (de)activate them, from the
// management table. Every field optional so the table can PATCH a single cell;
// position/department are nullable so they can be cleared (e.g. a CEO with no
// department); `active` false = soft-delete (deactivate), true = reactivate.
export const UpdateUserDto = z.object({
  role: UserRole.optional(),
  position: Position.nullable().optional(),
  department: Department.nullable().optional(),
  active: z.boolean().optional(),
  // Display name — editable by any users:manage holder.
  name: z.string().trim().min(1).max(200).optional(),
  // Login email — change is RESTRICTED to a Super Admin (enforced in the API)
  // and must stay globally unique.
  email: z.string().trim().email().optional(),
  // Contact phone — editable by any users:manage holder; null clears it.
  phone: z.string().trim().max(40).nullable().optional(),
  // Per-user permission override: an explicit set, or null to follow role
  // defaults. Omit to leave unchanged. Ignored for SUPER_ADMIN (always full).
  permissions: z.array(PermissionEnum).nullable().optional(),
});
export type UpdateUserDto = z.infer<typeof UpdateUserDto>;

// Create a new user from the management page. This ERP has no public register
// flow, so an admin (users:manage) sets the initial password here; the API
// creates the user + an argon2 credential. Email must be globally unique.
export const CreateUserDto = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  role: UserRole.default('EMPLOYEE'),
  position: Position.nullable().optional(),
  department: Department.nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});
export type CreateUserDto = z.infer<typeof CreateUserDto>;

// Admin password reset (no public reset flow). users:manage sets a new password
// for a user; the API re-hashes (argon2) the credential.
export const SetPasswordDto = z.object({
  password: z.string().min(8).max(200),
});
export type SetPasswordDto = z.infer<typeof SetPasswordDto>;

// Real per-user contribution stats for the profile page. Every field is derived
// from actual rows (campaigns.deployedBy, arsenal_runs.triggeredBy, audit_log
// actorId) — no fabricated metrics.
export const UserActivityItemDto = z.object({
  entity: z.string(),
  action: z.string(),
  at: z.string(),
});
export type UserActivityItemDto = z.infer<typeof UserActivityItemDto>;

export const UserStatsDto = z.object({
  campaignsLaunched: z.number(),
  stagesRun: z.number(),
  actionsLogged: z.number(),
  recentActivity: z.array(UserActivityItemDto),
});
export type UserStatsDto = z.infer<typeof UserStatsDto>;

// ---- Sales Agent meetings (Read.ai analyses synced from n8n) ----
// How a meeting's campaign was resolved.
export const MeetingMatchMethod = z.enum(['email', 'domain', 'manual']);
export type MeetingMatchMethod = z.infer<typeof MeetingMatchMethod>;

// A synced, analyzed meeting. `analysis` is the workflow's Sales Analysis Schema
// JSON, returned verbatim (unknown) so LLM-shape drift never breaks the contract.
export const MeetingDto = z.object({
  id: z.string().uuid(),
  sessionId: z.string().nullable(),
  title: z.string().nullable(),
  clientCompany: z.string().nullable(),
  aeName: z.string().nullable(),
  clientContact: z.string().nullable(),
  clientEmail: z.string().nullable(),
  meetingDate: z.string().nullable(),
  persona: z.string().nullable(),
  analysis: z.unknown().nullable(),
  hasTranscript: z.boolean(),
  docUrl: z.string().nullable(),
  score: z.number().nullable(),
  campaignId: z.string().uuid().nullable(),
  campaignName: z.string().nullable(),
  leadId: z.string().uuid().nullable(),
  matchMethod: MeetingMatchMethod.nullable(),
  createdAt: z.string(),
});
export type MeetingDto = z.infer<typeof MeetingDto>;
export const MeetingListDto = z.array(MeetingDto);

// PATCH /sales/meetings/:id — manual campaign link (null clears it).
export const LinkMeetingDto = z.object({
  campaignId: z.string().uuid().nullable(),
});
export type LinkMeetingDto = z.infer<typeof LinkMeetingDto>;

// POST /sales/meetings/sync — mirror the analysis-report Docs in the Drive
// folder: imported (new), updated (existing), pruned (in ERP but the Doc is gone
// from the folder). configured=false means N8N_API_URL isn't set.
export const MeetingSyncResultDto = z.object({
  configured: z.boolean(),
  scanned: z.number(),
  imported: z.number(),
  updated: z.number(),
  pruned: z.number(),
});
export type MeetingSyncResultDto = z.infer<typeof MeetingSyncResultDto>;

// Coaching personas — Google Docs in the Drive "AI Personas" folder, listed via
// the Sales Agent workflow (id = Drive file id). The chosen name drives analysis.
export const PersonaDto = z.object({
  id: z.string(),
  name: z.string(),
});
export type PersonaDto = z.infer<typeof PersonaDto>;
export const PersonaListDto = z.object({
  folderUrl: z.string().nullable(),
  personas: z.array(PersonaDto),
});
export type PersonaListDto = z.infer<typeof PersonaListDto>;

// POST /sales/meetings/:id/analyze — run the coaching under a chosen persona
// (by name; the workflow resolves it against the Drive folder).
export const AnalyzeMeetingDto = z.object({
  persona: z.string().trim().min(1).max(120),
});
export type AnalyzeMeetingDto = z.infer<typeof AnalyzeMeetingDto>;

// ── Marketing · RAG Draft Review ────────────────────────────────────────────
// Reviewable replies the EVERTRUST - RAG AGENT workflow drafted for "Unsure"
// leads and saved as Gmail drafts (Do Not Send). Read shape mirrors the n8n
// erp-rag-drafts webhook; the ERP proxies it (the ERP has no Google creds).
export const MarketingDraftDto = z.object({
  draftId: z.string().nullable(),
  messageId: z.string().nullable(),
  threadId: z.string().nullable(),
  clientEmail: z.string().nullable(),
  company: z.string().nullable(),
  leadQuestion: z.string().nullable(),
  unsureArea: z.string().nullable(),
  unsureSection: z.string().nullable(),
  explanation: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  source: z.string().nullable(),
  status: z.string().nullable(),
  createdAt: z.string().nullable(),
  // Only drafts that carry a Gmail draft id can be sent from the ERP.
  sendable: z.boolean(),
});
export type MarketingDraftDto = z.infer<typeof MarketingDraftDto>;

// GET /marketing/drafts — configured=false means N8N_API_URL isn't set.
export const MarketingDraftListDto = z.object({
  configured: z.boolean(),
  count: z.number(),
  drafts: z.array(MarketingDraftDto),
});
export type MarketingDraftListDto = z.infer<typeof MarketingDraftListDto>;

// POST /marketing/drafts/send — approve & send a reviewed draft. The reviewer
// may have edited subject/body; n8n sends the final text, deletes the stale
// Gmail draft and marks the sheet row SENT. Human-approval gate.
export const SendDraftDto = z.object({
  draftId: z.string().trim().min(1),
  to: z.string().trim().email(),
  subject: z.string().default(''),
  body: z.string().trim().min(1),
  threadId: z.string().trim().optional(),
  source: z.string().trim().optional(),
});
export type SendDraftDto = z.infer<typeof SendDraftDto>;

export const SendDraftResultDto = z.object({
  ok: z.boolean(),
  status: z.string().nullable(),
  draftId: z.string().nullable(),
  to: z.string().nullable(),
  sentMessageId: z.string().nullable(),
  error: z.string().nullable(),
});
export type SendDraftResultDto = z.infer<typeof SendDraftResultDto>;

// POST /marketing/drafts/scan — "Sync from leads": fire the RAG Agent's
// scan-all-campaign-leads webhook (erp-rag-scan). It runs async (drafts appear
// in the queue shortly), so this just reports that the scan was kicked off.
export const ScanLeadsResultDto = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type ScanLeadsResultDto = z.infer<typeof ScanLeadsResultDto>;

// NOTE: meetings enter the ERP ONLY via "Sync from Drive" (mirror the folder
// Docs). There is intentionally no n8n→ERP push/ingest of meetings — the n8n
// workflow runs analyses and writes Drive artifacts; it never inserts ERP rows.

// ============================================================================
// GROWTH ENGINE — the "AIM sequence" (campaign launch → outbound arsenal)
// A campaign is the AIM target. On launch the API fires the AIM n8n webhook,
// which provisions the Drive campaign folder + config.json that the arsenal
// (Lead Satellite / Ammo Forge / Reach Bazooka / Reply Glock / Sleeper Grenade)
// runs against autonomously. Mirrors the reference Growth-Engine AIM form.
// ============================================================================

// Mirrors the campaign_state pgEnum. DRAFT = saved, not (yet) activated — e.g.
// the AIM webhook is unset or its call failed; ACTIVE = live (Lead Satellite /
// Bazooka pick it up); PAUSED = temporarily out of the send rotation; ARCHIVED =
// the soft delete (kept for attribution; terminal).
export const CampaignLifecycle = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
export type CampaignLifecycle = z.infer<typeof CampaignLifecycle>;

// Normalise a display name into its dedup slug: lower-case, trim, collapse each
// whitespace run into one hyphen ("  Cloud  Infrastructure " → "cloud-infrastructure").
// SSOT for niche + niche-target find-or-create on the API AND for client-side
// "will this match an existing niche?" previews.
export function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}

// Named email/content blocks Ammo Forge generates for a campaign (keys like
// coldEmail, slotProposal, meetingConfirmation, newsBrief). A free-form string
// map so the outreach workflows read templates from the ERP instead of Drive and
// can add new blocks without a contract change. POST /campaigns/:id/templates
// merges incrementally; GET /config and the campaign read shape expose the map.
export const CampaignTemplatesDto = z.record(z.string(), z.string());
export type CampaignTemplatesDto = z.infer<typeof CampaignTemplatesDto>;

// Read shape of a campaign row over HTTP. Nullable columns are .nullable();
// timestamps are ISO strings. `nicheName` is joined from the niches table for
// the UI (the row itself only stores the nicheId FK).
export const CampaignDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().nullable(),
  nicheId: z.string().uuid(),
  nicheName: z.string().nullable(),
  country: z.string(),
  region: z.string(),
  project: z.string(),
  gmailLabel: z.string(),
  salesCalendarId: z.string().nullable(),
  whatsappNumber: z.string(),
  sender: z.string(),
  lifecycle: CampaignLifecycle,
  archivedAt: z.string().nullable(),
  driveFolderId: z.string().nullable(),
  driveFolderUrl: z.string().nullable(),
  // Ammo Forge content blocks (see CampaignTemplatesDto). Nullable — the column
  // is empty until a workflow POSTs the first block; a future UI can show/edit it.
  templates: CampaignTemplatesDto.nullable(),
  activatedBy: z.string().uuid().nullable(),
  activatedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CampaignDto = z.infer<typeof CampaignDto>;

// Body for PATCH /campaigns/:id/lifecycle. DRAFT is never a target (a campaign
// can only move forward out of DRAFT); ARCHIVED is terminal.
export const UpdateCampaignLifecycleDto = z.object({
  lifecycle: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']),
});
export type UpdateCampaignLifecycleDto = z.infer<typeof UpdateCampaignLifecycleDto>;

// GET /campaigns/:id/files — every file in the campaign's Drive folder, listed
// via the CAMPAIGNS LIST workflow's erp-campaign-files webhook (the ERP has no
// Google creds). Each row links straight to the file in Drive.
export const CampaignFileDto = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string().nullable(),
  webViewLink: z.string().nullable(),
  modifiedTime: z.string().nullable(),
  size: z.string().nullable(),
});
export type CampaignFileDto = z.infer<typeof CampaignFileDto>;

export const CampaignFilesDto = z.object({
  configured: z.boolean(),
  count: z.number(),
  files: z.array(CampaignFileDto),
});
export type CampaignFilesDto = z.infer<typeof CampaignFilesDto>;

// Region is free text — a city, city list, or voivodeship/Bundesland (e.g.
// "Warszawa, Kraków" or "Mazowieckie"). The Lead Satellite's Build Search Query
// expands it into per-city searches, so it must NOT be constrained to a fixed
// enum (compass zones would starve the geographic search the workflow depends on).

// Outreach sender mailbox — which authorized Gmail identity REACH BAZOOKA sends a
// campaign's cold outreach from. Pass-through to the AIM webhook → the campaign's
// config.json (Drive), which BAZOOKA branches on at send time. 'info' is the
// default/legacy sender; keep keys short + stable (they map to fixed n8n creds).
export const CAMPAIGN_SENDERS = ['info', 'hanna'] as const;
export type CampaignSender = (typeof CAMPAIGN_SENDERS)[number];
export const CAMPAIGN_SENDER_LABELS: Record<CampaignSender, string> = {
  info: 'info@evertrust-germany.de',
  hanna: 'hanna@evertrust-germany.de',
};

// One outreach sender mailbox for an organization. `key` is the stable per-org
// identifier the campaign's `sender` field and the config `defaultSender` reference
// (validated against the org's sender keys at the service layer, NOT in the DTO);
// `email` is the real Gmail identity BAZOOKA sends from; `label` is an optional
// display name; `isDefault` marks the org's fallback sender.
export const OrgSenderDto = z.object({
  key: z.string().min(1),
  email: z.string().email(),
  label: z.string().nullable().optional(),
  isDefault: z.boolean(),
});
export type OrgSenderDto = z.infer<typeof OrgSenderDto>;

// The product-default sender list. The API falls back to this when an organization
// has no senders of its own configured — the same two legacy Gmail identities the
// team has always sent from, so existing 'info'/'hanna' references stay resolvable.
export const DEFAULT_SENDERS: OrgSenderDto[] = [
  { key: 'info', email: 'info@evertrust-germany.de', label: 'Info', isDefault: true },
  { key: 'hanna', email: 'hanna@evertrust-germany.de', label: 'Hanna', isDefault: false },
];

// --- Per-org Google connect (OAuth authorization-code flow, distinct from GIS login) ---
// The OAuth scopes requested when a user connects their company Google account. All are
// SENSITIVE (one-time app verification) but NONE are RESTRICTED — so no annual CASA audit.
// `gmail.readonly` (inbox read for replies) is intentionally absent: that is the increment-2
// scope decision. `include_granted_scopes` makes adding it later incremental.
export const GOOGLE_CONNECT_SCOPES: readonly string[] = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export const GoogleAccountStatus = z.enum(['CONNECTED', 'REVOKED', 'ERROR']);
export type GoogleAccountStatus = z.infer<typeof GoogleAccountStatus>;

// A Google account a user in this org has connected. `role` is the connecting ERP user's
// role (derived at read time, not stored). `isDefault` reflects the org's SINGLE default
// mailbox (org_config.defaultMailboxAccountId) — the new single-mailbox model. The legacy
// `isDefaultGmail`/`isDefaultCalendar` fields are kept for back-compat (the web reads them
// until its rewrite); the API mirrors both onto the single default. No tokens are ever
// exposed in this DTO.
export const ConnectedGoogleAccountDto = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  role: UserRole,
  scopes: z.array(z.string()),
  status: GoogleAccountStatus,
  // The org's single default mailbox (used for BOTH Gmail send and Calendar).
  isDefault: z.boolean(),
  // Legacy two-pointer flags — kept so the current web compiles; both mirror isDefault.
  isDefaultGmail: z.boolean(),
  isDefaultCalendar: z.boolean(),
  connectedAt: z.string(),
});
export type ConnectedGoogleAccountDto = z.infer<typeof ConnectedGoogleAccountDto>;

// Set the org-level default Gmail / Calendar accounts. Each field optional: omit to leave
// unchanged; null to clear. A non-null id must reference a google_accounts row in this org.
export const SetGoogleDefaultsDto = z.object({
  defaultGmailAccountId: z.string().uuid().nullable().optional(),
  defaultCalendarAccountId: z.string().uuid().nullable().optional(),
});
export type SetGoogleDefaultsDto = z.infer<typeof SetGoogleDefaultsDto>;

// Set the org's SINGLE default mailbox (used for both Gmail send and Calendar). `null`
// clears it; a non-null id must reference a google_accounts row in this org. Replaces the
// two-pointer SetGoogleDefaultsDto at the app layer.
export const SetDefaultMailboxDto = z.object({
  accountId: z.string().uuid().nullable(),
});
export type SetDefaultMailboxDto = z.infer<typeof SetDefaultMailboxDto>;

// --- Per-org AI engine (Configuration page) ---------------------------------------
// The selectable AI models for the per-org AI engine setting (matches the Configuration
// mockup). Null on org_config.aiModel = fall back to env ANTHROPIC_MODEL.
export const AI_ENGINE_MODELS: readonly string[] = [
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'local·llama-3',
];

// The org's resolved AI engine config: model + gateway label (each null when unset →
// product default). Returned by GET /arsenal/config/ai-engine.
export const AiEngineConfigDto = z.object({
  model: z.string().nullable(),
  gateway: z.string().nullable(),
});
export type AiEngineConfigDto = z.infer<typeof AiEngineConfigDto>;

// Partial update for the AI engine config: a value sets it, null clears it back to the
// product default, an omitted field is unchanged.
export const UpdateAiEngineDto = z.object({
  model: z.string().max(120).nullable().optional(),
  gateway: z.string().max(120).nullable().optional(),
});
export type UpdateAiEngineDto = z.infer<typeof UpdateAiEngineDto>;

export const CreateCampaignDto = z.object({
  name: z.string().max(60).optional(),
  // The campaign's niche by DISPLAY name; the API find-or-creates the niche row
  // (by slugify(nicheName)) and stores its id. Replaces the old free-text
  // niche/target pair — target archetypes now live on niche_targets.
  nicheName: z.string().min(1).max(120),
  country: z.string().min(1).max(120),
  // Geographic locality the Lead Satellite searches (see the note above).
  region: z.string().min(1).max(120),
  project: z.string().min(1).max(200),
  gmailLabel: z.string().min(1).max(120),
  // Optional: the sales calendar moved to the org level (resolved as
  // org_config.salesCalendarId ?? env SALES_CALENDAR_ID ?? null). When the AIM form's
  // Calendar dropdown is connected, the chosen Google calendar id is sent here as a
  // per-campaign override; otherwise it is omitted and resolved per-org at use-time.
  salesCalendarId: z.string().max(200).optional(),
  whatsappNumber: z.string().min(1).max(40),
  // Which mailbox BAZOOKA sends this campaign's outreach from — a per-org sender KEY
  // (validated against the org's senders at the service layer, not here). Optional on
  // the wire (defaults to 'info') so older clients + existing campaigns stay on info@.
  // Legacy 'info'/'hanna' keys remain valid strings.
  sender: z.string().min(1).default('info'),
});
export type CreateCampaignDto = z.infer<typeof CreateCampaignDto>;

// A Google Calendar the org's connected account can see (GET /arsenal/config/calendars).
// `id` is the opaque calendar id stored as a campaign's salesCalendarId; `summary` is the
// human label the AIM dropdown shows; `primary` flags the account's main calendar (used
// as the default selection when the org has no sales calendar configured yet).
export const CalendarDto = z.object({
  id: z.string(),
  summary: z.string(),
  primary: z.boolean(),
});
export type CalendarDto = z.infer<typeof CalendarDto>;

// GET /arsenal/config/calendars result. `configured` is false when no Google token is
// wired (GOOGLE_CALENDAR_TOKEN_JSON blank) or the live scan failed — the UI then degrades
// to the org-default calendar (omitting salesCalendarId on launch) instead of blocking it.
export const CalendarListResultDto = z.object({
  configured: z.boolean(),
  calendars: z.array(CalendarDto),
});
export type CalendarListResultDto = z.infer<typeof CalendarListResultDto>;

// ---- Arsenal triggers (the "Run now" buttons + the daily scheduler) ----
// The outbound stages the ERP can fire as n8n webhooks. AIM is excluded — it is
// the campaign launch (the campaigns module). Mirrors the arsenal_stage pgEnum.
export const ArsenalStage = z.enum([
  'LEAD_SATELLITE',
  'AMMO_FORGE',
  'REACH_BAZOOKA',
  'REPLY_GLOCK',
  'SLEEPER_GRENADE',
]);
export type ArsenalStage = z.infer<typeof ArsenalStage>;

// PER_CAMPAIGN stages operate on one campaign (need a campaignId; the ERP sends
// that campaign's context). GLOBAL stages process all active campaigns on the n8n
// side (no campaign context — e.g. the daily Bazooka send). Drives WHERE the "Run
// now" control lives: on a campaign vs in the global Arsenal panel.
export type ArsenalStageScope = 'PER_CAMPAIGN' | 'GLOBAL';
export interface ArsenalStageMeta {
  stage: ArsenalStage;
  label: string;
  scope: ArsenalStageScope;
  what: string;
}
export const ARSENAL_STAGE_META: Record<ArsenalStage, ArsenalStageMeta> = {
  LEAD_SATELLITE: {
    stage: 'LEAD_SATELLITE',
    label: 'Lead Satellite',
    scope: 'PER_CAMPAIGN',
    what: 'Pull leads from public sources into the campaign',
  },
  AMMO_FORGE: {
    stage: 'AMMO_FORGE',
    label: 'Ammo Forge',
    scope: 'PER_CAMPAIGN',
    what: 'Write the outreach docs / emails',
  },
  REACH_BAZOOKA: {
    stage: 'REACH_BAZOOKA',
    label: 'Reach Bazooka',
    scope: 'GLOBAL',
    what: 'Send the outbound batch, track replies (the daily send)',
  },
  REPLY_GLOCK: {
    stage: 'REPLY_GLOCK',
    label: 'Reply Glock',
    scope: 'GLOBAL',
    what: 'Sort & answer replies, book meetings',
  },
  SLEEPER_GRENADE: {
    stage: 'SLEEPER_GRENADE',
    label: 'Sleeper Grenade',
    scope: 'GLOBAL',
    what: 'Sweep not-interested → snooze → re-email',
  },
};

// Body for POST /arsenal/:stage/run. campaignId is REQUIRED for PER_CAMPAIGN
// stages and omitted for GLOBAL ones — the server validates against the scope.
export const RunArsenalDto = z.object({
  campaignId: z.string().uuid().optional(),
});
export type RunArsenalDto = z.infer<typeof RunArsenalDto>;

// Mirrors the arsenal_run_source / arsenal_run_status pgEnums.
// MANUAL = a human pressed "Run now"; SCHEDULED = the ERP's daily scheduler;
// N8N = an autonomous run that n8n reported back via the callback (it ran itself).
export const ArsenalRunSource = z.enum(['MANUAL', 'SCHEDULED', 'N8N']);
export type ArsenalRunSource = z.infer<typeof ArsenalRunSource>;
// DISPATCHED/FAILED = the ERP→n8n hand-off outcome (ERP-initiated runs). SUCCESS/
// ERROR = the FINAL outcome of an autonomous n8n run, reported back via the
// callback. The web treats DISPATCHED+SUCCESS as "ok" and FAILED+ERROR as "error".
export const ArsenalRunStatus = z.enum([
  'DISPATCHED',
  'FAILED',
  'SUCCESS',
  'ERROR',
]);
export type ArsenalRunStatus = z.infer<typeof ArsenalRunStatus>;

// True when a run status counts as a successful outcome (vs an error) — shared so
// the API and web agree on how to colour/tag a run in the Live activity feed.
export function isArsenalRunOk(status: ArsenalRunStatus): boolean {
  return status === 'DISPATCHED' || status === 'SUCCESS';
}

// Read shape of an arsenal_runs row — the record of an ERP→n8n hand-off.
export const ArsenalRunDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  stage: ArsenalStage,
  campaignId: z.string().uuid().nullable(),
  source: ArsenalRunSource,
  status: ArsenalRunStatus,
  detail: z.string().nullable(),
  triggeredBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ArsenalRunDto = z.infer<typeof ArsenalRunDto>;

// Body for POST /arsenal/runs/callback — the n8n→ERP writeback. An n8n stage
// workflow POSTs this at the END of an autonomous run so it appears in the
// per-campaign Live activity feed (the executions poller shows RUNNING live; this
// records the historical outcome). Identify the campaign by ERP `campaignId` OR by
// its Google Drive folder id (`driveFolderId` — what n8n knows natively, since it
// reads config from that folder); omit BOTH for a global stage. `stage` + `status`
// are normalised to upper-case so n8n can send either case. Auth is a shared
// ingest token in the `x-arsenal-token` header, NOT a JWT (n8n has no session).
export const ArsenalCallbackDto = z.object({
  stage: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    ArsenalStage,
  ),
  status: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(['SUCCESS', 'ERROR']),
  ),
  campaignId: z.string().uuid().optional(),
  driveFolderId: z.string().min(1).max(256).optional(),
  detail: z.string().max(500).optional(),
  // Optional per-run funnel counts the Marketing report sums (Phase 2). A flat map
  // of metric key -> finite non-negative number; capped so a mis-wired node can't
  // bloat the row. Stages send what they know, e.g. { emailsSent: 40 }.
  metrics: z
    .record(z.string().max(40), z.number().finite().nonnegative())
    .refine((m) => Object.keys(m).length <= 20, 'too many metric keys')
    .optional(),
});
export type ArsenalCallbackDto = z.infer<typeof ArsenalCallbackDto>;

// Response of the callback — minimal ingest ack (the recorded run's id).
export const ArsenalCallbackResultDto = z.object({
  ok: z.literal(true),
  id: z.string().uuid(),
});
export type ArsenalCallbackResultDto = z.infer<typeof ArsenalCallbackResultDto>;

// ---------------------------------------------------------------------------
// MARKETING REPORT — the Growth-Engine sequence report (daily/weekly/monthly).
// Aggregates arsenal_runs (+ campaigns) per period. "Health" fields (runs,
// success/error) are live today; funnel metric fields are null until n8n reports
// them via the callback `metrics` field above.
// ---------------------------------------------------------------------------

export const MarketingReportPeriod = z.enum(['day', 'week', 'month']);
export type MarketingReportPeriod = z.infer<typeof MarketingReportPeriod>;

// Canonical metric keys an n8n stage may report on a run (callback.metrics).
export const ARSENAL_METRIC_KEYS = [
  'leadsFound',
  'templatesForged',
  'emailsSent',
  'repliesHandled',
  'meetingsBooked',
  'leadsSwept',
] as const;
export type ArsenalMetricKey = (typeof ARSENAL_METRIC_KEYS)[number];

// The metric featured on each stage's lane in the report.
export const STAGE_PRIMARY_METRIC: Record<ArsenalStage, ArsenalMetricKey> = {
  LEAD_SATELLITE: 'leadsFound',
  AMMO_FORGE: 'templatesForged',
  REACH_BAZOOKA: 'emailsSent',
  REPLY_GLOCK: 'meetingsBooked',
  SLEEPER_GRENADE: 'leadsSwept',
};

// Human labels for the metric keys (web display).
export const ARSENAL_METRIC_LABEL: Record<ArsenalMetricKey, string> = {
  leadsFound: 'Leads found',
  templatesForged: 'Templates forged',
  emailsSent: 'Emails sent',
  repliesHandled: 'Replies',
  meetingsBooked: 'Meetings booked',
  leadsSwept: 'Leads swept',
};

// One stage's slice of the report. successRate null when runs===0; metrics is the
// summed map for the window ({} if none reported); trend = runs per bucket aligned
// to MarketingReportDto.buckets.
export const MarketingStageReportDto = z.object({
  stage: ArsenalStage,
  runs: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1).nullable(),
  metrics: z.record(z.string(), z.number()),
  trend: z.array(z.number().int().nonnegative()),
});
export type MarketingStageReportDto = z.infer<typeof MarketingStageReportDto>;

// GET /arsenal/report?period=… . funnel/kpi metric fields are null when no run in
// the window carried that metric (= "awaiting n8n"); a number (incl. 0) means it
// was reported.
export const MarketingReportDto = z.object({
  period: MarketingReportPeriod,
  // The campaign this report is scoped to (null = all campaigns / org-wide).
  campaignId: z.string().uuid().nullable(),
  from: z.string(),
  to: z.string(),
  buckets: z.array(z.string()),
  kpis: z.object({
    campaignsLaunched: z.number().int().nonnegative(),
    totalRuns: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1).nullable(),
    meetingsBooked: z.number().nullable(),
  }),
  funnel: z.object({
    leadsFound: z.number().nullable(),
    emailsSent: z.number().nullable(),
    repliesHandled: z.number().nullable(),
    meetingsBooked: z.number().nullable(),
  }),
  stages: z.array(MarketingStageReportDto),
});
export type MarketingReportDto = z.infer<typeof MarketingReportDto>;

// POST /arsenal/backfill — import recent n8n executions as runs (with metrics
// read from execution data) so the report's funnel fills from real history.
// configured=false when the n8n API isn't wired up. imported = new rows written,
// scanned = executions examined, byStage = per-stage import counts.
export const ArsenalBackfillResultDto = z.object({
  configured: z.boolean(),
  scanned: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  byStage: z.record(z.string(), z.number()),
});
export type ArsenalBackfillResultDto = z.infer<typeof ArsenalBackfillResultDto>;

// ---------------------------------------------------------------------------
// KEY ACCOUNT — hot-lead CRM (mirrors the n8n hot_leads subsystem).
// ---------------------------------------------------------------------------

// Pipeline stage — the board columns. Mirrors the n8n "Hot Reason" vocabulary
// (Interested / MeetingScheduled), plus CUSTOMER (graduated) and ARCHIVED.
export const LeadStage = z.enum([
  'INTERESTED',
  'MEETING_SCHEDULED',
  'ONGOING',
  'CUSTOMER',
  'ARCHIVED',
]);
export type LeadStage = z.infer<typeof LeadStage>;

export const LeadStageLabel: Record<LeadStage, string> = {
  INTERESTED: 'Interested',
  MEETING_SCHEDULED: 'Meeting Scheduled',
  ONGOING: 'Ongoing',
  CUSTOMER: 'Customer',
  ARCHIVED: 'Archived',
};

export const LeadSource = z.enum(['N8N', 'MANUAL']);
export type LeadSource = z.infer<typeof LeadSource>;

// Read shape of a leads row — the hot_leads mirror + ERP pipeline fields.
export const LeadDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string(),
  companyName: z.string().nullable(),
  companyType: z.string().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  tier: z.string().nullable(),
  // Niche FK (replaces the old free-text niche column). Only set on MANUAL leads;
  // N8N leads resolve their niche via the linked campaign. null = no niche.
  nicheId: z.string().uuid().nullable(),
  sourceCampaign: z.string().nullable(),
  campaignId: z.string().uuid().nullable(),
  hotReason: z.string().nullable(),
  leadStatus: z.string().nullable(),
  meetingDate: z.string().nullable(),
  detectedAt: z.string().nullable(),
  note: z.string().nullable(),
  stage: LeadStage,
  customerId: z.string().uuid().nullable(),
  source: LeadSource,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LeadDto = z.infer<typeof LeadDto>;

// Body for POST /leads (manual add). email is the only required field.
export const CreateLeadDto = z.object({
  email: z.string().email(),
  companyName: z.string().max(200).optional(),
  niche: z.string().max(120).optional(),
  tier: z.string().max(20).optional(),
  country: z.string().max(120).optional(),
  sourceCampaign: z.string().max(200).optional(),
  campaignId: z.string().uuid().optional(),
  note: z.string().max(2000).optional(),
  stage: LeadStage.optional(),
});
export type CreateLeadDto = z.infer<typeof CreateLeadDto>;

// Body for PATCH /leads/:id — move stage / edit a few fields.
export const UpdateLeadDto = z
  .object({
    stage: LeadStage.optional(),
    note: z.string().max(2000).optional(),
    tier: z.string().max(20).optional(),
    companyName: z.string().max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');
export type UpdateLeadDto = z.infer<typeof UpdateLeadDto>;

// POST /leads/backfill — import hot leads + graduated customers from the Hot
// Leads Pipeline execution data. imported = hot-lead rows upserted; customers =
// ERP customer rows created from graduated (_t:"cust") rows.
export const LeadBackfillResultDto = z.object({
  configured: z.boolean(),
  scanned: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
});
export type LeadBackfillResultDto = z.infer<typeof LeadBackfillResultDto>;

// POST /leads/provision {campaignId} — fire the Provision Hot Leads webhook for a
// campaign. configured=false when the webhook URL isn't set; ok=false on a failed
// dispatch; hotLeadsUrl is the created sheet's URL when the webhook returns it.
export const ProvisionHotLeadsResultDto = z.object({
  configured: z.boolean(),
  ok: z.boolean(),
  hotLeadsUrl: z.string().nullable(),
  detail: z.string(),
});
export type ProvisionHotLeadsResultDto = z.infer<typeof ProvisionHotLeadsResultDto>;

// Body for /leads/provision + /leads/run-pipeline. campaignId scopes the action to
// one campaign (its Drive folder); omit on run-pipeline to run all campaigns.
export const LeadCampaignActionDto = z.object({
  campaignId: z.string().uuid().optional(),
});
export type LeadCampaignActionDto = z.infer<typeof LeadCampaignActionDto>;

// POST /leads/run-pipeline — fire the Hot Leads Pipeline webhook (POST {folderId}).
export const RunHotLeadsPipelineResultDto = z.object({
  configured: z.boolean(),
  ok: z.boolean(),
  detail: z.string(),
});
export type RunHotLeadsPipelineResultDto = z.infer<
  typeof RunHotLeadsPipelineResultDto
>;

// Result of a bulk "clear" (test-data reset): how many rows were deleted.
export const ClearResultDto = z.object({
  deleted: z.number().int().nonnegative(),
});
export type ClearResultDto = z.infer<typeof ClearResultDto>;

// Real n8n execution status for a stage (the executions poller). RUNNING = an n8n
// execution is in progress; SUCCESS / ERROR = the latest finished one; IDLE = none.
export const ArsenalExecutionStatus = z.enum([
  'RUNNING',
  'SUCCESS',
  'ERROR',
  'IDLE',
]);
export type ArsenalExecutionStatus = z.infer<typeof ArsenalExecutionStatus>;

export const ArsenalExecutionDto = z.object({
  stage: ArsenalStage,
  status: ArsenalExecutionStatus,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type ArsenalExecutionDto = z.infer<typeof ArsenalExecutionDto>;

// GET /arsenal/executions — live per-stage n8n run state. configured=false when the
// n8n API isn't wired up (the web then falls back to its dispatch-based status).
export const ArsenalExecutionsDto = z.object({
  configured: z.boolean(),
  stages: z.array(ArsenalExecutionDto),
});
export type ArsenalExecutionsDto = z.infer<typeof ArsenalExecutionsDto>;

// "HH:MM" (24h) — shared so the API validates and the web input matches.
export const DAILY_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// True if `tz` is an IANA zone this runtime's Intl recognizes (works in Node + the
// browser). Used by the API scheduler (to interpret the daily time) and the Zod
// refine below, so an unknown zone is a 400 — never a silently mis-timed send.
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Timezones offered for the daily Bazooka send — curated (DACH-first + UTC + US
// East), not the full IANA set, so the picker stays a short scannable dropdown.
// Values are IANA names the scheduler resolves; the first entry is the default.
export const BAZOOKA_TIMEZONES = [
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Europe/Vienna', label: 'Vienna (CET/CEST)' },
  { value: 'Europe/Zurich', label: 'Zurich (CET/CEST)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York (ET)' },
] as const satisfies readonly { value: string; label: string }[];

export const DEFAULT_BAZOOKA_TIMEZONE = BAZOOKA_TIMEZONES[0].value;

// Per-org Growth-Engine settings. bazookaDailyAt = the ERP-editable daily Bazooka
// send time ("HH:MM", null = off); bazookaTimezone = the IANA zone that time is
// read in (null = legacy rows / server-local). Read shape of GET /arsenal/settings.
export const ArsenalSettingsDto = z.object({
  bazookaDailyAt: z.string().nullable(),
  bazookaTimezone: z.string().nullable(),
});
export type ArsenalSettingsDto = z.infer<typeof ArsenalSettingsDto>;

// Body for PUT /arsenal/settings. A valid "HH:MM" sets the daily send (null
// disables it); bazookaTimezone is a valid IANA zone (or null). Validated here so a
// bad time/zone is a 400, not a mis-scheduled send. A set time MUST carry a zone —
// the daily send is never left to interpret an implicit server clock.
export const UpdateArsenalSettingsDto = z
  .object({
    bazookaDailyAt: z
      .string()
      .regex(DAILY_TIME_REGEX, 'Use 24h HH:MM, e.g. 08:00')
      .nullable(),
    bazookaTimezone: z
      .string()
      .refine(isValidTimeZone, 'Unknown timezone')
      .nullable(),
  })
  .refine((v) => v.bazookaDailyAt === null || v.bazookaTimezone !== null, {
    message: 'Pick a timezone for the daily send.',
    path: ['bazookaTimezone'],
  });
export type UpdateArsenalSettingsDto = z.infer<typeof UpdateArsenalSettingsDto>;

// ============================================================================
// Performance Management System (PMS) — KPI scorecards, attribution, AI reports.
// Mirrors the lead_stage/computeDeadlineRisk patterns. Derived from the two PDFs
// (PMS Framework + KPI Scorecards). The data-honesty rule lives here too: a KPI's
// `source` says whether its value is real (AUTO), entered (MANUAL), approximated
// (PARTIAL), or unavailable (NA → rendered "—", never fabricated).
// ============================================================================

export const KpiCategory = z.enum([
  'OUTPUT',
  'QUALITY',
  'SPEED',
  'COMPLIANCE',
  'REVENUE',
]);
export type KpiCategory = z.infer<typeof KpiCategory>;
export const KPI_CATEGORY_LABELS: Record<KpiCategory, string> = {
  OUTPUT: 'Output',
  QUALITY: 'Quality',
  SPEED: 'Speed',
  COMPLIANCE: 'Compliance',
  REVENUE: 'Revenue',
};

export const KpiPeriod = z.enum(['WEEKLY', 'MONTHLY']);
export type KpiPeriod = z.infer<typeof KpiPeriod>;

// Data-honesty tag for a KPI value.
export const KpiSource = z.enum(['AUTO', 'MANUAL', 'PARTIAL', 'NA']);
export type KpiSource = z.infer<typeof KpiSource>;

export const ScorecardZone = z.enum(['GREEN', 'YELLOW', 'ORANGE', 'RED']);
export type ScorecardZone = z.infer<typeof ScorecardZone>;

export const ContributionRole = z.enum([
  'RESEARCH',
  'QUALIFICATION',
  'VALIDATION',
  'SALES',
  'ACCOUNT_MANAGER',
]);
export type ContributionRole = z.infer<typeof ContributionRole>;
export const CONTRIBUTION_ROLE_LABELS: Record<ContributionRole, string> = {
  RESEARCH: 'Research',
  QUALIFICATION: 'Qualification',
  VALIDATION: 'Validation',
  SALES: 'Sales',
  ACCOUNT_MANAGER: 'Account Manager',
};

export const ReportPeriod = z.enum(['DAILY', 'WEEKLY']);
export type ReportPeriod = z.infer<typeof ReportPeriod>;
export const ReportScope = z.enum(['COMPANY', 'DEPARTMENT', 'USER']);
export type ReportScope = z.infer<typeof ReportScope>;

// Zone thresholds from the PMS PDF (Green 90-100, Yellow 75-89, Orange 60-74,
// Red <60). `min` is the inclusive floor; ordered high → low.
export const SCORE_ZONE_META: Record<
  ScorecardZone,
  { label: string; min: number }
> = {
  GREEN: { label: 'High performer', min: 90 },
  YELLOW: { label: 'Meets expectations', min: 75 },
  ORANGE: { label: 'Needs improvement', min: 60 },
  RED: { label: 'Immediate review', min: 0 },
};

// Map a 0-100 composite to its zone.
export function zoneForScore(score: number): ScorecardZone {
  if (score >= 90) return 'GREEN';
  if (score >= 75) return 'YELLOW';
  if (score >= 60) return 'ORANGE';
  return 'RED';
}

// Bonus tier from the PMS PDF (advisory only — never auto-paid). 90+ full, 80-89
// 75%, 70-79 50%, <70 none.
export function bonusTierForScore(
  score: number,
): { label: string; pct: number } {
  if (score >= 90) return { label: 'Full bonus', pct: 100 };
  if (score >= 80) return { label: '75% bonus', pct: 75 };
  if (score >= 70) return { label: '50% bonus', pct: 50 };
  return { label: 'No bonus', pct: 0 };
}

// Seed KPI definitions for the Operational Tender Validation Team — the most
// data-rich scorecard, built first (Phase B). Weights are the PDF's exact
// 30/30/25/15; deadline compliance is tracked (weight 0) but unweighted, matching
// the PDF which lists it as a KPI without a weight. `source` flags real vs partial.
export interface KpiSeed {
  key: string;
  label: string;
  category: KpiCategory;
  weightPct: number;
  period: KpiPeriod;
  target: string;
  source: KpiSource;
}
export const OPERATIONAL_VALIDATION_KPIS: KpiSeed[] = [
  { key: 'submissions_per_week', label: 'Submissions / week', category: 'OUTPUT', weightPct: 30, period: 'WEEKLY', target: '10', source: 'AUTO' },
  { key: 'profit_maximization', label: 'Profit maximization', category: 'REVENUE', weightPct: 30, period: 'WEEKLY', target: '80', source: 'AUTO' },
  { key: 'risk_free_compliance', label: 'Risk-free compliance', category: 'COMPLIANCE', weightPct: 25, period: 'WEEKLY', target: '95%', source: 'PARTIAL' },
  { key: 'ai_validation_accuracy', label: 'AI validation accuracy', category: 'QUALITY', weightPct: 15, period: 'WEEKLY', target: '90%', source: 'PARTIAL' },
  { key: 'deadline_compliance', label: 'Submission deadline compliance', category: 'SPEED', weightPct: 0, period: 'WEEKLY', target: '95%', source: 'AUTO' },
];

// ---- DTOs ----
export const KpiDefinitionDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  department: Department.nullable(),
  key: z.string(),
  label: z.string(),
  category: KpiCategory,
  weightPct: z.number().int(),
  period: KpiPeriod,
  target: z.string().nullable(),
  source: KpiSource,
  active: z.boolean(),
  createdAt: z.string(),
});
export type KpiDefinitionDto = z.infer<typeof KpiDefinitionDto>;

export const KpiValueDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  kpiKey: z.string(),
  period: KpiPeriod,
  periodStart: z.string(),
  periodEnd: z.string(),
  numericValue: z.number().nullable(),
  displayValue: z.string().nullable(),
  source: KpiSource,
  enteredBy: z.string().uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KpiValueDto = z.infer<typeof KpiValueDto>;

// Body for POST /performance/kpi-values — a manager records a MANUAL KPI value.
export const CreateKpiValueDto = z.object({
  userId: z.string().uuid(),
  kpiKey: z.string().min(1).max(120),
  period: KpiPeriod.optional(),
  periodStart: z.string(),
  periodEnd: z.string(),
  numericValue: z.number().nullable().optional(),
  displayValue: z.string().max(60).optional(),
  note: z.string().max(2000).optional(),
});
export type CreateKpiValueDto = z.infer<typeof CreateKpiValueDto>;

export const ScorecardKpiDto = z.object({
  key: z.string(),
  label: z.string(),
  category: KpiCategory,
  value: z.string().nullable(),
  target: z.string().nullable(),
  source: KpiSource,
});
export type ScorecardKpiDto = z.infer<typeof ScorecardKpiDto>;

// A user's computed scorecard for a period. categoryScores omits categories with
// no data (never zero-filled). userName/department are denormalized for the UI.
export const ScorecardDto = z.object({
  id: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  userName: z.string(),
  department: Department.nullable(),
  position: z.string().nullable(),
  period: KpiPeriod,
  periodStart: z.string(),
  periodEnd: z.string(),
  categoryScores: z.record(KpiCategory, z.number()).nullable(),
  composite: z.number(),
  zone: ScorecardZone,
  kpis: z.array(ScorecardKpiDto),
  generatedAt: z.string().nullable(),
});
export type ScorecardDto = z.infer<typeof ScorecardDto>;

export const PerformanceReportDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  scope: ReportScope,
  scopeId: z.string().nullable(),
  period: ReportPeriod,
  periodStart: z.string(),
  periodEnd: z.string(),
  summary: z.unknown().nullable(),
  aiRunId: z.string().uuid().nullable(),
  generatedAt: z.string(),
});
export type PerformanceReportDto = z.infer<typeof PerformanceReportDto>;

// Executive rollup for the CEO / Performance Executive tab — all computed from
// scorecards (no AI yet; the narrative AI brief arrives in Phase D).
export const DepartmentRollupDto = z.object({
  department: Department.nullable(),
  label: z.string(),
  avg: z.number(),
  count: z.number(),
  topName: z.string().nullable(),
});
export type DepartmentRollupDto = z.infer<typeof DepartmentRollupDto>;

export const PerformanceOverviewDto = z.object({
  period: KpiPeriod,
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  companyAvg: z.number(),
  members: z.number(),
  highPerformers: z.number(),
  needsAttention: z.number(),
  departments: z.array(DepartmentRollupDto),
  // The lowest scorecards — who to look at first.
  attention: z.array(ScorecardDto),
});
export type PerformanceOverviewDto = z.infer<typeof PerformanceOverviewDto>;

// AI Management brief (Phase D) — the Claude-generated narrative over the
// scorecards. `headline` is one sentence; `bullets` are 3-5 factual observations;
// `topAction` is the single recommended next step. Used as the Claude tool schema.
export const PerformanceBriefSummary = z.object({
  headline: z.string(),
  bullets: z.array(z.string()),
  topAction: z.string(),
});
export type PerformanceBriefSummary = z.infer<typeof PerformanceBriefSummary>;

export const PerformanceBriefDto = z.object({
  // false when ANTHROPIC_API_KEY is unset — the UI then shows a "configure key"
  // note instead of an invented summary.
  configured: z.boolean(),
  generatedAt: z.string().nullable(),
  period: KpiPeriod,
  summary: PerformanceBriefSummary.nullable(),
});
export type PerformanceBriefDto = z.infer<typeof PerformanceBriefDto>;

// ============================================================================
// GROWTH ENGINE v2 — niches, prospects, outreach, contracts, notifications
// The cold-outreach arsenal's data plane. Niches/targets feed Lead Satellite;
// prospects are the per-campaign leads sheet; reply_classifications project onto
// prospect.status; suppressions are the do-not-contact gate. Read shapes over
// HTTP: nullable columns are .nullable(), timestamps are ISO strings.
// ============================================================================

// ---- Enum mirrors (one per Growth-Engine v2 pgEnum) ----
// Provenance of a niche_targets row.
export const NicheTargetSource = z.enum(['AI', 'MANUAL']);
export type NicheTargetSource = z.infer<typeof NicheTargetSource>;

// AI classification of an inbound reply (Reply Glock + RAG UNSURE pass).
export const ReplyVerdict = z.enum([
  'INTERESTED',
  'NOT_INTERESTED',
  'SNOOZE',
  'MEETING_REQUEST',
  'UNSURE',
  'AUTO_REPLY',
  'BOUNCE',
]);
export type ReplyVerdict = z.infer<typeof ReplyVerdict>;

// What kind of Drive artifact a campaign_assets row points at.
export const AssetKind = z.enum([
  'EMAIL_TEMPLATE',
  'NEWS_BRIEF',
  'NICHE_ANALYSIS',
  'COACH_REPORT',
  'CONTRACT_TEMPLATE',
  'OTHER',
]);
export type AssetKind = z.infer<typeof AssetKind>;

// ContractMaker contract lifecycle.
export const ContractStatus = z.enum(['GENERATED', 'SENT', 'SIGNED', 'FAILED']);
export type ContractStatus = z.infer<typeof ContractStatus>;

// ---- Industries ----
// An industry groups niches (one industry → many niches), org-scoped, for
// grouping/search ONLY. It is NOT part of lead research — the campaign config and
// the arsenal payload never reference it.
// Read shape of an industry row.
export const IndustryDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});
export type IndustryDto = z.infer<typeof IndustryDto>;

// Industry row enriched with its rollup count for the management list (GET
// /industries, JWT). `nicheCount` is how many niches point at this industry.
export const IndustryListItemDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  nicheCount: z.number().int().nonnegative(),
});
export type IndustryListItemDto = z.infer<typeof IndustryListItemDto>;

// Body for POST /industries (JWT) — create an industry. Deduped by
// (org, slugify(name)) server-side.
export const CreateIndustryDto = z.object({
  name: z.string().min(1).max(120),
});
export type CreateIndustryDto = z.infer<typeof CreateIndustryDto>;

// Body for PATCH /industries/:id (JWT) — rename an industry. A slug clash with a
// sibling industry in the same org is a 409.
export const UpdateIndustryDto = z.object({
  name: z.string().min(1).max(120),
});
export type UpdateIndustryDto = z.infer<typeof UpdateIndustryDto>;

// Body for PATCH /niches/:id/industry (JWT) — assign a niche to an industry, or
// unassign it (industryId = null). Grouping only — does not touch lead research.
export const AssignNicheIndustryDto = z.object({
  industryId: z.string().uuid().nullable(),
});
export type AssignNicheIndustryDto = z.infer<typeof AssignNicheIndustryDto>;

// ---- Niches ----
// Read shape of a niche row (the UI combobox + the machine niche list).
export const NicheDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});
export type NicheDto = z.infer<typeof NicheDto>;

// Body for POST /niches (JWT) — create a niche directly (the niches-management
// view, vs. the find-or-create the AIM launch does). Deduped by (org,
// slugify(name)) server-side — a slug clash is a 409. `industryId` optionally
// assigns the grouping parent on create (null/omitted = unassigned); a non-null
// id must belong to the caller's org or the create 404s. Grouping/search only.
export const CreateNicheDto = z.object({
  name: z.string().min(1).max(120),
  industryId: z.string().uuid().nullable().optional(),
});
export type CreateNicheDto = z.infer<typeof CreateNicheDto>;

// Body for PATCH /niches/:id (JWT) — rename a niche. A slug clash with a sibling
// niche in the same org is a 409. (Industry assignment is a separate route:
// PATCH /niches/:id/industry.)
export const UpdateNicheDto = z.object({
  name: z.string().min(1).max(120),
});
export type UpdateNicheDto = z.infer<typeof UpdateNicheDto>;

// Read shape of a niche_target archetype row.
export const NicheTargetDto = z.object({
  id: z.string().uuid(),
  nicheId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  searchHint: z.string().nullable(),
  source: NicheTargetSource,
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type NicheTargetDto = z.infer<typeof NicheTargetDto>;

// Body for POST /niches/:id/targets/bulk — the NICHE ANALYTICS workflow's AI
// targets. Upserted by (nicheId, slugify(name)); existing rows update searchHint.
export const NicheTargetBulkDto = z.object({
  targets: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        searchHint: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type NicheTargetBulkDto = z.infer<typeof NicheTargetBulkDto>;

// Result of POST /niches/:id/targets/bulk.
export const NicheTargetBulkResultDto = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  targets: z.array(NicheTargetDto),
});
export type NicheTargetBulkResultDto = z.infer<typeof NicheTargetBulkResultDto>;

// Niche row enriched with rollup counts for the UI niches-management list
// (GET /niches, JWT). `targetCount` is every target (enabled + disabled);
// `campaignCount` is how many campaigns reference this niche; `prospectCount` is
// how many prospects sit under those campaigns. `industryId`/`industryName` are
// the niche's optional grouping parent (null when unassigned). The plain NicheDto
// (id/name/slug) stays the combobox shape — this is a superset, so the combobox
// keeps working if it reads the same list. The industry/prospect fields default
// in (`.optional()` with a `.default()`) so any machine route reusing this shape
// without populating them still validates; the JWT listWithCounts always sets them.
export const NicheListItemDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  targetCount: z.number().int().nonnegative(),
  campaignCount: z.number().int().nonnegative(),
  prospectCount: z.number().int().nonnegative().default(0),
  industryId: z.string().uuid().nullable().default(null),
  industryName: z.string().nullable().default(null),
});
export type NicheListItemDto = z.infer<typeof NicheListItemDto>;

// Body for POST /niches/:id/targets (JWT) — add ONE manual target archetype
// (source MANUAL). Upserted by (nicheId, slugify(name)) like the machine bulk
// route; an existing slug updates its searchHint instead of duplicating.
export const CreateNicheTargetDto = z.object({
  name: z.string().min(1).max(200),
  searchHint: z.string().max(500).optional(),
});
export type CreateNicheTargetDto = z.infer<typeof CreateNicheTargetDto>;

// Body for PATCH /niche-targets/:id (JWT) — the human enable/disable + edit. All
// fields optional; at least one required. `enabled:false` archives the target
// (kept as evidence, skipped by Lead Satellite).
export const UpdateNicheTargetDto = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().min(1).max(200).optional(),
    searchHint: z.string().max(500).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'at least one field is required');
export type UpdateNicheTargetDto = z.infer<typeof UpdateNicheTargetDto>;

// ---- Campaign config (the machine GET /campaigns/:id/config response) ----
// The autonomous arsenal's view of a campaign: launch inputs + the resolved niche
// with its ENABLED targets. driveFolderId is the Ammo Forge artifact root.
export const CampaignConfigDto = z.object({
  campaignId: z.string().uuid(),
  lifecycle: CampaignLifecycle,
  name: z.string().nullable(),
  country: z.string(),
  region: z.string(),
  project: z.string(),
  sender: z.string(),
  gmailLabel: z.string(),
  salesCalendarId: z.string().nullable(),
  whatsappNumber: z.string(),
  driveFolderId: z.string().nullable(),
  // Ammo Forge content blocks the outreach workflows fetch (coldEmail, etc.).
  // Defaults to {} so a machine caller always gets a map, never null/undefined.
  templates: CampaignTemplatesDto.default({}),
  niche: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    targets: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        searchHint: z.string().nullable(),
      }),
    ),
  }),
  // The GLOBAL Growth-Engine automation knobs (the effective Templates + Leads
  // groups from workflow_config), merged into the machine route the outreach
  // workflows already poll so they pick up the baseline copy + lead governance
  // without a new HTTP node. `z.lazy` because WorkflowTemplatesDto / WorkflowLeadsDto
  // are declared later in this module (after their template primitives).
  automation: z.object({
    templates: z.lazy(() => WorkflowTemplatesDto),
    leads: z.lazy(() => WorkflowLeadsDto),
  }),
});
export type CampaignConfigDto = z.infer<typeof CampaignConfigDto>;

// Machine campaign-list row (GET /campaigns/machine/list?lifecycle=ACTIVE).
export const CampaignMachineListItemDto = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  project: z.string(),
  country: z.string(),
  region: z.string(),
  sender: z.string(),
  gmailLabel: z.string(),
  driveFolderId: z.string().nullable(),
  nicheId: z.string().uuid(),
});
export type CampaignMachineListItemDto = z.infer<
  typeof CampaignMachineListItemDto
>;

// ---- Prospects ----
// Mirror of the prospect_status pgEnum. A PROJECTION of the conversation; the
// append-only reply_classifications rows are the evidence behind it.
export const ProspectStatus = z.enum([
  'NEW',
  'EMAILED',
  'REPLIED',
  'INTERESTED',
  'MEETING_SCHEDULED',
  'NOT_INTERESTED',
  'RE_ENGAGED',
  'DO_NOT_CONTACT',
]);
export type ProspectStatus = z.infer<typeof ProspectStatus>;

// Read shape of a prospect row.
export const ProspectDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  campaignId: z.string().uuid(),
  nicheTargetId: z.string().uuid().nullable(),
  email: z.string(),
  companyName: z.string().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  emailVerified: z.boolean(),
  status: ProspectStatus,
  snoozeUntil: z.string().nullable(),
  followupCount: z.number().int().nonnegative(),
  lastContactedAt: z.string().nullable(),
  leadId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProspectDto = z.infer<typeof ProspectDto>;

// One incoming prospect in a bulk write (Lead Satellite scrape result). Scraped
// fields only — status/snooze/followup are server-owned (never set by a scrape).
export const ProspectInputDto = z.object({
  email: z.string().email().max(320),
  companyName: z.string().max(300).optional(),
  website: z.string().max(500).optional(),
  city: z.string().max(200).optional(),
  country: z.string().max(120).optional(),
  sourceUrl: z.string().max(1000).optional(),
  nicheTargetId: z.string().uuid().optional(),
  emailVerified: z.boolean().optional(),
});
export type ProspectInputDto = z.infer<typeof ProspectInputDto>;

// Body for POST /prospects/bulk — upsert on (campaignId, email). On conflict the
// scraped fields update but status/snooze/followupCount/leadId NEVER regress.
export const ProspectBulkDto = z.object({
  campaignId: z.string().uuid(),
  prospects: z.array(ProspectInputDto).min(1).max(500),
});
export type ProspectBulkDto = z.infer<typeof ProspectBulkDto>;

// Result of POST /prospects/bulk.
export const ProspectBulkResultDto = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});
export type ProspectBulkResultDto = z.infer<typeof ProspectBulkResultDto>;

// Body for PATCH /prospects/:id — partial status/funnel update (Reach Bazooka
// stamps lastContactedAt+followupCount; Reply Glock sets status/snoozeUntil).
export const UpdateProspectDto = z
  .object({
    status: ProspectStatus.optional(),
    snoozeUntil: z.string().datetime().nullable().optional(),
    followupCount: z.number().int().nonnegative().optional(),
    lastContactedAt: z.string().datetime().nullable().optional(),
    emailVerified: z.boolean().optional(),
    leadId: z.string().uuid().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'at least one field is required');
export type UpdateProspectDto = z.infer<typeof UpdateProspectDto>;

// Org-scoped JWT list for the UI prospect board/table (GET /prospects/board).
// `items` is the (optionally filtered + paginated) page; `total` is the count
// AFTER filters but BEFORE the limit/offset window; `statusCounts` is the full
// per-status tally for the campaign board columns (unaffected by the page window).
export const ProspectListDto = z.object({
  items: z.array(ProspectDto),
  total: z.number().int().nonnegative(),
  statusCounts: z.record(ProspectStatus, z.number().int().nonnegative()),
});
export type ProspectListDto = z.infer<typeof ProspectListDto>;

// Body for PATCH /prospects/:id/status — the human manual override from the UI
// (archive / re-open a prospect). status is required; an optional snoozeUntil
// rides along for a manual RE_ENGAGE/snooze. Distinct from the machine PATCH which
// the outreach stages use to stamp followup/lastContacted.
export const UpdateProspectStatusDto = z.object({
  status: ProspectStatus,
  snoozeUntil: z.string().datetime().nullable().optional(),
});
export type UpdateProspectStatusDto = z.infer<typeof UpdateProspectStatusDto>;

// ---- Reply classifications ----
// Body for POST /reply-classifications — Reply Glock / RAG verdict. Inserted as
// evidence AND projected onto prospects.status (INTERESTED→INTERESTED,
// SNOOZE→NOT_INTERESTED+snoozeUntil, MEETING_REQUEST→MEETING_SCHEDULED, …).
export const ReplyClassificationDto = z.object({
  prospectId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  verdict: ReplyVerdict,
  snoozeUntil: z.string().datetime().optional(),
  model: z.string().max(120).optional(),
  raw: z.unknown().optional(),
  suggestedReply: z.string().max(8000).optional(),
});
export type ReplyClassificationDto = z.infer<typeof ReplyClassificationDto>;

// Result of POST /reply-classifications — the recorded row id + the prospect's
// resulting status (so the caller sees the projection without a re-fetch).
export const ReplyClassificationResultDto = z.object({
  id: z.string().uuid(),
  prospectId: z.string().uuid(),
  status: ProspectStatus,
});
export type ReplyClassificationResultDto = z.infer<
  typeof ReplyClassificationResultDto
>;

// Read filters for GET /reply-classifications (the RAG agent backlog + verdict
// pulls). `needsRag=true` is the RAG drafting queue: UNSURE rows whose prospect
// has no sibling reply_classifications row carrying a non-null suggestedReply yet
// (once the RAG agent POSTs a row WITH suggestedReply, the prospect drops out).
export const ReplyClassificationQuery = z.object({
  verdict: ReplyVerdict.optional(),
  prospectId: z.string().uuid().optional(),
  needsRag: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type ReplyClassificationQuery = z.infer<typeof ReplyClassificationQuery>;

// Read shape of one reply_classifications row joined with enough prospect context
// for the RAG agent to act (prospect email + campaignId — the verdict log itself
// carries no campaignId; it is inherited via the prospect). Timestamps are ISO.
export const ReplyClassificationDtoRead = z.object({
  id: z.string().uuid(),
  prospectId: z.string().uuid(),
  messageId: z.string().uuid().nullable(),
  verdict: ReplyVerdict,
  snoozeUntil: z.string().nullable(),
  model: z.string().nullable(),
  suggestedReply: z.string().nullable(),
  createdAt: z.string(),
  // Joined from the parent prospect (the RAG agent needs these to assemble context).
  prospectEmail: z.string(),
  campaignId: z.string().uuid(),
});
export type ReplyClassificationDtoRead = z.infer<
  typeof ReplyClassificationDtoRead
>;

// Read shape of one DRAFT-REVIEW-QUEUE row (GET /reply-classifications/queue, JWT):
// a reply_classifications row that HAS a non-null suggestedReply (the RAG agent has
// drafted an answer a human now reviews), joined with prospect context (email +
// companyName + campaignId) and the prospect's LATEST verdict. `suggestedReply` is
// non-null by construction here (the queue only surfaces drafted rows).
export const ReplyDraftDto = z.object({
  id: z.string().uuid(),
  prospectId: z.string().uuid(),
  campaignId: z.string().uuid(),
  prospectEmail: z.string(),
  prospectCompanyName: z.string().nullable(),
  verdict: ReplyVerdict,
  suggestedReply: z.string(),
  model: z.string().nullable(),
  createdAt: z.string(),
  // The prospect's most recent verdict (may differ from this row's verdict if a
  // later classification landed) — lets the reviewer see the current funnel state.
  latestVerdict: ReplyVerdict,
});
export type ReplyDraftDto = z.infer<typeof ReplyDraftDto>;

// ---- Outreach messages (the conversation ledger) ----
// Mirror of the message_direction pgEnum: Bazooka sends (OUTBOUND) and the Gmail
// poller's inbound replies (INBOUND).
export const MessageDirection = z.enum(['OUTBOUND', 'INBOUND']);
export type MessageDirection = z.infer<typeof MessageDirection>;

// Mirror of the message_status pgEnum. Outbound: SENT/FAILED/BOUNCED; inbound:
// RECEIVED.
export const MessageStatus = z.enum(['SENT', 'FAILED', 'BOUNCED', 'RECEIVED']);
export type MessageStatus = z.infer<typeof MessageStatus>;

// Body for POST /outreach-messages — one conversation-ledger entry. When
// gmailMessageId is present the row UPSERTS on it (re-polled Gmail threads must
// not double-insert — on conflict status/subject/bodySnippet/sentAt update);
// otherwise it is a plain insert. The prospect must exist (404). org is inherited
// via the prospect (the ledger has no own organizationId).
export const CreateOutreachMessageDto = z.object({
  prospectId: z.string().uuid(),
  direction: MessageDirection,
  status: MessageStatus,
  gmailMessageId: z.string().max(256).optional(),
  gmailThreadId: z.string().max(256).optional(),
  subject: z.string().max(2000).optional(),
  bodySnippet: z.string().max(8000).optional(),
  templateAssetId: z.string().uuid().optional(),
  sentAt: z.string().datetime().optional(),
  error: z.string().max(2000).optional(),
});
export type CreateOutreachMessageDto = z.infer<typeof CreateOutreachMessageDto>;

// Read filters for GET /outreach-messages — the thread context pull (RAG Agent +
// Reply Glock). Newest-first; defaults to 50 rows.
export const OutreachMessageQuery = z.object({
  prospectId: z.string().uuid().optional(),
  gmailThreadId: z.string().max(256).optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type OutreachMessageQuery = z.infer<typeof OutreachMessageQuery>;

// Read shape of an outreach_messages row over HTTP (timestamps → ISO strings).
export const OutreachMessageDto = z.object({
  id: z.string().uuid(),
  prospectId: z.string().uuid(),
  direction: MessageDirection,
  status: MessageStatus,
  gmailMessageId: z.string().nullable(),
  gmailThreadId: z.string().nullable(),
  subject: z.string().nullable(),
  bodySnippet: z.string().nullable(),
  templateAssetId: z.string().uuid().nullable(),
  sentAt: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type OutreachMessageDto = z.infer<typeof OutreachMessageDto>;

// ---- Suppressions ----
// Body for POST /suppressions — add an address to the org do-not-contact list.
// org resolves from sourceProspectId's prospect, else from campaignId.
export const SuppressionDto = z
  .object({
    email: z.string().email().max(320),
    reason: z.string().max(500).optional(),
    sourceProspectId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
  })
  .refine(
    (o) => !!o.sourceProspectId || !!o.campaignId,
    'sourceProspectId or campaignId is required to resolve the org',
  );
export type SuppressionDto = z.infer<typeof SuppressionDto>;

export const SuppressionResultDto = z.object({
  id: z.string().uuid(),
  created: z.boolean(),
});
export type SuppressionResultDto = z.infer<typeof SuppressionResultDto>;

// Read shape of one suppressions row (GET /suppressions, JWT) — the org's
// do-not-contact list for the UI. Timestamps are ISO strings.
export const SuppressionListItemDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string(),
  reason: z.string().nullable(),
  sourceProspectId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type SuppressionListItemDto = z.infer<typeof SuppressionListItemDto>;

// ---- Prospect graduation (INTERESTED → hot lead) ----
// Body for POST /prospects/:id/graduate — the Reply Glock graduation that retires
// the CRM Hot Leads workflow. All optional. IDEMPOTENT: re-graduating a prospect
// returns its existing lead; an existing leads row for (org,email) is LINKED, not
// duplicated (the unique key would reject a dup anyway).
export const GraduateProspectDto = z.object({
  stage: LeadStage.optional(),
  hotReason: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
});
export type GraduateProspectDto = z.infer<typeof GraduateProspectDto>;

// Result of POST /prospects/:id/graduate — the hot lead + whether THIS call created
// it (false when the prospect was already linked or an existing lead was reused).
export const GraduateProspectResultDto = z.object({
  lead: LeadDto,
  graduated: z.boolean(),
});
export type GraduateProspectResultDto = z.infer<
  typeof GraduateProspectResultDto
>;

// ---- Campaign assets ----
// Body for POST /campaigns/:id/assets — register a Drive artifact (upsert on
// driveFileId). kind mirrors the asset_kind pgEnum.
export const CampaignAssetDto = z.object({
  kind: AssetKind,
  name: z.string().min(1).max(300),
  driveFileId: z.string().min(1).max(256),
  driveUrl: z.string().max(1000).optional(),
  mimeType: z.string().max(200).optional(),
});
export type CampaignAssetDto = z.infer<typeof CampaignAssetDto>;

export const CampaignAssetResultDto = z.object({
  id: z.string().uuid(),
  created: z.boolean(),
});
export type CampaignAssetResultDto = z.infer<typeof CampaignAssetResultDto>;

// Body for POST /campaigns/:id/templates — the blocks Ammo Forge writes for a
// campaign. MERGED into campaigns.templates (existing keys survive unless the
// same key is re-sent, then it's overwritten), so a workflow can set blocks
// incrementally. The merged map is returned.
export const CampaignTemplatesBodyDto = z.object({
  templates: CampaignTemplatesDto,
});
export type CampaignTemplatesBodyDto = z.infer<typeof CampaignTemplatesBodyDto>;

// ---- Contracts ----
// Body for POST /contracts — ContractMaker output (the PDF stays in Drive). At least
// one of leadId/customerId/campaignId is required (the API resolves the org from it).
export const CreateContractDto = z
  .object({
    leadId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
    templateAssetId: z.string().uuid().optional(),
    signingMeetingId: z.string().uuid().optional(),
    driveFileId: z.string().max(256).optional(),
    driveUrl: z.string().max(1000).optional(),
    cooperationTerm: z.string().max(500).optional(),
  })
  .refine(
    (o) => !!o.leadId || !!o.customerId || !!o.campaignId,
    'leadId, customerId, or campaignId is required to resolve the org',
  );
export type CreateContractDto = z.infer<typeof CreateContractDto>;

// Body for PATCH /contracts/:id — status flip (signing detection → SIGNED).
export const UpdateContractDto = z
  .object({
    status: ContractStatus.optional(),
    driveFileId: z.string().max(256).nullable().optional(),
    driveUrl: z.string().max(1000).nullable().optional(),
    signedAt: z.string().datetime().nullable().optional(),
    error: z.string().max(1000).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'at least one field is required');
export type UpdateContractDto = z.infer<typeof UpdateContractDto>;

export const ContractDto = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  leadId: z.string().uuid().nullable(),
  customerId: z.string().uuid().nullable(),
  campaignId: z.string().uuid().nullable(),
  templateAssetId: z.string().uuid().nullable(),
  signingMeetingId: z.string().uuid().nullable(),
  status: ContractStatus,
  driveFileId: z.string().nullable(),
  driveUrl: z.string().nullable(),
  cooperationTerm: z.string().nullable(),
  signedAt: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ContractDto = z.infer<typeof ContractDto>;

// Read filters for GET /contracts — ContractMaker's "did I already generate a
// contract for this lead?" check. Newest-first; defaults to 50 rows.
export const ContractQuery = z.object({
  campaignId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  status: ContractStatus.optional(),
  limit: z.number().int().positive().max(500).optional(),
});
export type ContractQuery = z.infer<typeof ContractQuery>;

// ---- Notifications ----
// Body for POST /notifications — in-app feed entry. org resolves from campaignId
// when present, else from the authenticated principal (n8n callback path).
export const CreateNotificationDto = z.object({
  type: z.string().min(1).max(80),
  title: z.string().min(1).max(300),
  body: z.string().max(2000).optional(),
  link: z.string().max(1000).optional(),
  campaignId: z.string().uuid().optional(),
});
export type CreateNotificationDto = z.infer<typeof CreateNotificationDto>;

// Read shape of a notification row (the bell feed).
export const NotificationDto = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

// ============================================================================
// Growth-Engine workflow config (the GLOBAL, app-wide singleton in
// workflow_config). Makes the n8n wiring — currently env-only (redeploy to
// change) — admin-editable from the ERP, with the env var as the fallback. The
// read shape exposes, per field, the EFFECTIVE value (stored override ?? env)
// plus whether a stored override exists. Secrets are never returned: the n8n API
// key and the ingest token are status-only.
// ============================================================================

// Per-field resolution envelope: `value` is the effective (stored ?? env) value;
// `overridden` is true when a stored override row value exists (so the UI can show
// "overriding env" vs "from env").
export const ConfigFieldDto = z.object({
  value: z.string().nullable(),
  overridden: z.boolean(),
});
export type ConfigFieldDto = z.infer<typeof ConfigFieldDto>;

// The org's default Gmail sending alias. Mirrors campaigns.sender (plain text, not a
// pgEnum) — a per-org sender KEY, validated against the org's senders at the service
// layer rather than in the DTO. Legacy 'info'/'hanna' keys remain valid strings.
export const DefaultSender = z.string().min(1);
export type DefaultSender = z.infer<typeof DefaultSender>;

// Outreach tone + template language. Stored as plain text on workflow_config (the
// project forbids new pgEnums), validated to these literals on the wire. Nullable
// everywhere: null = unset (no product default — the UI shows "not set").
export const OutreachTone = z.enum(['friendly', 'formal', 'direct']);
export type OutreachTone = z.infer<typeof OutreachTone>;
export const TemplateLanguage = z.enum(['en', 'de']);
export type TemplateLanguage = z.infer<typeof TemplateLanguage>;

// One block of the baseline outreach sequence — a subject + body pair. The default
// template is exactly three of these (cold → followup → finalPush).
export const TemplateBlockDto = z.object({
  subject: z.string(),
  body: z.string(),
});
export type TemplateBlockDto = z.infer<typeof TemplateBlockDto>;

// The stored `defaultTemplate` jsonb shape: the full 3-block sequence, or null when
// no baseline has been set. All three blocks are required when the object is present.
export const DefaultTemplateDto = z.object({
  cold: TemplateBlockDto,
  followup: TemplateBlockDto,
  finalPush: TemplateBlockDto,
});
export type DefaultTemplateDto = z.infer<typeof DefaultTemplateDto>;

// Configuration > Templates — the baseline outreach copy. Every field is the raw
// stored value (null = unset); there is no env fallback for these. Factored out of
// WorkflowConfigDto so the same effective shape can ride along on the machine
// campaign config (CampaignConfigDto.automation).
export const WorkflowTemplatesDto = z.object({
  default: DefaultTemplateDto.nullable(),
  signature: z.string().nullable(),
  // Per-org signature image. Optional + nullable for backward compatibility:
  // omitted/null = no signature image set. Stored as a hotlinkable image URL —
  // run `driveImageUrl()` on a pasted Google Drive share link before persisting.
  signatureImageUrl: z.string().url().nullable().optional(),
  tone: OutreachTone.nullable(),
  language: TemplateLanguage.nullable(),
});
export type WorkflowTemplatesDto = z.infer<typeof WorkflowTemplatesDto>;

// Normalize a Google Drive share link into a hotlinkable image URL of the form
// `https://lh3.googleusercontent.com/d/<FILE_ID>`. Handles the common Drive share
// shapes (`/file/d/<id>/view`, `open?id=<id>`, `uc?id=<id>`) and an already-correct
// lh3 URL. If no Drive file id can be extracted (any other URL — e.g. a same-origin
// `/public/signature-image/<uuid>` path or an arbitrary https URL), the input is
// returned UNCHANGED (trimmed). Pure + total: never throws, no I/O.
export function driveImageUrl(input: string): string {
  const trimmed = (input ?? '').trim();
  // Match the file id across every supported Drive/lh3 shape. Drive file ids are
  // URL-safe base64 (letters, digits, '-' and '_'); take the first match found.
  const id =
    trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ??
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] ??
    trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/)?.[1] ??
    null;
  return id ? `https://lh3.googleusercontent.com/d/${id}` : trimmed;
}

// Configuration > Leads — lead-generation governance. The caps are raw stored
// values (null = unset = no cap). `defaultRegions` is the stored array (never null —
// defaults to []). The two booleans are EFFECTIVE: an unset value resolves to the
// safe product default `true` so it can never silently read as "off". Factored out
// of WorkflowConfigDto for reuse on CampaignConfigDto.automation.
export const WorkflowLeadsDto = z.object({
  maxLeadsPerRun: z.number().int().nullable(),
  maxPerNiche: z.number().int().nullable(),
  dailySendCap: z.number().int().nullable(),
  defaultRegions: z.array(z.string()),
  respectSuppressions: z.boolean(),
  dedupDays: z.number().int().nullable(),
  requireNicheAnalysis: z.boolean(),
});
export type WorkflowLeadsDto = z.infer<typeof WorkflowLeadsDto>;

// GET /arsenal/config — the resolved Growth-Engine workflow config. Every webhook
// + the n8n base URL carry the {value, overridden} envelope. The n8n API key and
// ingest token are status-only (never returned): `n8nApiKeySet` reflects the env
// key; `ingestTokenSet` + `ingestTokenSource` ('rotated' = a stored hash exists,
// 'env' = falling back to ARSENAL_INGEST_TOKEN, 'none' = neither) describe the
// machine-route auth without disclosing the secret.
export const WorkflowConfigDto = z.object({
  webhooks: z.object({
    aim: ConfigFieldDto,
    leadSatellite: ConfigFieldDto,
    ammoForge: ConfigFieldDto,
    reachBazooka: ConfigFieldDto,
    replyGlock: ConfigFieldDto,
    sleeperGrenade: ConfigFieldDto,
  }),
  n8nApiUrl: ConfigFieldDto,
  n8nApiKeySet: z.boolean(),
  ingestTokenSet: z.boolean(),
  ingestTokenSource: z.enum(['rotated', 'env', 'none']),
  ingestTokenSetAt: z.string().nullable(),
  defaultSender: DefaultSender.nullable(),
  // The resolved per-org sender list (the org's own senders, or DEFAULT_SENDERS when
  // it has none). Managed via dedicated sender CRUD endpoints, not the PUT body below.
  senders: z.array(OrgSenderDto),
  // The org's default Google Calendar id sales bookings land on (null = unset).
  salesCalendarId: z.string().nullable(),
  followupOffsetDays: z.number().int().nullable(),
  finalPushOffsetDays: z.number().int().nullable(),
  // Configuration > Templates / Leads — see WorkflowTemplatesDto / WorkflowLeadsDto
  // (defined above). Referenced here so the wire shape is unchanged while the same
  // groups can be reused on CampaignConfigDto.automation.
  templates: WorkflowTemplatesDto,
  leads: WorkflowLeadsDto,
});
export type WorkflowConfigDto = z.infer<typeof WorkflowConfigDto>;

// A nullable URL override field for the PUT body: a non-empty string must be a
// valid URL (sets the override); an empty string OR null clears the override (→
// env fallback); an omitted key leaves the stored value unchanged. The
// empty-string→null coercion runs before validation so a cleared form input reads
// as "clear", not "invalid URL".
const NullableUrlOverride = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().url('Must be a valid URL').nullable(),
);

// A nullable nonnegative-int override (sequence offsets), empty string → null.
const NullableOffsetDays = z.preprocess(
  (v) => (v === '' ? null : v),
  z.number().int().min(0, 'Days must be 0 or more').nullable(),
);

// A nullable nonnegative-int cap (lead caps / dedup window): a value sets it, null
// (or "") clears it back to "no cap". Reuses the offset coercion + bound.
const NullableCap = z.preprocess(
  (v) => (v === '' ? null : v),
  z.number().int().min(0, 'Must be 0 or more').nullable(),
);

// A nullable free-text override (e.g. the sales calendar id): a non-empty string sets
// it, an empty string OR null clears it, omit leaves it unchanged. Empty-string→null
// so a cleared form input reads as "clear".
const NullableText = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().nullable(),
);

// Default target regions: an array of NON-EMPTY strings, each trimmed. Blank/
// whitespace-only entries are rejected (not silently dropped) so a bad form row
// surfaces as a validation error rather than vanishing.
const DefaultRegions = z.array(
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, 'Region must not be empty'),
);

// PUT body for the Templates group. Every field optional; null clears, omit leaves
// unchanged. `default` is the full 3-block object (validated) OR null to clear the
// baseline — a partial template is rejected (all three blocks with subject+body).
const UpdateTemplates = z.object({
  default: DefaultTemplateDto.nullable().optional(),
  signature: z.string().nullable().optional(),
  // null clears the signature image, omit leaves it unchanged. Empty string → null
  // so a cleared form input reads as "clear" rather than failing URL validation.
  signatureImageUrl: z
    .preprocess((v) => (v === '' ? null : v), z.string().url().nullable())
    .optional(),
  tone: OutreachTone.nullable().optional(),
  language: TemplateLanguage.nullable().optional(),
});

// PUT body for the Leads group. Every field optional; null clears a cap, omit
// leaves unchanged. `defaultRegions` replaces the stored array wholesale.
const UpdateLeads = z.object({
  maxLeadsPerRun: NullableCap.optional(),
  maxPerNiche: NullableCap.optional(),
  dailySendCap: NullableCap.optional(),
  defaultRegions: DefaultRegions.optional(),
  respectSuppressions: z.boolean().optional(),
  dedupDays: NullableCap.optional(),
  requireNicheAnalysis: z.boolean().optional(),
});

// PUT /arsenal/config — partial update of the singleton. Every field is optional;
// providing a value sets the override, `null` (or "") clears it back to env, and
// omitting it leaves the stored value untouched. The ingest token is deliberately
// NOT here — rotation is a separate, later endpoint.
export const UpdateWorkflowConfigDto = z.object({
  webhooks: z
    .object({
      aim: NullableUrlOverride.optional(),
      leadSatellite: NullableUrlOverride.optional(),
      ammoForge: NullableUrlOverride.optional(),
      reachBazooka: NullableUrlOverride.optional(),
      replyGlock: NullableUrlOverride.optional(),
      sleeperGrenade: NullableUrlOverride.optional(),
    })
    .optional(),
  n8nApiUrl: NullableUrlOverride.optional(),
  defaultSender: DefaultSender.nullable().optional(),
  // The org's default sales calendar id. Empty string OR null clears it, omit leaves
  // it unchanged. The senders LIST is managed via dedicated CRUD endpoints, not here.
  salesCalendarId: NullableText.optional(),
  followupOffsetDays: NullableOffsetDays.optional(),
  finalPushOffsetDays: NullableOffsetDays.optional(),
  templates: UpdateTemplates.optional(),
  leads: UpdateLeads.optional(),
});
export type UpdateWorkflowConfigDto = z.infer<typeof UpdateWorkflowConfigDto>;

// GET /arsenal/lead-stats — the org-scoped counts behind the Configuration page's
// metric strip: total leads, prospects, and suppression-list entries for the
// caller's organization. Pure tallies — no env/override semantics here.
export const LeadStatsDto = z.object({
  leads: z.number().int(),
  prospects: z.number().int(),
  suppressed: z.number().int(),
});
export type LeadStatsDto = z.infer<typeof LeadStatsDto>;

// POST /arsenal/config/test-n8n — the result of probing the n8n public API with the
// resolved base URL (stored override ?? env) + the env N8N_API_KEY. `configured` is
// false when the URL or key is unset (no call attempted); `ok` is true only on a
// successful authenticated 2xx. `detail` is a human string ('Connected', an HTTP
// status, or an error message) and `workflowCount` is the count the probe could read
// (null when the body doesn't expose it or the call wasn't made/failed). The endpoint
// never throws — failures are surfaced in `detail`, never as a 5xx.
export const TestN8nResultDto = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  detail: z.string(),
  workflowCount: z.number().int().nullable(),
});
export type TestN8nResultDto = z.infer<typeof TestN8nResultDto>;

// POST /arsenal/config/rotate-token — the freshly minted machine ingest token. The
// plaintext `token` is returned EXACTLY ONCE for the admin to paste into n8n; only
// its SHA-256 hash is persisted (workflow_config.ingestTokenHash), so it can never be
// read back. `setAt` is the ISO stamp the rotation took effect.
export const RotateIngestTokenResultDto = z.object({
  token: z.string(),
  setAt: z.string(),
});
export type RotateIngestTokenResultDto = z.infer<typeof RotateIngestTokenResultDto>;
