// Shared builder for outgoing Gmail messages. Produces a multipart/alternative MIME
// message (text/plain fallback + text/html) so an image signature can be embedded, and
// returns the base64url string the Gmail API's `raw` field expects. Used by both the
// Reach bazooka sender and the Engage reply sender.

export interface MimeEmailArgs {
  to: string;
  from: string;
  fromName?: string;
  subject: string; // final subject (caller handles any "Re:" prefixing)
  body: string; // plain-text body
  signatureImageUrl?: string | null; // appended as <img> in HTML + a URL in plain text
  inReplyTo?: string | null;
  references?: string | null;
}

// A distinctive MIME boundary — vanishingly unlikely to occur in an email body.
const BOUNDARY = '----=_EVT_Part_7c1f9e3b2a';

// RFC2047-encode a header value so non-ASCII (em dashes, umlauts) survives transport.
function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function base64url(raw: string): string {
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function buildMimeEmail(args: MimeEmailArgs): string {
  const fromHeader = args.fromName ? `${args.fromName} <${args.from}>` : args.from;
  const sig = args.signatureImageUrl?.trim() || null;

  const plain = sig ? `${args.body}\n\n${sig}` : args.body;
  const htmlBody = htmlEscape(args.body).replace(/\r?\n/g, '<br>');
  const sigHtml = sig
    ? `<br><br><img src="${sig}" alt="signature" style="max-width:480px;height:auto;border:0;" />`
    : '';
  const html =
    `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;` +
    `font-size:14px;line-height:1.5;color:#111;">${htmlBody}${sigHtml}</body></html>`;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${args.to}`,
    `Subject: ${encodeSubject(args.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${BOUNDARY}"`,
  ];
  if (args.inReplyTo) headers.push(`In-Reply-To: ${args.inReplyTo}`);
  const refs = [args.references, args.inReplyTo].filter(Boolean).join(' ').trim();
  if (refs) headers.push(`References: ${refs}`);

  const raw = [
    headers.join('\r\n'),
    '',
    `--${BOUNDARY}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    plain,
    `--${BOUNDARY}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${BOUNDARY}--`,
    '',
  ].join('\r\n');

  return base64url(raw);
}
