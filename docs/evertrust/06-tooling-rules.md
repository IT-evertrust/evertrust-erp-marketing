# 06 — Tooling Rules

These rules are locked. If you're tempted to break one, ask first.

## The stack

> **Claude Code + n8n + the Evertrust ERP.** Nothing else.

That's the entire toolchain. If you're proposing a new tool, the bar is high — talk to your team lead.

## What's in / what's out

### IN
- **The Evertrust ERP** (`localhost:3000` today, PROD on Mac mini later) — for ALL operational state.
- **n8n** (`evertrustgmbh.app.n8n.cloud`) — for moving data between systems. Reads/writes the ERP via HTTP API.
- **Claude Code** — for development, agent orchestration, doc writing, reviews.
- **Gmail** — for outbound email actions only (the Hermes agent).
- **PostgreSQL** — the ERP's database. You don't touch it directly; you go through the ERP API.

### OUT (deprecated as of 2026-05-22)
- **Lark Base** — do not propose for new work.
- **Lark Docs** — do not propose for new work.
- **Lark tasks / webhooks** — do not propose for new work.
- 82 legacy doc references to Lark will be swept in a future cleanup.

### Minimized
- **Google Sheets** — never the default database. Only for legacy workflows or external party requirements.
- **Google Drive** — only for legacy or client/supplier requirements until ERP parity ships.
- **Google Calendar** — only for legacy or external requirements.

## n8n naming convention

Every workflow name follows this template:

```
[Lane] - [Function] - [Environment]
```

Examples of correct names:
- `Operations - Argus Service-Bund Scrape - TEST`
- `Operations - Submission Evidence Logger - PROD`
- `Supplier - Quote Request Router - TEST`
- `CRM - Client Follow Up - PROD`

**Only two environments exist: `TEST` and `PROD`.** No third value. No "DEV", no "STAGING".

## TEST vs PROD discipline

- **Every PROD workflow has a TEST sibling.** Always.
- **TEST is never deleted after promotion.** It stays alongside PROD forever, for re-testing.
- **TEST writes only TEST-tagged rows. PROD writes only PROD-tagged rows.** Use the `Environment` field on each row to enforce this.

## Promoting TEST → PROD: the 8 conditions

A workflow can be promoted from TEST to PROD only when **all 8** are true:

1. Three clean consecutive TEST runs (no error).
2. An intentional failure was triggered and logged in the error workflow.
3. Schema in the ERP confirmed (target tables/columns exist and accept the payload).
4. Blueprint document is complete and in `/docs/`.
5. PROD credentials are owned by an L4+ person (not just stored in the workflow).
6. Workflow writes only PROD-tagged rows.
7. The error trigger is wired to the `Workflow Error Logger`.
8. Change-log sign-off in `docs/trev-change-log.md` (the change is approved, not pending).

If you can't tick all 8 — it stays in TEST.

## Don't overbuild

For each n8n workflow, default to:
- 1 trigger
- 1 happy path
- 1 error path
- ≤ 12 nodes preferred
- Native nodes first, expressions over Code nodes, no premature sub-workflows.

If you need more than 12 nodes, ask whether the logic should move into the ERP API instead.

## ERP-first, always

Every n8n workflow reads and writes operational data **through the ERP's HTTP API** — never directly to Postgres.

This means:
- One place for validation logic.
- One place for audit logging.
- One place to change schema without breaking 30 workflows.

## Change log

Every meaningful change to workflows, app code, agents, or docs goes into [`docs/trev-change-log.md`](../docs/trev-change-log.md) as **Pending** first.

Once it's approved and implemented → moves to **Approved**.
If it's dropped → moves to **Rejected/Postponed** with a reason.

Keep entries short. Detail goes in the blueprint, not the log.

## Trev's control view

The boss (L2) measures the team by the answer to these five questions:

1. What is **urgent**?
2. What is **blocked**?
3. **Who owns** it?
4. What **deadline** is at risk?
5. What needs Trev's **decision**?

When you design a dashboard, a report, a workflow, or a chat update — these are the questions to answer.

---

Next: **[07-glossary.md](07-glossary.md)** — the words you'll hear every day.
