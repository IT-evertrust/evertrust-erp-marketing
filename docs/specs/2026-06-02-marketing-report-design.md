# Marketing report (Growth-Engine sequence) — design

**Date:** 2026-06-02
**Status:** approved (Layout C), building
**Scope:** First of three new role pages. Also removes Tenders/Suppliers/Customers from the sidebar (nav-only). Key Account + Sales are separate later cycles.

## Goal

A `/marketing` page: a **Daily / Weekly / Monthly report of the Growth-Engine sequence**, Layout C (per-stage lanes). Phased:

- **Phase 1 (this build):** everything from data we already have — `arsenal_runs` + `campaigns`: runs per stage, success/error rate, campaigns launched, per-bucket sparkline trends.
- **Phase 2 (fills in over time):** funnel metrics (leads → emails → replies → meetings) light up as the n8n stages report counts via the existing `POST /arsenal/runs/callback` (new optional `metrics` field). No ERP code change needed once the column + DTO exist.

## Layout C (approved)

Top: period toggle **Day / Week / Month** + window label.
KPI row (4 tiles): **Campaigns launched · Sequence runs · Success rate · Meetings booked** (last is a funnel metric → dashed/amber "awaiting n8n" until reported).
Compact funnel strip: **Leads → Emails → Replies → Meetings** (dashed until reported).
Per-stage lanes (5): stage name + status dot, `runs · success%`, error pill when errors>0, the stage's primary metric (dashed until reported), and a per-bucket sparkline.

Solid blue/green = live now. Dashed/amber = awaiting n8n metric reporting. Charts are lightweight CSS bars/sparklines — **no new chart dependency** for v1.

## Data model

Add nullable `metrics jsonb` to `arsenal_runs` (migration 0010). Stores the per-run counts an n8n stage reports. Existing rows stay null.

Canonical metric keys (flat numeric map; stages send what they know):
- `leadsFound` (Lead Satellite) · `templatesForged` (Ammo Forge) · `emailsSent` (Reach Bazooka) · `repliesHandled`, `meetingsBooked` (Reply Glock) · `leadsSwept` (Sleeper Grenade).

The **funnel** reads `leadsFound → emailsSent → repliesHandled → meetingsBooked`. Per-stage lanes show each stage's own primary key.

## Backend

**Callback extension:** `ArsenalCallbackDto` gains `metrics: z.record(z.string(), z.number().finite()).optional()` (cap ~20 keys). `recordCallback` stores it on the run row. Manual/scheduled runs leave it null.

**Report endpoint:** `GET /arsenal/report?period=day|week|month` — perm `campaigns:read`. Returns `MarketingReportDto`:
- `period`, `from`, `to`, `buckets: string[]` (bucket labels oldest→newest).
- `kpis`: `{ campaignsLaunched, totalRuns, successRate, meetingsBooked|null }`.
- `funnel`: `{ leadsFound|null, emailsSent|null, repliesHandled|null, meetingsBooked|null }` (null = no metric reported in window).
- `stages: MarketingStageReportDto[]` — one per ArsenalStage: `{ stage, runs, ok, errors, successRate, primaryMetricKey, primaryMetricValue|null, trend: number[] }` (trend = runs per bucket aligned to `buckets`).

Rolling windows by period: day → last 24h (hourly bars); week → last 7 days; month → last 30 days (daily bars). Aggregation is in-process (low volume): fetch the org's runs (+ global null-org runs) in the window, bucket by period, group by stage, sum metrics. `campaignsLaunched` = campaigns with `deployedAt` (fallback `createdAt`) in the window.

Outcome split reuses `isArsenalRunOk` (DISPATCHED/SUCCESS = ok; FAILED/ERROR = error).

## Shared

`MarketingReportPeriod` enum; `ARSENAL_METRIC_KEYS` + per-stage `STAGE_PRIMARY_METRIC`; `MarketingStageReportDto`, `MarketingReportDto`.

## Web

- Route `apps/web/src/app/(app)/marketing/page.tsx` + `components/marketing/*` (view, period toggle, KPI tiles, funnel strip, stage lane + sparkline).
- `useMarketingReport(period)` hook (refetch ~30s), `api.arsenal.report(period)`, query key `arsenal.report(period)`.
- Nav: add `{ href:'/marketing', label:'Marketing', icon: LineChart, permission:'campaigns:read', group:'Acquisition' }`; **remove** Tenders/Suppliers/Customers from `NAV_ITEMS` (routes + backend untouched, reversible).

## Tests

- API: report service — bucketing by day/week/month, per-stage ok/error counts + successRate, metric sums, `campaignsLaunched`, empty-window → zeros/nulls.
- API: callback persists `metrics`; report surfaces them.
- API: `/arsenal/report` permission (campaigns:read).
- Web: tsc green.

## Out of scope (v1)

Per-campaign drill-down, CSV export, comparison-to-previous-period, recharts. Funnel data depends on n8n wiring (Phase 2 — playbook doc updated with the `metrics` field).

## n8n playbook

Update `docs/evertrust/n8n-run-callback.md`: the callback body gains optional `metrics` (canonical keys per stage), so report funnel/per-stage numbers populate as stages report.
