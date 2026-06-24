// Outreach-template placeholder substitution. Tokens (whitespace-tolerant):
//   {{Company}} / {{Company Name}} -> the lead's company (aliases)
//   {{Type}}          -> the campaign's target type (provider / supplier / …)
//   {{IndustryFocus}} -> the campaign's industry (IT / Power / …)
//   {{TenderFocus}}   -> the campaign's niche-in-sector (Cloud Infrastructure / …)
// Unrecognized tokens are left as-is so a typo is visible rather than silently blanked.

export interface TemplateVars {
  company: string;
  type: string;
  industryFocus: string;
  tenderFocus: string;
}

export function renderTemplate(text: string, vars: TemplateVars): string {
  return text
    .replace(/\{\{\s*Company(?:\s*Name)?\s*\}\}/g, vars.company)
    .replace(/\{\{\s*Type\s*\}\}/g, vars.type)
    .replace(/\{\{\s*IndustryFocus\s*\}\}/g, vars.industryFocus)
    .replace(/\{\{\s*TenderFocus\s*\}\}/g, vars.tenderFocus);
}

export interface EmailBlockInput {
  subject: string;
  body: string;
}
export interface NormalizedTemplate {
  cold_outreach: EmailBlockInput;
  follow_up: EmailBlockInput;
  final_push: EmailBlockInput;
}

// The accepted round-key spellings for a pasted/uploaded template, mapped to the stored
// keys. Matching is case-insensitive so COLD / cold / cold_outreach all work.
const ROUND_ALIASES: Record<keyof NormalizedTemplate, string[]> = {
  cold_outreach: ['cold_outreach', 'cold', 'cold_email'],
  follow_up: ['follow_up', 'followup'],
  final_push: ['final_push', 'finalpush', 'final'],
};

// Normalize a pasted/uploaded template (any of the common round spellings) to the stored
// shape. Throws Error when a round or its subject/body is missing — the caller maps that
// to a 400.
export function normalizeTemplateInput(raw: unknown): NormalizedTemplate {
  if (!raw || typeof raw !== 'object') throw new Error('Template must be an object');
  const obj = raw as Record<string, unknown>;
  const pick = (round: keyof NormalizedTemplate): EmailBlockInput => {
    const aliases = ROUND_ALIASES[round];
    for (const key of Object.keys(obj)) {
      if (!aliases.some((a) => a.toLowerCase() === key.toLowerCase())) continue;
      const v = obj[key] as Record<string, unknown> | null;
      if (v && typeof v.subject === 'string' && typeof v.body === 'string') {
        return { subject: v.subject, body: v.body };
      }
    }
    throw new Error(`Missing or invalid round "${round}" (need { subject, body })`);
  };
  return {
    cold_outreach: pick('cold_outreach'),
    follow_up: pick('follow_up'),
    final_push: pick('final_push'),
  };
}
