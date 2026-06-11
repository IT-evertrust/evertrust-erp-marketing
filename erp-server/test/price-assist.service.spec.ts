import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import {
  PriceAssistService,
  buildPriceAssistPrompt,
  PriceAssistModelOutput,
} from '../src/pricing/price-assist.service';
import { PricingTenantService } from '../src/pricing/pricing-tenant.service';
import type { ClaudeService } from '../src/ai/claude.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T_A = 'a1111111-1111-1111-1111-111111111111';
const LI_A = 'c1111111-1111-1111-1111-111111111111';

// One org-A tender + one line item under it, plus the price_observations and
// ai_runs tables the service touches. Mirrors the pricing.service.spec seed.
function seed() {
  const tenders = new FakeTable([
    {
      id: T_A,
      organizationId: ORG_A,
      vergabeId: 'EXT-A',
      source: 'PORTAL',
      title: 'Org A tender',
      buyer: 'Stadt Musterstadt',
      regime: 'VOB_A',
      niche: 'electrical',
      location: 'Berlin',
      status: 'PIC_PRICING',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      __seq: 1,
    },
  ]);
  const lineItems = new FakeTable([
    {
      id: LI_A,
      tenderId: T_A,
      sourceDocId: null,
      parentId: null,
      position: '01',
      description: 'LED panel 60x60',
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
  const aiRuns = new FakeTable([]);

  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.lineItems, lineItems],
      [schema.priceObservations, priceObservations],
      [schema.aiRuns, aiRuns],
    ]),
  );
  const tenant = new PricingTenantService(db);
  return {
    db,
    tenant,
    tables: { tenders, lineItems, priceObservations, aiRuns },
  };
}

// A configurable stand-in for ClaudeService — no network. We assert the service's
// orchestration (tenancy, ai_runs logging, escalation, graceful failure), not the
// HTTP boundary (that lives in ClaudeService).
function fakeClaude(opts: {
  configured?: boolean;
  result?: {
    unitPrice: number;
    confidence: number;
    rationale: string;
    assumptions: string[];
  };
  throws?: string;
}): ClaudeService {
  return {
    isConfigured: () => opts.configured ?? true,
    model: () => 'claude-test',
    structured: async () => {
      if (opts.throws) throw new Error(opts.throws);
      return {
        data:
          opts.result ?? {
            unitPrice: 123.456,
            confidence: 0.8,
            rationale: 'Based on the spec and market rates.',
            assumptions: ['standard install'],
          },
        usage: {
          model: 'claude-test',
          tokensIn: 1200,
          tokensOut: 80,
          eurCost: 0.0042,
        },
      };
    },
  } as unknown as ClaudeService;
}

describe('PriceAssistService — Phase 5b Claude price-assist', () => {
  it('returns {configured:false} and writes NO ai_runs when Claude is unconfigured', async () => {
    const { db, tenant, tables } = seed();
    const svc = new PriceAssistService(db, fakeClaude({ configured: false }), tenant);

    const res = await svc.suggest(ORG_A, LI_A);

    expect(res).toEqual({ configured: false, suggestion: null, error: null });
    expect(tables.aiRuns.rows).toHaveLength(0);
  });

  it('returns a suggestion and logs ONE ai_runs row on a successful call', async () => {
    const { db, tenant, tables } = seed();
    const svc = new PriceAssistService(
      db,
      fakeClaude({
        result: {
          unitPrice: 123.456,
          confidence: 0.82,
          rationale: 'r',
          assumptions: ['a', 'b'],
        },
      }),
      tenant,
    );

    const res = await svc.suggest(ORG_A, LI_A);

    expect(res.configured).toBe(true);
    expect(res.error).toBeNull();
    expect(res.suggestion).toMatchObject({
      unitPrice: '123.46', // number → toFixed(2) string (money precision)
      currency: 'EUR',
      confidence: 0.82,
      assumptions: ['a', 'b'],
      lowConfidence: false,
      model: 'claude-test',
    });

    expect(tables.aiRuns.rows).toHaveLength(1);
    const run = tables.aiRuns.rows[0]!;
    expect(run).toMatchObject({
      organizationId: ORG_A,
      tenderId: T_A,
      taskType: 'price-assist',
      model: 'claude-test',
      tokensIn: 1200,
      tokensOut: 80,
      escalated: false,
    });
    expect(run.confidence).toBe('0.820'); // numeric(4,3)
    expect(run.eurCost).toBe('0.004200'); // numeric(12,6)
  });

  it('flags a low-confidence suggestion as escalated (run + suggestion)', async () => {
    const { db, tenant, tables } = seed();
    const svc = new PriceAssistService(
      db,
      fakeClaude({
        result: { unitPrice: 50, confidence: 0.3, rationale: 'weak', assumptions: [] },
      }),
      tenant,
    );

    const res = await svc.suggest(ORG_A, LI_A);

    expect(res.suggestion?.lowConfidence).toBe(true);
    expect(tables.aiRuns.rows[0]!.escalated).toBe(true);
  });

  it('surfaces a model failure as {error} — never throws, logs no run', async () => {
    const { db, tenant, tables } = seed();
    const svc = new PriceAssistService(
      db,
      fakeClaude({ throws: 'Claude HTTP 529: overloaded' }),
      tenant,
    );

    const res = await svc.suggest(ORG_A, LI_A);

    expect(res.configured).toBe(true);
    expect(res.suggestion).toBeNull();
    expect(res.error).toContain('529');
    expect(tables.aiRuns.rows).toHaveLength(0);
  });

  it('enforces tenancy FIRST: a cross-org line item 404s even when configured', async () => {
    const { db, tenant } = seed();
    const svc = new PriceAssistService(db, fakeClaude({ configured: true }), tenant);

    await expect(svc.suggest(ORG_B, LI_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('buildPriceAssistPrompt', () => {
  it('includes the line + tender context and a formatted evidence section', () => {
    const { system, prompt } = buildPriceAssistPrompt({
      line: {
        position: '01',
        description: 'LED panel 60x60',
        longText: null,
        qty: '10',
        unit: 'pcs',
        spec: null,
        brand: 'Osram',
        std: null,
      },
      tender: {
        title: 'School refit',
        buyer: 'Stadt X',
        regime: 'VOB_A',
        location: 'Berlin',
        niche: 'electrical',
        currency: 'EUR',
      },
      observations: [{ source: 'AI_ESTIMATE', price: '40.00', note: 'prior run' }],
    });

    expect(system).toContain('suggest_price');
    expect(prompt).toContain('LED panel 60x60');
    expect(prompt).toContain('School refit');
    expect(prompt).toContain('Osram');
    expect(prompt).toContain('AI_ESTIMATE: 40.00 EUR (prior run)');
  });

  it('renders "None recorded." when there is no price evidence', () => {
    const { prompt } = buildPriceAssistPrompt({
      line: {
        position: '01',
        description: 'x',
        longText: null,
        qty: '1',
        unit: 'm',
        spec: null,
        brand: null,
        std: null,
      },
      tender: {
        title: 't',
        buyer: null,
        regime: null,
        location: null,
        niche: null,
        currency: 'EUR',
      },
      observations: [],
    });

    expect(prompt).toContain('None recorded.');
  });
});

describe('PriceAssistModelOutput (Claude↔API contract)', () => {
  it('parses a valid output and defaults assumptions to []', () => {
    const parsed = PriceAssistModelOutput.parse({
      unitPrice: 10,
      confidence: 0.5,
      rationale: 'ok',
    });
    expect(parsed.assumptions).toEqual([]);
  });

  it('rejects an out-of-range confidence', () => {
    expect(() =>
      PriceAssistModelOutput.parse({
        unitPrice: 10,
        confidence: 1.5,
        rationale: 'x',
      }),
    ).toThrow();
  });
});
