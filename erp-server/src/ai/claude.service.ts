import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppConfigService } from '../config/app-config.service';

// The Anthropic Messages API, called directly over fetch — NO SDK dependency
// (the repo has no package manager on PATH, and every other external integration
// here is a raw fetch too: see ArsenalService/CampaignsService). This is the ONE
// place that talks to Anthropic; domain logic (prompts, schemas) lives in the
// callers (e.g. PriceAssistService) so this boundary stays thin and mockable.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 30_000;

// Token usage + approximate € cost of one model call (for ai_runs observability).
export interface ClaudeUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  eurCost: number;
}

// A structured (forced tool-call) Claude result: the validated JSON the model
// returned as the tool input, plus the call's usage/cost.
export interface ClaudeStructuredResult<T> {
  data: T;
  usage: ClaudeUsage;
}

// Approximate blended €/token by model family — for observability only, NOT
// billing-grade. Anthropic lists USD/MTok; we fold in a flat ~0.92 USD→EUR factor
// and divide by 1e6. Matched by substring on the model id; unknown model → 0 cost.
const MODEL_RATE_EUR_PER_TOKEN: { match: string; in: number; out: number }[] = [
  // Sonnet ≈ $3 in / $15 out per MTok.
  { match: 'sonnet', in: 0.00000276, out: 0.0000138 },
  // Haiku ≈ $0.80 in / $4 out per MTok.
  { match: 'haiku', in: 0.00000074, out: 0.00000368 },
  // Opus ≈ $15 in / $75 out per MTok.
  { match: 'opus', in: 0.0000138, out: 0.000069 },
];

function estimateEurCost(model: string, tokensIn: number, tokensOut: number): number {
  const m = model.toLowerCase();
  const rate = MODEL_RATE_EUR_PER_TOKEN.find((r) => m.includes(r.match));
  if (!rate) return 0;
  return tokensIn * rate.in + tokensOut * rate.out;
}

// Minimal shape of the Messages API response we read (we force a single tool_use).
interface AnthropicContentBlock {
  type: string;
  input?: unknown;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

@Injectable()
export class ClaudeService {
  constructor(private readonly config: AppConfigService) {}

  // True when an API key is set. Blank = every Claude feature is gracefully
  // disabled (callers branch on this and return a "not configured" result rather
  // than throwing), so the API runs fine before a key is provisioned.
  isConfigured(): boolean {
    return this.config.get('ANTHROPIC_API_KEY').trim().length > 0;
  }

  // The configured model id (used for suggestions + recorded on the ai_runs row).
  model(): string {
    return this.config.get('ANTHROPIC_MODEL');
  }

  // Call Claude and FORCE a single structured tool call, validating the tool input
  // against `schema`. Returns the parsed data + usage/cost. THROWS on: not
  // configured, network/timeout, non-2xx, missing tool_use block, or schema-invalid
  // output — the caller decides how to surface it (PriceAssistService maps a thrown
  // failure to a { configured:true, error } result so the HTTP call never 500s on an
  // operational model hiccup). `jsonSchema` is the tool input_schema (JSON Schema);
  // `schema` is the Zod validator for the returned input — kept as two explicit
  // arguments to avoid a zod→json-schema dependency.
  async structured<T>(args: {
    system: string;
    prompt: string;
    toolName: string;
    toolDescription: string;
    schema: z.ZodType<T>;
    jsonSchema: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<ClaudeStructuredResult<T>> {
    const apiKey = this.config.get('ANTHROPIC_API_KEY').trim();
    if (!apiKey) throw new Error('Claude is not configured');
    const model = this.model();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: args.maxTokens ?? 1024,
          system: args.system,
          tools: [
            {
              name: args.toolName,
              description: args.toolDescription,
              input_schema: args.jsonSchema,
            },
          ],
          // Force the model to answer via the tool → guaranteed structured output.
          tool_choice: { type: 'tool', name: args.toolName },
          messages: [{ role: 'user', content: args.prompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `Claude HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
        );
      }

      const json = (await res.json()) as AnthropicResponse;
      const toolUse = (json.content ?? []).find((b) => b.type === 'tool_use');
      if (!toolUse) {
        throw new Error('Claude returned no structured tool output');
      }
      // Validate the model's tool input against the caller's Zod schema. Invalid
      // output throws (caught and surfaced as a clean error, never auto-applied).
      const data = args.schema.parse(toolUse.input);

      const tokensIn = json.usage?.input_tokens ?? 0;
      const tokensOut = json.usage?.output_tokens ?? 0;
      return {
        data,
        usage: {
          model,
          tokensIn,
          tokensOut,
          eurCost: estimateEurCost(model, tokensIn, tokensOut),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
