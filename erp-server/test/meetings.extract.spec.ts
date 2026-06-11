import {
  extractMeeting,
  pickProspectEmail,
  type RunData,
} from '../src/meetings/meetings.extract';

// Build an n8n runData object from {nodeName: outputJson}.
function rd(nodes: Record<string, Record<string, unknown>>): RunData {
  const out: RunData = {};
  for (const [k, j] of Object.entries(nodes)) {
    out[k] = [{ data: { main: [[{ json: j }]] } }];
  }
  return out;
}

describe('meetings.extract', () => {
  it('extracts fields and picks the prospect email (skips owner + internal)', () => {
    const r = rd({
      'Read.ai Webhook': {
        body: {
          session_id: 'S1',
          title: 'Discovery',
          start_time: Date.UTC(2026, 5, 3),
          participants: [
            { name: 'Hanna', email: 'hanna@evertrust-germany.de' },
            { name: 'Vic', email: 'vic@kodeca.de' },
          ],
          owner: { email: 'hanna@evertrust-germany.de' },
        },
      },
      'Sales Coach Agent': {
        output: {
          client_company: 'Kodeca',
          ae_name: 'Hanna',
          client_contact: 'Vic',
          performance_score: { overall: { score: 65 } },
        },
      },
      'Create Meeting Doc': { webViewLink: 'https://docs.google.com/x' },
    });
    const m = extractMeeting(r);
    expect(m).not.toBeNull();
    expect(m!.sessionId).toBe('S1');
    expect(m!.clientEmail).toBe('vic@kodeca.de');
    expect(m!.clientCompany).toBe('Kodeca');
    expect(m!.aeName).toBe('Hanna');
    expect(m!.score).toBe(65);
    expect(m!.docUrl).toBe('https://docs.google.com/x');
    expect(m!.meetingDate).toBe('2026-06-03');
  });

  it('returns no prospect when only internal participants are present', () => {
    expect(
      pickProspectEmail({
        owner: { email: 'a@evertrust-germany.de' },
        participants: [{ email: 'a@evertrust-germany.de' }],
      }),
    ).toBeNull();
  });

  it('skips the owner even on an external domain', () => {
    expect(
      pickProspectEmail({
        owner: { email: 'host@partner.com' },
        participants: [
          { email: 'host@partner.com' },
          { email: 'buyer@client.io' },
        ],
      }),
    ).toBe('buyer@client.io');
  });

  it('returns null when there is no analysis and no body', () => {
    expect(extractMeeting({})).toBeNull();
  });
});
