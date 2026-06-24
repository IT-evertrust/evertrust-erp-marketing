# Bazooka Templates + Email Signature — Design Spec

**Date:** 2026-06-25 · **Branch:** finalized-erp · **Status:** Approved (design)

Two related features for the outreach email content:
- **A. Org-default bazooka template** — paste/upload a 3-round template, set it as the org-wide default the bazooka sends; richer placeholders resolved per-campaign.
- **B. Email signature** — append a configured signature image to every outgoing email, which requires switching the send paths to HTML.

## Current state (from exploration)

- Templates live on `reach_aims.templates` (`cold_outreach`/`follow_up`/`final_push`, each `{subject, body}`), **AI-generated** by the Ammo Forge agent — no paste/upload/edit path.
- Placeholder substitution supports **only `{{Company Name}}`** → `lead.company` (`reach.service.ts` ~367).
- Send paths are **plain-text only**: `gmail-sender.buildRaw` (~92) and `engage.buildRawReply` (~214).
- Signature infra exists but is **dead code**: `org_config.signature` / `signatureImageUrl`, `signature_assets` table, `POST /arsenal/config/signature-image` — nothing appends to emails.

## Decisions (from the user)

- `{{Type}}` = target type (provider/supplier…), `{{IndustryFocus}}` = industry (IT/Power…), `{{TenderFocus}}` = niche-in-sector (Cloud Infrastructure…) — all **per-campaign**. `{{Company}}` = the lead's company.
- "Default" = **org-wide default** template.
- **HTML emails with an embedded image signature** (plain-text fallback retained).

## Data model — 1 migration (additive, idempotent)

- `org_config.default_template` jsonb — the org-wide 3-round template (`{cold_outreach,follow_up,final_push}`, each `{subject,body}`), nullable.
- `reach_aims.target_type` text, `reach_aims.industry_focus` text, `reach_aims.tender_focus` text — per-campaign placeholder values (nullable).
- `org_config.signature_image_url` — already exists; reused.

NOTE (push-managed local DB): after the schema edit, apply the same `ALTER … ADD COLUMN IF NOT EXISTS` to the live `evertrust_finalized` DB directly — the migration only auto-applies to clean-migrate targets. (See the live-DB-ALTER gotcha.)

## Part A — Template management

### Placeholder resolver (`reach.service`)
Replace the single `{{Company Name}}` substitution with a token map applied to subject + body:

| Token | Value |
|---|---|
| `{{Company}}`, `{{Company Name}}` | `lead.company` |
| `{{Type}}` | `aim.targetType ?? ''` |
| `{{IndustryFocus}}` | `aim.industryFocus ?? ''` |
| `{{TenderFocus}}` | `aim.tenderFocus ?? aim.niche` |

Pure function `renderTemplate(text, { company, type, industryFocus, tenderFocus })` — unit-tested. Unknown tokens are left untouched.

### `templateFor(aim, round)`
Org default wins when set, else the campaign's AI-generated `aim.templates` (graceful fallback). Maps the round enum (`cold`/`followup`/`final`) to the template keys.

### API (Reach controller, `campaigns:write`)
- `GET /growth/reach/default-template` → the org's default template (or null).
- `PUT /growth/reach/default-template` → body is the 3-round template; accepts the user's `{COLD,FOLLOWUP,FINALPUSH}` shape and maps to `{cold_outreach,follow_up,final_push}`. Validated by a Zod DTO.
- `POST /growth/reach/default-template/upload` → multipart JSON file (reuses the `FileInterceptor`/`memoryStorage` pattern from `workflow-config.controller`), parsed + validated, same store.

### UI (`erp-client/.../reach`)
A "Templates" editor: a 3-round form (subject + body each) you can paste/upload into, with **Save as default**; the three per-campaign fields (`Type`/`IndustryFocus`/`TenderFocus`) on the campaign create/edit form.

## Part B — Signature + HTML email

- The signature image URL stored on `org_config.signatureImageUrl` (the user's `lh3…` link), settable via the existing `POST /arsenal/config/signature-image` ({url}) and surfaced in the Templates UI.
- A shared `buildMimeEmail({to, from, subject, text, signatureImageUrl, inReplyTo?, references?})` helper building **multipart/alternative**: a `text/plain` part (body + signature URL as text) and a `text/html` part (body with `\n`→`<br>` + `<img src="signatureImageUrl" alt="signature">`). Base64url for Gmail.
- Both `gmail-sender.buildRaw` (cold/followup/final) and `engage.buildRawReply` (replies) switch to it; the signature is fetched from `org_config` per send and appended to **every** email. When no signature URL is configured, it degrades to body-only (still valid multipart/plain).

## Testing
- `renderTemplate` — each token substitutes; unknown tokens untouched; `{{TenderFocus}}` falls back to niche.
- `templateFor` — org default wins; falls back to `aim.templates`.
- `buildMimeEmail` — multipart structure, both parts present, `<img>` in HTML, plain-text fallback, no-signature degrades cleanly.
- API — PUT then GET round-trips; the `COLD/FOLLOWUP/FINALPUSH` → DB-key mapping.

## Out of scope
- Per-lead AI personalization of the pasted template (it's a fixed template + placeholders).
- Multiple named template libraries (one org default for now).
- Hosting/proxying the signature image (we store the URL as given; Drive-hosted images may be blocked by some clients — swappable later).
