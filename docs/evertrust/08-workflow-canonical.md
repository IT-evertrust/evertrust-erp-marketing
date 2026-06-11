# 08 — The Canonical Workflow Reference

> This is the **authoritative scope reference** for the 52-row tender workflow.
> Version 1.0 · 2026-05-15 · Owner: Trev
> Companion to `Evertrust_Workflow_17.xlsx` (the canonical visual workflow). Chapter 03 was the summary; this chapter is the full text.

## 1. Why this model

The 8-phase split groups the 52-row workflow spine by **automation posture**, not by visual swimlane. Each phase has one clear question: *do we automate this, partially automate it, or leave it manual?*

**The model is locked.** Any change to phase boundaries goes through `docs/trev-change-log.md` as a Pending entry first.

## 2. The 8 phases (full table)

| Phase | Rows | Name | Automation posture |
|---|---|---|---|
| **1** | R01–R14 | Partner scouting | ❄ FROZEN — Kha will handle this lane; adapt his version later. Out of current automation scope. |
| **2** | R15–R15c | Tender search + intake | Automate. Search → extract → store in the ERP. |
| **3** | R16–R19 | Per-client shortlist + confirm/reject loop | Automate. Build shortlist → send → if reject: loop to next client; if all reject: trash. |
| **4** | R20–R22 | Record open + assign + upload | Automate. Missing-docs check → open record → auto-assign L5 PIC → upload TYPE 1 docs. |
| **5** | R23–R29 | Pricing (AI + L5 + L3) | Automate (mixed). AI-assisted pricing → L5 red/yellow line check (human judgment) → L3 final check. Status chain lives here. Track A pricing **and** Track B documentation run in parallel from this phase. |
| **6** | R30–R31 | Client approval + deadline check | Automate (with mandatory human gate). Written customer approval required before submission (no approval = no submission). T-2 deadline safety check. |
| **7** | R32–R37 | Documentation + QC + submit | Automate. TYPE 2 docs → L4 QC (conditional) → submit at T-2 → save proof + update tracker. Track B finishes here. |
| **8** | R38–R52 | Result + follow-up | **Parked.** Keep as-is for now. Post-submission, clarification, award/loss, contract, billing, KPI, partner review, risk. |

## 3. The status chain (belongs to Phase 5 + Phase 7)

`Not Started → PIC Pricing → Customer Pricing → Documents → Submitted` (then `Awarded` / `Lost` in Phase 8).

- `Not Started` — set at Phase 4 (R21 record opened).
- `PIC Pricing` — set when Phase 5 (R24 → R27) begins.
- `Customer Pricing` — set when Phase 5 (R29) sends pricing pack to client.
- `Documents` — set when Phase 7 (R32) doc prep starts (or when Phase 5's Track B doc prep begins running in parallel).
- `Submitted` — set when Phase 7 (R35) submits via portal.

The 5-value core vocabulary is locked from the May 15 reconciliation. Replaces the 15-value and 10-value enums in deprecated schema docs.

## 4. Track A and Track B (the Phase 5 parallel split)

From the v17 Mind Map and Blueprint sheets:

- **Track A — Pricing**
  R25 supplier quotes → R27 build pricing pack → R27a Tender Overview Brief → R28 senior judgment → R29 send to client → R30 client approval
- **Track B — Documentation**
  R32 prepare TYPE 2 docs → R33 forms complete → R34 L4 QC

**The tracks run in parallel.** Phase 5 contains Track A in full + the *start* of Track B (R32 doc prep can fire as soon as R24 confirms ready-to-price; it does not wait for pricing to complete). Phase 7 contains Track B's QC + submission tail (R33–R37) plus the convergence point at R35 (submit).

**Implication for automation design:** the doc-prep workflow can be triggered from the same event that fires the pricing workflow (R24 → ready-to-price). They do not need to be sequential. Both must complete before R35 submits.

## 5. Letter-suffix branches (preserved from v16, verbatim in v17)

These are decision branches and intake sub-steps:

| Code | Belongs to phase | What it does |
|---|---|---|
| R7a / R7b | 1 (frozen) | Partner replies — Yes / No |
| R8a / R8b | 1 (frozen) | Partner relevant — Yes / No |
| R9a / R9b | 1 (frozen) | Strategic partner — No / Yes |
| R11a, R12a, R13a/R13b | 1 (frozen) | Partner doc gates |
| **R15a** | **2** | ★ Download tender package from portal; upload TYPE 1 docs to staging |
| **R15b** | **2** | ★ High-volume / complex trigger? If Yes → fire R25 immediately |
| **R15c** | **2** | ★ Filter tender against each active client profile (niche, LV value, location, size, blacklist/whitelist) |
| R18a | 3 | Client rejects — Yes → mark no-go |
| R19a / R19b | 3 | Client confirms — No (loop back) / Yes (open record) |
| R20a / R20b | 4 | Missing docs — Yes (chase + flag) / No (hand to Operations) |
| R23a | 5 | Complex → assign L4 QC Lead |
| R24a / R24b | 5 | Ready to price — No (log gaps) / Yes (build pricing) |
| R25a | 5 | Need supplier quote — Yes (request) |
| R26a | 5 | Input delayed — Yes (escalate deadline risk) |
| R27a | 5 | ★ PIC Tender Overview Brief (parallel with R27) |
| R28a | 5 | Senior judgment → reroute to L4 QC |
| R30a / R30b | 6 | Client approves — No (revise/stop) / Yes both gates clear (check deadline) |
| **R31a / R31b** | **6** | Deadline unsafe — Yes (escalate / reduce / decline) / No (proceed to submit) |

> R31b is **not** a separate action — it's the "no, deadline safe, proceed" branch. The submit action itself is R35 (Phase 7).

## 6. What changed from v16 → v17

| Aspect | v16 | v17 |
|---|---|---|
| Phase count | 4 visual phases (1 / 2 / 3A / 3B / 4) | 8 automation phases |
| Phase 1 freeze rationale | "out of current scope per v15 freeze" | "Kha will handle, adapt his version later" |
| Phase 2 name | "TENDER SCREENING + INTAKE" (R15–R20) | "TENDER SEARCH + INTAKE" (R15–R15c only) |
| Phase 3 | (was inside v16 Phase 2) | **New.** "Per-client shortlist + confirm/reject loop" (R16–R19) |
| Phase 4 | (was inside v16 Phase 3A) | **New.** "Record open + assign + upload" (R20–R22) |
| Phase 5 | "PHASE 3A · PRICING & OVERVIEW (R21–R31)" | "PRICING (AI + L5 + L3)" (R23–R29 only) |
| Phase 6 | (was inside v16 Phase 3A) | **New.** "Client approval + deadline check" (R30–R31) |
| Phase 7 | "PHASE 3B · DOCUMENTATION & SUBMISSION (R32–R37)" | "Documentation + QC + submit" (R32–R37) |
| Phase 8 | "PHASE 4 · RESULT & FOLLOW-UP" | "Result + follow-up (PARKED)" (R38–R52) |
| Row content | 52 main rows + 4 sub-rows | **Identical — zero task-content drift** |
| Letter-suffix branches | All present | All present, verbatim |

v15 and v16 are preserved untouched as rollback points.

## 7. Build implications (phase-by-phase)

What the 8-phase model means for n8n / automation work:

### Phase 1 (R01–R14) — frozen
- No automation work here until Kha's version arrives.
- If Trev needs Phase 1 visibility before then, build a read-only dashboard reference. No write paths.

### Phase 2 (R15–R15c) — first automation candidate
- R15 — portal search trigger (manual cadence at first, scheduled later)
- R15a — extract package → upload TYPE 1 docs to staging
- R15b — high-volume detector (LV line count + scope breadth) → fires R25 supplier outreach early
- R15c — per-client profile filter; depends on the `Customer` table

### Phase 3 (R16–R19) — automation candidate
- R16 — build per-client shortlist (low-risk, mostly ERP writes)
- R17 — send tenders to matched clients (queue-for-approval before auto-send)
- R18 / R19 — reject loop + trash logic; needs a state machine: pending → sent → awaiting-reply → confirmed | rejected | timeout
- "All clients reject → trash" needs a definition of "all" (whitelist exhausted? timeout-based?)

### Phase 4 (R20–R22) — automation candidate
- R20 — missing-docs detector (manual flag at first)
- R21 — open tender record (record-creation routine)
- R22 — auto-assign L5 PIC (round-robin? niche-based? load-balanced? — decide before build)
- Auto-upload TYPE 1 docs into the per-tender folder

### Phase 5 (R23–R29) — most complex automation
- AI pricing assist (Claude) — explicitly approved
- Track A pricing + Track B doc prep fire in parallel from R24
- Red / yellow line check stays human (L5)
- L3 final check stays human

### Phase 6 (R30–R31) — automation with mandatory human gate
- R30 written approval is a process rule, not a hard system block (WhatsApp / email / call / text all count)
- T-2 deadline detector + escalation routing

### Phase 7 (R32–R37) — automation candidate
- R32 TYPE 2 doc prep (master checklist source: Library → EPC Document)
- R34 conditional QC gate (routine → L5 may self-submit; risky / complex / high-value → L4 QC required)
- R35 submission act stays human (portal interaction)
- R36–R37 evidence logging is high-value automation (submission proof + timestamp + final file list + tracker update)

### Phase 8 (R38–R52) — parked
- Keep manual / as-is for now.
- KPI roll-up and result entry will eventually automate, but not this iteration.

## 8. Routing implications (post-reconciliation)

For automation that writes to Person fields, current routing rules:

| Phase | Routing impact |
|---|---|
| 1 | Frozen — irrelevant for now |
| 2 | R15c filter depends on the `Customer` table, not on a person |
| 3 | R17 send to client — interim: L4 (Trev / Thy) until L5 CRM hired |
| 4 | R22 assign L5 PIC — assignment surface in the ERP Kanban view |
| 5 | Pricing routes to L5 (Phat / Kiet / Huong / Khang / Tien) under L3 Ops |
| 6 | R30 approval chase — interim: L4 (Trev / Thy) until L5 CRM hired |
| 7 | R34 L4 QC — Trev / Thy |
| 8 | Parked |

## 9. Open design questions (intern note)

These are known gaps. If you're building in one of these phases, ask before assuming:

1. **Phase 3** — definition of "all clients reject → trash" (whitelist exhausted vs timeout-based).
2. **Phase 4 R22** — assignment algorithm (round-robin / niche-based / load-balanced).
3. **Phase 5 Track B trigger point** — fires from R24 ready-to-price, but the exact event hook is per workflow.

## 10. The lowest-risk first automations

If you're picking your first automation to build, these are the safe starts:

- **Phase 4 (R20–R22)** — record open + assign + upload. Self-contained, mostly ERP writes.
- **Phase 7 (R36–R37 evidence logging)** — submission proof capture. High value, low risk.

Both have well-defined inputs/outputs and don't depend on unfinished design questions in Phases 3 or 5.
