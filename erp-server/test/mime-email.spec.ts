import { buildMimeEmail } from '../src/common/mime-email';

const decode = (raw: string) =>
  Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

describe('buildMimeEmail', () => {
  it('builds multipart/alternative with text + html parts and an embedded signature image', () => {
    const msg = decode(
      buildMimeEmail({
        to: 'a@b.com',
        from: 'me@evertrust.de',
        fromName: 'Hanna',
        subject: 'Hi',
        body: 'Line1\nLine2',
        signatureImageUrl: 'https://img/x',
      }),
    );
    expect(msg).toContain('Content-Type: multipart/alternative');
    expect(msg).toContain('Content-Type: text/plain');
    expect(msg).toContain('Content-Type: text/html');
    expect(msg).toContain('Line1<br>Line2'); // newlines → <br> in HTML
    expect(msg).toContain('<img src="https://img/x"'); // embedded signature
    expect(msg).toContain('https://img/x'); // also in the plain-text fallback
    expect(msg).toContain('From: Hanna <me@evertrust.de>');
  });

  it('omits the image (but stays multipart) when no signature url is set', () => {
    const msg = decode(buildMimeEmail({ to: 'a@b.com', from: 'm@e.de', subject: 'Hi', body: 'Hello' }));
    expect(msg).not.toContain('<img');
    expect(msg).toContain('Content-Type: multipart/alternative');
    expect(msg).toContain('Hello');
  });

  it('RFC2047-encodes the subject and threads via In-Reply-To/References', () => {
    const msg = decode(
      buildMimeEmail({
        to: 'a@b.com',
        from: 'm@e.de',
        subject: 'Re: x',
        body: 'b',
        inReplyTo: '<id1>',
        references: '<id0>',
      }),
    );
    expect(msg).toContain('=?UTF-8?B?');
    expect(msg).toContain('In-Reply-To: <id1>');
    expect(msg).toContain('References: <id0> <id1>');
  });

  it('strips internal meeting-time markers — never sent (and not shown as escaped text)', () => {
    const msg = decode(
      buildMimeEmail({
        to: 'a@b.com',
        from: 'm@e.de',
        subject: 'x',
        body: 'Hi\n\n<!--meeting-time-->Would Thursday at 09:00 work?<!--/meeting-time-->',
      }),
    );
    expect(msg).not.toContain('meeting-time--'); // marker gone from both parts
    expect(msg).not.toContain('&lt;!--'); // not escaped-visible in the HTML part
    expect(msg).toContain('Would Thursday at 09:00 work?'); // the prose survives
  });

  it('escapes HTML-special characters in the body', () => {
    const msg = decode(buildMimeEmail({ to: 'a@b.com', from: 'm@e.de', subject: 'x', body: 'A <b> & C' }));
    expect(msg).toContain('A &lt;b&gt; &amp; C');
  });
});
