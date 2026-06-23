import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MarketingDraftDto,
  MarketingDraftListDto,
  ScanLeadsResultDto,
  SendDraftDto,
  SendDraftResultDto,
} from '@evertrust/shared';

// Marketing · RAG Draft Review. The EVERTRUST - RAG AGENT workflow drafts
// replies to "Unsure" leads (grounded in a knowledge file) and saves a Gmail
// draft "Do Not Send"; on approve it sends the (possibly edited) reply, deletes
// the stale draft and marks the row SENT. The ERP has no Google/Gmail creds, so
// it proxies the workflow's read (erp-rag-drafts), send (erp-rag-send) and
// scan (erp-rag-scan) webhooks — same host as N8N_API_URL.
const DRAFTS_WEBHOOK_PATH = 'erp-rag-drafts';
const SEND_WEBHOOK_PATH = 'erp-rag-send';
const SCAN_WEBHOOK_PATH = 'erp-rag-scan';
const REQUEST_TIMEOUT_MS = 20000;

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);
  constructor(private readonly config: ConfigService) {}

  // Reviewable drafts awaiting human approval. Degrades to an empty list (not an
  // error) when the source isn't configured, so the page renders cleanly.
  async listDrafts(): Promise<MarketingDraftListDto> {
    const url = this.draftsUrl();
    if (!url) return { configured: false, count: 0, drafts: [] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Draft list returned HTTP ${res.status}.`,
        );
      }
      const json = (await res.json()) as { drafts?: unknown };
      const raw = Array.isArray(json?.drafts) ? json.drafts : [];
      const drafts = raw.map((r) =>
        this.normalize((r ?? {}) as Record<string, unknown>),
      );
      return { configured: true, count: drafts.length, drafts };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `drafts GET ${url} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      throw new ServiceUnavailableException(
        'Draft list call failed — check that the RAG Agent workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // Approve & send a reviewed draft (real client email). The webhook validates,
  // sends via Gmail, deletes the stale draft and marks the row SENT.
  async send(input: SendDraftDto): Promise<SendDraftResultDto> {
    const url = this.sendUrl();
    if (!url) {
      throw new ServiceUnavailableException(
        'Draft send is not configured (set N8N_API_URL).',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Draft send returned HTTP ${res.status}.`,
        );
      }
      const s = (v: unknown) => (typeof v === 'string' && v.length ? v : null);
      return {
        ok: json.ok === true,
        status: s(json.status),
        draftId: s(json.draftId),
        to: s(json.to),
        sentMessageId: s(json.sentMessageId),
        error: s(json.error),
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `send POST ${url} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      throw new ServiceUnavailableException(
        'Draft send call failed — check that the RAG Agent workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // "Sync from leads": kick the RAG Agent to Drive-scan every campaign's `leads`
  // sheet for Status=unsure rows and draft replies. The webhook is onReceived
  // (returns immediately, drafts run async), so we just confirm it started.
  async scanLeads(): Promise<ScanLeadsResultDto> {
    const url = this.scanUrl();
    if (!url) {
      throw new ServiceUnavailableException(
        'Lead scan is not configured (set N8N_API_URL).',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ source: 'erp' }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `Lead scan returned HTTP ${res.status}.`,
        );
      }
      return {
        ok: true,
        message: 'Scan started — new drafts will appear in the queue shortly.',
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `scan POST ${url} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      throw new ServiceUnavailableException(
        'Lead scan call failed — check that the RAG Agent workflow is active.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalize(r: Record<string, unknown>): MarketingDraftDto {
    const s = (v: unknown) => (typeof v === 'string' && v.length ? v : null);
    return {
      draftId: s(r.draftId),
      messageId: s(r.messageId),
      threadId: s(r.threadId),
      clientEmail: s(r.clientEmail),
      company: s(r.company),
      leadQuestion: s(r.leadQuestion),
      unsureArea: s(r.unsureArea),
      unsureSection: s(r.unsureSection),
      explanation: s(r.explanation),
      subject: s(r.subject),
      body: s(r.body),
      source: s(r.source),
      status: s(r.status),
      createdAt: s(r.createdAt),
      sendable: r.sendable === true,
    };
  }

  private draftsUrl(): string {
    return this.urlFor('N8N_RAG_DRAFTS_WEBHOOK_URL', DRAFTS_WEBHOOK_PATH);
  }
  private sendUrl(): string {
    return this.urlFor('N8N_RAG_SEND_WEBHOOK_URL', SEND_WEBHOOK_PATH);
  }
  private scanUrl(): string {
    return this.urlFor('N8N_RAG_SCAN_WEBHOOK_URL', SCAN_WEBHOOK_PATH);
  }
  // Explicit override env var, else derive from the n8n instance base.
  private urlFor(envKey: string, path: string): string {
    const explicit = (this.config.get(envKey) ?? '').trim();
    if (explicit) return explicit;
    const base = (this.config.get('N8N_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    return base ? `${base}/webhook/${path}` : '';
  }
}
