# 04 — Progress Snapshot (2026-05-25)

A practical view of what's done, what's being built, and what's not started.

## Built and live

### ERP core
- **Authentication** — login with username OR email, bcrypt-hashed passwords, NextAuth sessions.
- **Three view tiers** — Super Admin, Admin, Employee. Admins can toggle between views.
- **Seed data** — 6 starting users, 26 customers, 5 example tenders, 53 workflow dev-rows.

### Database
The full Prisma schema is in place. Major tables:
- `User`, `Employee`, `ClockEvent` — identity and time tracking
- `Tender`, `TenderChecklistTemplate`, `TenderChecklistItem` — tender records and checklists
- `Customer`, `CustomerShortlistEntry`, `CustomerChecklistPreference` — customer profiles + matching rules
- `Supplier`, `PriceObservation` — supplier directory + price evidence
- `Task`, `Announcement`, `Lead`, `Campaign` — operational plumbing
- `WorkflowError`, `DocumentFile`, `AuditLog` — observability and compliance
- `BotConversation`, `BotMessage` — AI chat history
- `DevPhase`, `DevRow` — the 8 phases and 53 dev rows themselves, modelled in the DB

### Pricing engine (Phase 5)
Lives in `src/lib/pricing/`. Highlights:
- Combines price evidence from multiple sources (`SUPPLIER_QUOTE`, `MANUAL`, `AI_ESTIMATE`, etc.).
- Weights them — supplier quote 90, manual 50, AI estimate 40. A single real supplier quote dominates AI estimates.
- Returns a **quality signal** (`REAL_QUOTES` / `MIXED` / `ESTIMATE_ONLY`) so L5/L3 know how much to trust the number.
- Caps confidence at 60 and blocks auto-accept when all evidence is estimate-only.
- Emits warnings (e.g. "Only 1 real quote — a second will materially improve confidence").

### Catalogs and price data
- **LED catalog** — 10,000-SKU bank with German specs, GTIN, manufacturer, alias index (~168k aliases for matching messy German LV line-items). Includes AI estimates as starting points.
- **Container catalog** — 22 hand-curated items, German aliases, no prices (real prices arrive via supplier quotes).
- **Cleaning catalog** — 15 hand-curated Reinigungsleistungen items, no prices.
- **Real-price data** — 27 web-researched market prices across 2 batches. Average correction vs AI estimate: **-69%** (the AI bank was systematically inflated 3× on consumer/SMB items).
- **Supplier seeds** — 5 known LED manufacturers (LEDVANCE, Philips/Signify, SLV, Glamox, LEDVANCE/OSRAM). `primaryEmail = null` deliberately, so Hermes refuses to send until L4 verifies a real contact.

### Real-price intake pipeline
Anyone can expand the price data without engineering help:
- Drop a CSV in `data/seed/intake/` (template at `data/seed/real-prices-template.csv`).
- Run `pnpm tsx scripts/import-real-prices-csv.ts`.
- Done. Idempotent, supports all 5 real sources, auto-creates suppliers.

### Legal library
Markdown corpus of German + Vietnamese procurement and labor law under `legal-sources/`. Used by Hermes to cite clauses when drafting.

## In design — not yet built

- **Argus** — Phase 2 tender scraper (Service-Bund, DTVP portals).
- **Scribe** — Phase 2 parser (GAEB X81/X82/X83, PDF OCR, structured field extraction).
- **Sieve** — Phase 3 bid/skip rules engine.
- **Hermes** — outbound messages (supplier RFQs, customer pricing approval requests, deadline pings). Gmail-only by policy.
- **n8n PROD workflows** — workspace is provisioned at `evertrustgmbh.app.n8n.cloud` but nothing posts to the ERP yet. The first PROD pair to ship is **Workflow Error Logger → ERP `/api/errors`**.

## Not yet started

- **Production deployment** — still running on `localhost:3000`. Production will live on a Mac mini once delivered.
- **Nightly PostgreSQL backup** — needs to be wired before PROD.
- **`ANTHROPIC_API_KEY`** in the ERP `.env` — bot is disabled until set.

## What this means for you

- If you're touching **code**, the ERP repo is real and runnable today.
- If you're touching **operations**, the pricing engine has real data and a real intake pipeline you can feed.
- If you're touching **n8n**, the workspace exists but you'll be shipping the first live integrations — be careful, naming and TEST/PROD discipline matters (see [06-tooling-rules.md](06-tooling-rules.md)).

---

Next: **[05-team-and-roles.md](05-team-and-roles.md)** — how the team is organized.
