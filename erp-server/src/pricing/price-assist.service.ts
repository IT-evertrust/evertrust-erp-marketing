import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@evertrust/db';
import {
  PRICE_ASSIST_LOW_CONFIDENCE,
  type PriceAssistResultDto,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { ClaudeService } from '../ai/claude.service';
import { PricingTenantService } from './pricing-tenant.service';

type LineItemRow = typeof schema.lineItems.$inferSelect;
type TenderRow = typeof schema.tenders.$inferSelect;

// The structured shape Claude MUST return (validated server-side). unitPrice is the
// estimated price for ONE `unit` of the line, in EUR; confidence 0–1; rationale +
// assumptions explain the basis. This is the Claude↔API contract (not api↔web), so
// it lives here, not in @evertrust/shared.
export const PriceAssistModelOutput = z.object({
  unitPrice: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2000),
  assumptions: z.array(z.string().max(300)).max(12).default([]),
});
export type PriceAssistModelOutput = z.infer<typeof PriceAssistModelOutput>;

// JSON Schema for the forced tool call (kept in lockstep with PriceAssistModelOutput
// above). Hand-written to avoid a zod→json-schema dependency.
const PRICE_ASSIST_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    unitPrice: {
      type: 'number',
      description: 'Estimated price in EUR for ONE unit of the line. Non-negative.',
    },
    confidence: {
      type: 'number',
      description:
        '0–1 confidence in the estimate given the evidence and how specific the line is. Be honest: vague lines with no evidence are low confidence.',
    },
    rationale: {
      type: 'string',
      description: '1–3 sentences explaining the basis for the estimate.',
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key assumptions you made (materials, scope, region, etc.).',
    },
  },
  required: ['unitPrice', 'confidence', 'rationale', 'assumptions'],
};

const SYSTEM_PROMPT =
  'You are a German public-procurement (VOB/VgV/UVgO) cost estimator for Evertrust GmbH. ' +
  'You estimate the unit price for a single tender line item (an LV position) in EUR. ' +
  'You are ASSISTING a human pricer: your number is a starting estimate to fill a gap, never a final or binding price. ' +
  'Be conservative, use the line text + any recorded price evidence, and be explicit about every assumption. ' +
  'If the line is vague or you have no evidence, say so via a LOW confidence score. ' +
  'Always answer by calling the suggest_price tool.';

function orDash(v: string | null | undefined): string {
  return v && v.trim().length > 0 ? v : '—';
}

// Build the (system, user) prompt for one line item from its row, the owning tender
// and its recorded price observations. PURE + exported so it is unit-testable and so
// the exact context sent to Claude is auditable.
export function buildPriceAssistPrompt(input: {
  line: Pick<
    LineItemRow,
    'position' | 'description' | 'longText' | 'qty' | 'unit' | 'spec' | 'brand' | 'std'
  >;
  tender: Pick<
    TenderRow,
    'title' | 'buyer' | 'regime' | 'location' | 'niche' | 'currency'
  >;
  observations: { source: string; price: string; note: string | null }[];
}): { system: string; prompt: string } {
  const { line, tender, observations } = input;
  const evidence =
    observations.length === 0
      ? 'None recorded.'
      : observations
          .map(
            (o) =>
              `- ${o.source}: ${o.price} ${tender.currency}${o.note ? ` (${o.note})` : ''}`,
          )
          .join('\n');

  const prompt = [
    `Estimate the unit price (per ${orDash(line.unit)}) for this tender line item.`,
    '',
    'TENDER',
    `- Title: ${orDash(tender.title)}`,
    `- Buyer: ${orDash(tender.buyer)}`,
    `- Regime: ${orDash(tender.regime)}`,
    `- Location: ${orDash(tender.location)}`,
    `- Niche: ${orDash(tender.niche)}`,
    '',
    'LINE ITEM',
    `- Position: ${orDash(line.position)}`,
    `- Description: ${orDash(line.description)}`,
    `- Long text: ${orDash(line.longText)}`,
    `- Quantity: ${orDash(line.qty)} ${orDash(line.unit)}`,
    `- Spec: ${orDash(line.spec)}`,
    `- Brand: ${orDash(line.brand)}`,
    `- Standard: ${orDash(line.std)}`,
    '',
    'EXISTING PRICE EVIDENCE (most recent first)',
    evidence,
    '',
    `Return the unit price in EUR per ${orDash(line.unit)}, your confidence (0–1), a short rationale, and your assumptions.`,
  ].join('\n');

  return { system: SYSTEM_PROMPT, prompt };
}

// Phase 5b — Claude price-assist. Produces a price SUGGESTION for one line item and
// logs the model run to ai_runs (cost/quality observability). It NEVER mutates
// pricing: the human reviews the suggestion and, if they accept, records it as an
// AI_ESTIMATE observation through the normal evidence path (so the line stays
// unbacked/RED until a real quote backs it). The HTTP call never 500s on an
// operational model failure — that surfaces as { configured:true, error } so the UI
// can show it (failures are exposed, not hidden).
@Injectable()
export class PriceAssistService {
  private readonly logger = new Logger(PriceAssistService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly claude: ClaudeService,
    private readonly tenant: PricingTenantService,
  ) {}

  async suggest(orgId: string, lineItemId: string): Promise<PriceAssistResultDto> {
    // Tenancy first: 404 if the line / its tender isn't in the caller's org.
    const line = await this.tenant.requireLineItem(orgId, lineItemId);

    // Blank API key → feature disabled. Return a neutral result, never throw.
    if (!this.claude.isConfigured()) {
      return { configured: false, suggestion: null, error: null };
    }

    const tender = await this.tenant.requireTender(orgId, line.tenderId);
    const observations = await this.db
      .select({
        source: schema.priceObservations.source,
        price: schema.priceObservations.price,
        note: schema.priceObservations.note,
      })
      .from(schema.priceObservations)
      .where(eq(schema.priceObservations.lineItemId, lineItemId))
      .orderBy(desc(schema.priceObservations.observedAt))
      .limit(20);

    const { system, prompt } = buildPriceAssistPrompt({
      line,
      tender,
      observations,
    });

    try {
      const { data, usage } = await this.claude.structured({
        system,
        prompt,
        toolName: 'suggest_price',
        toolDescription:
          'Return a unit-price estimate (EUR) for the line item with a confidence, rationale and assumptions.',
        schema: PriceAssistModelOutput,
        jsonSchema: PRICE_ASSIST_JSON_SCHEMA,
        maxTokens: 1024,
      });

      const lowConfidence = data.confidence < PRICE_ASSIST_LOW_CONFIDENCE;

      // Log the run to ai_runs (cost + confidence ledger). escalated = weak
      // suggestion → a human should seek a real quote.
      await this.db.insert(schema.aiRuns).values({
        organizationId: orgId,
        tenderId: line.tenderId,
        taskType: 'price-assist',
        model: usage.model,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        eurCost: usage.eurCost.toFixed(6),
        confidence: data.confidence.toFixed(3),
        escalated: lowConfidence,
      });

      return {
        configured: true,
        suggestion: {
          unitPrice: data.unitPrice.toFixed(2),
          currency: tender.currency,
          confidence: data.confidence,
          rationale: data.rationale,
          assumptions: data.assumptions ?? [],
          lowConfidence,
          model: usage.model,
        },
        error: null,
      };
    } catch (err) {
      // Operational model failure (network / non-2xx / bad output). Expose it; the
      // UI shows the message. No ai_runs row (no usage to record).
      const message =
        err instanceof Error ? err.message : 'Claude price-assist failed';
      this.logger.warn(`price-assist failed for line ${lineItemId}: ${message}`);
      return { configured: true, suggestion: null, error: message };
    }
  }
}
