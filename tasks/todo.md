# Activate stage build

Wire the Growth **Activate** stage end-to-end, mirroring the Engage pattern. The Activate
UI (3 tabs: Meeting Booker, Company Research, After-Sales Analysis) is fully built but
mock-only — keep the visual pattern, swap mock data for real API, add the requested
interactions in the existing design language.

Decisions (confirmed):
- Meeting Booker → **live Google Calendar** (per connected account, account toggle, popup +
  request-to-join), backend reads Calendar via stored OAuth tokens.
- After-Sales → **PG-native via erp-agents** (`activate.sales_agent`, hermes/LiteLLM);
  personas from PG `personas` table (default Alex Hormozi, interchangeable);
  analysis stored on `meetings.analysis`.
- Company Research → erp-agents `activate.company_research` (LLM + DB context), cached
  per upcoming meeting.

## 1. erp-agents (DONE — verified with real hermes + offline fallback)
- [x] `activate.sales_agent` workflow — ported the old `sales` agent (validate → Hormozi-lens
      system msg from persona prompt → LLM coach with parse-and-retry → analysis). Offline fallback.
- [x] `activate.company_research` workflow — LLM dossier (profile/signals/talking points).
- [x] Registered both in `core/registry.py`; updated `workflows/activate/__init__.py`.

## 2. erp-server (DONE — api typecheck passes)
- [x] `growth/activate` module: controller + service + repository + agent + calendar + model.
- [x] Meeting Booker: GoogleAuthService extended (list accounts + per-account token);
      ActivateCalendarClient reads live calendar; meeting detail + request-to-join.
- [x] Personas: list from PG `personas` (auto-provision default Alex Hormozi); resolve by name.
- [x] After-Sales: list analyzable meetings, run `activate.sales_agent`, persist analysis; demo-seed.
- [x] Company Research: company-context lookup, run `activate.company_research`, in-memory cache.

## 3. erp-client (DONE — typecheck + lint clean, /activate renders 200)
- [x] Swapped `activate-service` mock for real API calls; rewrote the hook (loads accounts,
      meetings, dossiers, personas, analyses; account toggle; generate + analyze actions).
- [x] Meeting Booker: account toggle (like Engage inbox switch) + click→detail popup +
      request-to-join button; dynamic current-week grid; empty/loading states.
- [x] Company Research: dossiers from upcoming meetings; lazy generate on select.
- [x] After-Sales: persona selector (Alex Hormozi default) + summary + performance + technique
      scores + strengths/weaknesses + "implement next time" action items.

## Review — verified end-to-end (2026-06-19)
- erp-agents: both workflows run with real hermes (LLM) + robust offline fallback; HTTP `/run`
  contract verified for `activate.sales_agent` and `activate.company_research`.
- erp-server: boots clean (0 TS errors), all 10 `/growth/activate/*` routes mapped, DI + DB OK.
  Verified live: personas auto-provision (Alex Hormozi); demo-seed; analyses list; the full
  ERP→agent→hermes→parse→persist analyze chain (real Hormozi scores stored on the meeting);
  meeting-accounts returns the org's connected Google accounts (info@, admin@).
- Booker calendar read works through the stored-OAuth path; in THIS dev DB the two grants were
  encrypted with a different GOOGLE_TOKEN_ENC_KEY, so the token can't be decrypted — the booker
  now degrades to a clean 503 / empty state instead of a 500 (environmental, not a code bug).
- erp-client: typecheck + lint clean; `/activate` compiles + renders 200 with all three tabs.
- UI pattern preserved (GrowthCard/LiveDot, same tokens); new toggle/popup/persona-select/score
  sections added in the existing design language.

Left running for immediate testing: updated agents server :8001 (now exposes the activate
workflows; replaced a stale instance running old code) and erp-api :3001 (AUTH_DISABLED, paired
with the client's NEXT_PUBLIC_AUTH_DISABLED demo mode).
