# Evertrust ERP — System Overview

**AI‑assisted tender operations: what the platform does, and how n8n + Claude fit around it.**

`Snapshot: 2026‑05‑31 · repo: evertrust-ERP · branch: m0-foundations`

> Status legend — ✅ **built & live** (deployed) · 🟡 **partial** · ⬜ **planned** (in the docs, not built yet).
> This is a point‑in‑time snapshot of the *actual* system. Where the canonical docs (`docs/evertrust/`, `COMBINE.md`, `BUILD_PLAN.md`) describe more than what exists, that gap is called out explicitly.

---

## 1. What this system is

Two halves, joined at the moment a **deal is won**:

- **REACH ARSENAL** (pre‑deal acquisition) — outbound sales, running **autonomously in n8n Cloud**. It targets companies in a niche/city, cold‑emails them, sorts replies, and books meetings. Runs on **OpenAI (gpt‑4o / gpt‑4o‑mini)** + Gmail / Sheets / Drive / Calendar / WhatsApp. *Not Claude, not the ERP.*
- **Evertrust ERP** (post‑deal operations) — **the web‑app**. Once a deal is won, the tender becomes an ERP record and runs the German public‑procurement (*Vergabe*) pipeline: **intake → pricing → approval → documents → submit → result.**

**Stack:** NestJS (Drizzle ORM + Postgres 16, JWT/argon2) · Next.js (App Router, shadcn/ui, TanStack Query) · `@evertrust/shared` (Zod single source of truth) · multi‑tenant · permission‑RBAC · immutable audit log · **Claude‑only** for AI · n8n **Cloud**.

**Roadmap** = the canonical **52‑step / 8‑phase tender workflow** (R01–R52), not arbitrary milestones.

---

## 2. ERP web‑app functions

### Identity & access — ✅
- JWT + argon2 login (stale‑session safe).
- 4‑role taxonomy **SUPER_ADMIN > ADMIN > MANAGER > EMPLOYEE** + a **21‑permission** RBAC catalog, enforced server‑side (`PermissionsGuard`) and used to gate the UI.
- **Per‑user permission overrides** — edit any user's permissions; the API re‑reads role/permissions from the DB on **every request**, so changes (and deactivations) take effect immediately.
- **`/users` page** — manage role / position (CEO … Officer) / department (Operations, IT, Consulting, Marketing, Business, HR), deactivate/reactivate, and edit per‑user permissions.
- **Immutable audit log** on every mutation (org‑stamped, actor + before/after).

### Tender core — ✅ (Phase 4)
- Tender CRUD keyed by the portal **Vergabe‑ID**; the **7‑status state machine** — `NOT_STARTED → PIC_PRICING → CUSTOMER_PRICING → DOCUMENTS → SUBMITTED → AWARDED → LOST` — with guarded, audited transitions.
- Manual **PIC assignment** (supersedes prior active assignment).
- **TYPE 1 document** upload / list / download (Multer disk storage).
- Supplier & customer registries.

### Pricing workbench — ✅ (Phase 5 · ★ highest value)
- **5a — LV line items + PriceObservation engine.** Evidence from 7 sources (weighted 90→40); per‑line quality signal **REAL / MIXED / ESTIMATE** → **R/Y/G** flag; confidence scoring (capped for estimate‑only); tender **high‑risk** rule (≥35% of lines unbacked, or any top‑5‑by‑value line unbacked). Finalize → `CUSTOMER_PRICING`.
- **5b — Claude price‑assist.** On an unbacked line, "Ask Claude" returns a unit‑price **suggestion** (confidence 0–1 + rationale + assumptions). It **never auto‑applies** — a human accepts it, which records an `AI_ESTIMATE` observation (so the line stays unbacked/RED until a *real* quote backs it). Every call is logged to `ai_runs` (model / tokens / € cost / confidence); low confidence is flagged for escalation.
- **5c — Hermes supplier RFQ.** "Request quotes" dispatches an RFQ to selected suppliers for selected lines via the **Hermes n8n webhook**; the dispatch is logged (`rfqs`), and supplier replies return as `SUPPLIER_QUOTE` evidence. RFQ history shown in the workbench.

### Approval & deadline — ✅ (Phase 6)
- **6a — Customer‑approval gate.** "No written approval → no submission," enforced in code. Evidence is channel‑agnostic (a link *or* a note — email/WhatsApp/call all count once recorded).
- **6b — Deadline safety + escalation.** Deterministic `computeDeadlineRisk` (T‑2 / T‑1 / T‑0 escalate to MANAGER / ADMIN / SUPER_ADMIN; reminder cadence T‑5 / T‑3 / T‑1) → "deadline at risk" dashboard card, per‑tender badge, and a `GET /tenders/deadline-risk` worklist (the same computation the dashboard renders and n8n is meant to poll).

### QC + submission — ✅ (Phase 7 core, R34–R37)
- **Conditional QC gate.** A QC review is required before submission when the tender is **above the EU threshold** (high‑value) **OR** its pricing is **high‑risk** **OR** a QC review was explicitly opened; routine tenders skip it. QC reuses the `QC` approval type.
- **Submit act + evidence.** `POST /tenders/:id/submit` enforces every blocker, snapshots the bid file list, writes an immutable **submission receipt** (proof + timestamp + file list), and advances `DOCUMENTS → SUBMITTED`. A direct transition to `SUBMITTED` is refused, so **SUBMITTED ⟺ a logged receipt** — there is no submission without evidence. The portal act itself stays human.

### Growth Engine — ✅ (the ERP's Arsenal control panel)
- `/growth-engine` launches **AIM** campaigns (fires the AIM n8n webhook, which provisions the Drive campaign + config the Arsenal then runs against).
- **"Run now"** triggers per Arsenal stage + a dependency‑free **daily Bazooka scheduler** (send time + timezone editable in‑app, no redeploy). Every ERP→n8n hand‑off is logged in `arsenal_runs` (DISPATCHED / FAILED).

### Observability — ✅
`audit_log` (every mutation) · `ai_runs` (AI cost/quality ledger) · `arsenal_runs` (ERP→n8n hand‑offs) · `/health`.

### Not built in the app
- 🟡 **TYPE 2 doc checklist / completeness** (R32–R33) — needs the external "EPC Document Library" required‑forms manifest. (TYPE 2 files already *upload* via the Phase 4 documents module.)
- ⬜ **Phase 2 intake**, ⬜ **Phase 3 shortlist**, ⬜ **Phase 8 result/follow‑up**.

---

## 3. The 8‑phase tender workflow (R01–R52)

| Phase | What it covers | Status |
|---|---|---|
| 1 — Partner scouting (R01–14) | Out of automation scope (Kha's lane) | ❄ frozen |
| 2 — Search + intake (R15) | **Argus** portal search (TED / DTVP / Service‑Bund) + **Scribe** GAEB X81/X83 + OCR parsing | ⬜ not built |
| 3 — Shortlist (R16–19) | **Sieve** match vs client profiles → confirm/reject | ⬜ not built |
| 4 — Record + assign + upload (R20–22) | tender record, PIC assignment, TYPE 1 docs | ✅ done |
| 5 — Pricing (R23–29) ★ | LV + evidence engine + Claude assist + Hermes RFQ | ✅ done |
| 6 — Approval + deadline (R30–31) | customer‑approval gate + deadline risk | ✅ done |
| 7 — Docs + QC + submit (R32–37) | QC gate + submit + evidence (R34–37) ✅ · TYPE 2 checklist (R32–33) 🟡 | 🟡 partial |
| 8 — Result + follow‑up (R38–52) | win/loss, contract, billing, supplier review | ⏸ parked |

**Domain anchors:** German regimes VOB/A, VgV, UVgO · GAEB DA XML (X81 unpriced LV, X83 priced response, X84 final) · portal submission stays human · "submit at T‑2" (never aim for the deadline) · GDPR/EU.

---

## 4. How n8n fits

- **Live today:** the **REACH ARSENAL** project — 7 workflows (AIM orchestrator, Lead Satellite, Ammo Forge, Reach Bazooka, Reply Glock, Sleeper Grenade, Niche Flamethrower) on **OpenAI**, integrating Gmail / Sheets / Drive / Calendar / WhatsApp. *The OpenAI key is an n8n credential, not an ERP setting.*
- **ERP → n8n (outbound — works):** the ERP fires webhooks for AIM campaign launch, per‑stage "Run now", the daily Bazooka send, and the **Hermes RFQ** (5c). Each is config‑gated — a blank webhook URL means that trigger is safely off.
- **n8n → ERP (writeback) — ⬜ absent:** the ERP is localhost‑only, so n8n Cloud can't reach it yet. The single intended pull is read‑only `GET /tenders/deadline-risk` ("n8n polls") — nothing polls it yet.
- **Planned tender‑ops workflows** (Argus / Scribe / Sieve) that would feed the ERP are Phase 2/3 — **not built**.

> **Editing live workflows:** the Arsenal workflows are large (~80 nodes). Editing them via the n8n MCP `update_workflow` strips credentials — use the n8n UI or `publish_workflow` instead.

---

## 5. How Claude fits

- **Strategy (COMBINE):** **Claude‑only** for ERP AI — DeepSeek was dropped; `CLAUDE` / `DEEPSEEK` survive only as audit‑enum labels. BUILD_PLAN positions Claude as a **supervisor / QA layer** (~10–30% of volume), activating on low confidence, red flags, or sensitive items.
- **Live today:** exactly one integration — **price‑assist (5b)** — calling the Anthropic Messages API directly (raw `fetch`, forced structured tool output, no SDK). Disabled until `ANTHROPIC_API_KEY` is set.
- **Strategy mismatch to keep in view:** the docs say "Claude," but the *live* automations (the Arsenal) run on **OpenAI**. They are separate worlds: the ERP doesn't call OpenAI, and the Arsenal doesn't call Claude.

**Agent roster (codenames from the glossary):**

| Agent | Intended role | Status |
|---|---|---|
| **Argus** | tender portal search / intake | ⬜ planned |
| **Scribe** | GAEB / PDF parsing → structured fields | ⬜ planned |
| **Sieve** | bid/skip matching vs client profiles | ⬜ planned |
| **Hermes** | supplier / customer outreach (RFQ) | 🟡 ERP fires the webhook (5c); n8n side pending |
| **Hydra** | orchestration | ⬜ planned |
| **Eve** | review / QA | ⬜ planned (price‑assist is the closest live piece) |
| **Nero / Aza / Cipher** | code / docs / security | ⬜ planned |

---

## 6. Bottom line

**Production‑ready & deployed** — the *middle* of the tender pipeline: **record → price (with Claude assist + supplier RFQ) → customer approval → deadline safety → QC → submit with evidence**, plus full auth / RBAC / user management and the Growth‑Engine control panel for the n8n Arsenal. All multi‑tenant, permission‑gated, audited.

**Gaps vs the docs' full vision** — automated **intake/parsing/shortlisting** (Argus/Scribe/Sieve, Phases 2–3), **result/follow‑up** (Phase 8), the broader **Claude agent fleet**, and **n8n→ERP writeback** (blocked until the ERP is deployed to a reachable URL). Today a human starts each ERP phase; the automations **assist and escalate** rather than run end‑to‑end.

**Operating principle:** automation assists, humans decide. Low confidence and missing approvals **escalate** rather than proceed; every critical action is **audited**; nothing reaches `SUBMITTED` without recorded customer approval, conditional QC, and a submission receipt.
