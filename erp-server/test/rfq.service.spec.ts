import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { RfqService } from '../src/rfq/rfq.service';
import { PricingTenantService } from '../src/pricing/pricing-tenant.service';
import type { AppConfigService } from '../src/config/app-config.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T_A = 'a1111111-1111-1111-1111-111111111111'; // org A
const T_B = 'b2222222-2222-2222-2222-222222222222'; // org B
const S1 = 'c1111111-1111-1111-1111-111111111111'; // org A supplier
const S2 = 'c2222222-2222-2222-2222-222222222222'; // org A supplier
const S3 = 'c3333333-3333-3333-3333-333333333333'; // org B supplier
const LI_A = 'd1111111-1111-1111-1111-111111111111'; // line on T_A
const LI_B = 'd2222222-2222-2222-2222-222222222222'; // line on T_B
const USER = 'e1111111-1111-1111-1111-111111111111';
const HERMES_URL = 'https://evertrustgmbh.app.n8n.cloud/webhook/hermes-rfq-request';

function makeConfig(urls: Record<string, string>): AppConfigService {
  return { get: (k: string) => urls[k] ?? '' } as unknown as AppConfigService;
}

function seed(urls: Record<string, string> = {}) {
  const tenders = new FakeTable([
    {
      id: T_A,
      organizationId: ORG_A,
      vergabeId: 'EXT-A',
      source: 'PORTAL',
      title: 'Org A tender',
      buyer: 'Stadt X',
      regime: 'VOB_A',
      location: 'Berlin',
      status: 'PIC_PRICING',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      __seq: 1,
    },
    {
      id: T_B,
      organizationId: ORG_B,
      vergabeId: 'EXT-B',
      source: 'PORTAL',
      title: 'Org B tender',
      status: 'PIC_PRICING',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      __seq: 2,
    },
  ]);
  const suppliers = new FakeTable([
    { id: S1, organizationId: ORG_A, name: 'Alpha GmbH', contact: 'a@x.de', niches: [], capabilities: [], fitScore: null, createdAt: new Date(), __seq: 1 },
    { id: S2, organizationId: ORG_A, name: 'Beta AG', contact: null, niches: [], capabilities: [], fitScore: null, createdAt: new Date(), __seq: 2 },
    { id: S3, organizationId: ORG_B, name: 'Gamma KG', contact: null, niches: [], capabilities: [], fitScore: null, createdAt: new Date(), __seq: 3 },
  ]);
  const lineItems = new FakeTable([
    { id: LI_A, tenderId: T_A, position: '01', description: 'LED panel', qty: '10', unit: 'pcs', longText: null, spec: null, brand: null, std: null, bidEp: null, bidGp: null, sourceDocId: null, parentId: null, __seq: 1 },
    { id: LI_B, tenderId: T_B, position: '01', description: 'Cable', qty: '5', unit: 'm', longText: null, spec: null, brand: null, std: null, bidEp: null, bidGp: null, sourceDocId: null, parentId: null, __seq: 2 },
  ]);
  const rfqs = new FakeTable([]);

  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.suppliers, suppliers],
      [schema.lineItems, lineItems],
      [schema.rfqs, rfqs],
    ]),
  );
  const service = new RfqService(db, makeConfig(urls), new PricingTenantService(db));
  return { service, rfqs };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('RfqService — dispatch (Phase 5c Hermes RFQ)', () => {
  it('fires the Hermes webhook with tender+supplier+line context and records DISPATCHED', async () => {
    const { service, rfqs } = seed({ N8N_HERMES_RFQ_WEBHOOK_URL: HERMES_URL });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const row = await service.create(ORG_A, T_A, USER, {
      supplierIds: [S1, S2],
      lineItemIds: [LI_A],
      note: 'Please quote',
    });

    // The webhook was POSTed with the RFQ context.
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(HERMES_URL);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toMatchObject({
      tender: { id: T_A, currency: 'EUR' },
      suppliers: [{ id: S1, name: 'Alpha GmbH' }, { id: S2, name: 'Beta AG' }],
      lineItems: [{ id: LI_A, position: '01' }],
      note: 'Please quote',
    });

    // The dispatch was recorded.
    expect(row).toMatchObject({
      organizationId: ORG_A,
      tenderId: T_A,
      supplierIds: [S1, S2],
      lineItemIds: [LI_A],
      note: 'Please quote',
      status: 'DISPATCHED',
      dispatchedBy: USER,
    });
    expect(row.detail).toContain('200');
    expect(rfqs.rows).toHaveLength(1);
  });

  it('records FAILED on a non-2xx webhook response (never throws)', async () => {
    const { service, rfqs } = seed({ N8N_HERMES_RFQ_WEBHOOK_URL: HERMES_URL });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 502 }) as unknown as typeof fetch;

    const row = await service.create(ORG_A, T_A, USER, { supplierIds: [S1] });

    expect(row.status).toBe('FAILED');
    expect(row.detail).toContain('502');
    expect(rfqs.rows).toHaveLength(1); // still recorded — observable
  });

  it('records FAILED on a network error (never throws)', async () => {
    const { service } = seed({ N8N_HERMES_RFQ_WEBHOOK_URL: HERMES_URL });
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('socket hang up')) as unknown as typeof fetch;

    const row = await service.create(ORG_A, T_A, USER, { supplierIds: [S1] });

    expect(row.status).toBe('FAILED');
    expect(row.detail).toContain('socket hang up');
  });

  it('rejects when Hermes is not configured (blank URL) and records nothing', async () => {
    const { service, rfqs } = seed({});
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      service.create(ORG_A, T_A, USER, { supplierIds: [S1] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rfqs.rows).toHaveLength(0);
  });

  it('404s when the tender belongs to another org', async () => {
    const { service } = seed({ N8N_HERMES_RFQ_WEBHOOK_URL: HERMES_URL });
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    await expect(
      service.create(ORG_B, T_A, USER, { supplierIds: [S3] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400s when a supplier is not in the org', async () => {
    const { service } = seed({ N8N_HERMES_RFQ_WEBHOOK_URL: HERMES_URL });
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    // S3 belongs to ORG_B — foreign to this ORG_A RFQ.
    await expect(
      service.create(ORG_A, T_A, USER, { supplierIds: [S1, S3] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s when a chosen line item is not on the tender', async () => {
    const { service } = seed({ N8N_HERMES_RFQ_WEBHOOK_URL: HERMES_URL });
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    // LI_B is on T_B, not T_A.
    await expect(
      service.create(ORG_A, T_A, USER, { supplierIds: [S1], lineItemIds: [LI_B] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RfqService — list', () => {
  it('lists the tender’s RFQs and 404s across orgs', async () => {
    const { service } = seed({ N8N_HERMES_RFQ_WEBHOOK_URL: HERMES_URL });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    await service.create(ORG_A, T_A, USER, { supplierIds: [S1] });
    const list = await service.list(ORG_A, T_A);
    expect(list).toHaveLength(1);
    expect(list[0]!.tenderId).toBe(T_A);

    await expect(service.list(ORG_B, T_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
