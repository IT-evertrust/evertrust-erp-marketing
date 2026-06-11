import type { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { MeetingsService } from '../src/meetings/meetings.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function svc() {
  const meetings = new FakeTable([
    {
      id: 'm1',
      organizationId: ORG,
      sessionId: 's1',
      clientCompany: 'Kodeca',
      aeName: 'Hanna',
      clientContact: 'Vic',
      clientEmail: 'vic@kodeca.de',
      persona: 'Alex Hormozi',
      score: 65,
      campaignId: 'c1',
      matchMethod: 'email',
      analysis: { overall_summary: 'x' },
      transcript: '[00:00] Hanna: hello\n[00:05] Vic: hi',
      docUrl: 'https://docs.google.com/document/d/DOC1/edit',
      meetingDate: '2026-06-03',
      createdAt: new Date('2026-06-03T00:00:00Z'),
      __seq: 2,
    },
    {
      id: 'm2',
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
      __seq: 1,
    },
  ]);
  const campaigns = new FakeTable([
    { id: 'c1', organizationId: ORG, name: 'LED Retrofit Berlin 2026' },
  ]);
  const personas = new FakeTable([
    {
      id: 'p1',
      organizationId: ORG,
      name: 'Alex Hormozi',
      systemPrompt: 'Coach.',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      __seq: 1,
    },
  ]);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.meetings, meetings],
      [schema.campaigns, campaigns],
      [schema.personas, personas],
    ]),
  );
  const config = {
    get: (k: string) => (k === 'N8N_API_URL' ? 'https://n8n.test' : ''),
  } as unknown as ConfigService;
  return { service: new MeetingsService(db, config), meetings };
}

describe('MeetingsService.list', () => {
  it('returns all meetings (newest first) with the campaign name joined', async () => {
    const { service } = svc();
    const r = await service.list(ORG);
    expect(r.map((x) => x.id)).toEqual(['m1', 'm2']);
    expect(r[0]!.campaignName).toBe('LED Retrofit Berlin 2026');
    expect(r[1]!.campaignName).toBeNull();
  });

  it('filters to Unattributed', async () => {
    const { service } = svc();
    const r = await service.list(ORG, { campaignId: 'none' });
    expect(r.map((x) => x.id)).toEqual(['m2']);
  });

  it('filters by campaign and by search', async () => {
    const { service } = svc();
    expect((await service.list(ORG, { campaignId: 'c1' })).map((x) => x.id)).toEqual(['m1']);
    expect((await service.list(ORG, { search: 'rhein' })).map((x) => x.id)).toEqual(['m2']);
    expect((await service.list(ORG, { ae: 'Hanna' })).map((x) => x.id)).toEqual(['m1']);
  });
});

describe('MeetingsService.link', () => {
  it('links a meeting to a campaign (manual) and returns the name', async () => {
    const { service } = svc();
    const m = await service.link(ORG, 'm2', 'c1');
    expect(m.campaignId).toBe('c1');
    expect(m.matchMethod).toBe('manual');
    expect(m.campaignName).toBe('LED Retrofit Berlin 2026');
  });

  it('404s for an unknown meeting', async () => {
    const { service } = svc();
    await expect(service.link(ORG, 'nope', 'c1')).rejects.toBeInstanceOf(
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
    const { service } = svc();
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

    const m = await service.analyze(ORG, 'm1', 'Kanye West');
    expect(postedTo).toBe('https://n8n.test/webhook/erp-sales-analyze');
    expect(body).toMatchObject({ persona: 'Kanye West' });
    expect(m.persona).toBe('Kanye West');
    expect(m.score).toBe(80);
    expect(m.hasTranscript).toBe(true);
  });

  it('rejects when the meeting has no stored transcript', async () => {
    const { service } = svc();
    await expect(service.analyze(ORG, 'm2', 'Alex Hormozi')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s for an unknown meeting', async () => {
    const { service } = svc();
    await expect(
      service.analyze(ORG, 'nope', 'Alex Hormozi'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MeetingsService.sync (from Drive folder)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('mirrors the folder: updates matched docs, prunes meetings whose doc is gone', async () => {
    const { service, meetings } = svc();
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
    const m1 = meetings.rows.find((m) => m.id === 'm1')!;
    expect(m1.score).toBe(68);
    expect(m1.clientCompany).toBe('The Codest');
    expect(meetings.rows.find((m) => m.id === 'm2')).toBeUndefined();
  });

  it('reports not-configured when N8N_API_URL is unset', async () => {
    const meetings = new FakeTable([]);
    const { db } = makeFakeDb(new Map<unknown, FakeTable>([[schema.meetings, meetings]]));
    const config = { get: () => '' } as unknown as ConfigService;
    const r = await new MeetingsService(db, config).sync(ORG);
    expect(r.configured).toBe(false);
  });
});

describe('MeetingsService.remove', () => {
  it('deletes a meeting and 404s on an unknown one', async () => {
    const { service } = svc();
    const r = await service.remove(ORG, 'm1');
    expect(r.id).toBe('m1');
    await expect(service.remove(ORG, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
