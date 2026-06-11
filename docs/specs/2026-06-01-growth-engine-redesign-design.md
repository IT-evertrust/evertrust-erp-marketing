# Growth Engine Redesign — Design Spec

`2026-06-01 · status: design approved · scope: frontend-only (apps/web)`

## Problem

`/growth-engine` today is a set of scattered, mostly-manual controls: a **hardcoded reference "pipeline"** visual (no live state), a global "Run now" panel, a campaign list with per-campaign buttons, a standalone runs list, and a separate scheduler card. It doesn't read as one **system**, and nothing is **live** (no polling).

## Goal

Present the Arsenal as ONE systemized, synced sequence:

```
AIM → ( Lead Satellite & Ammo Forge ) → Reach Bazooka → Reply Glock → Sleeper Grenade
 1            2  (per-campaign pair)            3              4              5
```

- Steps **1–2 are per-campaign**; steps **3–5 are global** (fire across all campaigns).
- Every node's status is **live, derived from `arsenal_runs`** — last-run outcome only, never a fabricated "stage complete".
- **Frontend-only**: reuse existing endpoints; ~15 s polling + refetch-on-focus.

## Non-goals (explicit)

- **True auto-chaining** (ERP advancing a campaign stage-by-stage on completion). The ERP fires stages and runs the daily schedule, but n8n does not report completion back — that needs an n8n→ERP callback/writeback, a **separate backend item**.
- **Per-campaign status for GLOBAL stages** (Bazooka/Glock/Sleeper are org-wide by design; their status shows once, in the top strip).
- No backend/DTO/db/migration changes.

## Sequence model — `apps/web/src/lib/arsenal-sequence.ts` (new)

An ordered, web-side definition (labels/`what` reused from `ARSENAL_STAGE_META` in `@evertrust/shared`; AIM is the campaign launch, not an `ArsenalStage`, so its label is local):

```
ARSENAL_SEQUENCE = [
  { key:'AIM',     kind:'launch', scope:'PER_CAMPAIGN' },
  { key:'PREP',    kind:'pair',   scope:'PER_CAMPAIGN', stages:['LEAD_SATELLITE','AMMO_FORGE'] },
  { key:'REACH_BAZOOKA',   kind:'stage', scope:'GLOBAL' },
  { key:'REPLY_GLOCK',     kind:'stage', scope:'GLOBAL' },
  { key:'SLEEPER_GRENADE', kind:'stage', scope:'GLOBAL' },
]
```

Pure status helpers (unit-testable, no React):

- `deriveGlobalStatus(runs, stage)` → latest run for that stage (org-wide) → `{ status:'DISPATCHED'|'FAILED', at }` or `null` (idle).
- `deriveCampaignStageStatus(runs, campaignId, stage)` → latest run for `(campaignId, stage)` → same shape or idle.
- `deriveAimStatus(campaign)` → from `campaign.status`/`deployedAt`: `DEPLOYED`→ok, `FAILED`→failed, `DRAFT`→idle.
- Status → dot colour: `DISPATCHED` = emerald, `FAILED` = rose (matches the existing runs card), idle/none = slate.

## Components (web only)

- **`SequenceStrip`** (new) — the top "system" map: the 5 step nodes with arrows. Global nodes (3–5) show org-wide live dot + last-run time + a Run button. The **Bazooka node hosts the daily-send schedule** (time + timezone inline edit + Turn off) — folding in the current scheduler card. Per-campaign nodes (1–2) are labelled "per campaign" (status shown per row below).
- **`CampaignSequenceRow`** (new, replaces the inline `CampaignRow`) — per campaign: header (name · status badge · Drive link · delete) + its per-campaign steps: **AIM** (from campaign status) → **prep pair** (Lead Satellite, Ammo Forge — each a node: dot + last-run time + Run/Retry, scoped to that `campaignId`).
- **Live activity feed** — enhance the existing `arsenal-runs-card` in place (keep the filename): newest `arsenal_runs` with stage label · status · source (manual/scheduled) · campaign · time, plus a "synced Xs ago" caption; auto-refresh via the polling hook.
- **`GrowthEngineView`** (recompose) — `PageHeader` + AIM action + `StatTile` row → `SequenceStrip` → Campaigns (`CampaignSequenceRow` list) → `LiveActivityFeed`. **Remove** the hardcoded `arsenal-pipeline.tsx` and fold the global "Run now" panel + standalone scheduler (`arsenal-controls.tsx`) into the strip.
- **Keep/reuse**: `AimLaunchDialog`, `RunStageButton` (used in both the strip and the rows), delete-campaign, the scheduler mutation/validation.

## Data flow & sync

- Add `refetchInterval: 15_000` + `refetchOnWindowFocus: true` to `useArsenalRuns`, `useCampaigns`, `useArsenalSettings`.
- Node status is derived **client-side** from the runs list (group by `stage`, and by `(campaignId, stage)` for per-campaign). The existing ~50-run cap is fine at current volume; if a per-campaign stage has no run in the window it simply shows **idle** (honest).
- No new endpoints, DTOs, db, or migration.

## Permissions

Unchanged: `campaigns:read` to view; `campaigns:write` for AIM launch, running a stage, editing the schedule, and delete. All action affordances gated with `<Can permission="campaigns:write">`.

## UX / house style

Reuse the kit (PageHeader, StatTile, Card, Badge, Button, Input/Select for the schedule, Skeleton) and Tailwind v4 tokens. Status dots emerald/rose/slate; arrows between nodes; the strip wraps on small screens; campaign rows stack. No new fonts/deps. Loading → skeletons; empty → existing EmptyState ("You haven't aimed yet…").

## Verify

`tsc` clean for `apps/web` (no web jest suite in this repo). Manual smoke: page renders; nodes colour from real runs; schedule edit + Turn off work; runs feed auto-refreshes (~15 s); permission gating intact; AIM launch + delete still work.

## Files

- **add**: `apps/web/src/lib/arsenal-sequence.ts`; `apps/web/src/components/growth/sequence-strip.tsx`; `apps/web/src/components/growth/campaign-sequence-row.tsx`.
- **change**: `apps/web/src/components/growth/growth-engine-view.tsx`; `apps/web/src/hooks/use-arsenal.ts`; `apps/web/src/hooks/use-campaigns.ts`; `apps/web/src/components/growth/arsenal-runs-card.tsx` (→ live feed + auto-refresh caption).
- **remove/fold**: `apps/web/src/components/growth/arsenal-pipeline.tsx` (hardcoded reference); `apps/web/src/components/growth/arsenal-controls.tsx` (schedule → Bazooka node; global run buttons → strip).
