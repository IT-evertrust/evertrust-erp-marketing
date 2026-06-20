import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';

import { DB, type DbClient } from '../../../db/db.tokens';
import { AppConfigService } from '../../../config/app-config.service';
import { GoogleAuthService } from '../../../auth/google/google-auth.service';

// Shared Gmail transport for the Growth plane (Reach + Engage). Resolves a sender
// handle (info | hanna) to a connected google_accounts row (by email), mints a fresh
// access token via GoogleAuthService, and calls the Gmail send API. The backend owns
// sending; the agents stay brain-only.
@Injectable()
export class GmailSenderService {
  private readonly logger = new Logger(GmailSenderService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly google: GoogleAuthService,
    private readonly config: AppConfigService,
  ) {}

  // sender key -> connected mailbox (account id + email), or null if not connected.
  private async resolveAccount(
    orgId: string,
    senderKey: string,
  ): Promise<{ accountId: string; email: string } | null> {
    const senders = await this.db
      .select({ email: schema.orgSenders.email })
      .from(schema.orgSenders)
      .where(
        and(
          eq(schema.orgSenders.organizationId, orgId),
          eq(schema.orgSenders.senderKey, senderKey),
        ),
      )
      .limit(1);
    const email = senders[0]?.email ?? `${senderKey}@evertrust-germany.de`;

    const accts = await this.db
      .select({ id: schema.googleAccounts.id, email: schema.googleAccounts.email })
      .from(schema.googleAccounts)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, orgId),
          eq(schema.googleAccounts.email, email),
        ),
      )
      .limit(1);
    return accts[0] ? { accountId: accts[0].id, email: accts[0].email } : null;
  }

  // Whether a sender mailbox is connected + usable (for a fast pre-send check).
  async canSend(orgId: string, senderKey: string): Promise<boolean> {
    const acct = await this.resolveAccount(orgId, senderKey);
    if (!acct) return false;
    const token = await this.google.getAccessTokenForAccountId(
      orgId,
      acct.accountId,
    );
    return token != null;
  }

  // Send an email as `senderKey`. Returns the Gmail message id. Throws 503 if the
  // mailbox isn't connected / the token is unusable / the API rejects.
  async sendAs(
    orgId: string,
    senderKey: string,
    msg: { to: string; subject: string; body: string; fromName?: string },
  ): Promise<string> {
    const acct = await this.resolveAccount(orgId, senderKey);
    if (!acct) {
      throw new ServiceUnavailableException(
        `No connected Google mailbox for sender '${senderKey}'. Connect it via Sign in with Google.`,
      );
    }
    const token = await this.google.getAccessTokenForAccountId(
      orgId,
      acct.accountId,
    );
    if (!token) {
      throw new ServiceUnavailableException(
        `Google mailbox ${acct.email} token is unusable — reconnect it.`,
      );
    }

    const raw = this.buildRaw({
      from: acct.email,
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
          Authorization: `Bearer ${token}`,
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

  // Test-mode-aware single send. In 'test' mode (REACH_SEND_MODE default) every send
  // is redirected to REACH_TEST_RECIPIENT with a banner so real/synthetic prospect
  // inboxes are never hit; 'live' sends to the real `to`. Returns the actual recipient,
  // the Gmail message id, and the mode used.
  async deliver(
    orgId: string,
    senderKey: string,
    msg: { to: string; subject: string; body: string; fromName?: string },
  ): Promise<{ recipient: string; messageId: string; mode: 'test' | 'live' }> {
    const mode = this.config.get('REACH_SEND_MODE') as 'test' | 'live';
    const testRecipient = this.config.get('REACH_TEST_RECIPIENT');
    const recipient = mode === 'live' ? msg.to : testRecipient;
    const body =
      mode === 'live'
        ? msg.body
        : `[TEST MODE — would be sent to ${msg.to}]\n\n${msg.body}`;
    const messageId = await this.sendAs(orgId, senderKey, {
      ...msg,
      to: recipient,
      body,
    });
    return { recipient, messageId, mode };
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
