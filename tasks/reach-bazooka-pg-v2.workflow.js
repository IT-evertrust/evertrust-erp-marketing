import { workflow, node, trigger, sticky, newCredential, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

// ===== Credentials (resolved by name from list_credentials) =====
// Bind by explicit credential ID so n8n does NOT collapse same-type nodes onto one cred
// (the two Gmail nodes MUST stay on distinct creds — see IDs from list_credentials).
const liteLlm = newCredential('LiteLLM Gateway (mac-mini)', '2YgDmy9NuLHvOgzJ'); // openAiApi  (LLM validate/personalize)
const gmailInfo = newCredential('Gmail account', '4oGndbIXYKoqNask');             // gmailOAuth2 (info@)  -> Send Outreach
const gmailHanna = newCredential('Gmail account: Hanna', 'iBJ8BCOqhFb5kDUg');     // gmailOAuth2 (Hanna)  -> Send Outreach (Hanna)
const waCred = newCredential('WhatsApp account', 'hfg64imhwFA01Qcb');             // whatsAppApi (all WA notify nodes)
// ERP HTTP nodes are intentionally UNBOUND (httpHeaderAuth, genericCredentialType) — user binds "ERP Ingest (x-arsenal-token)".

// ============================ HAMMER — triggers + globals ============================
const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Schedule 8AM Daily',
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * *' }] } },
    disabled: true,
    position: [208, 208]
  },
  output: [{}]
});

const webhookTrigger = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook',
    parameters: { path: 'wf2-reach-bazooka-pg', options: {} },
    disabled: true,
    position: [208, 384]
  },
  output: [{}]
});

const configGlobals = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config — Globals',
    parameters: {
      assignments: {
        assignments: [
          { id: 'g1', name: 'erpBaseUrl', value: 'https://evertrust-api.onrender.com', type: 'string' },
          { id: 'g2', name: 'managerWhatsAppNumber', value: '84333634500', type: 'string' },
          { id: 'g3', name: 'senderPhoneNumberId', value: '1030239273516528', type: 'string' },
          { id: 'g4', name: 'errorAlertThreshold', value: 3, type: 'number' },
          { id: 'g5', name: 'runId', value: expr('{{ $now.toFormat("yyyy-LL-dd-HHmm") }}'), type: 'string' },
          { id: 'g6', name: 'today', value: expr('{{ $now.toFormat("yyyy-LL-dd") }}'), type: 'string' },
          { id: 'g7', name: 'mode', value: 'outbound', type: 'string' },
          { id: 'g8', name: 'maxSendsPerRun', value: expr('{{ Number($vars.BAZOOKA_MAX_SENDS ?? $env.BAZOOKA_MAX_SENDS ?? 25) }}'), type: 'number' },
          { id: 'g9', name: 'sendListLimit', value: expr('{{ Number($vars.BAZOOKA_SEND_LIST_LIMIT ?? $env.BAZOOKA_SEND_LIST_LIMIT ?? 50) }}'), type: 'number' }
        ]
      },
      options: {}
    },
    position: [448, 208]
  },
  output: [{ erpBaseUrl: 'https://evertrust-api.onrender.com', runId: '2026-06-12-0800', today: '2026-06-12', mode: 'outbound', managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', maxSendsPerRun: 25, sendListLimit: 50 }]
});

// ===== A. ERP: active campaigns (REPLACES Drive root/folder discovery + config.json) =====
const erpGetCampaigns = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Get Active Campaigns',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.erpBaseUrl }}/campaigns/machine/list?lifecycle=ACTIVE'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { response: { response: { neverError: true } } }
    },
    position: [688, 208]
  },
  output: [{ data: [{ id: 'camp_1', name: 'Container Poland', sender: 'info', niche: 'Container', city: 'Gdynia', templatesFileId: 'drv_tpl_1', newsFileId: 'drv_news_1' }] }]
});

const codeBuildRunStart = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Run Start Message',
    parameters: {
      jsCode:
        "const g = $('Config — Globals').first().json;\n" +
        "const raw = items.map(i => i.json).filter(Boolean);\n" +
        "let list = [];\n" +
        "for (const r of raw) {\n" +
        "  if (Array.isArray(r)) list = list.concat(r);\n" +
        "  else if (Array.isArray(r.data)) list = list.concat(r.data);\n" +
        "  else if (Array.isArray(r.campaigns)) list = list.concat(r.campaigns);\n" +
        "  else if (r.id || r.campaignId) list.push(r);\n" +
        "}\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "if (sd.bazookaRunId !== g.runId) { sd.bazookaRunId = g.runId; sd.bazookaSent = 0; }\n" +
        "const campaigns = list.map(c => ({ campaignId: String(c.id ?? c.campaignId), campaignName: c.name ?? c.campaignName ?? '' }));\n" +
        "let body;\n" +
        "if (campaigns.length === 0) {\n" +
        "  body = 'Bazooka dry-fire — no ammo loaded\\nRun ID: ' + g.runId + '\\n\\nNo ACTIVE campaigns returned by the ERP.';\n" +
        "} else {\n" +
        "  body = 'Locked and loaded\\nRun ID: ' + g.runId + '\\nLoading ' + campaigns.length + ' mags now...';\n" +
        "}\n" +
        "return [{ json: { erpBaseUrl: g.erpBaseUrl, runId: g.runId, today: g.today, mode: g.mode || 'outbound', managerWhatsAppNumber: g.managerWhatsAppNumber, senderPhoneNumberId: g.senderPhoneNumberId, errorAlertThreshold: g.errorAlertThreshold, maxSendsPerRun: g.maxSendsPerRun, sendListLimit: g.sendListLimit, campaigns, notifyType: 'REACH_BAZOOKA_RUN_START', notifyTitle: 'Reach Bazooka — run start', messageBody: body } }];"
    },
    position: [912, 208]
  },
  output: [{ erpBaseUrl: 'https://evertrust-api.onrender.com', runId: '2026-06-12-0800', today: '2026-06-12', mode: 'outbound', managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', maxSendsPerRun: 25, sendListLimit: 50, campaigns: [{ campaignId: 'camp_1', campaignName: 'Container Poland' }], notifyType: 'REACH_BAZOOKA_RUN_START', notifyTitle: 'Reach Bazooka — run start', messageBody: 'Locked and loaded' }]
});

const ifOutboundRunStart = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Outbound Run Start',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c1', leftValue: expr('{{ $json.mode }}'), rightValue: 'outbound', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }]
      },
      options: {}
    },
    position: [1136, 208]
  }
});

const waRunStart = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Run Start',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr('{{ $json.messageBody }}'),
      additionalFields: {}
    },
    credentials: { whatsAppApi: waCred },
    onError: 'continueRegularOutput',
    position: [1360, 112]
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid.RUNSTART' }] }]
});

// B. NEW — ERP notification ALONGSIDE WhatsApp Run Start
const erpNotifyRunStart = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Run Start',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.erpBaseUrl }}/notifications'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ type: $json.notifyType, title: $json.notifyTitle, body: $json.messageBody, link: null, campaignId: null }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [1360, 304]
  },
  output: [{ ok: true }]
});

const codeExplodeCampaigns = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Explode Campaigns',
    parameters: {
      jsCode:
        "const start = $('Code — Build Run Start Message').first().json;\n" +
        "return (start.campaigns || []).map(c => ({ json: { campaignId: c.campaignId, campaignName: c.campaignName, erpBaseUrl: start.erpBaseUrl, runId: start.runId, today: start.today, mode: start.mode || 'outbound', managerWhatsAppNumber: start.managerWhatsAppNumber, senderPhoneNumberId: start.senderPhoneNumberId, errorAlertThreshold: start.errorAlertThreshold, maxSendsPerRun: start.maxSendsPerRun, sendListLimit: start.sendListLimit, __sibReset: true } }));"
    },
    position: [1600, 208]
  },
  output: [{ campaignId: 'camp_1', campaignName: 'Container Poland', __sibReset: true }]
});

// ============================ BARREL — outbound pipeline ============================
const loopCampaigns = splitInBatches({
  version: 3,
  config: {
    name: 'Loop — Campaigns',
    parameters: { options: { reset: expr('{{ $json.__sibReset === true }}') } },
    position: [1792, 208]
  }
});

// A. ERP: per-campaign config (REPLACES Drive — List Campaign Files + Check Required Files + Download/Parse config.json)
const erpGetConfig = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Get Campaign Config',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.erpBaseUrl }}/campaigns/{{ $json.campaignId }}/config'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { response: { response: { neverError: true } } }
    },
    position: [2016, 304]
  },
  output: [{ data: { sender: 'info', niche: 'Container', city: 'Gdynia', project: 'Tender X', templatesFileId: 'drv_tpl_1', newsFileId: 'drv_news_1', templateAssetId: 'asset_1' } }]
});

const codeMergeConfig = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Merge Campaign Config',
    parameters: {
      jsCode:
        "const campaign = $('Loop — Campaigns').item.json;\n" +
        "let cfg = items.length ? items[0].json : {};\n" +
        "if (cfg && cfg.data && typeof cfg.data === 'object') cfg = cfg.data;\n" +
        "const sender = String(cfg.sender ?? cfg.sendFrom ?? campaign.sender ?? 'info');\n" +
        "// Drive pointers for the KEPT template/news content (still binaries in Drive).\n" +
        "const templatesFileId = cfg.templatesFileId ?? cfg.templatesDocId ?? cfg.templateDriveFileId ?? (cfg.templates && cfg.templates.driveFileId) ?? null;\n" +
        "const newsFileId = cfg.newsFileId ?? cfg.newsDocId ?? cfg.newsDriveFileId ?? (cfg.news && cfg.news.driveFileId) ?? null;\n" +
        "return [{ json: { ...campaign, config: cfg, sender,\n" +
        "  niche: cfg.niche ?? '', city: cfg.city ?? '', project: cfg.project ?? '',\n" +
        "  templatesFileId, newsFileId,\n" +
        "  templateAssetId: cfg.templateAssetId ?? cfg.templateId ?? null,\n" +
        "  templateSubject: cfg.templateSubject ?? (cfg.template && cfg.template.subject) ?? '',\n" +
        "  templateBody: cfg.templateBody ?? (cfg.template && cfg.template.body) ?? '' } }];"
    },
    position: [2240, 304]
  },
  output: [{ campaignId: 'camp_1', campaignName: 'Container Poland', sender: 'info', niche: 'Container', city: 'Gdynia', templatesFileId: 'drv_tpl_1', newsFileId: 'drv_news_1', templateAssetId: 'asset_1' }]
});

// C. Templates + news now come from Postgres via GET /campaigns/:id/config
// (config.templates.coldEmail + config.templates.newsBrief). The Drive downloads are removed;
// these Code nodes read the config node's templates object instead of a Drive binary.
const codeParseTemplates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Parse Template Blocks',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const campaign = $('Code — Merge Campaign Config').first().json;\n" +
        "const cfgTemplates = ($('ERP — Get Campaign Config').first()?.json?.templates) || {};\n" +
        "let text = String(cfgTemplates.coldEmail || '').trim();\n" +
        "function extract(blockTag) {\n" +
        "  const re = new RegExp('\\\\[' + blockTag + '\\\\]([\\\\s\\\\S]*?)(?=\\\\n\\\\[(?:COLD-AGG|COLD|FOLLOWUP|FINALPUSH)\\\\]|$)', 'i');\n" +
        "  const m = text.match(re);\n" +
        "  if (!m) return { subject: '', body: '' };\n" +
        "  const raw = m[1];\n" +
        "  const subjMatch = raw.match(/Subject:\\s*(.+)/i);\n" +
        "  const bodyMatch = raw.match(/Body:\\s*([\\s\\S]+)/i);\n" +
        "  return { subject: (subjMatch && subjMatch[1] || '').trim(), body: (bodyMatch && bodyMatch[1] || '').trim() };\n" +
        "}\n" +
        "const parsed = { COLD: extract('COLD'), 'COLD-AGG': extract('COLD-AGG'), FOLLOWUP: extract('FOLLOWUP'), FINALPUSH: extract('FINALPUSH') };\n" +
        "// If config.templates.coldEmail is authored with [BLOCK] tags, use the parsed blocks;\n" +
        "// otherwise treat coldEmail as the single COLD body and fall back for the other blocks.\n" +
        "const hasAny = ['COLD','COLD-AGG','FOLLOWUP','FINALPUSH'].some(k => (parsed[k].subject || parsed[k].body));\n" +
        "const coldBody = text;\n" +
        "const templates = hasAny ? parsed : { COLD: { subject: campaign.templateSubject || '', body: coldBody || campaign.templateBody || '' }, 'COLD-AGG': { subject: '', body: '' }, FOLLOWUP: { subject: campaign.templateSubject || '', body: coldBody || campaign.templateBody || '' }, FINALPUSH: { subject: campaign.templateSubject || '', body: coldBody || campaign.templateBody || '' } };\n" +
        "return { json: { ...campaign, templates } };"
    },
    position: [2688, 304]
  },
  output: [{ campaignId: 'camp_1', templates: { COLD: { subject: 'Hi {{Company Name}}', body: '...' } } }]
});

const codeParseNews = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Parse News',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const campaign = $('Code — Parse Template Blocks').first().json;\n" +
        "const cfgTemplates = ($('ERP — Get Campaign Config').first()?.json?.templates) || {};\n" +
        "const text = String(cfgTemplates.newsBrief || '').trim();\n" +
        "return { json: { ...campaign, newsText: text } };"
    },
    position: [3136, 304]
  },
  output: [{ campaignId: 'camp_1', campaignName: 'Container Poland', mode: 'outbound', erpBaseUrl: 'https://evertrust-api.onrender.com', managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', sendListLimit: 50, maxSendsPerRun: 25, config: { niche: 'Container' }, templates: { COLD: { subject: 'Hi', body: '...' } }, newsText: '' }]
});

const ifOutboundActivate = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Outbound Activate',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c1', leftValue: expr('{{ $json.mode }}'), rightValue: 'outbound', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }]
      },
      options: {}
    },
    position: [3360, 208]
  }
});

// A. ERP: per-campaign send list (REPLACES Sheets — Read Leads + Collect Leads + Compute Action cadence/suppression)
const erpGetSendList = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Get Send List',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.erpBaseUrl }}/prospects'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'sendList', value: 'true' },
          { name: 'campaignId', value: expr('{{ $json.campaignId }}') },
          { name: 'limit', value: expr('{{ $json.sendListLimit }}') }
        ]
      },
      options: { response: { response: { neverError: true } } }
    },
    position: [3584, 144]
  },
  output: [{ data: [{ id: 'pros_1', email: 'ceo@acme.de', companyName: 'Acme GmbH', companyType: 'Bau', status: 'NEW', followupCount: 0 }] }]
});

const codeBuildActivated = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Activated Message',
    parameters: {
      jsCode:
        "const campaign = $('Code — Parse News').first().json;\n" +
        "const raw = items.map(i => i.json).filter(Boolean);\n" +
        "let list = [];\n" +
        "for (const r of raw) {\n" +
        "  if (Array.isArray(r)) list = list.concat(r);\n" +
        "  else if (Array.isArray(r.data)) list = list.concat(r.data);\n" +
        "  else if (Array.isArray(r.prospects)) list = list.concat(r.prospects);\n" +
        "  else if (r.id || r.prospectId) list.push(r);\n" +
        "}\n" +
        "const prospects = list.map(p => ({\n" +
        "  prospectId: String(p.id ?? p.prospectId),\n" +
        "  email: String(p.email ?? p.contactEmail ?? '').trim(),\n" +
        "  companyName: p.companyName ?? p.company ?? '',\n" +
        "  companyType: p.companyType ?? '',\n" +
        "  prevFollowupCount: Number(p.followupCount ?? 0),\n" +
        "  nextFollowupCount: Number(p.followupCount ?? 0) + 1,\n" +
        "  prospectStatus: p.status ?? ''\n" +
        "}));\n" +
        "const msg = 'Mag loaded — campaign hot\\nCampaign: ' + campaign.campaignName + '\\nRounds chambered: ' + prospects.length;\n" +
        "return [{ json: { ...campaign, prospects, activatedMessageBody: msg, notifyType: 'REACH_BAZOOKA_CAMPAIGN_ACTIVATED', notifyTitle: 'Reach Bazooka — campaign activated' } }];"
    },
    position: [3808, 144]
  },
  output: [{ campaignId: 'camp_1', campaignName: 'Container Poland', erpBaseUrl: 'https://evertrust-api.onrender.com', runId: '2026-06-12-0800', today: '2026-06-12', managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', maxSendsPerRun: 25, prospects: [{ prospectId: 'pros_1', email: 'ceo@acme.de' }], activatedMessageBody: 'Mag loaded', notifyType: 'REACH_BAZOOKA_CAMPAIGN_ACTIVATED', notifyTitle: 'Reach Bazooka — campaign activated' }]
});

const waCampaignActivated = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Campaign Activated',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr('{{ $json.activatedMessageBody }}'),
      additionalFields: {}
    },
    credentials: { whatsAppApi: waCred },
    onError: 'continueRegularOutput',
    position: [4032, 48]
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ACTIVATED' }] }]
});

// B. NEW — ERP notification ALONGSIDE WhatsApp Campaign Activated
const erpNotifyActivated = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Campaign Activated',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.erpBaseUrl }}/notifications'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ type: $json.notifyType, title: $json.notifyTitle, body: $json.activatedMessageBody, link: null, campaignId: $json.campaignId }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [4032, 240]
  },
  output: [{ ok: true }]
});

const codeExplodeProspects = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Send Cap Guard + Explode Prospects',
    parameters: {
      jsCode:
        "// B. NEW send-cap guard: bound total sends across the whole run to maxSendsPerRun (default 25, overridable).\n" +
        "// Count kept in workflow static data so the cap is GLOBAL across all campaigns in this run.\n" +
        "const campaign = $('Code — Build Activated Message').first().json;\n" +
        "const cap = Number(campaign.maxSendsPerRun) || 25;\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "if (typeof sd.bazookaSent !== 'number') sd.bazookaSent = 0;\n" +
        "const prospects = campaign.prospects || [];\n" +
        "const out = [];\n" +
        "let cappedThisCampaign = 0;\n" +
        "for (const p of prospects) {\n" +
        "  if (sd.bazookaSent >= cap) { cappedThisCampaign++; continue; }\n" +
        "  sd.bazookaSent++;\n" +
        "  out.push({ json: { ...p, campaignName: campaign.campaignName, campaignId: campaign.campaignId, config: campaign.config, sender: campaign.sender, templates: campaign.templates, newsText: campaign.newsText || '', niche: campaign.niche, city: campaign.city, project: campaign.project, templateAssetId: campaign.templateAssetId, erpBaseUrl: campaign.erpBaseUrl, runId: campaign.runId, today: campaign.today, managerWhatsAppNumber: campaign.managerWhatsAppNumber, senderPhoneNumberId: campaign.senderPhoneNumberId, __sibReset: true } });\n" +
        "}\n" +
        "if (cappedThisCampaign > 0) {\n" +
        "  console.warn('[Bazooka] SEND CAP REACHED (' + cap + '). Skipped ' + cappedThisCampaign + ' prospect(s) in campaign ' + campaign.campaignName + '. Sent so far this run: ' + sd.bazookaSent + '.');\n" +
        "}\n" +
        "return out;"
    },
    position: [4256, 144]
  },
  output: [{ prospectId: 'pros_1', email: 'ceo@acme.de', campaignName: 'Container Poland', __sibReset: true }]
});

const loopProspects = splitInBatches({
  version: 3,
  config: {
    name: 'Loop — Prospects',
    parameters: { options: { reset: expr('{{ $json.__sibReset === true }}') } },
    position: [4480, 144]
  }
});

const codeComputeAction = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Compute Action',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "// Cadence (cold/followup/finalpush) is decided server-side in the send list; here we only pick the\n" +
        "// template block from the prospect status + follow-up count, and backstop the email format.\n" +
        "const cleanEmail = (s) => String(s == null ? '' : s)\n" +
        "  .replace(/[\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]/g, '-')\n" +
        "  .replace(/[\\u00A0\\u200B\\u200C\\u200D\\u2060\\uFEFF]/g, '')\n" +
        "  .trim();\n" +
        "const isValidEmail = (e) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(e);\n" +
        "const { __sibReset, ...lead } = $input.item.json;\n" +
        "lead.email = cleanEmail(lead.email);\n" +
        "const templates = lead.templates || {};\n" +
        "const newsText = lead.newsText || '';\n" +
        "const hasBadNews = /isBadNews:\\s*true/i.test(newsText) || /\\[BAD NEWS/i.test(newsText);\n" +
        "const aggTpl = templates['COLD-AGG'];\n" +
        "const aggAvailable = !!(aggTpl && (((aggTpl.body || '').trim()) || ((aggTpl.subject || '').trim())));\n" +
        "const status = String(lead.prospectStatus || '').trim().toUpperCase();\n" +
        "const fu = Number(lead.prevFollowupCount || 0);\n" +
        "let actionType = 'cold';\n" +
        "let templateBlock = (hasBadNews && aggAvailable) ? 'COLD-AGG' : 'COLD';\n" +
        "let skipReason = '';\n" +
        "if (status === 'EMAILED' || fu >= 2) { actionType = 'finalpush'; templateBlock = 'FINALPUSH'; }\n" +
        "else if (status === 'CONTACTED' || fu === 1) { actionType = 'followup'; templateBlock = 'FOLLOWUP'; }\n" +
        "if (!isValidEmail(lead.email)) { actionType = 'skip'; templateBlock = null; skipReason = 'INVALID_EMAIL'; console.log('[Compute Action] SKIP_INVALID_EMAIL company=' + (lead.companyName || '') + ' email=' + JSON.stringify(lead.email)); }\n" +
        "const tpl = templateBlock ? (templates[templateBlock] || templates.COLD || {}) : null;\n" +
        "return { json: { ...lead, actionType, templateBlock, skipReason, templateSubject: (tpl && tpl.subject) || lead.templateSubject || '', templateBody: (tpl && tpl.body) || lead.templateBody || '' } };"
    },
    position: [4704, 144]
  },
  output: [{ prospectId: 'pros_1', actionType: 'cold', templateBlock: 'COLD', templateSubject: 'Hi {{Company Name}}', templateBody: '...' }]
});

const ifActionOrSkip = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Action or Skip',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c1', leftValue: expr('{{ $json.actionType }}'), rightValue: 'skip', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }]
      },
      options: {}
    },
    position: [4928, 144]
  }
});

const codePrepareLlm = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Prepare LLM Payload',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const d = $input.item.json;\n" +
        "const c = d.config || {};\n" +
        "const prompt = 'You are an email finalizer. Your job: take the template below and produce a ready-to-send email by replacing the {{...}} placeholders with real lead data.\\n\\n' +\n" +
        "  'Lead data:\\n' +\n" +
        "  '- Company Name: ' + (d.companyName || '') + '\\n' +\n" +
        "  '- Company Type: ' + (d.companyType || '') + '\\n' +\n" +
        "  '- Email: ' + (d.email || '') + '\\n\\n' +\n" +
        "  'Campaign context (use only if helpful for personalisation):\\n' +\n" +
        "  '- Niche: ' + (d.niche || c.niche || '') + '\\n' +\n" +
        "  '- City: ' + (d.city || c.city || '') + '\\n' +\n" +
        "  '- Project: ' + (d.project || c.project || '') + '\\n\\n' +\n" +
        "  ((d.templateBlock === 'COLD-AGG' && d.newsText) ? 'Recent demand-driver / BAD-news intel for this niche (AGGRESSIVE variant only — use it to open with ONE short, NATURAL sentence in the email language tying the threat to GERMAN tender demand; if the template already opens with the hook keep exactly one and do not duplicate; never paste arrow chains; never fabricate):\\n' + d.newsText + '\\n\\n' : '') +\n" +
        "  'Template to fill in (' + d.templateBlock + ' block):\\n' +\n" +
        "  'Subject: ' + (d.templateSubject || '') + '\\n' +\n" +
        "  'Body: ' + (d.templateBody || '') + '\\n\\n' +\n" +
        "  'Instructions:\\n' +\n" +
        "  '1. Replace every {{Company Name}} placeholder with the lead Company Name.\\n' +\n" +
        "  '2. Replace every {{Company Type}} placeholder with the lead Company Type.\\n' +\n" +
        "  '3. Replace any {{city}} with the campaign city, {{project}} with the campaign project (if those placeholders appear).\\n' +\n" +
        "  '4. You may very lightly personalise the body for tone (1-2 small word changes max). Do not invent facts. Do not change structure or core meaning.\\n' +\n" +
        "  '5. Set valid=true unless the lead data is clearly bogus (missing required field, obviously fake company name, invalid email).\\n' +\n" +
        "  '6. Do NOT second-guess the template choice or timing — that decision was already made upstream.\\n' +\n" +
        "  '7. If demand-driver news is provided (aggressive COLD-AGG variant only), open with at most ONE short, NATURAL sentence in the email language tying it to GERMAN tender demand — never paste raw arrow chains, never duplicate a hook the template already includes, never invent news. If no news is provided, do not mention any.\\n\\n' +\n" +
        "  'Return JSON only:\\n' +\n" +
        "  '{ \"valid\": true or false, \"reason\": \"one-line if invalid else empty\", \"finalSubject\": \"...\", \"finalBody\": \"...\" }';\n" +
        "return { json: { ...d, llmPrompt: prompt } };"
    },
    position: [5152, 144]
  },
  output: [{ prospectId: 'pros_1', llmPrompt: 'You are an email finalizer...' }]
});

const openAiValidate = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 1.7,
  config: {
    name: 'OpenAI — Pre-send Validate',
    parameters: {
      resource: 'text',
      operation: 'message',
      modelId: { __rl: true, value: 'deepseek', mode: 'list', cachedResultName: 'DEEPSEEK' },
      messages: {
        values: [
          { content: 'You are an outreach validator. Always respond with raw JSON only — no prose, no code fences.', role: 'system' },
          { content: expr('{{ $json.llmPrompt }}') }
        ]
      },
      jsonOutput: true,
      options: { temperature: 0.2 }
    },
    credentials: { openAiApi: liteLlm },
    position: [5376, 144]
  },
  output: [{ message: { content: '{"valid":true,"reason":"","finalSubject":"Hi Acme GmbH","finalBody":"..."}' } }]
});

const codeParseValidation = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Parse Validation JSON',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const lead = $('Code — Prepare LLM Payload').item.json;\n" +
        "const raw = $input.item.json;\n" +
        "let parsed = raw.message?.content ?? raw.content ?? raw.output ?? raw.text ?? raw;\n" +
        "if (Array.isArray(parsed)) parsed = parsed.map(x => (x && (x.text ?? x.content)) || '').reduce((a, b) => a + b, '');\n" +
        "if (typeof parsed === 'string') {\n" +
        "  try { parsed = JSON.parse(parsed); } catch (e) { parsed = { valid: false, reason: 'invalid JSON from LLM: ' + e.message, finalSubject: '', finalBody: '' }; }\n" +
        "}\n" +
        "const validStr = parsed.valid === true ? 'yes' : 'no';\n" +
        "const finalSubject = parsed.finalSubject || lead.templateSubject || '';\n" +
        "const finalBody = parsed.finalBody || lead.templateBody || '';\n" +
        "const finalBodyHtml = String(finalBody).replace(/\\r?\\n/g, '<br>') + '<br><br><img src=\"https://lh3.googleusercontent.com/d/1mNy9SN_iJjuw_ZgbNCwSepeF8YnozyvE\" alt=\"Evertrust GmbH\" style=\"max-width:600px;display:block;border:0;\">';\n" +
        "const bodySnippet = String(finalBody).replace(/\\s+/g, ' ').trim().slice(0, 280);\n" +
        "return { json: { ...lead, llmValid: !!parsed.valid, llmValidStr: validStr, llmReason: parsed.reason || '', finalSubject, finalBody, finalBodyHtml, bodySnippet } };"
    },
    position: [5600, 144]
  },
  output: [{ prospectId: 'pros_1', llmValidStr: 'yes', finalSubject: 'Hi Acme GmbH', finalBodyHtml: '...<br>', bodySnippet: '...' }]
});

const ifLlmValid = ifElse({
  version: 2.3,
  config: {
    name: 'IF — LLM Valid',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c-valid', leftValue: expr('{{ $json.llmValidStr }}'), rightValue: 'yes', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }]
      },
      options: {}
    },
    position: [5824, 144]
  }
});

const ifSenderHanna = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Sender Hanna?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c-sender-hanna', leftValue: expr("{{ String($json.sender || (($json.config || {}).sender) || 'info').toLowerCase() }}"), rightValue: 'hanna', operator: { type: 'string', operation: 'contains', name: 'filter.operator.contains' } }]
      },
      options: {}
    },
    position: [6048, 80]
  }
});

const gmailSendHanna = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Send Outreach (Hanna)',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: expr('{{ String($json.email).replace(/‑/g,"-").replace(/‐/g,"-").replace(/­/g,"").replace(/ /g,"").trim() }}'),
      subject: expr('{{ $json.finalSubject }}'),
      message: expr('{{ $json.finalBodyHtml }}'),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: gmailHanna },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'continueErrorOutput',
    position: [6272, 0]
  },
  output: [{ id: 'gmail_msg_1', threadId: 'gmail_thread_1' }]
});

const gmailSendInfo = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Send Outreach',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: expr('{{ String($json.email).replace(/‑/g,"-").replace(/‐/g,"-").replace(/­/g,"").replace(/ /g,"").trim() }}'),
      subject: expr('{{ $json.finalSubject }}'),
      message: expr('{{ $json.finalBodyHtml }}'),
      options: { appendAttribution: false }
    },
    credentials: { gmailOAuth2: gmailInfo },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'continueErrorOutput',
    position: [6272, 192]
  },
  output: [{ id: 'gmail_msg_1', threadId: 'gmail_thread_1' }]
});

const codeBuildSentPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Sent Payload',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const lead = $('Code — Parse Validation JSON').item.json;\n" +
        "const sent = $input.item.json;\n" +
        "return { json: { ...lead, gmailMessageId: sent.id || sent.messageId || null, gmailThreadId: sent.threadId || null } };"
    },
    position: [6496, 96]
  },
  output: [{ prospectId: 'pros_1', erpBaseUrl: 'https://evertrust-api.onrender.com', finalSubject: 'Hi', bodySnippet: '...', templateAssetId: 'asset_1', nextFollowupCount: 1, gmailMessageId: 'gmail_msg_1', gmailThreadId: 'gmail_thread_1' }]
});

// A. ERP: log SENT (REPLACES Code — Track Outreach Thread)
const erpLogSent = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Log Outreach (SENT)',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Code — Build Sent Payload').item.json.erpBaseUrl }}/outreach-messages"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ prospectId: $('Code — Build Sent Payload').item.json.prospectId, direction: \"OUTBOUND\", status: \"SENT\", gmailMessageId: $('Code — Build Sent Payload').item.json.gmailMessageId, gmailThreadId: $('Code — Build Sent Payload').item.json.gmailThreadId, subject: $('Code — Build Sent Payload').item.json.finalSubject, bodySnippet: $('Code — Build Sent Payload').item.json.bodySnippet, templateAssetId: $('Code — Build Sent Payload').item.json.templateAssetId }) }}"),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [6720, 96]
  },
  output: [{ id: 'om_1' }]
});

// A. ERP: patch prospect EMAILED (REPLACES Sheets — Update Status)
const erpPatchProspect = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Patch Prospect (EMAILED)',
    parameters: {
      method: 'PATCH',
      url: expr("{{ $('Code — Build Sent Payload').item.json.erpBaseUrl }}/prospects/{{ $('Code — Build Sent Payload').item.json.prospectId }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ status: "EMAILED", followupCount: $(\'Code — Build Sent Payload\').item.json.nextFollowupCount, lastContactedAt: $now.toISO() }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [6944, 96]
  },
  output: [{ id: 'pros_1', status: 'EMAILED' }]
});

// A. ERP: log FAILED send (per-item send error -> log + continue, don't crash run)
const erpLogFailedSend = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Log Outreach (FAILED send)',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Code — Parse Validation JSON').item.json.erpBaseUrl }}/outreach-messages"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ prospectId: $('Code — Parse Validation JSON').item.json.prospectId, direction: \"OUTBOUND\", status: \"FAILED\", subject: $('Code — Parse Validation JSON').item.json.finalSubject, bodySnippet: ($('Code — Parse Validation JSON').item.json.bodySnippet || 'gmail send failed'), templateAssetId: $('Code — Parse Validation JSON').item.json.templateAssetId }) }}"),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [6720, 320]
  },
  output: [{ id: 'om_fail_1' }]
});

// A. ERP: log FAILED validation (REPLACES Sheets — Log Error)
const erpLogFailedValidation = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Log Outreach (FAILED validation)',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.erpBaseUrl }}/outreach-messages'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ prospectId: $json.prospectId, direction: "OUTBOUND", status: "FAILED", subject: $json.finalSubject, bodySnippet: ($json.llmReason || "validation failed"), templateAssetId: $json.templateAssetId }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [6048, 320]
  },
  output: [{ id: 'om_failval_1' }]
});

// ============================ MUZZLE — outbound summary ============================
const codeAggregateCounts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Aggregate Outbound Counts',
    parameters: {
      jsCode:
        "let cold = 0, followup = 0, finalpush = 0, skipped = 0, invalid = 0;\n" +
        "let actions = [];\n" +
        "try { actions = $('Code — Compute Action').all(); } catch (e) { actions = []; }\n" +
        "for (const it of actions) {\n" +
        "  switch (it.json && it.json.actionType) {\n" +
        "    case 'cold': cold++; break;\n" +
        "    case 'followup': followup++; break;\n" +
        "    case 'finalpush': finalpush++; break;\n" +
        "    case 'skip': skipped++; break;\n" +
        "  }\n" +
        "}\n" +
        "let validations = [];\n" +
        "try { validations = $('Code — Parse Validation JSON').all(); } catch (e) { validations = []; }\n" +
        "invalid = validations.filter(v => v.json && v.json.llmValid === false).length;\n" +
        "let campaign = {};\n" +
        "try { campaign = $('Code — Build Activated Message').first().json || {}; } catch (e) { campaign = {}; }\n" +
        "const msg = 'Shots fired\\nCold: ' + cold + ' | Follow-up: ' + followup + ' | Final push: ' + finalpush + '\\nMisfires (validation failed): ' + invalid;\n" +
        "return [{ json: { ...campaign, outboundCounts: { cold, followup, finalpush, skipped, invalid }, outboundMessageBody: msg, notifyType: 'REACH_BAZOOKA_OUTBOUND_SUMMARY', notifyTitle: 'Reach Bazooka — outbound summary' } }];"
    },
    position: [4928, 384]
  },
  output: [{ campaignId: 'camp_1', campaignName: 'Container Poland', erpBaseUrl: 'https://evertrust-api.onrender.com', managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', outboundCounts: { cold: 1, followup: 0, finalpush: 0, skipped: 0, invalid: 0 }, outboundMessageBody: 'Shots fired', notifyType: 'REACH_BAZOOKA_OUTBOUND_SUMMARY', notifyTitle: 'Reach Bazooka — outbound summary' }]
});

const waOutboundSummary = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Outbound Summary',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr('{{ $json.outboundMessageBody }}'),
      additionalFields: {}
    },
    credentials: { whatsAppApi: waCred },
    onError: 'continueRegularOutput',
    position: [5152, 288]
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid.SUMMARY' }] }]
});

// B. NEW — ERP notification ALONGSIDE WhatsApp Outbound Summary
const erpNotifySummary = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Outbound Summary',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.erpBaseUrl }}/notifications'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ type: $json.notifyType, title: $json.notifyTitle, body: $json.outboundMessageBody, link: null, campaignId: $json.campaignId }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [5152, 480]
  },
  output: [{ ok: true }]
});

// End-of-run ERP callback (REPLACES nothing — added for ERP run tracking, fires once after all campaigns)
const codeBuildRunCallback = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Run Callback',
    parameters: {
      jsCode:
        "const g = $('Config — Globals').first().json;\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "const emailsSent = Number(sd.bazookaSent || 0);\n" +
        "console.log('[Bazooka] Run ' + g.runId + ' complete. emailsSent=' + emailsSent + ' (cap ' + g.maxSendsPerRun + ').');\n" +
        "return [{ json: { erpBaseUrl: g.erpBaseUrl, runId: g.runId, emailsSent } }];"
    },
    position: [2016, 480]
  },
  output: [{ erpBaseUrl: 'https://evertrust-api.onrender.com', runId: '2026-06-12-0800', emailsSent: 1 }]
});

const erpRunsCallback = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Runs Callback',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.erpBaseUrl }}/arsenal/runs/callback'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ stage: "REACH_BAZOOKA", status: "SUCCESS", campaignId: null, metrics: { emailsSent: $json.emailsSent } }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    executeOnce: true,
    onError: 'continueRegularOutput',
    position: [2240, 480]
  },
  output: [{ ok: true }]
});

// ============================ MISSING-FILE alert (config fetch failed / no config) ============================
const codeCheckConfig = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Check Config Present',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const d = $input.item.json;\n" +
        "const cfg = d.config || {};\n" +
        "const hasConfig = cfg && Object.keys(cfg).length > 0;\n" +
        "const missing = [];\n" +
        "if (!hasConfig) missing.push('campaign config (ERP /campaigns/{id}/config)');\n" +
        "if (hasConfig && !d.templatesFileId && !(d.templateSubject || d.templateBody)) missing.push('templates (Drive templatesFileId or config template)');\n" +
        "const allPresentStr = missing.length === 0 ? 'yes' : 'no';\n" +
        "const missingMessageBody = missing.length ? ('Mag jammed — missing ammo\\nCampaign: ' + (d.campaignName || '') + '\\nMissing: ' + missing.join(', ') + '\\nAction: holstered for today. Fix the ERP config / Drive template to fire.') : null;\n" +
        "return { json: { ...d, missing, allPresentStr, missingMessageBody, notifyType: 'REACH_BAZOOKA_MISSING_FILE', notifyTitle: 'Reach Bazooka — missing file' } };"
    },
    position: [3360, 432]
  },
  output: [{ campaignId: 'camp_1', campaignName: 'Container Poland', erpBaseUrl: 'https://evertrust-api.onrender.com', managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', mode: 'outbound', config: { niche: 'Container' }, templatesFileId: 'drv_tpl_1', newsFileId: 'drv_news_1', missing: [], allPresentStr: 'yes', missingMessageBody: null, notifyType: 'REACH_BAZOOKA_MISSING_FILE', notifyTitle: 'Reach Bazooka — missing file' }]
});

const ifAllFilesPresent = ifElse({
  version: 2.3,
  config: {
    name: 'IF — All Files Present',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c1', leftValue: expr('{{ $json.allPresentStr }}'), rightValue: 'yes', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }]
      },
      options: {}
    },
    position: [3584, 432]
  }
});

const waMissingFile = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Missing File Alert',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr('{{ $json.missingMessageBody }}'),
      additionalFields: {}
    },
    credentials: { whatsAppApi: waCred },
    onError: 'continueRegularOutput',
    position: [3808, 336]
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid.MISSING' }] }]
});

// B. NEW — ERP notification ALONGSIDE WhatsApp Missing File Alert
const erpNotifyMissing = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Missing File',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.erpBaseUrl }}/notifications'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ type: $json.notifyType, title: $json.notifyTitle, body: $json.missingMessageBody, link: null, campaignId: $json.campaignId }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [3808, 528]
  },
  output: [{ ok: true }]
});

// ============================ SAFETY — error handler subtree ============================
const onWorkflowError = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'On Workflow Error', position: [528, 640] },
  output: [{ execution: { id: 'exec_1', lastNodeExecuted: 'Gmail — Send Outreach', error: { message: 'boom' } }, workflow: { id: 'wf', name: 'EVERTRUST - REACH BAZOOKA (PG) v2' } }]
});

const configErrorGlobals = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config Error Globals',
    parameters: {
      assignments: {
        assignments: [
          { id: '1', name: 'managerWhatsAppNumber', value: '84333634500', type: 'string' },
          { id: '2', name: 'senderPhoneNumberId', value: '1030239273516528', type: 'string' },
          { id: '3', name: 'erpBaseUrl', value: 'https://evertrust-api.onrender.com', type: 'string' },
          { id: '4', name: 'errorPayload', value: expr('{{ $json }}'), type: 'object' }
        ]
      },
      options: {}
    },
    position: [752, 640]
  },
  output: [{ managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', erpBaseUrl: 'https://evertrust-api.onrender.com' }]
});

const codeFormatError = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code Format Error Message',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const d = $input.item.json;\n" +
        "const err = d.errorPayload || d;\n" +
        "const exec = err.execution || {};\n" +
        "const wf = err.workflow || {};\n" +
        "const e = exec.error || {};\n" +
        "const wfName = wf.name || 'unknown workflow';\n" +
        "const node = exec.lastNodeExecuted || (e.node && e.node.name) || 'unknown node';\n" +
        "const msg = (e.message || 'Unknown error').toString().slice(0, 400);\n" +
        "const id = exec.id || '';\n" +
        "const url = exec.url || (id ? ('https://evertrustgmbh.app.n8n.cloud/workflow/' + (wf.id || '') + '/executions/' + id) : '');\n" +
        "const body = 'Weapon jammed\\nWorkflow: ' + wfName + '\\nFailed at node: ' + node + '\\nTime: ' + new Date().toISOString() + '\\n\\nError: ' + msg + '\\n\\n' + (url ? ('Execution: ' + url) : '');\n" +
        "return { json: { managerWhatsAppNumber: d.managerWhatsAppNumber, senderPhoneNumberId: d.senderPhoneNumberId, erpBaseUrl: d.erpBaseUrl, errorMessageBody: body, notifyType: 'REACH_BAZOOKA_ERROR', notifyTitle: 'Reach Bazooka — workflow error' } };"
    },
    position: [976, 640]
  },
  output: [{ managerWhatsAppNumber: '84333634500', senderPhoneNumberId: '1030239273516528', erpBaseUrl: 'https://evertrust-api.onrender.com', errorMessageBody: 'Weapon jammed...', notifyType: 'REACH_BAZOOKA_ERROR', notifyTitle: 'Reach Bazooka — workflow error' }]
});

const waErrorAlert = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA Error Alert',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr('{{ $json.errorMessageBody }}'),
      additionalFields: {}
    },
    credentials: { whatsAppApi: waCred },
    onError: 'continueRegularOutput',
    position: [1200, 544]
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ERROR' }] }]
});

// B. NEW — ERP notification ALONGSIDE WhatsApp Error Alert
const erpNotifyError = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Error',
    parameters: {
      method: 'POST',
      url: expr('{{ $json.erpBaseUrl }}/notifications'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ type: $json.notifyType, title: $json.notifyTitle, body: $json.errorMessageBody, link: null, campaignId: null }) }}'),
      options: { response: { response: { neverError: true } } }
    },
    onError: 'continueRegularOutput',
    position: [1200, 736]
  },
  output: [{ ok: true }]
});

// ============================ Sticky notes ============================
const stickyDanger = sticky(
  '## DO NOT ACTIVATE until reviewed — sends real email; first runs send-capped.\n\nThis workflow sends COLD OUTREACH to real prospects. Keep INACTIVE. A human runs it manually, send-capped (Config — Globals maxSendsPerRun, default 25 via $vars.BAZOOKA_MAX_SENDS), and supervised at cutover.',
  [],
  { color: 3 }
);

const stickyHammer = sticky(
  '## HAMMER\n\nTriggers + globals. Schedule 8AM (disabled) fires the full outbound run; Config — Globals carries ERP base URL, mode, run ID, manager phone, and send-cap. ERP — Get Active Campaigns replaces the old Drive folder discovery + config.json.',
  [scheduleTrigger, webhookTrigger, configGlobals, erpGetCampaigns, codeBuildRunStart],
  { color: 4 }
);

const stickyErp = sticky(
  '## ERP credential — UNBOUND\n\nSelect the ERP Ingest (x-arsenal-token) credential (HTTP Header Auth) on EVERY "ERP — ..." HTTP node before running (campaigns, config, send list, outreach-messages SENT/FAILED, prospect PATCH, runs callback, and the 5 /notifications nodes).\n\nUpdate the base URL in Config — Globals if it differs from https://evertrust-api.onrender.com (live only post-deploy).',
  [],
  { color: 4 }
);

const stickyBarrel = sticky(
  '## BARREL\n\nOutbound pipeline. Loop Campaigns -> ERP config -> templates from Postgres (config.templates.coldEmail + newsBrief via Parse Template Blocks / Parse News) -> ERP send list (server applies campaign-ACTIVE + status + followupCount<3 + lastContactedAt + suppression) -> send-cap guard -> Loop Prospects -> Compute Action -> LLM validate/personalize -> IF Valid -> IF Sender (Hanna/info@) -> Gmail send -> ERP log SENT + patch EMAILED. Per-item send failure -> ERP log FAILED + continue.',
  [],
  { color: 7 }
);

const stickySender = sticky(
  '## Sender branch (preserved from live)\n\nIF — Sender Hanna? lowercases the campaign sender and checks contains "hanna".\n- true  -> Gmail — Send Outreach (Hanna)  [cred: Gmail account: Hanna]\n- false -> Gmail — Send Outreach  [cred: Gmail account / info@]\n\nBoth Gmail nodes are bound explicitly by id so n8n does not collapse them onto one credential.',
  [],
  { color: 5 }
);

const stickyMuzzle = sticky(
  '## MUZZLE\n\nOutbound summary + end-of-run callback. Aggregate counts per campaign -> WhatsApp digest + ERP /notifications. Loop done -> ERP /arsenal/runs/callback (stage REACH_BAZOOKA, emailsSent).',
  [],
  { color: 6 }
);

const stickySafety = sticky(
  '## SAFETY\n\nError handler subtree. Any workflow error -> On Workflow Error -> Config Error Globals -> Code Format Error Message -> WA Error Alert + ERP /notifications.',
  [],
  { color: 3 }
);

const stickyNotify = sticky(
  '## ERP notifications (NEW, alongside WhatsApp)\n\nEvery WhatsApp manager ping now also POSTs to ERP /notifications (Run Start, Campaign Activated, Missing File, Outbound Summary, Error). Both channels fire in parallel; the ERP legs use onError continueRegularOutput so a notify failure never blocks the send pipeline.',
  [],
  { color: 6 }
);

// ============================ Compose ============================
export default workflow('reach-bazooka-pg-v2', 'EVERTRUST - REACH BAZOOKA (PG) v2')
  // ---- HAMMER: schedule path ----
  .add(scheduleTrigger)
  .to(configGlobals)
  .to(erpGetCampaigns)
  .to(codeBuildRunStart)
  .to(ifOutboundRunStart
    .onTrue(waRunStart.to(codeExplodeCampaigns))
    .onFalse(codeExplodeCampaigns)
  )
  // ERP notify Run Start fans out from the same builder (parallel to WA)
  .add(codeBuildRunStart)
  .to(erpNotifyRunStart)
  // webhook path -> same globals
  .add(webhookTrigger)
  .to(configGlobals)

  // ---- BARREL: campaign loop ----
  .add(codeExplodeCampaigns)
  .to(loopCampaigns)
  .add(loopCampaigns
    .onDone(codeBuildRunCallback.to(erpRunsCallback))
    .onEachBatch(
      erpGetConfig
        .to(codeMergeConfig)
        .to(codeCheckConfig)
        .to(ifAllFilesPresent
          .onTrue(
            codeParseTemplates
              .to(codeParseNews)
              .to(ifOutboundActivate
                .onTrue(
                  erpGetSendList
                    .to(codeBuildActivated)
                    .to(waCampaignActivated)
                    .to(codeExplodeProspects)
                    .to(loopProspects
                      .onDone(codeAggregateCounts
                        .to(waOutboundSummary)
                        .to(nextBatch(loopCampaigns))
                      )
                      .onEachBatch(
                        codeComputeAction
                          .to(ifActionOrSkip
                            .onTrue(nextBatch(loopProspects))
                            .onFalse(
                              codePrepareLlm
                                .to(openAiValidate)
                                .to(codeParseValidation)
                                .to(ifLlmValid
                                  .onTrue(
                                    ifSenderHanna
                                      .onTrue(gmailSendHanna)
                                      .onFalse(gmailSendInfo)
                                  )
                                  .onFalse(erpLogFailedValidation.to(nextBatch(loopProspects)))
                                )
                            )
                          )
                      )
                    )
                )
                .onFalse(nextBatch(loopCampaigns))
              )
          )
          .onFalse(waMissingFile.to(nextBatch(loopCampaigns)))
        )
    )
  )
  // Campaign Activated ERP notify (parallel to WA)
  .add(codeBuildActivated)
  .to(erpNotifyActivated)
  // Missing-file ERP notify (parallel to WA)
  .add(codeCheckConfig)
  .to(erpNotifyMissing)
  // Outbound Summary ERP notify (parallel to WA)
  .add(codeAggregateCounts)
  .to(erpNotifySummary)

  // ---- Gmail send -> ERP log/patch, with per-item FAILED-send branch ----
  .add(gmailSendHanna
    .onError(erpLogFailedSend.to(nextBatch(loopProspects)))
  )
  .to(codeBuildSentPayload)
  .to(erpLogSent)
  .to(erpPatchProspect)
  .to(nextBatch(loopProspects))
  .add(gmailSendInfo
    .onError(erpLogFailedSend.to(nextBatch(loopProspects)))
  )
  .to(codeBuildSentPayload)

  // ---- SAFETY: error handler (fans out to WA + ERP notify) ----
  .add(onWorkflowError)
  .to(configErrorGlobals)
  .to(codeFormatError)
  .to(waErrorAlert)
  .add(codeFormatError)
  .to(erpNotifyError)

  // ---- stickies ----
  .add(stickyDanger)
  .add(stickyHammer)
  .add(stickyErp)
  .add(stickyBarrel)
  .add(stickySender)
  .add(stickyMuzzle)
  .add(stickySafety)
  .add(stickyNotify);
