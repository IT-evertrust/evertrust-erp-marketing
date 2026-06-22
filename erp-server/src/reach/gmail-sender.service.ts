import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { GoogleAccountsService } from '../google/google-accounts.service';

// Shared Gmail transport for the Growth plane (Reach + Engage). Routes every send
// through the org's connected Google mailbox via GoogleAccountsService.resolveMailbox
// ('gmail' kind): it mints a fresh access token for the org's default/connected
// sending account and the Gmail API send happens here. The backend owns sending;
// the agents stay brain-only.
@Injectable()
export class GmailSenderService {
  private readonly logger = new Logger(GmailSenderService.name);

  constructor(private readonly googleAccounts: GoogleAccountsService) {}

  // Whether a sender mailbox is connected + usable (for a fast pre-send check). The
  // sender handle is ignored — the org's resolved default Gmail mailbox is used.
  async canSend(orgId: string, _sender: string): Promise<boolean> {
    return (await this.googleAccounts.resolveMailbox(orgId, 'gmail')).ok;
  }

  // Send an email via the org's resolved Gmail mailbox. Returns the Gmail message
  // id. Throws 503 if no mailbox is connected / the token is unusable / the API
  // rejects. The sender handle is ignored — the resolved default account sends.
  async sendAs(
    orgId: string,
    _sender: string,
    msg: { to: string; subject: string; body: string; fromName?: string },
  ): Promise<string> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'gmail');
    if (!access.ok) throw new ServiceUnavailableException(access.reason);

    const raw = this.buildRaw({
      from: access.account.email,
      fromName: msg.fromName,
      to: msg.to,
      subject: msg.subject,
      body: msg.body,
    });
    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      },
    );
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Gmail send failed (${res.status}): ${t.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  // RFC822 message, base64url-encoded for the Gmail API. Subject is RFC2047-encoded
  // so non-ASCII (em dashes, umlauts) survive.
  private buildRaw(m: {
    from: string;
    fromName?: string;
    to: string;
    subject: string;
    body: string;
  }): string {
    const fromHeader = m.fromName ? `${m.fromName} <${m.from}>` : m.from;
    const encSubject = `=?UTF-8?B?${Buffer.from(m.subject, 'utf8').toString('base64')}?=`;
    const lines = [
      `From: ${fromHeader}`,
      `To: ${m.to}`,
      `Subject: ${encSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      m.body,
    ];
    return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
  }
}
