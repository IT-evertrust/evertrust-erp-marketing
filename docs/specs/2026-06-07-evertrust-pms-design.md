# Evertrust PMS / KPI Scorecards — Implementation Plan

Source documents: `Evertrust_PMS_Framework_EN.pdf`, `Evertrust_KPI_Scorecards_EN.pdf`
Status: **PLAN / not started** · grounded in a full repo scan 2026-06-07

---

## 1. What the two PDFs ask for

A company-wide **Performance Management System** so management runs on data, not manual supervision:

- **Per-employee scorecard** — role-specific, weekly + monthly KPI targets, a **0–100 score**, KPI
  categories: **Output / Quality / Speed / System Compliance / Revenue Contribution**.
- **Scoring zones** — Green 90–100, Yellow 75–89, Orange 60–74, Red < 60.
- **Per-department KPI areas + weightings** — Sales · Marketing · IT/ERP · Tender Research ·
  Operational Tender Validation · Team Leaders (each with its own KPI list + % weights).
- **Revenue attribution per tender** — track Research → Qualification → Validation → Sales →
  Account Manager so contribution → bonus/promotion is measurable.
- **AI Management Layer** — daily + weekly AI reports (scores, deviations, missed deadlines,
  top/under performers, team & revenue rankings, revenue opportunities).
- **Bonus model** — tiered on KPI score (90+ full, 80–89 75%, 70–79 50%, <70 none).
- **CEO dashboard** — daily: tenders submitted, pipeline value, productivity, revenue forecast,
  AI action recommendations, top-5 opportunities.

## 2. What already exists (so we build, not duplicate)

- **People model** — `users` with role (SUPER_ADMIN/ADMIN/MANAGER/EMPLOYEE), `department`
  (OPERATIONS/IT/CONSULTING/MARKETING/BUSINESS/HR), `position` (CEO…SPECIALIST), per-user
  `permissions[]`. No KPI/score columns.
- **Raw signal already captured** — `submission_receipts` (submittedBy, submittedAt vs
  `tenders.submissionDeadlineAt`), `pricings` (margin, finalPrice, decidedBy), `tenders`
  (estimatedValue, status, regime), `leads` (stage funnel, createdBy, campaignId), `meetings`
  (score 0–100, aeName — **free text, not a userId**), `arsenal_runs.metrics` jsonb
  (leadsFound/emailsSent/meetingsBooked/repliesHandled), `audit_log` (actorId on every write).
- **No** kpi/scorecard/performance/bonus/attribution tables. No revenue-to-person link.
- **Reusable infra** — `ClaudeService.structured()` (Zod-validated, cost-logged to `ai_runs`);
  the custom self-rescheduling **scheduler** (`arsenal.scheduler.ts`, per-org, DB-driven times);
  permission model (add keys to `PERMISSIONS` + `ROLE_PERMISSIONS`); nav (`nav-items.ts`) + page
  convention (`app/<x>/page.tsx`); dashboard already renders real KPIs; `GET /admin/users/:id/stats`
  already returns real per-user contribution counts; migrations auto-apply on Render via
  `api-start.sh`.

## 3. The core constraint: data honesty (no fabricated scores)

CLAUDE.md forbids fabricated operational state. Each PDF KPI must be classified by whether a **real
source exists**. This is the make-or-break of the project.

| Department | KPI (from PDF) | Real source today | Status |
|---|---|---|---|
| **Operational Tender Validation** | Submissions/day & /week | `submission_receipts` (submittedBy/At) | ✅ REAL |
| | Submission deadline compliance | submittedAt vs `tenders.submissionDeadlineAt` | ✅ REAL |
| | Profit maximization | `pricings.margin` | ✅ REAL |
| | Pricing accuracy review | `pricings` + price-assist confidence | PARTIAL |
| | AI validation accuracy | AI suggested vs human final price (`ai_runs` vs `pricings`) | PARTIAL |
| | Risk-free compliance | approvals / compliance module | PARTIAL |
| **Sales** | Meetings booked | `meetings` (needs AE→user link) | PARTIAL |
| | Qualified opportunities / conversion | `leads` stages, `tenders` AWARDED | PARTIAL |
| | Pipeline value created | `tenders.estimatedValue` (needs attribution) | PARTIAL |
| | New partners contacted | — | NEEDS CAPTURE |
| **Marketing** | Leads / qualified leads | `leads`, `arsenal_runs.metrics` (team-level) | REAL (team) |
| | Content published | — | NEEDS CAPTURE |
| | Website traffic growth | — (no analytics integration) | NOT CAPTURABLE |
| | Cost per qualified lead | partial (`ai_runs.eurCost`; no ad spend) | NEEDS CAPTURE |
| **Tender Research** | Qualified tenders found / volume | `tenders` count + estimatedValue (needs researcher link) | PARTIAL |
| | Qualification accuracy | — | NEEDS CAPTURE |
| | Data completeness in ERP | derivable (filled fields per tender) | PARTIAL |
| **IT / ERP** | Features delivered / bugs resolved / ticket time | — (no issue tracker) | NEEDS CAPTURE (or GitHub/Linear integ) |
| | ERP stability | `/health` uptime (partial) | PARTIAL |
| **Team Leaders** | Team KPI achievement / productivity | aggregate of members' scores | ✅ DERIVED |

**Design rule that falls out of this:** the scorecard engine must support three value sources —
`AUTO` (computed from real data), `MANUAL` (a manager records it; e.g. content published, bugs
resolved), and `UNAVAILABLE` (shown as "—", never invented). Start where data is richest
(**Operational Tender Validation**), expand outward; let weights drop "—" KPIs out of the composite
rather than zero-scoring people on data we don't have.

## 4. Proposed architecture (new, additive — no rewrites)

**New tables** (`packages/db/src/schema/performance.ts`, one migration):
- `kpi_definition` — org, scope (department **or** role), `key`, label, `category`
  (OUTPUT/QUALITY/SPEED/COMPLIANCE/REVENUE), `weightPct`, `period` (WEEKLY/MONTHLY), `target`,
  `source` (AUTO/MANUAL), active. *Seeded from the PDF weightings; editable later.*
- `kpi_value` — org, userId, kpiKey, periodStart/End, value, source, enteredBy?, note?.
- `scorecard` — org, userId, periodStart/End, `categoryScores` jsonb, `composite` (0–100),
  `zone` (GREEN/YELLOW/ORANGE/RED), generatedAt, reportId?.
- `tender_contribution` — tenderId, userId, `role`
  (RESEARCH/QUALIFICATION/VALIDATION/SALES/ACCOUNT_MANAGER), createdAt — the revenue-attribution link.
- `performance_report` — org, scope (company/department/user), period, generatedAt, `summary` jsonb
  (AI output), aiRunId — the AI Management Layer output.

**Shared** (`packages/shared`): the enums above + DTOs + the zone helper (mirror `computeDeadlineRisk`
pattern) + `PMS_WEIGHTS` constants seeded from the PDFs.

**Permissions**: `performance:read` (managers+), `performance:write` (record manual KPIs / set
contributions), `performance:admin` (edit definitions/weights). Add to `PERMISSIONS` + `ROLE_PERMISSIONS`.

**API** (`apps/api/src/performance/`):
- Scoring engine service — per period, pulls AUTO metrics (submissions, deadlines, margin, meetings,
  leads, arsenal metrics), merges MANUAL values, applies weights → composite + zone → `scorecard`.
- `GET /performance/scorecards?period=…`, `GET /performance/scorecards/:userId`,
  `POST /performance/kpi-values` (manual entry), `POST /tenders/:id/contributions`,
  `GET /performance/reports?period=…`, `GET /performance/ceo` (exec rollup).
- Auto-seed `tender_contribution` from existing fields where unambiguous (picId→VALIDATION,
  submittedBy→submission credit, pricing.decidedBy, lead.createdBy→RESEARCH, deployedBy).

**AI Management Layer**: a scheduled job (reuse `arsenal.scheduler` pattern) calls
`ClaudeService.structured()` daily + weekly over the computed scorecards/pipeline → writes
`performance_report` (top/under performers, deviations, missed deadlines, revenue opportunities,
recommended actions). Cost-logged; gracefully disabled when `ANTHROPIC_API_KEY` is blank.

**Web** (`apps/web`):
- `/performance` page — per-employee scorecards (zone-colored 0–100 rings, category breakdown,
  weekly/monthly toggle), department rollups, team-leader view; manual-KPI entry + tender-contribution
  assignment (permission-gated).
- Exec/**CEO view** — pipeline value, productivity score, revenue forecast, top-5 attention, the AI
  daily recommendations (extends the existing dashboard rather than replacing it).
- Bonus panel — **advisory only** (read-only suggestion from score tiers; never auto-pays — bonuses are
  an irreversible action → stays a human gate per the HITL policy).

## 5. Phased rollout (each phase independently shippable)

- **Phase A — Foundations**: schema + migration + shared enums/DTOs + permissions + seed
  `kpi_definition` from the PDF weightings. (No UI yet.)
- **Phase B — Scoring engine + the richest scorecard**: compute the **Operational Tender Validation
  Team** scorecard end-to-end from real data; weekly/monthly; `/performance` shows it. Proves the
  model on honest data.
- **Phase C — Attribution + manual capture**: `tender_contribution` (auto-seed + manager UI) and
  MANUAL `kpi_value` entry → unlocks Sales / Research / Marketing / IT scorecards without faking.
- **Phase D — AI Management Layer**: daily + weekly AI reports (scheduler + Claude + report store + UI).
- **Phase E — CEO dashboard + bonus advisory**: exec rollup view + score-tier bonus suggestions
  (read-only) + team-leader rollups.

## 6. Decisions needed from the user (before Phase A)

1. **Sequence** — MVP-first (Phase B: one real scorecard, then expand) vs commit to the full PMS up front?
2. **Non-capturable KPIs** (Content Published, Website Traffic, Bugs/Features, Cost-per-lead) —
   **manual entry now** (managers record them), **integrate later** (GitHub/Linear/Plausible/GA), or
   **omit** until a source exists?
3. **Meetings ownership** — `meetings.aeName` is free text; add a real `userId` link so Sales
   scorecards attribute correctly? (recommended)
4. **Bonus** — keep purely advisory (recommended) or compute payable amounts?
5. **Granularity now** — per-person scorecards immediately, or department-level first (small team)?

## 7. Deploy mechanics (known-good)

Same pipeline as recent work: migrations auto-apply on Render via `api-start.sh db:migrate`; API
redeploys on push (Render autoDeploy); web on Vercel. New `ANTHROPIC_API_KEY` already wired for the
AI layer (price-assist uses it). No n8n changes required for Phases A–C; the AI layer (D) is ERP-side.
