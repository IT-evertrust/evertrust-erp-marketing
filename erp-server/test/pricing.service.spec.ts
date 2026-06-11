import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { PricingTenantService } from '../src/pricing/pricing-tenant.service';
import { LineItemsService } from '../src/pricing/line-items.service';
import { ObservationsService } from '../src/pricing/observations.service';
import { PricingService } from '../src/pricing/pricing.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T_A = 'a1111111-1111-1111-1111-111111111111'; // org A, PIC_PRICING
const T_B = 'b2222222-2222-2222-2222-222222222222'; // org B
const LI_A = 'c1111111-1111-1111-1111-111111111111'; // line item on T_A
const USER = 'd1111111-1111-1111-1111-111111111111';

// Seed two tenders (one per org) + one line item under the org-A tender. Each
// table is keyed by the Drizzle table object identity, exactly as the services
// query them.
function seed() {
  const tenders = new FakeTable([
    {
      id: T_A,
      organizationId: ORG_A,
      vergabeId: 'EXT-A',
      source: 'PORTAL',
      title: 'Org A tender',
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
  const lineItems = new FakeTable([
    {
      id: LI_A,
      tenderId: T_A,
      sourceDocId: null,
      parentId: null,
      position: '01',
      description: 'LED panel',
      longText: null,
      qty: '10',
      unit: 'pcs',
      spec: null,
      brand: null,
      std: null,
      bidEp: null,
      bidGp: null,
      __seq: 1,
    },
  ]);
  const priceObservations = new FakeTable([]);
  const pricings = new FakeTable([]);

  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.lineItems, lineItems],
      [schema.priceObservations, priceObservations],
      [schema.pricings, pricings],
    ]),
  );
  const tenant = new PricingTenantService(db);
  return {
    db,
    tenant,
    lineItems: new LineItemsService(db, tenant),
    observations: new ObservationsService(db, tenant),
    pricing: new PricingService(db, tenant),
    tables: { tenders, lineItems, priceObservations, pricings },
  };
}

describe('PricingTenantService — cross-org isolation', () => {
  // WHY: line_items/observations/pricings carry NO organizationId; tenancy is
  // enforced via the owning tender. A cross-org access must be a 404, not a leak.
  it('requireTender 404s for another org tender', async () => {
    const { tenant } = seed();
    await expect(tenant.requireTender(ORG_A, T_B)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('requireTender returns the tender for its owning org', async () => {
    const { tenant } = seed();
    expect((await tenant.requireTender(ORG_A, T_A)).id).toBe(T_A);
  });

  it('requireLineItem 404s when the caller is not the owning org', async () => {
    const { tenant } = seed();
    await expect(tenant.requireLineItem(ORG_B, LI_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('line-item list 404s across orgs (no cross-org read)', async () => {
    const { lineItems } = seed();
    await expect(lineItems.list(ORG_B, T_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('LineItemsService — server-derived bidGp', () => {
  // WHY: bidGp = qty * bidEp is OWNED by the server; the client never sets it.
  it('computes bidGp on create from qty*bidEp', async () => {
    const { lineItems } = seed();
    const row = await lineItems.create(ORG_A, T_A, {
      position: '02',
      description: 'Cable',
      qty: '4',
      unit: 'm',
      bidEp: '2.5',
    });
    expect(row.bidGp).toBe('10'); // 4 * 2.5
  });

  it('recomputes bidGp on update when bidEp changes (qty from existing row)', async () => {
    const { lineItems } = seed();
    // LI_A has qty 10, bidEp null -> set bidEp 7 -> bidGp 70.
    const { after } = await lineItems.update(ORG_A, LI_A, { bidEp: '7' });
    expect(after.bidEp).toBe('7');
    expect(after.bidGp).toBe('70');
  });
});

describe('PricingService — engine integration + totals', () => {
  // WHY: the GET view must reflect the engine (suggested/confidence/signal) and
  // roll up subtotal=Σ bidGp + risk + signal histogram.
  it('computes per-line pricing, subtotal and signal counts', async () => {
    const ctx = seed();
    // Price LI_A: qty 10 * bidEp 9 = bidGp 90.
    await ctx.lineItems.update(ORG_A, LI_A, { bidEp: '9' });
    // One supplier quote -> REAL_QUOTES / backed.
    await ctx.observations.create(ORG_A, LI_A, USER, {
      source: 'SUPPLIER_QUOTE',
      price: '88',
    });

    const view = await ctx.pricing.getPricing(ORG_A, T_A);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.suggestedPrice).toBe(88);
    expect(view.lines[0]!.signal).toBe('REAL_QUOTES');
    expect(view.lines[0]!.observationCount).toBe(1);
    expect(view.subtotal).toBe('90');
    expect(view.signalCounts).toEqual({
      REAL_QUOTES: 1,
      MIXED: 0,
      ESTIMATE_ONLY: 0,
    });
    expect(view.highRisk).toBe(false);
  });

  it('upsert recomputes subtotal/finalPrice from the margin and resets DRAFT', async () => {
    const ctx = seed();
    await ctx.lineItems.update(ORG_A, LI_A, { bidEp: '10' }); // bidGp 100
    const { before, after } = await ctx.pricing.upsertPricing(ORG_A, T_A, 20);
    expect(before).toBeNull();
    expect(after.subtotal).toBe('100');
    expect(after.finalPrice).toBe('120'); // 100 * 1.2
    expect(after.status).toBe('DRAFT');
  });

  it('upsert 404s for another org tender', async () => {
    const { pricing } = seed();
    await expect(pricing.upsertPricing(ORG_B, T_A, 10)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PricingService — finalize', () => {
  // WHY: finalize sets pricings FINAL + decidedBy AND advances the tender
  // PIC_PRICING -> CUSTOMER_PRICING through the shared state machine.
  it('finalizes and transitions PIC_PRICING -> CUSTOMER_PRICING', async () => {
    const ctx = seed();
    await ctx.lineItems.update(ORG_A, LI_A, { bidEp: '10' });
    await ctx.pricing.upsertPricing(ORG_A, T_A, 0);

    const { after } = await ctx.pricing.finalize(ORG_A, T_A, USER);
    expect(after.pricing.status).toBe('FINAL');
    expect(after.pricing.decidedBy).toBe(USER);
    expect(after.status).toBe('CUSTOMER_PRICING');
    // The tender row itself was advanced.
    expect((await ctx.tenant.requireTender(ORG_A, T_A)).status).toBe(
      'CUSTOMER_PRICING',
    );
  });

  it('404s finalize when there is no pricing row yet', async () => {
    const ctx = seed();
    await expect(ctx.pricing.finalize(ORG_A, T_A, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('400s finalize from a state that cannot reach CUSTOMER_PRICING', async () => {
    const ctx = seed();
    await ctx.pricing.upsertPricing(ORG_A, T_A, 0);
    // Move the tender to DOCUMENTS (legal from PIC_PRICING); CUSTOMER_PRICING is
    // NOT reachable from DOCUMENTS, so finalize must 400.
    ctx.tables.tenders.rows[0]!.status = 'DOCUMENTS';
    await expect(ctx.pricing.finalize(ORG_A, T_A, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
