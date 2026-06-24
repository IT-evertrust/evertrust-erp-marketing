# Reach Auto-Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Reach campaign with auto-send ON progress on its own — cold, then follow-up (+2 days) and final (+4 days) from the cold send, only while the lead hasn't replied, only during the org's business hours.

**Architecture:** Three functional pieces + one display piece. (1) A pure send-window helper. (2) Inter-round spacing + a reply-stop inside the existing `eligibleLeads` so `runBazooka` self-limits on every path. (3) A dependency-free `ReachScheduler` (identical pattern to `EngageScheduler`) that, per org, calls the unchanged `runBazooka` when inside the org's window. (4) Replace the hardcoded "Tomorrow 09:00" with a real computed next-send time.

**Tech Stack:** NestJS 11, Drizzle ORM, real-Postgres jest (Testcontainer), Next.js 15 frontend. No new dependencies, no DB migration.

**Spec:** `docs/specs/2026-06-24-reach-auto-sender-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `erp-server/src/reach/reach-window.ts` | Pure send-window + tz-validity helpers | **Create** |
| `erp-server/test/reach-window.spec.ts` | Unit tests for the helpers | **Create** |
| `erp-server/src/reach/reach.repository.ts` | Spacing + reply-stop in `eligibleLeads`; `orgsWithAutoSend`, `orgSalesTimeZone`, `nextDueAt` | Modify |
| `erp-server/test/reach-cadence.spec.ts` | Real-DB tests for spacing / reply-stop / next-due | **Create** |
| `erp-server/src/reach/reach.service.ts` | `listAutoSendOrgs`, `resolveSendTimeZone`, attach `nextSendAt` in `getAims` | Modify |
| `erp-server/src/reach/reach.model.ts` | `nextSendAt` on the `ReachAim` view type | Modify |
| `erp-server/src/reach/reach-scheduler.service.ts` | The hourly self-rescheduling auto-sender | **Create** |
| `erp-server/test/reach-scheduler.spec.ts` | `orgsWithAutoSend` + scheduler lifecycle | **Create** |
| `erp-server/src/reach/reach.module.ts` | Register `ReachScheduler` provider | Modify |
| `erp-client/src/modules/(growth)/reach/types.ts` | `nextSendAt` on the campaign view | Modify |
| `erp-client/src/modules/(growth)/reach/services/reach.service.ts` | Use real `nextSendAt` in `getSenderSchedule` | Modify |

---

## Task 1: Send-window helper (`reach-window.ts`)

**Files:**
- Create: `erp-server/src/reach/reach-window.ts`
- Test: `erp-server/test/reach-window.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// erp-server/test/reach-window.spec.ts
import { isWithinSendWindow, isValidTimeZone, nextWindowOpen } from '../src/reach/reach-window';

describe('reach-window', () => {
  // 2026-06-23 is a Tuesday. Times are constructed in UTC then read in Europe/Berlin (UTC+2 in June).
  it('is open Tue 10:00 Berlin', () => {
    expect(isWithinSendWindow(new Date('2026-06-23T08:00:00Z'), 'Europe/Berlin')).toBe(true); // 10:00 local
  });
  it('is closed at 18:00 Berlin (after 17:00)', () => {
    expect(isWithinSendWindow(new Date('2026-06-23T16:00:00Z'), 'Europe/Berlin')).toBe(false); // 18:00 local
  });
  it('is closed before 09:00 Berlin', () => {
    expect(isWithinSendWindow(new Date('2026-06-23T06:00:00Z'), 'Europe/Berlin')).toBe(false); // 08:00 local
  });
  it('is closed on Saturday', () => {
    expect(isWithinSendWindow(new Date('2026-06-27T10:00:00Z'), 'Europe/Berlin')).toBe(false); // Sat 12:00 local
  });
  it('respects the org timezone (10:00 UTC is 19:00 in Tokyo → closed)', () => {
    expect(isWithinSendWindow(new Date('2026-06-23T10:00:00Z'), 'Asia/Tokyo')).toBe(false); // 19:00 local
  });
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
  it('nextWindowOpen rolls a Friday-evening instant to Monday 09:00 local', () => {
    const open = nextWindowOpen(new Date('2026-06-26T20:00:00Z'), 'Europe/Berlin'); // Fri 22:00 local
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', weekday: 'short', hour: 'numeric', hour12: false,
    }).formatToParts(open);
    expect(parts.find((p) => p.type === 'weekday')!.value).toBe('Mon');
    expect(Number(parts.find((p) => p.type === 'hour')!.value) % 24).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-window`
Expected: FAIL — `Cannot find module '../src/reach/reach-window'`.

- [ ] **Step 3: Write the implementation**

```ts
// erp-server/src/reach/reach-window.ts
// Pure send-window helpers for the Reach auto-sender. No deps: Intl.DateTimeFormat
// evaluates the org's local wall-clock from any IANA timezone (correct across DST).
// Window = Monday–Friday, 09:00–17:00 in the org's timezone.

const OPEN_HOUR = 9;
const CLOSE_HOUR = 17;
const WEEKEND = new Set(['Sat', 'Sun']);

// {weekday:'Mon'..'Sun', hour:0..23} for `at` rendered in `timeZone`.
function localParts(at: Date, timeZone: string): { weekday: string; hour: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(at);
  return {
    weekday: p.find((x) => x.type === 'weekday')!.value,
    hour: Number(p.find((x) => x.type === 'hour')!.value) % 24, // Intl can emit '24' at midnight
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isWithinSendWindow(now: Date, timeZone: string): boolean {
  const { weekday, hour } = localParts(now, timeZone);
  return !WEEKEND.has(weekday) && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

// The first instant at/after `now` that falls inside the window. Advances hour by hour
// (≤ ~72 iterations to clear a weekend) — only used for the "next send" display, never
// in a hot path. Always returns a window-open instant.
export function nextWindowOpen(now: Date, timeZone: string): Date {
  let t = now.getTime();
  const HOUR = 3_600_000;
  for (let i = 0; i < 24 * 8; i++) {
    const d = new Date(t);
    const { weekday, hour } = localParts(d, timeZone);
    if (!WEEKEND.has(weekday) && hour >= OPEN_HOUR && hour < CLOSE_HOUR) return d;
    t += HOUR;
  }
  return new Date(t); // unreachable in practice; a window opens within 8 days
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-window`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add erp-server/src/reach/reach-window.ts erp-server/test/reach-window.spec.ts
git commit -m "feat(reach): pure send-window helpers (Mon–Fri 09:00–17:00, org tz)"
```

---

## Task 2: Spacing + reply-stop in `eligibleLeads`

**Files:**
- Modify: `erp-server/src/reach/reach.repository.ts` (add constants near `ROUNDS` @ line 96; rewrite `eligibleLeads` @ ~460)
- Test: `erp-server/test/reach-cadence.spec.ts`

- [ ] **Step 1: Write the failing test** (drives behavior through the public `nextDueRound`)

```ts
// erp-server/test/reach-cadence.spec.ts
import { schema } from '@evertrust/db';
import { ReachRepository } from '../src/reach/reach.repository';
import { getDb, seed } from './real-db';

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AIM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LEAD = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

async function seedLead() {
  await seed(schema.reachAims, {
    id: AIM, organizationId: ORG, name: 'Cadence', niche: 'Cyber', region: 'DE',
    sender: 'hanna', status: 'IN_CAMPAIGN', autoSend: true,
  });
  await seed(schema.reachLeads, {
    id: LEAD, organizationId: ORG, aimId: AIM, company: 'Globex', email: 'ops@globex.test', status: 'NEW',
  });
}
const repo = () => new ReachRepository(getDb());

describe('eligibleLeads cadence (via nextDueRound)', () => {
  it('cold is due when nothing has been sent', async () => {
    await seedLead();
    expect(await repo().nextDueRound(ORG, AIM)).toBe('cold');
  });

  it('follow-up is NOT due 1 day after cold, but IS due at 2 days', async () => {
    await seedLead();
    await seed(schema.reachSends, { organizationId: ORG, aimId: AIM, leadId: LEAD, round: 'cold', sentAt: ago(1 * DAY) });
    expect(await repo().nextDueRound(ORG, AIM)).toBeNull(); // cold sent, follow-up not yet due

    await getDb().delete(schema.reachSends);
    await seed(schema.reachSends, { organizationId: ORG, aimId: AIM, leadId: LEAD, round: 'cold', sentAt: ago(2 * DAY) });
    expect(await repo().nextDueRound(ORG, AIM)).toBe('followup');
  });

  it('final is due 4 days after cold (follow-up already sent)', async () => {
    await seedLead();
    await seed(schema.reachSends, { organizationId: ORG, aimId: AIM, leadId: LEAD, round: 'cold', sentAt: ago(4 * DAY) });
    await seed(schema.reachSends, { organizationId: ORG, aimId: AIM, leadId: LEAD, round: 'followup', sentAt: ago(2 * DAY) });
    expect(await repo().nextDueRound(ORG, AIM)).toBe('final');
  });

  it('a replied lead drops out — no follow-up even at 2 days', async () => {
    await seedLead();
    await seed(schema.reachSends, {
      organizationId: ORG, aimId: AIM, leadId: LEAD, round: 'cold', sentAt: ago(2 * DAY), repliedAt: new Date(),
    });
    expect(await repo().nextDueRound(ORG, AIM)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-cadence`
Expected: FAIL — the "1 day" case returns `'followup'` (no spacing yet) and the replied case returns `'followup'` (no reply-stop yet).

- [ ] **Step 3a: Add the cadence constants** next to `ROUNDS` (`reach.repository.ts` ~line 96)

```ts
const ROUNDS: ReachRound[] = ['cold', 'followup', 'final'];

// Days after the COLD send each later round becomes due (anchored to the cold send,
// per the +2 / +4 spec). Calendar days — the send-window gate defers the actual send
// to the next business slot, so weekends are handled without weekday counting.
const ROUND_DELAY_DAYS: Record<ReachRound, number> = { cold: 0, followup: 2, final: 4 };
const DAY_MS = 86_400_000;
```

- [ ] **Step 3b: Rewrite `eligibleLeads`** (`reach.repository.ts` ~line 460). Replace the whole method body:

```ts
  private async eligibleLeads(
    tx: Tx,
    orgId: string,
    aimId: string,
    round: ReachRound,
  ): Promise<Array<{ id: string; company: string; email: string | null }>> {
    const leads = await tx
      .select({
        id: schema.reachLeads.id,
        company: schema.reachLeads.company,
        email: schema.reachLeads.email,
      })
      .from(schema.reachLeads)
      .where(and(eq(schema.reachLeads.aimId, aimId), tenantScope(orgId, schema.reachLeads)));

    // sentAt + repliedAt added: spacing reads the cold send time, reply-stop reads any
    // send marked replied (markLeadReplied stamps reach_sends.replied_at, not reach_leads).
    const sends = await tx
      .select({
        leadId: schema.reachSends.leadId,
        round: schema.reachSends.round,
        sentAt: schema.reachSends.sentAt,
        repliedAt: schema.reachSends.repliedAt,
      })
      .from(schema.reachSends)
      .where(and(eq(schema.reachSends.aimId, aimId), tenantScope(orgId, schema.reachSends)));

    const has = (leadId: string, r: ReachRound) =>
      sends.some((s) => s.leadId === leadId && s.round === r);
    const hasReplied = (leadId: string) =>
      sends.some((s) => s.leadId === leadId && s.repliedAt != null);
    const coldSentAt = (leadId: string) =>
      sends.find((s) => s.leadId === leadId && s.round === 'cold')?.sentAt ?? null;

    const now = Date.now();
    const dueSince = (at: Date | null, days: number) =>
      at != null && now - at.getTime() >= days * DAY_MS;

    return leads.filter((l) => {
      if (round === 'cold') return !has(l.id, 'cold'); // cold: send once, immediately
      if (hasReplied(l.id)) return false; // REPLY-STOP: a replied lead leaves the sequence
      if (has(l.id, round)) return false; // each later round at most once
      return dueSince(coldSentAt(l.id), ROUND_DELAY_DAYS[round]); // SPACING: cold + N days
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-cadence`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add erp-server/src/reach/reach.repository.ts erp-server/test/reach-cadence.spec.ts
git commit -m "feat(reach): inter-round spacing (+2/+4d) and reply-stop in eligibleLeads"
```

---

## Task 3: `ReachScheduler` + org enumeration + tz resolution + wiring

**Files:**
- Modify: `erp-server/src/reach/reach.repository.ts` (add `orgsWithAutoSend`, `orgSalesTimeZone`)
- Modify: `erp-server/src/reach/reach.service.ts` (add `listAutoSendOrgs`, `resolveSendTimeZone`)
- Create: `erp-server/src/reach/reach-scheduler.service.ts`
- Modify: `erp-server/src/reach/reach.module.ts` (register provider)
- Test: `erp-server/test/reach-scheduler.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// erp-server/test/reach-scheduler.spec.ts
import { schema } from '@evertrust/db';
import { ReachRepository } from '../src/reach/reach.repository';
import { getDb, seed } from './real-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const repo = () => new ReachRepository(getDb());

describe('ReachRepository.orgsWithAutoSend', () => {
  it('returns only orgs that have an auto-send aim, de-duplicated', async () => {
    await seed(schema.reachAims, [
      { id: '11111111-1111-1111-1111-111111111111', organizationId: ORG_A, name: 'A1', niche: 'x', region: 'DE', sender: 'h', status: 'IN_CAMPAIGN', autoSend: true },
      { id: '22222222-2222-2222-2222-222222222222', organizationId: ORG_A, name: 'A2', niche: 'x', region: 'DE', sender: 'h', status: 'IN_CAMPAIGN', autoSend: true },
      { id: '33333333-3333-3333-3333-333333333333', organizationId: ORG_B, name: 'B1', niche: 'x', region: 'DE', sender: 'h', status: 'IN_CAMPAIGN', autoSend: false },
    ]);
    const orgs = await repo().orgsWithAutoSend();
    expect(orgs.sort()).toEqual([ORG_A]); // ORG_A once (deduped), ORG_B excluded (autoSend false)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-scheduler`
Expected: FAIL — `repo().orgsWithAutoSend is not a function`.

- [ ] **Step 3a: Add repo methods** (`reach.repository.ts`, after `findAutoSendAims`)

```ts
  // Distinct orgs that have at least one auto-send campaign — the scheduler's work list.
  async orgsWithAutoSend(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ orgId: schema.reachAims.organizationId })
      .from(schema.reachAims)
      .where(eq(schema.reachAims.autoSend, true));
    return rows.map((r) => r.orgId);
  }

  // The org's stored sales timezone (org_config.salesTimeZone), trimmed, or null.
  async orgSalesTimeZone(orgId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ tz: schema.orgConfig.salesTimeZone })
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    return row?.tz?.trim() || null;
  }
```

- [ ] **Step 3b: Add service methods** (`reach.service.ts`). Add the import and methods:

```ts
import { isValidTimeZone } from './reach-window';
```

```ts
  // The orgs the auto-send scheduler should process.
  listAutoSendOrgs(): Promise<string[]> {
    return this.repo.orgsWithAutoSend();
  }

  // The org's send-window timezone, per the multi-tenant rule
  // (org_config.salesTimeZone ?? env SALES_TIME_ZONE ?? 'Europe/Berlin').
  async resolveSendTimeZone(orgId: string): Promise<string> {
    const orgTz = await this.repo.orgSalesTimeZone(orgId);
    const envTz = this.config.get('SALES_TIME_ZONE').trim();
    const candidate = orgTz ?? (envTz.length > 0 ? envTz : null);
    return candidate && isValidTimeZone(candidate) ? candidate : 'Europe/Berlin';
  }
```

- [ ] **Step 3c: Create the scheduler** (`reach-scheduler.service.ts`)

```ts
// erp-server/src/reach/reach-scheduler.service.ts
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { ReachService } from './reach.service';
import { isWithinSendWindow } from './reach-window';

// ===========================================================================
// Reach · auto-sender (dependency-free, mirrors EngageScheduler — no @nestjs/schedule).
// One self-rescheduling timer, re-armed AFTER its run finishes so a slow run never
// overlaps itself. Each tick processes every org that has an auto-send campaign, but
// only while that org is inside its send window. runBazooka itself is unchanged — it
// already gates on the auto_send toggle and (now) on spacing + reply-stop.
// ===========================================================================

function envBool(key: string, dflt: boolean): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  if (v == null || v === '') return dflt;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v);
}
function envInt(key: string, dflt: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

@Injectable()
export class ReachScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReachScheduler.name);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  constructor(private readonly reach: ReachService) {}

  onModuleInit(): void {
    if (!envBool('REACH_AUTOSEND_ENABLED', true)) {
      this.logger.log('Reach auto-send disabled (REACH_AUTOSEND_ENABLED=false).');
      return;
    }
    const everyMs = envInt('REACH_AUTOSEND_INTERVAL_MIN', 60) * 60_000;
    this.logger.log(`Reach auto-send armed: every ${everyMs / 60_000} min across all orgs.`);
    // Delay the first run by one interval so a restart doesn't immediately send.
    this.arm(everyMs, everyMs, () => this.runDueSends());
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // Schedule `fn` after `firstDelayMs`, then re-arm `intervalMs` after each completion.
  private arm(firstDelayMs: number, intervalMs: number, fn: () => Promise<unknown>): void {
    const tick = () => {
      if (this.destroyed) return;
      void Promise.resolve()
        .then(fn)
        .catch((err) =>
          this.logger.warn(
            `reach auto-send error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
        .finally(() => {
          if (this.destroyed) return;
          const t = setTimeout(tick, intervalMs);
          this.timers.add(t);
        });
    };
    const first = setTimeout(tick, firstDelayMs);
    this.timers.add(first);
  }

  private async runDueSends(): Promise<void> {
    const orgs = await this.reach.listAutoSendOrgs();
    for (const orgId of orgs) {
      const tz = await this.reach.resolveSendTimeZone(orgId);
      if (!isWithinSendWindow(new Date(), tz)) {
        this.logger.log(`Reach auto-send org ${orgId}: outside window (${tz}) — skipped.`);
        continue;
      }
      const summary = await this.reach.runBazooka(orgId);
      this.logger.log(
        `Reach auto-send org ${orgId}: ${summary.campaignsProcessed} campaign(s) advanced.`,
      );
    }
  }
}
```

- [ ] **Step 3d: Register the provider** (`reach.module.ts`). Add the import and the provider:

```ts
import { ReachScheduler } from './reach-scheduler.service';
```

Change the providers array to:

```ts
  providers: [ReachService, ReachRepository, ReachAgentClient, GmailSenderService, ReachScheduler],
```

- [ ] **Step 4: Run test + typecheck**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-scheduler`
Expected: PASS (1 test).
Run: `corepack pnpm --filter @evertrust/db build && corepack pnpm --filter @evertrust/api typecheck 2>&1 | rg "reach-scheduler|reach-window|reach.service|reach.repository" || echo "no new errors in reach"`
Expected: no reach-related typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add erp-server/src/reach/reach-scheduler.service.ts erp-server/src/reach/reach.module.ts erp-server/src/reach/reach.service.ts erp-server/src/reach/reach.repository.ts erp-server/test/reach-scheduler.spec.ts
git commit -m "feat(reach): hourly ReachScheduler auto-sender, window-gated per org"
```

---

## Task 4: Real "Next send" (replace the hardcoded string)

**Files:**
- Modify: `erp-server/src/reach/reach.repository.ts` (add `nextDueAt`)
- Modify: `erp-server/src/reach/reach.model.ts` (add `nextSendAt` to the aim view)
- Modify: `erp-server/src/reach/reach.service.ts` (attach `nextSendAt` in `getAims`)
- Modify: `erp-client/src/modules/(growth)/reach/types.ts`
- Modify: `erp-client/src/modules/(growth)/reach/services/reach.service.ts`
- Test: extend `erp-server/test/reach-cadence.spec.ts`

- [ ] **Step 1: Write the failing test** (append to `reach-cadence.spec.ts`)

```ts
describe('ReachRepository.nextDueAt', () => {
  it('returns cold+2 days for a campaign whose only lead got a cold send', async () => {
    await seedLead();
    const coldAt = ago(0); // sent just now
    await seed(schema.reachSends, { organizationId: ORG, aimId: AIM, leadId: LEAD, round: 'cold', sentAt: coldAt });
    const at = await repo().nextDueAt(ORG, AIM);
    expect(at).not.toBeNull();
    // follow-up due 2 days after the cold send (±1s for execution time)
    expect(Math.abs(at!.getTime() - (coldAt.getTime() + 2 * DAY))).toBeLessThan(1000);
  });

  it('returns null when every lead has replied', async () => {
    await seedLead();
    await seed(schema.reachSends, {
      organizationId: ORG, aimId: AIM, leadId: LEAD, round: 'cold', sentAt: ago(1 * DAY), repliedAt: new Date(),
    });
    expect(await repo().nextDueAt(ORG, AIM)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-cadence`
Expected: FAIL — `repo().nextDueAt is not a function`.

- [ ] **Step 3a: Add `nextDueAt`** (`reach.repository.ts`, after `nextDueRound`)

```ts
  // The soonest instant the campaign's NEXT round becomes sendable, across all
  // not-yet-replied leads — ignoring the send window (the caller clamps to it for
  // display). null when nothing is pending (sequence complete / everyone replied).
  async nextDueAt(orgId: string, aimId: string): Promise<Date | null> {
    return this.db.transaction(async (tx) => {
      const leads = await tx
        .select({ id: schema.reachLeads.id })
        .from(schema.reachLeads)
        .where(and(eq(schema.reachLeads.aimId, aimId), tenantScope(orgId, schema.reachLeads)));
      const sends = await tx
        .select({
          leadId: schema.reachSends.leadId,
          round: schema.reachSends.round,
          sentAt: schema.reachSends.sentAt,
          repliedAt: schema.reachSends.repliedAt,
        })
        .from(schema.reachSends)
        .where(and(eq(schema.reachSends.aimId, aimId), tenantScope(orgId, schema.reachSends)));

      const has = (id: string, r: ReachRound) => sends.some((s) => s.leadId === id && s.round === r);
      const replied = (id: string) => sends.some((s) => s.leadId === id && s.repliedAt != null);
      const coldAt = (id: string) => sends.find((s) => s.leadId === id && s.round === 'cold')?.sentAt ?? null;

      let soonest: number | null = null;
      const now = Date.now();
      for (const l of leads) {
        if (replied(l.id)) continue;
        let due: number | null = null;
        if (!has(l.id, 'cold')) due = now; // cold is immediately sendable
        else if (!has(l.id, 'followup')) {
          const c = coldAt(l.id);
          due = c ? c.getTime() + ROUND_DELAY_DAYS.followup * DAY_MS : null;
        } else if (!has(l.id, 'final')) {
          const c = coldAt(l.id);
          due = c ? c.getTime() + ROUND_DELAY_DAYS.final * DAY_MS : null;
        }
        if (due != null && (soonest == null || due < soonest)) soonest = due;
      }
      return soonest == null ? null : new Date(soonest);
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @evertrust/api test -- --testPathPattern reach-cadence`
Expected: PASS (6 tests total in the file).

- [ ] **Step 5a: Add `nextSendAt` to the aim view type** (`reach.model.ts`, on the `ReachAim` type — add the field alongside `stats`/`autoSend`):

```ts
  // ISO-8601 instant the next round can send (clamped to the org's window), or null
  // when the sequence is complete / all replied. Drives the "Next send" UI column.
  nextSendAt: string | null;
```

- [ ] **Step 5b: Attach `nextSendAt` in `getAims`** (`reach.service.ts`). Replace the `getAims` method:

```ts
  async getAims(orgId: string): Promise<ReachAim[]> {
    const aims = await this.repo.findAims(orgId);
    const tz = await this.resolveSendTimeZone(orgId);
    return Promise.all(
      aims.map(async (aim) => {
        const due = await this.repo.nextDueAt(orgId, aim.id);
        const nextSendAt = due ? nextWindowOpen(due, tz).toISOString() : null;
        return { ...aim, nextSendAt };
      }),
    );
  }
```

Add `nextWindowOpen` to the existing reach-window import in `reach.service.ts`:

```ts
import { isValidTimeZone, nextWindowOpen } from './reach-window';
```

- [ ] **Step 5c: Frontend type** (`erp-client/src/modules/(growth)/reach/types.ts`). Add to `ReachCampaignView`:

```ts
  nextSendAt: string | null;
```

- [ ] **Step 5d: Use it in the UI** (`erp-client/.../services/reach.service.ts`, `getSenderSchedule`). Replace the `nextSend` line:

```ts
      nextSend:
        c.status === 'OVER' || roundsSent === 3
          ? '-'
          : c.nextSendAt
            ? new Date(c.nextSendAt).toLocaleString(undefined, {
                weekday: 'short', hour: '2-digit', minute: '2-digit',
              })
            : 'Pending',
```

- [ ] **Step 6: Verify backend + frontend build**

Run: `corepack pnpm --filter @evertrust/db build && corepack pnpm --filter @evertrust/api typecheck 2>&1 | rg "reach" || echo "no reach typecheck errors"`
Run: `corepack pnpm --filter @evertrust/web typecheck 2>&1 | rg "reach" || echo "no reach typecheck errors"`
Expected: no reach-related errors in either.

- [ ] **Step 7: Commit**

```bash
git add erp-server/src/reach/reach.repository.ts erp-server/src/reach/reach.model.ts erp-server/src/reach/reach.service.ts "erp-client/src/modules/(growth)/reach/types.ts" "erp-client/src/modules/(growth)/reach/services/reach.service.ts" erp-server/test/reach-cadence.spec.ts
git commit -m "feat(reach): real computed 'next send' replaces the hardcoded placeholder"
```

---

## Final verification

- [ ] Run the full reach + window + scheduler suite:
  `corepack pnpm --filter @evertrust/api test -- --testPathPattern "reach-window|reach-cadence|reach-scheduler"`
  Expected: all green.
- [ ] Full API typecheck delta unchanged vs. base (only the pre-existing `users` errors remain; nothing reach-related).
- [ ] Manual smoke (optional, against the running stack): toggle a campaign's bazooka ON, set `REACH_AUTOSEND_INTERVAL_MIN=1`, confirm the log line `Reach auto-send armed` and a window-gated tick.

## Self-review notes (done while writing)

- **Spec coverage:** window helper (T1) ✓, spacing+reply-stop (T2) ✓, scheduler+enumeration+tz (T3) ✓, real next-send (T4) ✓, multi-tenant per-org tz resolution ✓, tests for every behavior in the spec's test list ✓.
- **No `ScheduleModule`:** intentional — mirrors the dependency-free `EngageScheduler`; `@nestjs/schedule` is not a dependency.
- **Reply signal:** every reply check is `reach_sends.replied_at != null` (matches `markLeadReplied`), never `reach_leads.replied_at`.
- **Type consistency:** `nextSendAt` is `string | null` end-to-end (model → service → web type → UI); repo returns `Date | null` and the service serializes with `.toISOString()`.
