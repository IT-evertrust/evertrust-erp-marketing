# 03 — The 8-Phase Tender Workflow

This is the most important page in this pack. Everything else hangs off it.

Every tender we touch flows through 8 phases. Each phase is a group of workflow rows (R01–R52) from our canonical workflow document, **Evertrust_Workflow_17.xlsx**.

## The 8 phases at a glance

| Phase | Rows | Name | What happens | Posture |
|---|---|---|---|---|
| **1** | R01–R14 | **Partner scouting** | Finding and signing partner companies whose tenders we'll execute. | ❄ FROZEN |
| **2** | R15–R15c | **Tender search + intake** | Scrape portals → extract → store in the ERP. | Automate |
| **3** | R16–R19 | **Per-client shortlist + confirm/reject** | Match each tender against active client profiles → ask the client → reject loops to next client; all-reject trashes the tender. | Automate |
| **4** | R20–R22 | **Record open + assign + upload** | Open ERP record → auto-assign L5 PIC → upload TYPE 1 docs. | Automate |
| **5** | R23–R29 | **Pricing** | AI estimate → L5 refines → L3 senior signs off. Track A. | Automate (mixed AI + human) |
| **6** | R30–R31 | **Client approval + deadline check** | Get written customer approval → T-2 safety check. | Automate WITH mandatory human gate |
| **7** | R32–R37 | **Documents + QC + submit** | Prepare TYPE 2 docs → optional L4 QC → submit at T-2. Track B converges here. | Automate |
| **8** | R38–R52 | **Result + follow-up** | Win/lose, contract, billing, KPI, partner review. | Parked (manual for now) |

## Phase status chain — LOCKED (7 values)

Every tender record in the ERP has one of these statuses:

```
NOT_STARTED → PIC_PRICING → CUSTOMER_PRICING → DOCUMENTS → SUBMITTED → AWARDED → LOST
```

- `NOT_STARTED` — set when a record is first opened (Phase 4)
- `PIC_PRICING` — L5 is pricing it (Phase 5)
- `CUSTOMER_PRICING` — pricing pack sent to client for approval (Phase 5 → 6)
- `DOCUMENTS` — TYPE 2 documents being prepared (Phase 7, or Phase 5 Track B running parallel)
- `SUBMITTED` — bid is in (Phase 7)
- `AWARDED` — we won (Phase 8)
- `LOST` — we didn't (Phase 8)

Older docs may show 5-value or 10-value enums — those are deprecated. Use the 7 above.

## Track A and Track B run in parallel (Phase 5)

This trips people up. In Phase 5:

- **Track A = Pricing** — R25 (get supplier quotes) → R27 (build pricing pack) → R28 (senior judgment) → R29 (send to client)
- **Track B = Documentation** — R32 (prepare TYPE 2 docs) → R33 (forms complete) → R34 (L4 QC, conditional)

**Both tracks can start as soon as R24 marks the tender ready-to-price.** They don't have to be sequential. Both must finish before R35 (submit).

So the doc team isn't sitting idle waiting for pricing. They start in parallel.

## Two crucial dates

- **T-5** — pricing should be done 5 days before the deadline.
- **T-2** — submission target is 2 days before the deadline. We never aim for the deadline itself.

If a tender is at risk of missing T-2, the L4 escalates to the L3. If still at risk, the L3 escalates to L2 (Trev).

## High-risk rule

A tender is flagged **high-risk** when either:
- More than 35% of LV (line items in the bill of quantities) are benchmark-only (no real supplier price), **OR**
- The top-5 most-expensive line items don't have a supplier link / reference / backup.

High-risk tenders need senior review before submission.

## R34 L4 QC is conditional

Not every tender gets the L4 quality-check step. It's required for:
- Risky tenders
- Complex tenders
- High-value tenders
- Sensitive customers
- Anything Trev flags

Routine tenders can go directly L5 → submission, no L4 in between.

## R27 pricing flow

The actual pricing process today:
1. Build the price in **Excel**.
2. Convert it through **GAEB Online 2025** (a German tender-format converter).
3. Write the result back into a **PDF** or **GAEB X83** file (the format the portal expects).

If you don't know what GAEB is yet — that's fine, it's in the glossary.

---

Next: **[04-progress-snapshot.md](04-progress-snapshot.md)** — what's actually built right now.
