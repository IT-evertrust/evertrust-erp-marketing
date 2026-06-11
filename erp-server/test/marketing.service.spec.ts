import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MarketingService } from '../src/marketing/marketing.service';

function svc(apiUrl = 'https://n8n.test') {
  const config = {
    get: (k: string) => (k === 'N8N_API_URL' ? apiUrl : ''),
  } as unknown as ConfigService;
  return new MarketingService(config);
}

describe('MarketingService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('lists reviewable RAG drafts via the erp-rag-drafts webhook', async () => {
    const service = svc();
    let calledUrl = '';
    global.fetch = (async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          count: 1,
          drafts: [
            {
              draftId: 'r123',
              clientEmail: 'a@b.com',
              company: 'Code & Pepper',
              subject: 'Re: pricing',
              body: 'Dear ...',
              unsureArea: 'finance',
              source: 'leads-sheet',
              status: 'PENDING',
              sendable: true,
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const r = await service.listDrafts();
    expect(calledUrl).toBe('https://n8n.test/webhook/erp-rag-drafts');
    expect(r.configured).toBe(true);
    expect(r.count).toBe(1);
    expect(r.drafts[0]).toMatchObject({
      draftId: 'r123',
      company: 'Code & Pepper',
      sendable: true,
    });
  });

  it('returns configured:false (not an error) when N8N_API_URL is unset', async () => {
    const service = svc('');
    const r = await service.listDrafts();
    expect(r).toEqual({ configured: false, count: 0, drafts: [] });
  });

  it('throws ServiceUnavailable when the drafts webhook returns non-200', async () => {
    const service = svc();
    global.fetch = (async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(service.listDrafts()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('POSTs the (edited) reply to erp-rag-send and maps the result', async () => {
    const service = svc();
    let calledUrl = '';
    let sentBody: unknown = null;
    global.fetch = (async (url: string, init: RequestInit) => {
      calledUrl = url;
      sentBody = JSON.parse(String(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 'SENT',
          draftId: 'r123',
          to: 'a@b.com',
          sentMessageId: 'msg-9',
        }),
      };
    }) as unknown as typeof fetch;

    const r = await service.send({
      draftId: 'r123',
      to: 'a@b.com',
      subject: 'Re: pricing',
      body: 'Edited reply',
    });
    expect(calledUrl).toBe('https://n8n.test/webhook/erp-rag-send');
    expect(sentBody).toMatchObject({ draftId: 'r123', body: 'Edited reply' });
    expect(r).toMatchObject({ ok: true, status: 'SENT', sentMessageId: 'msg-9' });
  });

  it('send throws ServiceUnavailable when N8N_API_URL is unset', async () => {
    const service = svc('');
    await expect(
      service.send({ draftId: 'r1', to: 'a@b.com', subject: '', body: 'x' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('scanLeads POSTs the erp-rag-scan webhook and confirms it started', async () => {
    const service = svc();
    let calledUrl = '';
    let method = '';
    global.fetch = (async (url: string, init: RequestInit) => {
      calledUrl = url;
      method = String(init.method);
      return { ok: true, status: 200, json: async () => ({ message: 'Workflow was started' }) };
    }) as unknown as typeof fetch;

    const r = await service.scanLeads();
    expect(calledUrl).toBe('https://n8n.test/webhook/erp-rag-scan');
    expect(method).toBe('POST');
    expect(r.ok).toBe(true);
  });

  it('scanLeads throws ServiceUnavailable when N8N_API_URL is unset', async () => {
    const service = svc('');
    await expect(service.scanLeads()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
