import { Injectable, Logger } from '@nestjs/common';

import { GoogleAccountsService } from '../google/google-accounts.service';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// One parsed inbound Gmail message (metadata + snippet only — no full body fetch).
export interface InboundMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  receivedAt: Date | null;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

// Reads a connected mailbox's Gmail inbox (gmail.readonly) for the Engage inbox sync.
// Metadata-only (From/Subject/Date headers + the Gmail snippet) — cheap and enough to
// match a sender to a known prospect. Unusable grants degrade to an empty list.
@Injectable()
export class GmailReaderService {
  private readonly logger = new Logger(GmailReaderService.name);

  constructor(private readonly google: GoogleAccountsService) {}

  // Recent inbound messages for an account (in:inbox, last `sinceDays`, capped). [] if
  // the grant is unusable.
  async listInbound(
    orgId: string,
    accountId: string,
    sinceDays = 30,
    max = 50,
  ): Promise<InboundMessage[]> {
    const token = await this.google.getAccessTokenForAccount(orgId, accountId);
    if (!token) return [];
    const auth = { Authorization: `Bearer ${token}` };
    try {
      const listParams = new URLSearchParams({
        q: `in:inbox newer_than:${sinceDays}d`,
        maxResults: String(max),
      });
      const listRes = await fetch(`${GMAIL_API}/messages?${listParams.toString()}`, {
        headers: auth,
      });
      if (!listRes.ok) {
        this.logger.warn(
          `Gmail list failed for account ${accountId}: ${listRes.status}`,
        );
        return [];
      }
      const list = (await listRes.json()) as GmailListResponse;
      const ids = (list.messages ?? []).map((m) => m.id);
      if (ids.length === 0) return [];

      // Fetch each message's metadata (parallel, best-effort).
      const metaParams = new URLSearchParams({ format: 'metadata' });
      for (const h of ['From', 'Subject', 'Date']) {
        metaParams.append('metadataHeaders', h);
      }
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(
            `${GMAIL_API}/messages/${id}?${metaParams.toString()}`,
            { headers: auth },
          );
          if (!res.ok) return null;
          return (await res.json()) as GmailMessage;
        }),
      );

      const parsed: InboundMessage[] = [];
      for (const msg of results) {
        if (!msg) continue;
        const headers = msg.payload?.headers ?? [];
        const from = header(headers, 'From');
        const { email, name } = parseFrom(from);
        if (!email) continue;
        parsed.push({
          gmailMessageId: msg.id,
          gmailThreadId: msg.threadId,
          fromEmail: email.toLowerCase(),
          fromName: name,
          subject: header(headers, 'Subject') ?? '',
          snippet: decodeEntities(msg.snippet ?? ''),
          receivedAt: msg.internalDate
            ? new Date(Number(msg.internalDate))
            : null,
        });
      }
      return parsed;
    } catch (err) {
      this.logger.warn(
        `Gmail read error for account ${accountId}: ${err instanceof Error ? err.message : 'error'}`,
      );
      return [];
    }
  }
}

function header(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string | null {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

// "Name" <a@b.com> | Name <a@b.com> | a@b.com -> { email, name }
function parseFrom(from: string | null): { email: string | null; name: string | null } {
  if (!from) return { email: null, name: null };
  const angle = from.match(/<([^>]+)>/);
  if (angle) {
    const email = angle[1]?.trim() ?? null;
    const name = from.slice(0, angle.index).trim().replace(/^"|"$/g, '') || null;
    return { email, name };
  }
  const trimmed = from.trim();
  return { email: trimmed.includes('@') ? trimmed : null, name: null };
}

// The Gmail snippet HTML-escapes a few entities; undo the common ones for display.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
