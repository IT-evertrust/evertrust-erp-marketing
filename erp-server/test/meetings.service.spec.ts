import type { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { MeetingsService } from '../src/meetings/meetings.service';
import { getDb, rowsOf, seed } from './real-db';

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
// Real UUIDs (the real `uuid` PK rejects 'm1'/'c1'); reused where a test asserts
// on the id or passes it as a campaign reference.
const M1 = 'a1111111-1111-1111-1111-111111111111';
const M2 = 'a2222222-2222-2222-2222-222222222222';
const C1 = 'c1111111-1111-1111-1111-111111111111';
const NICHE_C = 'cccccccc-1111-1111-1111-cccccccccccc';
// An absent-but-valid uuid for "unknown meeting" lookups.
const ABSENT = 'f9999999-9999-9999-9999-999999999999';

async function svc() {
  // m1 newer (2026-06-03) than m2 (2026-05-28); list() ORDER BY created_at DESC
  // → [m1, m2]. Explicit createdAt keeps that order deterministic.
  await seed(schema.meetings, [
    {
      id: M1,
      organizationId: ORG,
      sessionId: 's1',
      clientCompany: 'Kodeca',
      aeName: 'Hanna',
      clientContact: 'Vic',
      clientEmail: 'vic@kodeca.de',
      persona: 'Alex Hormozi',
      score: 65,
      campaignId: C1,
      matchMethod: 'email',
      analysis: { overall_summary: 'x' },
      transcript: '[00:00] Hanna: hello\n[00:05] Vic: hi',
      docUrl: 'https://docs.google.com/document/d/DOC1/edit',
      meetingDate: '2026-06-03',
      createdAt: new Date('2026-06-03T00:00:00Z'),
    },
    {
      id: M2,
      organizationId: ORG,
      sessionId: 's2',
      clientCompany: 'Rhein-Main Logistik',
      aeName: 'Lena',
      clientContact: 'Stefan',
      clientEmail: 's.adler@rm.de',
      persona: 'Alex Hormozi',
      score: 42,
      campaignId: null,
      matchMethod: null,
      analysis: {},
      meetingDate: '2026-05-28',
      createdAt: new Date('2026-05-28T00:00:00Z'),
    },
  ]);
  // campaigns has NOT-NULL columns with no default (nicheId/country/region/
  // project/gmailLabel/whatsappNumber); FK is off so nicheId need not resolve.
  await seed(schema.campaigns, [
    {
      id: C1,
      organizationId: ORG,
      name: 'LED Retrofit Berlin 2026',
      nicheId: NICHE_C,
      country: 'DE',
      region: 'Berlin',
      project: 'LED',
      gmailLabel: 'LED',
      whatsappNumber: '+490000000',
    },
  ]);
  await seed(schema.personas, [
    {
      organizationId: ORG,
      name: 'Alex Hormozi',
      systemPrompt: 'Coach.',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ]);
  const config = {
    get: (k: string) => (k === 'N8N_API_URL' ? 'https://n8n.test' : ''),
  } as unknown as ConfigService;
  return { service: new MeetingsService(getDb(), config) };
}

describe('MeetingsService.list', () => {
  it('returns all meetings (newest first) with the campaign name joined', async () => {
    const { service } = await svc();
    const r = await service.list(ORG);
    expect(r.map((x) => x.id)).toEqual([M1, M2]);
    expect(r[0]!.campaignName).toBe('LED Retrofit Berlin 2026');
    expect(r[1]!.campaignName).toBeNull();
  });

  it('filters to Unattributed', async () => {
    const { service } = await svc();
    const r = await service.list(ORG, { campaignId: 'none' });
    expect(r.map((x) => x.id)).toEqual([M2]);
  });

  it('filters by campaign and by search', async () => {
    const { service } = await svc();
    expect((await service.list(ORG, { campaignId: C1 })).map((x) => x.id)).toEqual([M1]);
    expect((await service.list(ORG, { search: 'rhein' })).map((x) => x.id)).toEqual([M2]);
    expect((await service.list(ORG, { ae: 'Hanna' })).map((x) => x.id)).toEqual([M1]);
  });
});

describe('MeetingsService.link', () => {
  it('links a meeting to a campaign (manual) and returns the name', async () => {
    const { service } = await svc();
    const m = await service.link(ORG, M2, C1);
    expect(m.campaignId).toBe(C1);
    expect(m.matchMethod).toBe('manual');
    expect(m.campaignName).toBe('LED Retrofit Berlin 2026');
  });

  it('404s for an unknown meeting', async () => {
    const { service } = await svc();
    await expect(service.link(ORG, ABSENT, C1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('MeetingsService.analyze', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('runs the persona analysis (via the n8n workflow) and stores it', async () => {
    const { service } = await svc();
    let postedTo = '';
    let body: unknown = null;
    global.fetch = (async (url: string, init: { body: string }) => {
      postedTo = url;
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          overall_summary: 'ok',
          performance_score: { overall: { score: 80 } },
        }),
      };
    }) as unknown as typeof fetch;

    const m = await service.analyze(ORG, M1, 'Kanye West');
    expect(postedTo).toBe('https://n8n.test/webhook/erp-sales-analyze');
    expect(body).toMatchObject({ persona: 'Kanye West' });
    expect(m.persona).toBe('Kanye West');
    expect(m.score).toBe(80);
    expect(m.hasTranscript).toBe(true);
  });

  it('rejects when the meeting has no stored transcript', async () => {
    const { service } = await svc();
    await expect(service.analyze(ORG, M2, 'Alex Hormozi')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s for an unknown meeting', async () => {
    const { service } = await svc();
    await expect(
      service.analyze(ORG, ABSENT, 'Alex Hormozi'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MeetingsService.sync (from Drive folder)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('mirrors the folder: updates matched docs, prunes meetings whose doc is gone', async () => {
    const { service } = await svc();
    let calledUrl = '';
    global.fetch = (async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          meetings: [
            {
              docId: 'DOC1',
              docName: 'The Codest - Sales Coach Report',
              docUrl: 'https://docs.google.com/document/d/DOC1/edit',
              clientCompany: 'The Codest',
              aeName: 'Hanna',
              persona: 'Alex Hormozi',
              summary: 'ok',
              strengthsText: '1. Anchor High\n   ...',
              performance: { overall: 68, communication: 75 },
              client: { overall: 70 },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const r = await service.sync(ORG);
    expect(calledUrl).toBe('https://n8n.test/webhook/erp-sales-meetings');
    expect(r).toMatchObject({ configured: true, scanned: 1, imported: 0, updated: 1, pruned: 1 });

    // m1 (docUrl → DOC1) updated to the folder doc; m2 (no docUrl) pruned.
    const rows = await rowsOf(schema.meetings);
    const m1 = rows.find((m) => m.id === M1)!;
    expect(m1.score).toBe(68);
    expect(m1.clientCompany).toBe('The Codest');
    expect(rows.find((m) => m.id === M2)).toBeUndefined();
  });

  it('reports not-configured when N8N_API_URL is unset', async () => {
    const config = { get: () => '' } as unknown as ConfigService;
    const r = await new MeetingsService(getDb(), config).sync(ORG);
    expect(r.configured).toBe(false);
  });
});

describe('MeetingsService.remove', () => {
  it('deletes a meeting and 404s on an unknown one', async () => {
    const { service } = await svc();
    const r = await service.remove(ORG, M1);
    expect(r.id).toBe(M1);
    await expect(service.remove(ORG, ABSENT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
