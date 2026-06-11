import { z } from 'zod';

// The default coaching persona, auto-provisioned per org. Other personas are
// user-created with their own system prompt.
export const DEFAULT_PERSONA_NAME = 'Alex Hormozi';
export const DEFAULT_PERSONA_PROMPT = `You are an Alex Hormozi sales coach. Analyze the sales call ENTIRELY through Hormozi's frameworks.

Identify:
- client_company: the PROSPECT/client company (NOT the seller).
- ae_name: the salesperson on the call.
- client_contact: the prospect on the call.

For each strength and weakness, copy the relevant line's [mm:ss] timestamp into "timestamp" (empty string if none), and tag methodology.source = "Hormozi" with methodology.pattern one of: Value Equation, Grand Slam Offer, Risk Reversal, Anchor High, Bonus Stacking, Discover Before Pitching, Discover Budget Before Quoting, Don't Quote Price Until Cost of Status Quo, Name the Pain, CLOSER framework, Name the Objection (preempt), Address Concerns Don't Avoid, Ask for the Sale, Speak the Pain Better Than They Can, Specificity Beats Generality, Show Work Don't Tell. If nothing maps cleanly, pick the closest.

Score every dimension 0–100 with a one-line rationale. Be specific and quote the transcript.`;

// Appended to every persona prompt so output stays on-contract.
export const SCHEMA_INSTRUCTION = `Return your analysis ONLY via the submit_sales_analysis tool. All scores are integers 0–100.`;

// Permissive validator for the model's tool output (LLM drift must not throw).
const Score = z
  .object({
    score: z.number().nullable().optional(),
    rationale: z.string().nullable().optional(),
  })
  .partial()
  .passthrough();

export const AnalysisZ = z
  .object({
    overall_summary: z.string().optional(),
    client_company: z.string().optional(),
    ae_name: z.string().optional(),
    client_contact: z.string().optional(),
    strengths: z.array(z.object({}).passthrough()).optional(),
    weaknesses: z.array(z.object({}).passthrough()).optional(),
    performance_score: z.record(Score).optional(),
    client_analysis: z.record(Score).optional(),
  })
  .passthrough();
export type AnalysisResult = z.infer<typeof AnalysisZ>;

// JSON Schema for the forced tool call (the shape Claude must fill).
const scoreSchema = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    rationale: { type: 'string' },
  },
};
const methodology = {
  type: 'object',
  properties: { source: { type: 'string' }, pattern: { type: 'string' } },
};
export const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    overall_summary: { type: 'string' },
    client_company: { type: 'string' },
    ae_name: { type: 'string' },
    client_contact: { type: 'string' },
    strengths: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          moment: { type: 'string' },
          timestamp: { type: 'string' },
          why_effective: { type: 'string' },
          methodology,
        },
      },
    },
    weaknesses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          timestamp: { type: 'string' },
          observation: { type: 'string' },
          evidence_quote: { type: 'string' },
          suggestion: { type: 'string' },
          methodology,
        },
      },
    },
    performance_score: {
      type: 'object',
      properties: {
        overall: scoreSchema,
        understanding_client_needs: scoreSchema,
        communication: scoreSchema,
        technical_explanation: scoreSchema,
        aggressiveness: scoreSchema,
      },
    },
    client_analysis: {
      type: 'object',
      properties: {
        overall: scoreSchema,
        buying_intent: scoreSchema,
        interest: scoreSchema,
        communication: scoreSchema,
      },
    },
  },
  required: ['overall_summary', 'performance_score', 'client_analysis'],
};
