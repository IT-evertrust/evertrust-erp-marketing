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
const drive = (svc: EngageRepliesService, allowPropose = true) =>
  (
    svc as unknown as {
      ensureMeetingTimeOnDraft(o: string, a: string, l: string, p: boolean): Promise<void>;
    }
  ).ensureMeetingTimeOnDraft(ORG, AIM, LEAD, allowPropose);

async function seedState(fields: Record<string, unknown>) {
  await seed(schema.reachLeadReplies, {
    id: REPLY,
    organizationId: ORG,
    aimId: AIM,
    leadId: LEAD,
    category: 'INTERESTED',
    inboundSubject: 'Re: intro',
    inboundBody: 'x',
    draftSubject: 'Re: intro',
    draftBody: 'Hi — fresh re-draft, no time yet.',
    ...fields,
  });
}

describe('EngageRepliesService.ensureMeetingTimeOnDraft', () => {
  it('first proposal: INTERESTED + no time → offers 2 free slots dual-zone, flips to PROPOSED', async () => {
    await seedReply('NONE');
    await drive(makeService(fakeCalendar()));

    const r = await reply();
    expect(r!.meetingStatus).toBe('PROPOSED');
    expect(r!.proposedSlots).toHaveLength(2); // PROPOSE_SLOT_COUNT — earliest two, not all
    expect(r!.draftBody).toContain('<!--meeting-time-->');
    expect(r!.draftBody).toContain('GMT+2');
    expect(r!.draftBody).toContain('GMT+7');
  });

  it('re-applies the prose to a re-drafted PROPOSED reply WITHOUT re-proposing', async () => {
    // Simulate a re-scan: PROPOSED with stored slots, but draft_body was just overwritten
    // (no prose). The prose must come back from the existing slots — not a fresh fetch.
    await seedState({ meetingStatus: 'PROPOSED', proposedSlots: SLOTS.slice(0, 2) });
    await drive(makeService(fakeCalendar()), false); // allowPropose=false → no new fetch

    const r = await reply();
    expect(r!.meetingStatus).toBe('PROPOSED');
    expect(r!.proposedSlots).toHaveLength(2); // unchanged
    expect(r!.draftBody).toContain('<!--meeting-time-->'); // prose restored after re-draft
  });

  it('re-applies an ACCEPTED confirmation from the accepted slot', async () => {
    await seedState({ meetingStatus: 'ACCEPTED', acceptedSlot: SLOTS[0] });
    await drive(makeService(fakeCalendar()), false);

    const r = await reply();
    expect(r!.meetingStatus).toBe('ACCEPTED');
    expect(r!.draftBody).toContain('<!--meeting-time-->');
    expect(r!.draftBody).toMatch(/all set|calendar invite/i); // accept-kind prose
  });

  it('does not propose for a non-interested lead (allowPropose=false) at NONE', async () => {
    await seedReply('NONE');
    await drive(makeService(fakeCalendar()), false);

    const r = await reply();
    expect(r!.meetingStatus).toBe('NONE');
    expect(r!.draftBody).not.toContain('<!--meeting-time-->');
  });

  it('leaves the draft as-is when the calendar has no availability', async () => {
    await seedReply('NONE');
    await drive(makeService(fakeCalendar({ slots: [] })));

    const r = await reply();
    expect(r!.meetingStatus).toBe('NONE');
    expect(r!.draftBody).not.toContain('<!--meeting-time-->');
  });
});
