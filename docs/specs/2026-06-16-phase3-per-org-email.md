# Phase 3 spec — per-org email sending & receiving (the sellable layer)

Goal: break the 2-Gmail-credential ceiling so **any client org sends from and receives at
its own address**, with onboarding that's self-serve (no credential handed to you and none
hand-made in n8n). This is what makes the product multi-tenant/sellable. n8n stays; only the
email send/receive path changes.

Builds on the per-org config already shipped (`org_senders`, `defaultSenderEmail`,
`salesCalendarId` exposed in `GET /campaigns/:id/config`). See the session diagrams:
"per-org sending via transactional provider" + "capturing replies via inbound webhook".

---

## 1. Architecture (recap)
- **Send:** one provider account + one API key (yours). The `From` is a per-request field.
  A client can only send from a **domain it verified via DNS** — that's the authorization,
  replacing per-mailbox credentials. 1 key → unlimited org senders.
- **Receive:** send sets `Reply-To: reply+<token>@inbound.<yourdomain>`; the inbound MX routes
  to the provider, which webhooks the ERP; the `<token>` resolves the exact prospect/campaign.
- **Meet:** per-org **booking link** (Cal.com/Calendly) embedded in emails — no calendar
  credential. (The Google Calendar path stays for orgs that share a calendar with you.)

---

## 2. Provider choice (DECISION NEEDED)
Must **permit cold outreach** (rules out Postmark), support **inbound parsing**, **per-domain
verification**, and ideally **subaccounts/dedicated IPs** for tenant reputation isolation.

| | Cold OK | EU region (GDPR) | Inbound | Subaccounts | Notes |
|---|---|---|---|---|---|
| **Mailgun** | yes (with setup) | **yes (EU)** | Routes | yes | Recommended — EU residency matters for a German co.; mature inbound Routes |
| SendGrid | yes (marketing) | limited | Inbound Parse | subusers | Big, capable; EU residency weaker |
| Resend | check ToS | partial | newer | no | Best DX, but inbound + cold tolerance less proven |

**Recommendation: Mailgun (EU region)** — GDPR data residency for German operations + mature
inbound Routes + subaccounts. ⚠️ Verify current ToS (cold-email policy) + pricing before committing.

---

## 3. ERP changes

### DB
- `org_sending_domains`: `id, organization_id (FK), domain, provider_domain_id,
  verification_status (PENDING|VERIFIED|FAILED), dns_records (jsonb — SPF/DKIM to show),
  verified_at, created_at`. Unique (organization_id, domain).
- **No reply-token table** — the token is a signed HMAC of `prospectId.campaignId`, minted on
  send and verified on inbound (stateless).
- Env: `EMAIL_PROVIDER_API_KEY`, `EMAIL_INBOUND_DOMAIN` (e.g. `inbound.evertrust-mail.com`),
  `REPLY_TOKEN_SECRET`.

### Endpoints
- `POST /org/sending-domains` (admin:config, @OrgId) → create the domain at the provider,
  store it PENDING, return the DNS records to display.
- `GET /org/sending-domains` → list + status.
- `POST /org/sending-domains/:id/verify` → re-check via the provider; flip to VERIFIED/FAILED.
- `DELETE /org/sending-domains/:id`.
- **`POST /outreach/send`** (machine, ArsenalTokenGuard) → the send seam. Body: prospectId/
  campaignId, subject, html. The ERP: resolves the org From (must be on a VERIFIED domain →
  else 403), checks suppression + send caps, mints the `Reply-To` token, calls the provider
  with the single key, writes `outreach_messages` (SENT/FAILED) + patches prospect EMAILED.
  → **Keeps the provider key server-side; n8n never holds it.**
- **`POST /inbound/email`** (@Public, provider-signature-verified) → parse, extract Reply-To
  token → resolve prospect/campaign → record the INBOUND `outreach_messages` row → trigger
  classification (see n8n below). Idempotent on the provider message id.
- **`POST /provider/events`** (@Public, signed) → delivery/bounce/complaint webhooks →
  bounce/complaint writes a `suppressions` row + updates `outreach_messages` status.

---

## 4. n8n changes
- **Reach Bazooka:** replace `IF — Sender Hanna? → 2 Gmail nodes` with ONE HTTP node →
  `POST {ERP}/outreach/send`. (Validation/compose stays; the send + From + Reply-To move to the ERP.)
- **Reply Glock:** intake moves from Gmail polling → the ERP `/inbound/email` webhook. To keep
  the rewrite small, the ERP inbound endpoint matches the prospect + records the message, then
  calls the existing Reply Glock **classify** webhook with the resolved prospect + body — so the
  gpt-4o classification + graduate logic stays in n8n unchanged. (Later option: move
  classification into the ERP `ai` module.)
- **Calendar:** unchanged for now (already per-org id); booking-link is the scalable swap later.

---

## 5. Onboarding UX (Configuration)
A **"Sending domains"** card next to the senders editor: add domain → show copyable DNS records
(SPF/DKIM) → "Verify" button → status badge (Pending/Verified/Failed). The senders editor then
validates that a sender's email is on a VERIFIED domain before it can be the default.

---

## 6. Deliverability
- Per-domain SPF + DKIM (provider-generated) + DMARC guidance.
- Bounce/complaint webhooks → automatic `suppressions` (protects sender reputation).
- Per-tenant reputation isolation via the verified domain (+ provider subaccounts / dedicated
  IP at scale). Warmup guidance for new domains.

---

## 7. Backward compatibility
Keep Gmail for your own org, or verify `evertrust-germany.de` with the provider and route your
own org through it too. Hybrid is fine during transition — no flag day.

---

## 8. Build sequence (testable increments)
1. **Provider account + domain model:** `org_sending_domains` table + the domain CRUD/verify
   endpoints + the Configuration card. Verify your own domain end-to-end (no sending yet).
2. **Send seam:** `POST /outreach/send` (provider call + From-verified check + suppression +
   token + outreach_messages). Test with your verified domain via curl.
3. **Bazooka swap:** one HTTP node → `/outreach/send`; disable the 2 Gmail send nodes. Test a
   real capped send from your domain.
4. **Inbound:** `EMAIL_INBOUND_DOMAIN` MX → provider; `/inbound/email` webhook + token match +
   trigger Reply Glock classify. Test a real reply round-trip.
5. **Provider events:** `/provider/events` → suppressions/status. Test a bounce.
6. **Onboard a 2nd org** (the real proof): verify a different domain, send + receive as it.

---

## 9. Decisions needed before build
- [ ] **Provider** (recommend Mailgun EU) — needs your account + API key.
- [ ] **Inbound domain** — a subdomain you control for replies (e.g. `inbound.evertrust-mail.com`).
- [ ] Confirm **send goes via the ERP `/outreach/send`** (recommended — key stays server-side)
      vs n8n calling the provider directly.
- [ ] Confirm **classification stays in n8n** initially (recommended — smallest change) vs moving
      to the ERP `ai` module now.

## 10. What you must provide to build it
- A provider account + API key (the one credential).
- DNS control for the inbound subdomain (to point its MX at the provider).
- (Per client, later) each client controls their own domain's DNS for verification — that's the
  self-serve onboarding step, not something you set up per client.
