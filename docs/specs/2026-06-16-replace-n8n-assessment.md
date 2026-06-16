# Bar 2 assessment — replacing n8n with the ERP

Honest scope of "the ERP does everything and we drop n8n." TL;DR: **don't do it now,
don't do it as a big-bang, and it's orthogonal to selling.** But here's exactly what it
would take, in what order, and when it's actually worth it — so it's a decision, not a vibe.

---

## 1. Should you even replace n8n? (drivers vs costs)

**Real reasons to replace it (when these bite, revisit):**
- n8n-cloud cost scaling with execution volume.
- Per-tenant logic n8n can't cleanly express (dynamic credentials per tenant — the exact wall
  you just hit; though Phase 3 solves that *without* leaving n8n).
- Wanting one codebase/test suite/deploy for the whole system; tighter control + versioning.
- Vendor lock-in / outages on a third party in your critical path.

**Real costs of replacing it:**
- You rebuild an **execution platform**: durable scheduler, retry/queue, LLM tool-loop,
  scraping, email send/receive, calendar, WhatsApp, per-stage logic, observability.
- You lose n8n's **visual editability** — today a non-dev can open a workflow and tweak it;
  after, every change is a code deploy. That's an org/process cost, not just engineering.
- The hardest piece (agentic web-search lead extraction) is exactly what n8n's agent +
  tool nodes give you almost for free.

**Verdict:** replacing n8n does **not** make the product sellable (Phase 3 does) and is not a
prerequisite for anything. Treat it as a later optimization, triggered by concrete pain.

---

## 2. What n8n actually does (the execution layer the ERP lacks)

The ERP today = **system of record + API contract**. n8n = **the entire execution engine**:

| Responsibility | What it is in n8n today |
|---|---|
| Scheduling | cron triggers (Bazooka 8AM daily, RAG hourly), webhook triggers |
| LLM orchestration | gpt-4o calls + langchain agents with a `web_search` tool (validate, classify, forge templates, niche archetypes, lead extraction) |
| Web search + scraping | SearXNG queries → fetch pages → Cloudflare email decode |
| Email send + receive | Gmail nodes (send) + Gmail polling (replies) |
| Calendar / comms | Google Calendar (slots, Meet links), WhatsApp notifications |
| Per-stage logic | dozens of Code nodes: parse, dedup, build queries, gates, payload shaping |
| Resilience + observability | per-node retries, error-trigger workflows, execution history |

---

## 3. The ERP replacement map (per responsibility → NestJS)

Effort: **S** = days, **M** = 1–2 weeks, **L** = 3+ weeks (one engineer, rough).

| Responsibility | ERP replacement | Effort | Risk |
|---|---|---|---|
| Scheduling | `@nestjs/schedule` (Cron) + a `jobs` table for durability/restart-safety. `ArsenalScheduler` already does Bazooka — generalize it. | M | Low |
| Queue / retries | BullMQ on the existing Redis; every stage = a job with retry/backoff. | M | Med (new infra discipline) |
| LLM orchestration | `ai` module + Anthropic/OpenAI SDK + a **tool-calling loop** (the agent's web_search loop, by hand). | **L** | **High** — replicating the agentic extraction reliably is the crux |
| Web search + scraping | service: SearXNG HTTP + `undici` fetch + `cheerio` parse + the cfemail decode (already JS in the n8n code node — portable). | M–L | Med |
| Email send + receive | **Phase 3 anyway** — provider API (send) + inbound webhook (receive). Moving this off Gmail nodes is the same work whether or not you drop n8n. | M | Med (overlaps Phase 3) |
| Calendar / booking | Google Calendar API client, or per-org booking link (Cal.com/Calendly). | S–M | Low |
| WhatsApp | WhatsApp Business API client. | S | Low |
| Per-stage logic | port the Code nodes to TS services. Mechanical but voluminous; most logic is already JS. | M | Low |
| Observability | already have `audit_log` + `arsenal_runs`; add structured stage logs + the job dashboard. | S–M | Low |

**Total order-of-magnitude:** a few engineer-**months** for parity, dominated by the LLM
tool-loop + scraping (Lead Satellite's brain) and the resilience layer (queue/retries) that
n8n hands you for free.

---

## 4. How to migrate (NEVER big-bang) — strangler fig

The ERP API contract (`/campaigns/:id/config`, `/prospects/bulk`, `/arsenal/runs/callback`,
…) is already the seam. Move **one stage at a time** into the ERP behind that same contract,
flip n8n off for that stage, watch it, proceed. You're never without a working pipeline.

Suggested order (simplest/lowest-risk → hardest):
1. **Sleeper Grenade** — small, self-contained (snooze sweep + suppression). Good pilot.
2. **Reach Bazooka** — the send loop. Do this *with* Phase 3 (provider), so the email move
   happens once. High value (it's the daily engine).
3. **Reply Glock** — reply classify + graduate + calendar. Pairs with the Phase-3 inbound webhook.
4. **Ammo Forge / Niche Analytics** — LLM generation; medium.
5. **Lead Satellite** — last. The agentic web-search extraction is the hardest to port; leave
   it on n8n longest, or keep it on n8n permanently and only move the rest.

---

## 5. Recommendation + sequencing

1. **Now: Bar 1** — deploy + test your own org on n8n+Gmail (the runbook). Proves the pipeline.
2. **Next: Phase 3** — provider email + per-tenant onboarding. Makes it **sellable**, and is a
   no-regret first brick of Bar 2 (the email layer moves off Gmail nodes either way).
3. **Later, only if a driver bites: Bar 2 by strangler** — start with Sleeper as a pilot to
   build the platform muscle (scheduler + queue + one stage), then Bazooka/Glock alongside
   Phase 3, and leave Lead Satellite's agent on n8n until last (or forever).

Replacing n8n wholesale is **not** the next move. The next move that advances *every* goal
(sellable + less n8n-coupled) is **Phase 3's provider email layer** — it's the intersection of
"makes money" and "first piece off n8n."

---

## 6. If you greenlight Bar 2: the concrete first step
A **Sleeper Grenade pilot** in the ERP: a `@nestjs/schedule` cron + a BullMQ job that does the
snooze-due sweep (`GET /prospects?snoozeDue=true` logic, in-process), drafts via the `ai`
module, sends via the Phase-3 provider, writes `outreach_messages` + `suppressions`, and
records an `arsenal_runs` row — then disable Sleeper in n8n. One vertical slice that builds the
scheduler+queue+LLM+email platform the rest of Bar 2 reuses. ~2–3 weeks; tells you if the full
migration is worth it before you commit to it.
