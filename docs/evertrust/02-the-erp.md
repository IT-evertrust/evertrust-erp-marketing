# 02 — The Evertrust ERP

We're building a custom internal application — the **Evertrust ERP** — to run the entire tender pipeline.

## Why we're building this

The team used to operate out of Lark Base + Google Sheets + scattered trackers. Problems:

- Operational state was spread across 4–5 tools — nobody had one truth.
- Reporting required pulling from multiple places.
- AI agents and n8n workflows had no consistent API to write to.
- No control panel for the boss to see "what's blocked, what's urgent, who owns it."

The ERP fixes that by being **one** place for everything.

## What it does today

- **Auth** — login with username OR email + password. 3 view tiers (Super Admin, Admin, Employee).
- **Tender records** — each tender has a portal-issued *Vergabe ID*, niche, customer, deadline, status, assigned L5 PIC (Person In Charge), value estimate, checklist.
- **Customer records** — 26 seeded, with per-niche preferences (what they buy, what they reject).
- **Supplier records** — seeded from the LED catalog. Used by Hermes (outbound RFQ agent).
- **Pricing engine** — multi-source price suggestions with quality signals:
  - `REAL_QUOTES` — green light, real supplier data
  - `MIXED` — yellow, some real, some estimate
  - `ESTIMATE_ONLY` — red, confidence capped at 60, can't auto-approve
- **Time tracking + salary** — internal visibility only (NOT certified for German labor law; payroll runs externally via DATEV or Personio).
- **AI bot** — only Super Admin + Admin can ask it to create tasks. Read-only for everyone.
- **Task routing, announcements, workflow error log** — the supporting plumbing.

## Stack (so you know the words when devs say them)

- **Frontend** — Next.js 15.1.4 (Turbopack), React 19, TypeScript 5.7, Tailwind 3.4 + shadcn UI
- **Backend** — Next.js API routes, NextAuth v5 (beta) for sessions
- **Database** — PostgreSQL 16 with Prisma 6.2 ORM
- **AI** — `@anthropic-ai/sdk` 0.96 (Claude)
- **Automation spine** — n8n (cloud) for moving data between systems

Don't memorize this. Just recognize it.

## The rules (LOCKED as of 2026-05-22)

- The stack is **Claude Code + n8n + the Evertrust ERP**. Nothing else.
- **All operational state lives in the ERP's Postgres database.**
- **n8n moves data; it never stores operational state.** It's the scheduler, not the source of truth.
- **The ERP UI is the daily-ops interface.** Not Lark, not Sheets, not a third-party tracker.
- **Lark is deprecated.** Don't propose Lark Base, Lark Docs, Lark tasks, or Lark webhooks for new work.
- **Google tools are minimized.** Gmail only for email sends (the Hermes agent). Drive/Sheets/Calendar only for legacy or external requirements until ERP parity ships.
- **Google Sheets is NEVER the default database.**

If you're tempted to "just use a spreadsheet for this" — stop. Ask first.

## Where the code lives

```
evertrust-erp/
├── prisma/
│   ├── schema.prisma     ← the database (single source of truth)
│   └── seed.ts           ← seeded users, customers, tenders, dev rows
├── src/
│   ├── app/              ← Next.js routes (pages + API)
│   ├── lib/
│   │   └── pricing/      ← the pricing engine
│   └── components/       ← UI
└── scripts/              ← seed importers, sample pickers
```

You don't need to understand all of it on day one.

---

Next: **[03-the-workflow.md](03-the-workflow.md)** — the 8 phases the ERP is built around.
