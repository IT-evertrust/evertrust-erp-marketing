import { schema } from '@evertrust/db';
import { EngageRepliesService } from '../src/engage/engage-replies.service';
import { getDb, rowsOf, seed } from './real-db';

// ===========================================================================
// EngageRepliesService.maybeProposeSlots — Scenario 2: an INTERESTED lead that gave no
// usable meeting time gets concrete free slots offered (so the reply has times to pick,
// not a vague "let's schedule soon"). Driven directly (private) with a fake calendar.
// ===========================================================================

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AIM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LEAD = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const REPLY = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const SLOTS = [
  { start: '2026-06-26T08:00:00.000Z', end: '2026-06-26T08:30:00.000Z' }, // Fri 10:00 Berlin
  { start: '2026-06-26T11:00:00.000Z', end: '2026-06-26T11:30:00.000Z' },
  { start: '2026-06-29T08:00:00.000Z', end: '2026-06-29T08:30:00.000Z' },
  { start: '2026-06-29T11:00:00.000Z', end: '2026-06-29T11:30:00.000Z' },
];

function fakeCalendar(opts: { slots?: typeof SLOTS; configured?: boolean } = {}) {
  return {
    async freeSlots() {
      return {
        configured: opts.configured ?? true,
        slots: opts.slots ?? SLOTS,
        reason: null,
        timeZone: 'Europe/Berlin',
        secondaryTimeZone: 'Asia/Bangkok',
      };
    },
    async getOrgTimeZones() {
      return { primary: 'Europe/Berlin', secondary: 'Asia/Bangkok' };
    },
  } as never;
}

function makeService(cal: ReturnType<typeof fakeCalendar>) {
  return new EngageRepliesService(getDb(), {} as never, {} as never, {} as never, cal);
}

async function seedReply(meetingStatus: string) {
  await seed(schema.reachLeadReplies, {
    id: REPLY,
    organizationId: ORG,
    aimId: AIM,
    leadId: LEAD,
    category: 'INTERESTED',
    inboundSubject: 'Re: intro',
    inboundBody: 'Sounds interesting, would love to learn more.',
    draftSubject: 'Re: intro',
    draftBody: 'Great to hear! Here are a few times that work — see below.',
    meetingStatus,
  });
}

const reply = async () => (await rowsOf(schema.reachLeadReplies)).find((r) => r.id === REPLY);
const drive = (svc: EngageRepliesService) =>
  (svc as unknown as { maybeProposeSlots(o: string, a: string, l: string): Promise<void> }).maybeProposeSlots(
    ORG,
    AIM,
    LEAD,
  );

describe('EngageRepliesService.maybeProposeSlots', () => {
  it('offers the earliest free slots dual-zone and flips the reply to PROPOSED', async () => {
    await seedReply('NONE');
    await drive(makeService(fakeCalendar()));

    const r = await reply();
    expect(r!.meetingStatus).toBe('PROPOSED');
    expect(r!.proposedSlots).toHaveLength(2); // PROPOSE_SLOT_COUNT — earliest two, not all
    expect(r!.draftBody).toContain('<!--meeting-time-->'); // system-owned block stamped
    expect(r!.draftBody).toContain('GMT+2'); // primary zone
    expect(r!.draftBody).toContain('GMT+7'); // cross-reference
  });

  it('is a no-op when the lead is already in a meeting flow (e.g. ACCEPTED)', async () => {
    await seedReply('ACCEPTED');
    await drive(makeService(fakeCalendar()));

    const r = await reply();
    expect(r!.meetingStatus).toBe('ACCEPTED'); // untouched
    expect(r!.proposedSlots ?? []).toHaveLength(0);
  });

  it('leaves the draft as-is when the calendar has no availability', async () => {
    await seedReply('NONE');
    await drive(makeService(fakeCalendar({ slots: [] })));

    const r = await reply();
    expect(r!.meetingStatus).toBe('NONE');
    expect(r!.draftBody).not.toContain('<!--meeting-time-->');
  });
});
