import { classifyEvent } from '../src/google/google-calendar-read.service';

// classifyEvent is the PURE hybrid category classifier behind the Activate color code.
// First-match-wins rules: ooo > reminder(all-day) > client(external attendee) >
// team(internal-only) > personal(no attendees). selfDomain is the org's own email
// domain (used to tell internal from external attendees).

const ext = [{ email: 'buyer@acme.io', self: false, resource: false }];
const intl = [{ email: 'colleague@evertrust-germany.de', self: false, resource: false }];
const DOM = 'evertrust-germany.de';

describe('classifyEvent', () => {
  it('ooo wins on eventType outOfOffice', () => {
    expect(classifyEvent({ eventType: 'outOfOffice', allDay: false, attendees: ext }, DOM)).toBe('ooo');
  });

  it('all-day → reminder', () => {
    expect(classifyEvent({ eventType: 'default', allDay: true, attendees: ext }, DOM)).toBe('reminder');
  });

  it('external attendee → client', () => {
    expect(classifyEvent({ eventType: 'default', allDay: false, attendees: ext }, DOM)).toBe('client');
  });

  it('internal-only attendees → team', () => {
    expect(classifyEvent({ eventType: 'default', allDay: false, attendees: intl }, DOM)).toBe('team');
  });

  it('no real attendees → personal', () => {
    expect(classifyEvent({ eventType: 'default', allDay: false, attendees: [] }, DOM)).toBe('personal');
  });

  it('resource/self attendees do not make it a meeting → personal', () => {
    const onlyRoom = [
      { email: 'room-3@evertrust-germany.de', self: false, resource: true },
      { email: 'me@evertrust-germany.de', self: true, resource: false },
    ];
    expect(classifyEvent({ eventType: 'default', allDay: false, attendees: onlyRoom }, DOM)).toBe('personal');
  });

  it('precedence: ooo before reminder before client', () => {
    expect(classifyEvent({ eventType: 'outOfOffice', allDay: true, attendees: ext }, DOM)).toBe('ooo');
    expect(classifyEvent({ eventType: 'default', allDay: true, attendees: ext }, DOM)).toBe('reminder');
  });

  it('mixed internal + external → client (external wins)', () => {
    expect(
      classifyEvent({ eventType: 'default', allDay: false, attendees: [...intl, ...ext] }, DOM),
    ).toBe('client');
  });
});
