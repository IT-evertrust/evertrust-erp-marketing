# Per-org Google connect — build spec (increment 1: foundation)

Goal: let each org connect **multiple** Google accounts (one per ERP user, carrying that user's
role) via a real OAuth authorization-code flow, store the **encrypted** refresh token per org,
and pick a **default Gmail** + **default Calendar** account. This is distinct from the GIS
**login** (which proves identity only and holds no Google API access).

Increment 1 (this doc) is the **decision-independent foundation** + the per-org **calendar list**
(fixes a real multi-tenant bug). The send seam and the **replies** path (which forces the A/B/C
scope decision — webhook vs restricted `gmail.readonly` + CASA) are increment 2.

## Scopes requested at connect time (increment 1)
`openid email profile` (to read the account's `sub`+email from the returned id_token) +
`gmail.send` + `calendar.events` + `calendar.readonly`. **All sensitive, none restricted** — no
CASA audit. `gmail.readonly` (inbox read) is deliberately NOT requested here; it is the increment-2
decision. Use `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`
(incremental authorization — readonly can be added later without re-consenting the rest).

## DB (migration 0031, model on 0028/0030 + append meta/_journal.json idx 31)
New table `google_accounts`:
- `id` uuid pk; `organization_id` uuid NOT NULL → organizations.id; `user_id` uuid NOT NULL → users.id (the connector; role derived from this user at read time)
- `google_sub` text NOT NULL (Google stable account id); `email` text NOT NULL; `display_name` text NULL
- `scopes` text[] NOT NULL default '{}'
- `refresh_token_enc` text NOT NULL (AES-256-GCM ciphertext — NEVER plaintext)
- `access_token_enc` text NULL; `access_token_expires_at` timestamptz NULL (optional short-lived cache)
- `status` text NOT NULL default 'CONNECTED' ('CONNECTED' | 'REVOKED' | 'ERROR'); `last_error` text NULL
- `connected_at` timestamptz NOT NULL default now(); `updated_at` timestamptz NOT NULL default now()
- UNIQUE (`organization_id`, `google_sub`); index on `organization_id`

`org_config` — add: `default_gmail_account_id` uuid NULL → google_accounts.id;
`default_calendar_account_id` uuid NULL → google_accounts.id.

`org_senders` — add: `google_account_id` uuid NULL → google_accounts.id (a sender backed by a
connected account; null = bare alias as today).

## shared (packages/shared)
- `ConnectedGoogleAccountDto` = `{ id, email, displayName: string|null, role: UserRole, scopes: string[], status, isDefaultGmail: boolean, isDefaultCalendar: boolean, connectedAt: string }`
- `SetGoogleDefaultsDto` = `{ defaultGmailAccountId?: string|null, defaultCalendarAccountId?: string|null }` (Zod; ids must be uuid or null)
- `GOOGLE_CONNECT_SCOPES` = the scope array above (single source of truth).

## backend (new module erp-server/src/google/)
- `token-crypto.ts` — AES-256-GCM `encrypt(plain)→"iv:tag:ct"(base64)` / `decrypt()`; key = `GOOGLE_TOKEN_ENC_KEY` (base64, 32 bytes). Throw if key missing/wrong length.
- `google-oauth.service.ts` — wraps `OAuth2Client` (already a dep): `isConfigured()`, `buildConsentUrl(state)`, `exchangeCode(code)→{refreshToken,accessToken,expiryDate,sub,email,name}`, `refreshAccessToken(refreshToken)→{accessToken,expiryDate}`.
- `google-accounts.service.ts` — `listForOrg(orgId)`, `upsertFromCallback(orgId,userId,tokens+profile)` (encrypt refresh; if org has no default yet, set this as default gmail+calendar), `setDefaults(orgId,dto)` (validate ids ∈ org), `disconnect(orgId,id)` (clear pointers if they referenced it; best-effort token revoke), `getAccessTokenForOrg(orgId,'gmail'|'calendar')→{accessToken,account}|null` (resolve default → decrypt → refresh).
- `google-connect.controller.ts`:
  - `GET /google/connect/start` (JwtAuthGuard, `@OrgId`, `@CurrentUser`) → `{ url }`; state = short-TTL signed JWT `{org,sub,nonce}`; 503 if `!isConfigured()`.
  - `GET /google/connect/callback` (`@Public`) → verify state, `exchangeCode`, `upsertFromCallback`, 302 redirect to `${APP_WEB_URL}/...?google=connected` (or `?google=error`); if `APP_WEB_URL` blank, return a minimal "connected — you can close this tab" HTML.
  - `GET /google/accounts` (admin:config, `@OrgId`) → `ConnectedGoogleAccountDto[]`.
  - `POST /google/accounts/defaults` (admin:config, `@OrgId`) → set defaults → returns list.
  - `DELETE /google/accounts/:id` (admin:config, `@OrgId`) → returns list.
- env.schema additions (all `''`-default = feature OFF, safe to boot): `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_TOKEN_ENC_KEY`, `APP_WEB_URL`.
- Register `GoogleModule` in app.module; export `GoogleAccountsService`.
- Refactor `google-calendar.service.ts`: `listCalendars(orgId)` → use `getAccessTokenForOrg(orgId,'calendar')` token if present, else fall back to the global `GOOGLE_CALENDAR_TOKEN_JSON` (back-compat). Keep the NEVER-THROW contract. Update the controller call site to pass `orgId`.

## client (erp-client) — Configuration, next to the senders editor
"Connected Google accounts" card: **Connect Google account** button → `GET /google/connect/start` → full-page redirect to `url`; on return (`?google=connected`) refetch. List rows = email + role badge + scope summary + status; two selectors "Default for Gmail" / "Default for Calendar" → POST defaults; Disconnect → DELETE. `api.google.{start,list,setDefaults,disconnect}` + query key + hook + en/de messages.

## Multi-tenant invariants (non-negotiable)
Every `google_accounts` row, query, and token resolve carries `organizationId`; `getAccessTokenForOrg`
resolves ONLY the calling org's default; the calendar list must stop returning EverTrust's calendars
to other orgs. Refresh tokens are encrypted at rest; plaintext never hits the DB or logs.

## Deferred to increment 2 (needs the A/B/C decision)
`POST /outreach/send` via `gmail.send`; calendar freebusy+booking endpoints; replies path
(A = Reply-To webhook / B = `gmail.readonly` + CASA / C = hybrid).
