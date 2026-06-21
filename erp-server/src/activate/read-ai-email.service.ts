import { Injectable, Logger } from '@nestjs/common';

import { GoogleAccountsService } from '../google/google-accounts.service';
import type { ReadAiImportItem } from './dto/import-read-ai.dto';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  payload?: { headers?: Array<{ name: string; value: string }>; parts?: GmailPart[]; mimeType?: string; body?: { data?: string } };
}

// Harvests Read AI meeting data from the connected mailboxes' Gmail (Read AI emails a
// "Read Meeting Report" per meeting — verified: lands in hanna@, sender executiveassistant@e.read.ai).
// The email carries title + date + SUMMARY (not the transcript), so this gives autonomous
// coverage of the meeting list; full transcripts come via the MCP path and merge onto the
// same row (deterministic title+date session key in the repo).
@Injectable()
export class ReadAiEmailService {
  private readonly logger = new Logger(ReadAiEmailService.name);

  constructor(private readonly google: GoogleAccountsService) {}

  // Parse Read AI report emails across all connected mailboxes into import items
  // (summary-only; no transcript). Best-effort per mailbox.
  async harvest(
    orgId: string,
    sinceDays = 120,
    maxPerMailbox = 60,
  ): Promise<{ items: ReadAiImportItem[]; scanned: number }> {
    const accounts = await this.google.listForOrg(orgId);
    const items: ReadAiImportItem[] = [];
    let scanned = 0;
    for (const account of accounts) {
      const token = await this.google.getAccessTokenForAccount(orgId, account.id);
      if (!token) continue;
      const auth = { Authorization: `Bearer ${token}` };
      const ids = await this.listReportIds(auth, sinceDays, maxPerMailbox);
      scanned += ids.length;
      for (const id of ids) {
        const item = await this.parseReport(auth, id, account.email);
        if (item) items.push(item);
      }
    }
    if (items.length === 0) {
      this.logger.log('Read AI harvest: no report emails found in connected mailboxes.');
    }
    return { items, scanned };
  }

  private async listReportIds(
    auth: Record<string, string>,
    sinceDays: number,
    max: number,
  ): Promise<string[]> {
    const params = new URLSearchParams({
      q: `from:read.ai subject:"Read Meeting Report" newer_than:${sinceDays}d`,
      maxResults: String(Math.min(max, 100)),
    });
    try {
      const res = await fetch(`${GMAIL_API}/messages?${params}`, { headers: auth });
      if (!res.ok) return [];
      const json = (await res.json()) as { messages?: Array<{ id: string }> };
      return (json.messages ?? []).map((m) => m.id);
    } catch {
      return [];
    }
  }

  private async parseReport(
    auth: Record<string, string>,
    id: string,
    owner: string,
  ): Promise<ReadAiImportItem | null> {
    try {
      const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, { headers: auth });
      if (!res.ok) return null;
      const msg = (await res.json()) as GmailMessage;
      const headers = msg.payload?.headers ?? [];
      const subject =
        headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';

      const parsed = parseSubject(subject);
      if (!parsed) return null;

      const body = extractPlainText(msg.payload);
      const summary = extractSummary(body);

      // Build with only defined fields (exactOptionalPropertyTypes). readAiId is left out
      // here — the MCP path fills it. title/date drive the dedup key.
      const item: ReadAiImportItem = { title: parsed.title, owner };
      if (parsed.meetingDate) item.meetingDate = parsed.meetingDate;
      const company = deriveCompany(parsed.title);
      if (company) item.company = company;
      if (summary) item.summary = summary;
      return item;
    } catch {
      return null;
    }
  }
}

// "🗓 <title> on <Month DD, YYYY> @ <time> | Read Meeting Report" -> { title, meetingDate(ISO) }.
// Greedy title so meeting names containing " on " still parse (the trailing date anchors it).
function parseSubject(
  subject: string,
): { title: string; meetingDate: string | null } | null {
  const cleaned = subject
    .replace(/^\s*🗓\s*/u, '')
    .replace(/\s*\|\s*Read Meeting Report\s*$/i, '')
    .trim();
  const m = cleaned.match(/^(.*)\s+on\s+([A-Za-z]+ \d{1,2}, \d{4})\s+@\s+.+$/);
  if (!m) return null;
  const title = (m[1] ?? '').trim();
  const dateStr = m[2] ?? '';
  if (!title) return null;
  // The email date is the meeting's local (Berlin) calendar day. Store it at noon UTC of
  // that day so the repo's Berlin-date session key stays stable and a later MCP transcript
  // (with the real start time) merges onto the same row.
  const base = new Date(dateStr);
  const meetingDate = Number.isNaN(base.getTime())
    ? null
    : new Date(
        Date.UTC(base.getFullYear(), base.getMonth(), base.getDate(), 12),
      ).toISOString();
  return { title, meetingDate };
}

function deriveCompany(title: string): string | undefined {
  const afterColon = title.includes(':')
    ? title.split(':').slice(1).join(':').trim()
    : title;
  const beforeX = (afterColon.split(/\s+x\s+/i)[0] ?? '').trim();
  return beforeX || undefined;
}

// Walk the MIME tree, return the text/plain body (base64url) decoded.
function extractPlainText(payload: GmailMessage['payload']): string {
  let out = '';
  const walk = (part?: GmailPart) => {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      out += Buffer.from(part.body.data, 'base64').toString('utf8');
    }
    (part.parts ?? []).forEach(walk);
  };
  if (payload?.body?.data && payload.mimeType === 'text/plain') {
    out += Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  (payload?.parts ?? []).forEach(walk);
  return out;
}

// Pull the leading summary paragraph out of the report email, dropping Read AI's
// invisible filler chars and the free-plan boilerplate footer.
function extractSummary(plain: string): string {
  const body = plain
    .replace(/[͏‌​‍‎‏­﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = body.search(/No meetings left|Upgrade \(|Read Free plan/i);
  const summary = (cut > 40 ? body.slice(0, cut) : body).trim();
  return summary.slice(0, 800);
}
