import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const forgeWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'WF-4 Forge Webhook (PG)',
    parameters: {
      httpMethod: 'POST',
      path: 'wf4-ammo-forge-pg',
      responseMode: 'responseNode',
      options: {}
    },
    position: [0, 240]
  },
  output: [{ body: { campaignId: 'cmp_123' } }]
});

const manualTestTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Test Trigger', position: [0, 540] },
  output: [{}]
});

const setTestCampaignId = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Set Test campaignId',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'test-cid', name: 'campaignId', value: 'REPLACE_WITH_CAMPAIGN_ID', type: 'string' }
        ]
      },
      options: {}
    },
    position: [224, 540]
  },
  output: [{ campaignId: 'REPLACE_WITH_CAMPAIGN_ID' }]
});

const normalizeInput = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Normalize Input',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'cid', name: 'campaignId', value: expr('{{ $json.body?.campaignId ?? $json.campaignId ?? "" }}'), type: 'string' }
        ]
      },
      options: {}
    },
    position: [224, 240]
  },
  output: [{ campaignId: 'cmp_123' }]
});

const respondOk = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond OK',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ accepted: true, campaignId: $json.campaignId }) }}'),
      options: { responseCode: 200 }
    },
    position: [448, 240]
  },
  output: [{ accepted: true, campaignId: 'cmp_123' }]
});

const getCampaignConfig = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Campaign Config',
    parameters: {
      method: 'GET',
      url: expr('https://evertrust-api.onrender.com/campaigns/{{ $json.campaignId }}/config'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {}
    },
    position: [672, 240],
    retryOnFail: true
  },
  output: [{
    campaignId: 'cmp_123',
    lifecycle: 'ACTIVE',
    name: 'LED Berlin Q3',
    country: 'DE',
    region: 'Berlin',
    project: 'LED Modernisation',
    sender: 'Hanna Nguyen',
    niche: { name: 'LED', slug: 'led', targets: ['municipalities', 'facility managers'] },
    templates: {},
    driveFolderId: null
  }]
});

const researchDemandDrivers = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {
    name: 'Research Demand Drivers',
    parameters: {
      resource: 'text',
      operation: 'response',
      modelId: { __rl: true, mode: 'id', value: 'gpt-4o' },
      responses: {
        values: [
          {
            role: 'system',
            content: 'You are a market-intelligence researcher for Evertrust GmbH, a German company that recruits EU suppliers into GERMAN public tenders. Use web search to find RECENT, real, citable demand drivers — especially BAD NEWS (conflicts, geopolitical tensions, breaches, cyberattacks, disasters, accidents, failures, sabotage, regulatory crackdowns, shortages, crises) ANYWHERE in the world — that create PRESSURE or URGENCY increasing GERMAN public-sector demand or procurement (federal, state, KRITIS) for a given niche. The causal chain MUST end in Germany: bad event (anywhere) -> pressure on German buyers -> more German tender demand for the niche. Do NOT return tender listings or positive PR. Respond with prose only — no JSON, no code fences.'
          },
          {
            role: 'user',
            content: expr('Find recent demand drivers (last ~90 days) — conflicts, tensions, breaches, attacks, disasters, failures, regulation, or crises — that pressure GERMAN public-sector buyers (federal, state, KRITIS) to procure or accelerate spending in this niche.\n\nNiche: {{ $json.niche.name }}\nSupplier country (context only): {{ $json.country }}\nRegion context: {{ $json.region }}\nTender / demand market: Germany (federal, state, KRITIS)\n\nExplain the causal chain explicitly, ending in Germany: [bad event, anywhere] -> [why it pressures GERMAN buyers] -> [more GERMAN tender demand for {{ $json.niche.name }}]. Prefer events German authorities, German media, or EU bodies are reacting to. Cite sources with URLs where possible. Summarise the strongest 3-5 drivers in clear prose suitable as background context for an outreach copywriter.')
          }
        ]
      },
      simplify: true,
      builtInTools: { webSearch: { searchContextSize: 'high' } },
      options: { maxToolCalls: 5 }
    },
    position: [896, 240],
    retryOnFail: true
  },
  output: [{ output: 'Demand-driver brief: recent grid-security incidents in the EU are pressuring German municipalities to accelerate LED and energy-infrastructure procurement...' }]
});

const forgeTemplates = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 2.3,
  config: {
    name: 'Forge Templates',
    parameters: {
      resource: 'text',
      operation: 'response',
      modelId: { __rl: true, mode: 'id', value: 'gpt-4o' },
      responses: {
        values: [
          {
            role: 'system',
            content: 'You are a senior B2B outbound copywriter for Evertrust GmbH, a German company that recruits EU suppliers into GERMAN public tenders. You write outreach + reply email templates for a campaign. Keep {{companyName}} and other {{placeholders}} EXACTLY as written — they are filled per-lead later by another system. If the campaign country is Germany/DE, write the templates in professional German business language using the formal Sie-form; otherwise write in English. Tone: direct, professional, credible — no hype, no exclamation marks. Respond with RAW JSON ONLY — no prose, no markdown, no code fences.'
          },
          {
            role: 'user',
            content: expr('Generate the campaign email templates as STRICT JSON with EXACTLY these four string keys and nothing else: coldEmail, slotProposal, meetingConfirmation, newsBrief.\n\nCampaign context:\n- Campaign name: {{ $(\'Get Campaign Config\').item.json.name }}\n- Niche: {{ $(\'Get Campaign Config\').item.json.niche.name }}\n- Country: {{ $(\'Get Campaign Config\').item.json.country }}\n- Region: {{ $(\'Get Campaign Config\').item.json.region }}\n- Project: {{ $(\'Get Campaign Config\').item.json.project }}\n- Sender (sign-off name): {{ $(\'Get Campaign Config\').item.json.sender }}\n\nDemand-driver context (use to add urgency/relevance, do not quote verbatim):\n{{ $json.output }}\n\nField requirements:\n- coldEmail: a complete cold outreach email BODY opening with the demand-driver pressure, explaining German tender demand for the niche, and a CTA to reply for a short qualification call. Use placeholders like {{companyName}}. End with a sign-off using the sender name and "EVERTRUST GmbH" on their own lines.\n- slotProposal: an email BODY proposing TWO concrete meeting slots (use placeholders {{slot1}} and {{slot2}}) for the qualification call, addressed to {{companyName}}.\n- meetingConfirmation: an email BODY confirming a booked meeting (use placeholders {{meetingTime}} and {{meetingLink}}), addressed to {{companyName}}.\n- newsBrief: a 200-400 word demand-driver brief (prose) summarising why German public-sector demand for this niche is rising right now, for internal context.\n\nReturn ONLY the JSON object: {"coldEmail":"...","slotProposal":"...","meetingConfirmation":"...","newsBrief":"..."}')
          }
        ]
      },
      simplify: true,
      options: { textFormat: { textOptions: { type: 'json_object' } }, temperature: 0.3 }
    },
    position: [1120, 240],
    retryOnFail: true
  },
  output: [{ output: '{"coldEmail":"Hello {{companyName}}, ...","slotProposal":"...","meetingConfirmation":"...","newsBrief":"..."}' }]
});

const parseTemplates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Templates (fail loud)',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: 'const cfg = $("Get Campaign Config").first().json || {};\nconst campaignId = (cfg.campaignId || "").toString();\nconst name = (cfg.name || "").toString();\nconst raw = $input.first().json || {};\nfunction collectText(r){\n  const acc = [];\n  if (typeof r === "string") acc.push(r);\n  else if (r && typeof r === "object") {\n    if (typeof r.output_text === "string") acc.push(r.output_text);\n    if (typeof r.output === "string") acc.push(r.output);\n    if (typeof r.text === "string") acc.push(r.text);\n    if (typeof r.content === "string") acc.push(r.content);\n    if (typeof r.response === "string") acc.push(r.response);\n    if (r.message && typeof r.message.content === "string") acc.push(r.message.content);\n    if (Array.isArray(r.output)) for (const x of r.output) if (x && Array.isArray(x.content)) for (const c of x.content) if (c && typeof c.text === "string") acc.push(c.text);\n    if (Array.isArray(r.content)) for (const c of r.content) if (c && typeof c.text === "string") acc.push(c.text);\n  }\n  return acc;\n}\nfunction stripFences(s){ return String(s).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(); }\nfunction tryParse(s){\n  const t = stripFences(s);\n  try { return JSON.parse(t); } catch (e) {}\n  const a = t.indexOf("{"); const b = t.lastIndexOf("}");\n  if (a !== -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }\n  return null;\n}\nlet parsed = null;\nif (raw && typeof raw === "object" && typeof raw.coldEmail === "string") parsed = raw;\nif (!parsed) { for (const s of collectText(raw)) { const p = tryParse(s); if (p && typeof p === "object") { parsed = p; break; } } }\nif (!parsed) { throw new Error("Forge Templates: could not parse JSON from model output. Raw keys: " + Object.keys(raw).join(",") + " | snippet: " + JSON.stringify(raw).slice(0, 300)); }\nconst REQUIRED = ["coldEmail", "slotProposal", "meetingConfirmation", "newsBrief"];\nconst templates = {};\nconst missing = [];\nfor (const k of REQUIRED) {\n  const v = parsed[k];\n  if (typeof v !== "string" || !v.trim()) { missing.push(k); }\n  else { templates[k] = v; }\n}\nif (missing.length) { throw new Error("Forge Templates: missing or empty template block(s): " + missing.join(", ") + ". Got keys: " + Object.keys(parsed).join(",")); }\nif (!campaignId) { throw new Error("Parse Templates: campaignId missing from Get Campaign Config response."); }\nconsole.log("[Parse Templates] campaignId=" + campaignId + " name=" + name + " blocks=" + REQUIRED.join(","));\nreturn [{ json: { campaignId, name, templates } }];'
    },
    position: [1344, 240]
  },
  output: [{
    campaignId: 'cmp_123',
    name: 'LED Berlin Q3',
    templates: { coldEmail: 'Hello {{companyName}}, ...', slotProposal: '...', meetingConfirmation: '...', newsBrief: '...' }
  }]
});

const postTemplates = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'POST Templates to ERP',
    parameters: {
      method: 'POST',
      url: expr('https://evertrust-api.onrender.com/campaigns/{{ $json.campaignId }}/templates'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ templates: $json.templates }) }}'),
      options: {}
    },
    position: [1568, 240],
    retryOnFail: true
  },
  output: [{ ok: true }]
});

const notifyTemplatesReady = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Notify Templates Ready',
    parameters: {
      method: 'POST',
      url: 'https://evertrust-api.onrender.com/notifications',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ type: "TEMPLATES_READY", title: "Templates ready: " + $(\'Parse Templates (fail loud)\').item.json.name, body: "Cold email + reply templates generated", link: "/campaigns/" + $(\'Parse Templates (fail loud)\').item.json.campaignId, campaignId: $(\'Parse Templates (fail loud)\').item.json.campaignId }) }}'),
      options: {}
    },
    position: [1792, 240],
    onError: 'continueRegularOutput'
  },
  output: [{ ok: true }]
});

const noteSpine = sticky(
  '## AMMO FORGE (PG) v2 — Postgres rebuild of WF-4 (no Google Drive)\n\nGenerates the campaign email templates + demand-driver brief and writes them to the ERP (Postgres) so Bazooka (coldEmail) and Reply Glock (slotProposal, meetingConfirmation) can read them.\n\n**Flow:** Webhook (POST /webhook/wf4-ammo-forge-pg, body { campaignId }) -> Normalize -> Respond OK immediately -> GET /campaigns/{id}/config -> Research demand drivers (OpenAI + web search) -> Forge Templates (OpenAI gpt-4o, strict JSON) -> Parse (fail loud) -> POST /campaigns/{id}/templates -> notify.\n\nManual Test Trigger -> Set Test campaignId joins the spine at Get Campaign Config (edit the value to test).\n\nThe config -> research -> forge -> parse -> POST spine FAILS LOUD. Only the notification leg is best-effort (continueRegularOutput).',
  [forgeWebhook, manualTestTrigger, getCampaignConfig, forgeTemplates, postTemplates],
  { color: 4, height: 320, width: 900 }
);

const noteErpAuth = sticky(
  '## ⚠ Select the ERP Ingest (x-arsenal-token) credential\n\nThe three ERP HTTP nodes — **Get Campaign Config**, **POST Templates to ERP**, **Notify Templates Ready** — use Header Auth (httpHeaderAuth) but are intentionally left UNBOUND.\n\nBefore running, open each and pick the **x-arsenal-token** credential (the ERP ingest token header). Same credential for all three.\n\nERP base URL: https://evertrust-api.onrender.com — update on every ERP node if the deployed base differs (live only post-deploy).',
  [getCampaignConfig, postTemplates, notifyTemplatesReady],
  { color: 3, height: 260, width: 620 }
);

export default workflow('ammo-forge-pg-v2', 'EVERTRUST - AMMO FORGE (PG) v2')
  .add(forgeWebhook)
  .to(normalizeInput)
  .to(respondOk)
  .to(getCampaignConfig)
  .to(researchDemandDrivers)
  .to(forgeTemplates)
  .to(parseTemplates)
  .to(postTemplates)
  .to(notifyTemplatesReady)
  .add(manualTestTrigger)
  .to(setTestCampaignId)
  .to(getCampaignConfig)
  .add(noteSpine)
  .add(noteErpAuth);
