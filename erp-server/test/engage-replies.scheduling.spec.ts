import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { EngageRepliesService } from '../src/engage/engage-replies.service';
import type { SchedulingVerdict, Slot } from '../src/engage/meeting-loop';
import { getDb, rowsOf, seed } from './real-db';

// ===========================================================================
// EngageRepliesService.applyScheduling — COUNTER idempotency per inbound message.
// ---------------------------------------------------------------------------
// The scan re-runs reply_glock for every lead whose counter-proposal is still the
// latest inbound. Without gating, the COUNTER branch re-fetched calendar alternatives,
// overwrote proposed_slots and re-ran the (LLM) draft regeneration on EVERY scan —
// wasting compute and clobbering manual draft edits. The fix stamps the resolved
// inbound's id on the reply row and skips re-resolving/re-drafting while it is unchanged.
//
// applyScheduling is private; we drive it directly (the public scanCampaign would pull
// in Gmail + the agent service). A fake calendar forces the resolution and `redraftReply`
// is stubbed to a counter so we can prove the LLM pass only fires when it should — and
// keep the unit scoped to reach_lead_replies (no reach_aims/lead graph required).
// ===========================================================================

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AIM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LEAD = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const REPLY = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const COUNTER_TIME = '2026-07-02T10:00:00.000Z';
const ALT: Slot[] = [{ start: '2026-07-02T11:00:00.000Z', end: '2026-07-02T11:30:00.000Z' }];
const OFFERED: Slot[] = [{ start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T09:30:00.000Z' }];

// reply_glock COUNTER verdict: no offered slot accepted, a counter time requested.
const COUNTER_VERDICT: SchedulingVerdict = { accepted_index: null, counter_time: COUNTER_TIME };

const eqId = (id: string) => eq(schema.reachLeadReplies.id, id);

// A fake calendar implementing the two methods resolveScheduling calls. `free` controls
// whether the counter time is taken (false → COUNTER with alternatives, true → ACCEPTED).
function fakeCalendar(opts: { free: boolean; alternatives?: Slot[] }) {
  return {
    async isWindowFree() {
      return { configured: true, free: opts.free, reason: null };
    },
    async alternativesNear() {
      return opts.alternatives ?? [];
    },
  } as never;
}

interface Harness {
  service: EngageRepliesService;
  redraft: jest.Mock;
}

async function seedFixture(free = false): Promise<Harness> {
  await seed(schema.reachLeadReplies, {
    id: REPLY,
    organizationId: ORG,
    aimId: AIM,
    leadId: LEAD,
    category: 'INTERESTED',
    inboundSubject: 'Re: intro',
    inboundBody: 'Can we do Thursday at noon instead?',
    draftSubject: 'Re: intro',
    draftBody: 'ORIGINAL DRAFT',
    // The lead was sent times last round → PROPOSED, with the originally offered slots.
    meetingStatus: 'PROPOSED',
    proposedSlots: OFFERED,
  });
  const service = new EngageRepliesService(
    getDb(),
    {} as never, // googleAccounts — unused on this path
    {} as never, // agent — only redraftReply uses it, and we stub redraftReply
    {} as never, // reach — unused on this path
    fakeCalendar({ free, alternatives: ALT }),
  );
  // Stub the LLM redraft: count calls (and DON'T regenerate), so the assertion is purely
  // "did the COUNTER branch decide to redraft?" — the behaviour finding #2 is about.
  const redraft = jest.fn(async () => ({ ok: true, draftSubject: '', draftBody: '' }));
  (service as unknown as { redraftReply: unknown }).redraftReply = redraft;
  return { service, redraft };
}

// Drive the private applyScheduling for our one lead with a given inbound message id.
function apply(service: EngageRepliesService, inboundId: string) {
  return (service as unknown as {
    applyScheduling(
      orgId: string,
      leadId: string,
      aim: unknown,
      lead: unknown,
      verdict: SchedulingVerdict,
      proposedSlots: Slot[],
      inboundId: string,
    ): Promise<void>;
  }).applyScheduling(
    ORG,
    LEAD,
    { id: AIM }, // applyScheduling only reads aim.id
    { company: 'Globex', email: 'ops@globex.example', contactName: 'Pat Lee' },
    COUNTER_VERDICT,
    OFFERED,
    inboundId,
  );
}

const reply = async () => (await rowsOf(schema.reachLeadReplies)).find((r) => r.id === REPLY);

describe('EngageRepliesService.applyScheduling — COUNTER idempotency per inbound', () => {
  it('first resolution: writes COUNTER, stamps the inbound id, and redrafts once', async () => {
    const { service, redraft } = await seedFixture();

    await apply(service, 'msg-1');

    const r = await reply();
    expect(r!.meetingStatus).toBe('COUNTER');
    expect(r!.counterResolvedInboundId).toBe('msg-1');
    expect(r!.proposedSlots).toEqual(ALT); // offered slots replaced by the alternatives
    expect(redraft).toHaveBeenCalledTimes(1); // one redraft (LLM) pass
    expect(redraft).toHaveBeenCalledWith(
      ORG,
      REPLY,
      expect.stringContaining('alternative times'),
    );
  });

  it('re-scan with the SAME inbound is a no-op: no redraft, manual edits preserved', async () => {
    const { service, redraft } = await seedFixture();

    await apply(service, 'msg-1'); // settles the counter (1 redraft)
    expect(redraft).toHaveBeenCalledTimes(1);

    // Operator hand-edits the draft between scans.
    await getDb()
      .update(schema.reachLeadReplies)
      .set({ draftBody: 'MANUAL EDIT' })
      .where(eqId(REPLY));

    await apply(service, 'msg-1'); // same inbound → gate fires

    const r = await reply();
    expect(redraft).toHaveBeenCalledTimes(1); // NO second redraft
    expect(r!.draftBody).toBe('MANUAL EDIT'); // manual edit NOT clobbered
    expect(r!.meetingStatus).toBe('COUNTER');
  });

  it('a NEW inbound (fresh counter) re-resolves and redrafts again', async () => {
    const { service, redraft } = await seedFixture();

    await apply(service, 'msg-1');
    await apply(service, 'msg-1'); // gated
    expect(redraft).toHaveBeenCalledTimes(1);

    await apply(service, 'msg-2'); // the lead replied again → new inbound

    const r = await reply();
    expect(redraft).toHaveBeenCalledTimes(2); // redraft fired for the new inbound
    expect(r!.counterResolvedInboundId).toBe('msg-2');
  });

  it('a prior COUNTER that now resolves to ACCEPTED still applies (gate only guards COUNTER)', async () => {
    // Calendar now reports the counter time as free → resolveScheduling returns ACCEPTED.
    const { service, redraft } = await seedFixture(true);
    // Pre-set the row to a prior COUNTER for this very inbound to prove the gate is
    // bypassed when the resolution is no longer COUNTER.
    await getDb()
      .update(schema.reachLeadReplies)
      .set({ meetingStatus: 'COUNTER', counterResolvedInboundId: 'msg-1' })
      .where(eqId(REPLY));

    await apply(service, 'msg-1');

    const r = await reply();
    expect(r!.meetingStatus).toBe('ACCEPTED');
    expect(r!.acceptedSlot).toEqual({ start: COUNTER_TIME, end: '2026-07-02T10:30:00.000Z' });
    expect(redraft).toHaveBeenCalledTimes(0); // ACCEPTED never redrafts
  });
});
