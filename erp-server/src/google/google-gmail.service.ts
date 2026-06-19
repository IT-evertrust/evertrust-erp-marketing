import { Injectable, Logger } from '@nestjs/common';
import { GoogleAccountsService } from './google-accounts.service';

// READ-side Gmail API for the org's connected default mailbox.
//
// AUTH MODEL: this never uses the Google sign-in ID token. The user must first run
// the per-org Google connect OAuth flow (/google/connect/start), which stores an
// encrypted refresh token in google_accounts. Each Gmail read resolves the CALLING
// org's default mailbox via GoogleAccountsService.resolveMailbox(orgId, 'gmail-read')
// and then calls Gmail REST as users/me with that mailbox's live access token.
//
// NEVER-THROW CONTRACT: these endpoints power UI reads, so auth/scope/API/network
// problems degrade to configured:false with a human-readable reason instead of a 500.

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_CAP = 25;

export interface GmailAccountDto {
  email: string;
}

export interface GmailProfileDto {
  configured: boolean;
  account: GmailAccountDto | null;
  profile: {
    emailAddress: string | null;
    messagesTotal: number | null;
    threadsTotal: number | null;
    historyId: string | null;
  } | null;
  reason: string | null;
}

export interface GmailMessageSummaryDto {
  id: string;
  threadId: string | null;
  snippet: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  internalDate: string | null;
  labelIds: string[];
}

export interface GmailMessagesListDto {
  configured: boolean;
  account: GmailAccountDto | null;
  messages: GmailMessageSummaryDto[];
  nextPageToken: string | null;
  resultSizeEstimate: number | null;
  reason: string | null;
}

export interface GmailAttachmentMetaDto {
  attachmentId: string | null;
  filename: string;
  mimeType: string | null;
  size: number | null;
}

export interface GmailMessageDetailDto {
  configured: boolean;
  account: GmailAccountDto | null;
  message: {
    id: string;
    threadId: string | null;
    snippet: string | null;
    subject: string | null;
    from: string | null;
    to: string | null;
    cc: string | null;
    bcc: string | null;
    date: string | null;
    internalDate: string | null;
    labelIds: string[];
    bodyText: string | null;
    bodyHtml: string | null;
    attachments: GmailAttachmentMetaDto[];
  } | null;
  reason: string | null;
}

export interface GmailListQueryDto {
  // No `q`: free-text search needs the RESTRICTED gmail.readonly scope; the connect
  // flow grants gmail.metadata only, under which messages.list rejects `q` (HTTP 400).
  maxResults?: string | number;
  pageToken?: string;
  labelIds?: string | string[];
  includeSpamTrash?: string | boolean;
}

interface GmailApiProfileResponse {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

interface GmailApiListResponse {
  messages?: { id?: string; threadId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

interface GmailPayloadPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPayloadPart[];
}

interface GmailApiMessageResponse {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
  sizeEstimate?: number;
}

interface GoogleJsonOk<T> {
  ok: true;
  data: T;
}

interface GoogleJsonErr {
  ok: false;
  status: number;
  body: string;
}

@Injectable()
export class GoogleGmailService {
  private readonly logger = new Logger(GoogleGmailService.name);

  constructor(private readonly googleAccounts: GoogleAccountsService) {}

  async profile(orgId: string): Promise<GmailProfileDto> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'gmail-read');
    if (!access.ok) {
      return { configured: false, account: null, profile: null, reason: access.reason };
    }

    try {
      const res = await this.googleGetJson<GmailApiProfileResponse>(
        `${GMAIL_API_BASE}/profile`,
        access.accessToken,
      );

      if (!res.ok) {
        this.logger.warn(`Gmail profile returned HTTP ${res.status} for org ${orgId}: ${res.body}`);

        return this.profileNotConfigured(
          access.account.email,
          `Gmail API error (HTTP ${res.status}). Reconnect the account and allow Gmail read access.`,
        );
      }

      return {
        configured: true,
        account: { email: access.account.email },
        profile: {
          emailAddress: res.data.emailAddress ?? null,
          messagesTotal: res.data.messagesTotal ?? null,
          threadsTotal: res.data.threadsTotal ?? null,
          historyId: res.data.historyId ?? null,
        },
        reason: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Gmail profile failed for org ${orgId}: ${msg}`);

      return this.profileNotConfigured(
        access.account.email,
        'Could not reach Gmail. Try again, or reconnect the account.',
      );
    }
  }

  async listMessages(orgId: string, query: GmailListQueryDto = {}): Promise<GmailMessagesListDto> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'gmail-read');
    if (!access.ok) {
      return {
        configured: false,
        account: null,
        messages: [],
        nextPageToken: null,
        resultSizeEstimate: null,
        reason: access.reason,
      };
    }

    try {
      const params = new URLSearchParams({
        maxResults: String(this.maxResults(query.maxResults)),
      });

      // NOTE: the `q` search parameter is intentionally NOT forwarded. The granted
      // gmail.metadata scope rejects messages.list with `q` (HTTP 400). Narrowing is
      // done via labelIds (allowed under metadata) instead; free-text search would
      // require the RESTRICTED gmail.readonly scope and its CASA audit.
      if (query.pageToken?.trim()) params.set('pageToken', query.pageToken.trim());

      if (this.booleanQuery(query.includeSpamTrash)) {
        params.set('includeSpamTrash', 'true');
      }

      for (const labelId of this.labelIds(query.labelIds)) {
        params.append('labelIds', labelId);
      }

      const list = await this.googleGetJson<GmailApiListResponse>(
        `${GMAIL_API_BASE}/messages?${params.toString()}`,
        access.accessToken,
      );

      if (!list.ok) {
        this.logger.warn(
          `Gmail messages.list returned HTTP ${list.status} for org ${orgId}: ${list.body}`,
        );

        return this.messagesNotConfigured(
          access.account.email,
          `Gmail API error (HTTP ${list.status}). Reconnect the account and allow Gmail read access.`,
        );
      }

      const messages = await Promise.all(
        (list.data.messages ?? [])
          .filter((m) => !!m.id)
          .map((m) => this.messageSummary(access.accessToken, m.id as string, m.threadId ?? null)),
      );

      return {
        configured: true,
        account: { email: access.account.email },
        messages,
        nextPageToken: list.data.nextPageToken ?? null,
        resultSizeEstimate: list.data.resultSizeEstimate ?? null,
        reason: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Gmail listMessages failed for org ${orgId}: ${msg}`);

      return this.messagesNotConfigured(
        access.account.email,
        'Could not reach Gmail. Try again, or reconnect the account.',
      );
    }
  }

  async getMessage(orgId: string, messageId: string): Promise<GmailMessageDetailDto> {
    const access = await this.googleAccounts.resolveMailbox(orgId, 'gmail-read');
    if (!access.ok) {
      return { configured: false, account: null, message: null, reason: access.reason };
    }

    try {
      // The connect flow grants gmail.metadata only (no message body) to avoid the
      // RESTRICTED-scope CASA audit. format=full / format=raw are rejected (HTTP 403)
      // under that scope, so we request format=metadata: headers + snippet + attachment
      // metadata, never the body. bodyText/bodyHtml therefore resolve to null.
      const params = new URLSearchParams({ format: 'metadata' });

      for (const h of ['Subject', 'From', 'To', 'Cc', 'Bcc', 'Date']) {
        params.append('metadataHeaders', h);
      }

      const res = await this.googleGetJson<GmailApiMessageResponse>(
        `${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
        access.accessToken,
      );

      if (!res.ok) {
        this.logger.warn(
          `Gmail messages.get returned HTTP ${res.status} for org ${orgId}: ${res.body}`,
        );

        return this.messageNotConfigured(
          access.account.email,
          `Gmail API error (HTTP ${res.status}). Reconnect the account and allow Gmail read access.`,
        );
      }

      const headers = res.data.payload?.headers ?? [];
      const body = this.extractBody(res.data.payload);

      return {
        configured: true,
        account: { email: access.account.email },
        message: {
          id: res.data.id ?? messageId,
          threadId: res.data.threadId ?? null,
          snippet: res.data.snippet ?? null,
          subject: this.header(headers, 'subject'),
          from: this.header(headers, 'from'),
          to: this.header(headers, 'to'),
          cc: this.header(headers, 'cc'),
          bcc: this.header(headers, 'bcc'),
          date: this.header(headers, 'date'),
          internalDate: res.data.internalDate ?? null,
          labelIds: res.data.labelIds ?? [],
          bodyText: body.bodyText,
          bodyHtml: body.bodyHtml,
          attachments: body.attachments,
        },
        reason: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Gmail getMessage failed for org ${orgId}: ${msg}`);

      return this.messageNotConfigured(
        access.account.email,
        'Could not reach Gmail. Try again, or reconnect the account.',
      );
    }
  }

  private async messageSummary(
    accessToken: string,
    id: string,
    fallbackThreadId: string | null,
  ): Promise<GmailMessageSummaryDto> {
    try {
      const params = new URLSearchParams({ format: 'metadata' });

      for (const h of ['From', 'To', 'Subject', 'Date']) {
        params.append('metadataHeaders', h);
      }

      const res = await this.googleGetJson<GmailApiMessageResponse>(
        `${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}?${params.toString()}`,
        accessToken,
      );

      if (!res.ok) {
        this.logger.warn(
          `Gmail metadata returned HTTP ${res.status} for message ${id}: ${res.body}`,
        );

        return this.minimalSummary(id, fallbackThreadId);
      }

      const headers = res.data.payload?.headers ?? [];

      return {
        id: res.data.id ?? id,
        threadId: res.data.threadId ?? fallbackThreadId,
        snippet: res.data.snippet ?? null,
        subject: this.header(headers, 'subject'),
        from: this.header(headers, 'from'),
        to: this.header(headers, 'to'),
        date: this.header(headers, 'date'),
        internalDate: res.data.internalDate ?? null,
        labelIds: res.data.labelIds ?? [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Gmail metadata failed for message ${id}: ${msg}`);

      return this.minimalSummary(id, fallbackThreadId);
    }
  }

  private minimalSummary(id: string, threadId: string | null): GmailMessageSummaryDto {
    return {
      id,
      threadId,
      snippet: null,
      subject: null,
      from: null,
      to: null,
      date: null,
      internalDate: null,
      labelIds: [],
    };
  }

  private async googleGetJson<T>(
    url: string,
    accessToken: string,
  ): Promise<GoogleJsonOk<T> | GoogleJsonErr> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text() };
    }

    return { ok: true, data: (await res.json()) as T };
  }

  private maxResults(value: string | number | undefined): number {
    const raw = typeof value === 'number' ? value : Number(value ?? DEFAULT_MAX_RESULTS);
    if (!Number.isFinite(raw)) return DEFAULT_MAX_RESULTS;
    return Math.max(1, Math.min(MAX_RESULTS_CAP, Math.floor(raw)));
  }

  private labelIds(value: string | string[] | undefined): string[] {
    const raw = Array.isArray(value) ? value : value ? value.split(',') : [];
    return raw.map((v) => v.trim()).filter(Boolean);
  }

  private booleanQuery(value: string | boolean | undefined): boolean {
    if (typeof value === 'boolean') return value;
    if (!value) return false;

    return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
  }

  private header(headers: GmailHeader[], name: string): string | null {
    const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    return found?.value ?? null;
  }

  private extractBody(payload: GmailPayloadPart | undefined): {
    bodyText: string | null;
    bodyHtml: string | null;
    attachments: GmailAttachmentMetaDto[];
  } {
    let bodyText: string | null = null;
    let bodyHtml: string | null = null;
    const attachments: GmailAttachmentMetaDto[] = [];

    const walk = (part: GmailPayloadPart | undefined): void => {
      if (!part) return;

      const filename = part.filename?.trim();
      const attachmentId = part.body?.attachmentId ?? null;

      if (filename || attachmentId) {
        attachments.push({
          attachmentId,
          filename: filename || '(unnamed attachment)',
          mimeType: part.mimeType ?? null,
          size: part.body?.size ?? null,
        });
      }

      const decoded = part.body?.data ? this.decodeBase64Url(part.body.data) : null;

      if (decoded && part.mimeType === 'text/plain' && bodyText === null) {
        bodyText = decoded;
      }

      if (decoded && part.mimeType === 'text/html' && bodyHtml === null) {
        bodyHtml = decoded;
      }

      for (const child of part.parts ?? []) walk(child);
    };

    walk(payload);

    return { bodyText, bodyHtml, attachments };
  }

  private decodeBase64Url(data: string): string {
    const padded = data
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(data.length / 4) * 4, '=');

    return Buffer.from(padded, 'base64').toString('utf8');
  }

  private profileNotConfigured(email: string, reason: string): GmailProfileDto {
    return {
      configured: false,
      account: { email },
      profile: null,
      reason,
    };
  }

  private messagesNotConfigured(email: string, reason: string): GmailMessagesListDto {
    return {
      configured: false,
      account: { email },
      messages: [],
      nextPageToken: null,
      resultSizeEstimate: null,
      reason,
    };
  }

  private messageNotConfigured(email: string, reason: string): GmailMessageDetailDto {
    return {
      configured: false,
      account: { email },
      message: null,
      reason,
    };
  }
}
