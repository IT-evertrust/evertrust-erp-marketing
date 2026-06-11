# 07 — Glossary

Skim once on day one. Come back when you hear a word you don't know.

## German tender vocabulary

| German | English | What it means here |
|---|---|---|
| **Ausschreibung** | Tender / public bid | The thing we're going after. |
| **Vergabe** | Award (of a tender) | Each tender has a portal-issued **Vergabe ID** — that's our tender code in the ERP. |
| **Vergabe-ID** | Tender ID | The unique ID assigned by the procurement portal. We use this as our tender code (no internal `ET-YYYY-NNNN` numbering). |
| **LV** (*Leistungsverzeichnis*) | Bill of quantities | The line-by-line spec of what the buyer wants. Each line = a row of "qty × description × price." |
| **GAEB** | German exchange format for construction tenders | The standard data format used to exchange LV files. Common variants: **X81** (request from buyer), **X83** (our priced response), **X86** (award). |
| **Reinigungsleistungen** | Cleaning services | The "Cleaning" niche. |
| **Bürocontainer** | Office container | A common Container niche item. |
| **Sanitärcontainer** | Sanitary / toilet container | Same. |
| **Hochbau / Tiefbau** | Building construction / civil engineering | Historical niches; mostly inactive today. |
| **EVB-IT** | Public-sector IT contract template | Sometimes referenced in IT tenders (rare for us). |
| **Bietergemeinschaft** | Bidding consortium | A group bid. Not our default mode. |
| **Eignungsnachweis** | Proof of eligibility | The documents proving we're allowed to bid (insurance, registrations, etc.). Part of TYPE 1. |
| **Nachweis** | Proof / certificate | Any required document. |
| **Frist** | Deadline | What T-2 / T-5 are measured against. |

## Internal jargon

| Term | Meaning |
|---|---|
| **The 52-row workflow** | Our canonical tender process, broken into 52 numbered rows (R01–R52) across 8 phases. v17 is the current version. |
| **The 8 phases** | The automation-posture grouping of the 52 rows. See [03-the-workflow.md](03-the-workflow.md). |
| **Status chain** | The 7 locked tender statuses: `NOT_STARTED → PIC_PRICING → CUSTOMER_PRICING → DOCUMENTS → SUBMITTED → AWARDED → LOST`. |
| **PIC** | Person In Charge. Each tender has one **L5 PIC**, by name. |
| **L1 / L2 / L3 / L4 / L5** | Authority tiers. See [05-team-and-roles.md](05-team-and-roles.md). |
| **Lane** | OPERATIONS, MARKETING, or HR. Each person belongs to one. |
| **Niche** | The category of thing the tender is about — LED, Container, Cleaning, DGUV, PV. |
| **TYPE 1 docs** | Eligibility / company documents (insurance, registration, references). Same set for every tender. |
| **TYPE 2 docs** | Tender-specific documents (the actual filled-out forms for this particular bid). |
| **T-2 / T-5** | "T minus 2 days from deadline" / "T minus 5 days." Pricing target is T-5; submission target is T-2. |
| **R34 QC** | The optional L4 quality-check step. Conditional — only for risky / complex / high-value / sensitive tenders. |
| **High-risk tender** | ≥35% of LV lines are benchmark-only OR top-5 most-expensive lines lack supplier backup. |
| **Track A / Track B** | Phase 5 splits into Track A (pricing) and Track B (documentation), running in parallel. |

## ERP / engineering vocabulary

| Term | Meaning |
|---|---|
| **The ERP** | Our internal Next.js app. The replacement for Lark Base + Sheets. |
| **Prisma schema** | The database definition at `evertrust-erp/prisma/schema.prisma`. Single source of truth for data shape. |
| **Seed data** | The initial dataset loaded into a fresh database via `prisma/seed.ts`. |
| **`/api/...`** | HTTP routes the ERP exposes. n8n calls these instead of touching the database directly. |
| **PriceObservation** | One row of price evidence — what was paid, by whom, when, from what source. |
| **Source** (price) | Where a price came from: `SUPPLIER_QUOTE`, `COMPETITOR_WINNER`, `OUR_SUBMITTED`, `MANUAL`, `OUR_BENCHMARK`, `AI_ESTIMATE`, `IBAU_HISTORICAL`. |
| **Quality signal** | The pricing engine's verdict on how much to trust a suggested price: `REAL_QUOTES` (green), `MIXED` (yellow), `ESTIMATE_ONLY` (red). |
| **Confidence** | A 0–100 score on a price suggestion. Capped at 60 if all evidence is estimate-only. |

## n8n vocabulary

| Term | Meaning |
|---|---|
| **Workflow** | A single n8n automation. Named `[Lane] - [Function] - [Environment]`. |
| **TEST / PROD** | The only two environments. |
| **The 8 conditions** | The promotion checklist for moving TEST → PROD. See [06-tooling-rules.md](06-tooling-rules.md). |
| **Workflow Error Logger** | The shared error workflow every other workflow points its error trigger at. |

## Agent names (Claude Code subagents)

We give our Claude Code agents short codename roles. You'll hear these in dev conversations:

| Codename | Role |
|---|---|
| **Argus** | Scrapes German tender portals (Phase 2). |
| **Scribe** | Parses raw scraped notices and GAEB/PDF files into structured data. |
| **Sieve** | Decides bid/skip on a parsed tender record (Phase 3). |
| **Hermes** | Drafts and sends outbound messages — supplier RFQs, customer approval requests, reminders. |
| **Hydra** | Decomposes multi-phase goals into a plan; routes work to other agents. |
| **Eve** | Reviews work before it ships — code diffs, n8n promotions, pricing math, legal citations. |
| **Nero** | Writes code — ERP features, n8n workflows, scripts. |
| **Aza** | Writes documentation, summaries, daily notes, change-log entries. |
| **Cipher** | Security review — secret leaks, recipient verification, bot permissions, n8n credentials. |

These are codenames for routing tasks. Real humans still do the deciding.

## Boss vocabulary (the questions the L2 cares about)

When the boss asks "what's the state?" — he means:

1. What is **urgent**?
2. What is **blocked**?
3. **Who owns** it?
4. What **deadline** is at risk?
5. What needs my **decision**?

Frame your updates around these five.

---

That's it. Welcome to Evertrust.
