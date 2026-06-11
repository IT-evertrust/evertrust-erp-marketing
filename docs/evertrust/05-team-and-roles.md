# 05 — Team and Roles

The team uses a 5-tier authority model. You will hear "L5", "L4", "L3" constantly. This is what they mean.

## Tier model

| Tier | Role | What they own |
|---|---|---|
| **L1** | Super Admin / CEO / Strategy | Strategic direction. Final escalation terminal. Customer relationships at the executive level. |
| **L2** | Governance / Director | Policy, approvals, AI rollout, escalation terminal. Measured by **decisions made on time**, not by tender output. |
| **L3** | Lane leads | Run a lane end-to-end. Currently: **Operations lead**, **Marketing/Sales lead**, **HR lead** (dual role). |
| **L4** | Niche / project leads | Own a niche or a specific project. Sits above the L5 PIC on each tender. |
| **L5** | Members (executors) | Day-to-day operators. Each tender has one **L5 PIC** (Person In Charge) by name. |

## Lanes

Three lanes:
- **OPERATIONS** — the tender pipeline itself (Phases 2–7).
- **MARKETING** — partner scouting, customer acquisition (Phase 1 — currently frozen).
- **HR** — hiring, payroll, time tracking.

A person belongs to one tier and one lane. Some people are dual-lane (e.g. HR leads who also work in another function).

## How work routes

Routine work moves **down**: L3 → L4 → L5 picks it up.

Escalation moves **up**:
- L5 stuck → L4 helps.
- L4 stuck → L3 helps.
- L3 needs policy / approval → L2.
- L2 needs strategic call → L1.

**Not every problem escalates to L2.** Routine new-supplier outreach, normal pricing, normal customer follow-up — all stays at L4/L5. Only strategic / sensitive / high-risk / outside-lane cases go to L2.

## Each tender has one L5 PIC

Every tender record in the ERP has a single named `assignedPicId`. That person is accountable for moving it through Phases 4–7. If they're stuck, they escalate — they don't drop it.

When you're assigned tenders, you are an L5 PIC. That's the muscle the company runs on.

## "Hannah" / "Dat" / "Trev" — what's with the nicknames?

The team mixes Vietnamese names + Western nicknames. Don't overthink it — the ERP stores both `username` (often the nickname) and `displayName` (often the legal name). Use whichever is on the person's account.

## Open seat: L5 CRM

There's currently no dedicated L5 for **client follow-up / CRM chasing**. The CEO is covering it interim. This affects a lot of workflow rows (17–20, 29–30, 33, 38–43, 48–49). Don't be surprised if customer-side follow-up feels manual — that's why.

## Resigned — do not route work to

If you see these names in old documents, they're gone:
- Norman
- July
- Tiger

The historical org chart in `data/evertrust-ausschreibungsuebersicht-level-0.tsv` is preserved for traceability only.

---

Next: **[06-tooling-rules.md](06-tooling-rules.md)** — the conventions that keep everything sane.
