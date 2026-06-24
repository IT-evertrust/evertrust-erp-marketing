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
