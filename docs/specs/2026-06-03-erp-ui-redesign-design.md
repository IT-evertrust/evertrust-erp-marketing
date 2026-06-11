# Evertrust ERP — UI Redesign (6 pages)

**Date:** 2026-06-03
**Status:** Locked — building. **Mock data first** (no backend wiring); real data sources noted per page.
**Mockups (reference):** `docs/superpowers/specs/mockups/*.html` (interactive, dark theme — the build target).

Shared aesthetic: dark theme (`#0b0b0e` bg, panels `#141418`, hairline borders, accents emerald/amber/sky/violet), two-pane "list + detail" where it fits, human-approval gates, confidence shown. Mirror existing conventions: `app/<name>/page.tsx` (`useRequirePermission` → `AppShell` → view), `components/<area>/<area>-view.tsx`, `nav-items.ts`, `middleware.ts` protected prefixes, TanStack Query hooks, shadcn/ui. AI features follow the price-assist precedent; observability via `aiRuns`.

---

## 1. Sales Agent — `/sales` (NEW)
**Source:** Read AI meeting agent (records/transcribes). **Coaching framework:** Hormozi lens (from the shared "Sales Coach Report" doc).
- **Layout:** two-pane. Left = meeting list (title, date, score chip /5). Right = tabs **Summary** / **Coaching**.
- **Summary:** Meeting Metadata (AE, client, product, duration, words, flags) · **Read AI signals** (talk-ratio, sentiment, engagement, questions) · Executive Summary · **Link to tender** (meeting↔tender, picker w/ AI best-match).
- **Coaching:** AE-performance rings + Client-analysis rings (/5) · **AE Performance Scores** (Communication, Understanding Client Needs, Technical Explanations) · **Client Analysis** (Buying Intent, Pain Acknowledgment, Decision Authority, Objection Profile, Misunderstandings) — each /5 + rationale/evidence · **What Worked** (collapsible: quote · why · methodology tag) · **What to Improve** (collapsible: what happened · try instead · methodology) · AI confidence.
- Mockup: `mockups/sales-agent.html`

## 2. Marketing — `/marketing` (REDESIGN)
**Source:** `EVERTRUST - RAG AGENT` n8n workflow — drafts replies to "Unsure" leads, grounded in a knowledge file, saved as Gmail draft "Do Not Send".
- Two top **tabs: Draft review** + **Report**. Funnel KPIs strip on top (+ "Drafts to review" tile).
- **Draft review:** two-pane. Left = queue of RAG drafts (company, question snippet, unsure-area chip). Right = **Context** (original thread, buyer's question, unsure-area + explanation, **KB citations/snippets**) + **confidence pill** (low flagged) + editable **Subject/Body** + actions **Approve & send / Save edits / Discard**.
  - **Send model (prod):** ERP is the approval cockpit; **n8n sends** the existing Gmail draft on approve (ERP holds no email creds). Human gate always.
- **Report:** period toggle + campaign picker + Sync · Funnel · **RAG draft funnel** (Unsure→Drafted→Approved→Sent→Replied) · **Draft outcomes** + **Response timing** · **Tender attribution** · per-stage sparklines (incl. RAG Agent).
- RAG output fields: `Company · Client Email · Lead Question · Section Indicating Unsure · Unsure Area · Explanation · Draft Subject · Drafted Reply`.
- Mockup: `mockups/marketing.html`

## 3. Growth Engine — `/growth-engine` (REDESIGN → "productive")
Action-first command center (do-engine, not watch-engine).
- Header + **quick-trigger toolbar** (AIM Lock&Load · Run a stage ▾ · Sync).
- **Compact engine status strip** (per-stage dot + metric + next run + error count).
- **Today's work** (hero action queue): Approve N drafts → Marketing · Coach N meetings → Sales · Convert N hot leads → Key Account · failures/deadlines. Each with a primary action button; items complete in place.
- **Campaigns** board (expandable activity + per-campaign Run stage / Open).
- Daily schedule.
- Mockup: `mockups/growth-engine.html`

## 4. Dashboard — `/dashboard` (REDESIGN → "operations cockpit")
Whole-business bird's-eye + jump-off.
- Greeting + period toggle · Headline KPIs (Leads/Emails/Replies/Meetings/Customers) · **Acquisition funnel** (Leads→Emailed→Replied→Meeting→Won) · **Needs attention** (cross-area cards → pages) · **Area cards** (Growth Engine/Marketing/Sales/Key Account, clickable) · **Recent activity feed** · **Pipeline by tender** (€ attribution).
- Mockup: `mockups/dashboard.html`

## 5. Users — `/users` (REDESIGN → "Team & access")
Two-pane admin.
- Left: search + filter chips (All/Admins/Managers/Employees/Inactive) + roster (avatar, name, dept·position, role badge, status dot).
- Right: profile header + **Role/Department/Position** selects + **Permissions toggle grid** (+ reset to role defaults) + **Danger zone** (Deactivate/Delete). **Super-Admin role-locked + undeletable.**
- Mockup: `mockups/users.html`

## 6. Profile — `/users/[id]` (NEW, dynamic route)
Per-user profile (clicked from Users).
- Header (banner + avatar + role badge + dept·position + status/member-since/last-active + Edit profile).
- Contribution KPIs (campaigns launched, emails sent, meetings as AE, drafts approved, customers won).
- Tabs: **Activity** (action feed) · **Access** (role/dept/position + effective permissions) · **Account** (email/phone/password/2FA/timezone/language/digests).
- Mockup: `mockups/profile.html`

---

## Build order
Sales → Marketing → Growth Engine → Dashboard → Users → Profile. Each: route + view (+ nav/middleware), mock data, `tsc` clean, commit, push → Vercel auto-deploys. Backend wiring (Read AI API, RAG callback/send, real metrics) is a later phase.
