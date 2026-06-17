import {
  buildRawReply,
  decodeBase64Url,
  extractPlainBody,
  normalizeVerdict,
  parseFromAddress,
  parseGmailMessage,
} from '../src/engage/engage.service';

// The PURE Gmail-payload parsing + reply-building helpers behind the Engage
// pipeline. These pin the contract — a full Gmail message (format=full) reduces to
// {from, subject, body}; verdict coercion is defensive; the RFC822 reply threads
// correctly — all with no network and no Google/Anthropic dependency.

// Encode a UTF-8 string as Gmail's URL-safe base64 (the inverse of decodeBase64Url).
function b64url(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('decodeBase64Url', () => {
  it('round-trips URL-safe base64 to UTF-8', () => {
    expect(decodeBase64Url(b64url('Hallo Ümlaut & co'))).toBe('Hallo Ümlaut & co');
  });
});

describe('parseFromAddress', () => {
  it('extracts a lowercased email + display name from a "Name <addr>" header', () => {
    expect(parseFromAddress('"Jane Doe" <Jane.Doe@Example.COM>')).toEqual({
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
    });
  });

  it('handles a bare address with no display name', () => {
    expect(parseFromAddress('bob@acme.io')).toEqual({
      email: 'bob@acme.io',
      name: null,
    });
  });

  it('returns null email for a malformed header', () => {
    expect(parseFromAddress('not an email').email).toBeNull();
    expect(parseFromAddress(null).email).toBeNull();
  });
});

describe('extractPlainBody', () => {
  it('prefers a text/plain part in a multipart/alternative tree', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('plain wins') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html loses</p>') } },
      ],
    };
    expect(extractPlainBody(payload)).toBe('plain wins');
  });

  it('falls back to stripped text/html when there is no plain part', () => {
    const payload = {
      mimeType: 'text/html',
      body: { data: b64url('<p>Hello <b>there</b></p>') },
    };
    expect(extractPlainBody(payload)).toBe('Hello there');
  });

  it('reads a single-part body carried directly on the payload', () => {
    const payload = { mimeType: 'text/plain', body: { data: b64url('direct body') } };
    expect(extractPlainBody(payload)).toBe('direct body');
  });
});

describe('parseGmailMessage', () => {
  it('reduces a full message to {from, subject, body} with threading headers', () => {
    const msg = {
      id: 'm123',
      threadId: 't456',
      internalDate: '1700000000000',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Prospect <buyer@target.de>' },
          { name: 'Subject', value: 'AW: Your proposal' },
          { name: 'Message-ID', value: '<abc@mail.target.de>' },
          { name: 'References', value: '<orig@us.com>' },
        ],
        parts: [{ mimeType: 'text/plain', body: { data: b64url('Sounds good, lets talk.') } }],
      },
    };
    const parsed = parseGmailMessage(msg);
    expect(parsed).not.toBeNull();
    expect(parsed!.gmailMessageId).toBe('m123');
    expect(parsed!.gmailThreadId).toBe('t456');
    expect(parsed!.fromEmail).toBe('buyer@target.de');
    expect(parsed!.subject).toBe('AW: Your proposal');
    expect(parsed!.body).toBe('Sounds good, lets talk.');
    expect(parsed!.rfc822MessageId).toBe('<abc@mail.target.de>');
    expect(parsed!.references).toBe('<orig@us.com>');
    expect(parsed!.receivedAt.getTime()).toBe(1700000000000);
  });

  it('returns null when the message has no id', () => {
    expect(parseGmailMessage({})).toBeNull();
  });
});

describe('normalizeVerdict', () => {
  it('passes the three Engage verdicts through (case-insensitive)', () => {
    expect(normalizeVerdict('interested')).toBe('INTERESTED');
    expect(normalizeVerdict('NOT_INTERESTED')).toBe('NOT_INTERESTED');
    expect(normalizeVerdict('Unsure')).toBe('UNSURE');
  });

  it('degrades any unknown value to UNSURE for human review', () => {
    expect(normalizeVerdict('MAYBE')).toBe('UNSURE');
    expect(normalizeVerdict('')).toBe('UNSURE');
  });
});

describe('buildRawReply', () => {
  it('builds a base64url RFC822 reply that threads via In-Reply-To/References', () => {
    const raw = buildRawReply({
      to: 'buyer@target.de',
      from: 'rep@us.com',
      subject: 'Your proposal',
      body: 'Happy to set up a call.',
      inReplyTo: '<abc@mail.target.de>',
      references: '<orig@us.com>',
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('To: buyer@target.de');
    expect(decoded).toContain('From: rep@us.com');
    // A subject without a Re:/AW: prefix gets one added.
    expect(decoded).toContain('Subject: Re: Your proposal');
    expect(decoded).toContain('In-Reply-To: <abc@mail.target.de>');
    expect(decoded).toContain('References: <orig@us.com> <abc@mail.target.de>');
    expect(decoded).toContain('Happy to set up a call.');
  });

  it('does not double-prefix an already-Re: subject', () => {
    const raw = buildRawReply({
      to: 'a@b.com',
      from: 'c@d.com',
      subject: 'Re: hi',
      body: 'x',
      inReplyTo: null,
      references: null,
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('Subject: Re: hi');
    expect(decoded).not.toContain('Re: Re: hi');
    // No threading headers when there is nothing to thread.
    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
  });
});
