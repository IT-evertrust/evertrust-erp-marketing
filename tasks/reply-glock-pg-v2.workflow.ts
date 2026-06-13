import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  switchCase,
  splitInBatches,
  nextBatch,
  expr,
} from '@n8n/workflow-sdk';

// ---------------------------------------------------------------------------
// EVERTRUST - REPLY GLOCK (PG) v2
// Faithful clone of the original "EVERTRUST - REPLY GLOCK" (Vi9x1RhdRIaePZPQ).
// ONLY the lead-data nodes are swapped for the ERP API; every other feature is
// preserved verbatim. Created INACTIVE.
// ---------------------------------------------------------------------------

const ERP = 'https://evertrust-api.onrender.com';

// Bound credentials (REACH ARSENAL team project where possible).
const CRED_GMAIL = newCredential('Gmail account: Hanna', 'iBJ8BCOqhFb5kDUg');
const CRED_CAL = newCredential('Google Calendar account: Hanna', 'K8toWX5wjc8Oceev');
const CRED_DRIVE = newCredential('Google Drive account: Hanna', 'R1hfa3xjcJxi0F2E');
const CRED_WA = newCredential('WhatsApp account', 'hfg64imhwFA01Qcb');
const CRED_OPENAI = newCredential('LiteLLM Gateway (mac-mini)', '2YgDmy9NuLHvOgzJ');
// ERP machine routes — x-arsenal-token header auth, intentionally UNBOUND.
// One shared placeholder credential; the user binds "ERP Ingest (x-arsenal-token)" once.
const CRED_ERP = newCredential('ERP Ingest (x-arsenal-token)');

const SIG_IMG =
  '<br><br><img src="https://lh3.googleusercontent.com/d/1mNy9SN_iJjuw_ZgbNCwSepeF8YnozyvE" alt="Evertrust GmbH" style="max-width:600px;display:block;border:0;">';

// ===========================================================================
// TRIGGERS + ENTRY (kept; Schedule + Webhook disabled like the original)
// ===========================================================================
const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Schedule - Every 15 Min',
    disabled: true,
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '*/15 * * * *' }] } },
    position: [-160, 208],
  },
  output: [{}],
});

const webhookTrigger = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webhook',
    disabled: true,
    parameters: { path: 'wf6-reply-glock-pg-v2', options: {} },
    position: [-160, 400],
  },
  output: [{}],
});

const configGlobals = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Config — Globals (Replies)',
    parameters: {
      assignments: {
        assignments: [
          { id: '1', name: 'rootFolderName', value: 'Evertrust Campaigns', type: 'string' },
          { id: '2', name: 'managerWhatsAppNumber', value: '84333634500', type: 'string' },
          { id: '3', name: 'errorAlertThreshold', value: 3, type: 'number' },
          { id: '4', name: 'senderPhoneNumberId', value: '1030239273516528', type: 'string' },
          { id: '5', name: 'runId', value: expr("{{ $now.toFormat('yyyy-LL-dd-HHmm') }}"), type: 'string' },
          { id: '6', name: 'today', value: expr("{{ $now.toFormat('yyyy-LL-dd') }}"), type: 'string' },
          { id: '7', name: 'errorsSheetName', value: 'Errors_Sheet', type: 'string' },
          { id: '8', name: 'reviewEmailDefault', value: 'marketing@evertrust.de', type: 'string' },
          { id: '9', name: 'errorsSheetId', value: '1ha4n6JG37e09kp6CuXBpDGp6uclqaK7XcbRBkor9YCw', type: 'string' },
          { id: '10', name: 'mode', value: 'replies', type: 'string' },
        ],
      },
      options: {},
    },
    position: [64, 208],
  },
  output: [{ runId: '2026-06-12-1200', today: '2026-06-12', mode: 'replies' }],
});

// ===========================================================================
// SWAP A — CAMPAIGN RESOLUTION via ERP (replaces the Drive folder discovery)
// ===========================================================================
const erpListCampaigns = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — List Active Campaigns',
    parameters: {
      method: 'GET',
      url: `${ERP}/campaigns/machine/list`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'lifecycle', value: 'ACTIVE' }] },
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    position: [320, 208],
  },
  output: [{ id: 'camp-uuid', name: 'Bavaria GC', project: 'Golf clubs', country: 'DE', region: 'Bavaria', sender: 'info', gmailLabel: 'Bavaria', driveFolderId: 'drv1', nicheId: 'niche-uuid' }],
});

const buildRunStart = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Run Start Message',
    parameters: {
      jsCode:
        "// Pick whichever globals node fired this run.\n" +
        "let globals = null;\n" +
        "try { const g = $('Config — Globals').first(); if (g && g.json && g.json.runId) globals = g.json; } catch (e) {}\n" +
        "if (!globals) {\n" +
        "  try { const g = $('Config — Globals (Replies)').first(); if (g && g.json && g.json.runId) globals = g.json; } catch (e) {}\n" +
        "}\n" +
        "if (!globals) throw new Error('No globals node executed. Expected Config — Globals or Config — Globals (Replies).');\n" +
        "const mode = globals.mode || 'replies';\n" +
        "// ERP machine campaign list -> normalize into the campaign-folder shape the rest of the flow uses.\n" +
        "const campaigns = items.filter(it => it.json && it.json.id).map(it => ({ campaignId: it.json.id, campaignName: it.json.name || '(unnamed)', driveFolderId: it.json.driveFolderId || null }));\n" +
        "let body;\n" +
        "if (campaigns.length === 0) {\n" +
        "  body = 'Bazooka dry-fire — no ammo loaded\\nRun ID: ' + globals.runId + '\\n\\nNo ACTIVE campaigns in the ERP.';\n" +
        "} else if (mode === 'replies') {\n" +
        "  body = 'Recon sweep started\\nRun ID: ' + globals.runId + '\\nScanning ' + campaigns.length + ' campaigns for return fire...';\n" +
        "} else {\n" +
        "  body = 'Locked and loaded\\nRun ID: ' + globals.runId + '\\nLoading ' + campaigns.length + ' mags now...';\n" +
        "}\n" +
        "return [{ json: { runId: globals.runId, today: globals.today, managerWhatsAppNumber: globals.managerWhatsAppNumber, senderPhoneNumberId: globals.senderPhoneNumberId, errorAlertThreshold: globals.errorAlertThreshold, errorsSheetName: globals.errorsSheetName, errorsSheetId: globals.errorsSheetId, reviewEmailDefault: globals.reviewEmailDefault, mode, campaigns, messageBody: body } }];",
    },
    position: [560, 208],
  },
  output: [{ runId: '2026-06-12-1200', campaigns: [{ campaignId: 'camp-uuid', campaignName: 'Bavaria GC' }] }],
});

const explodeCampaigns = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Explode Campaigns',
    parameters: {
      jsCode:
        "const start = $('Code — Build Run Start Message').first().json;\n" +
        "return (start.campaigns || []).map(c => ({ json: { campaignId: c.campaignId, campaignName: c.campaignName, driveFolderId: c.driveFolderId || null, runId: start.runId, today: start.today, managerWhatsAppNumber: start.managerWhatsAppNumber, senderPhoneNumberId: start.senderPhoneNumberId, errorAlertThreshold: start.errorAlertThreshold, errorsSheetName: start.errorsSheetName, errorsSheetId: start.errorsSheetId, reviewEmailDefault: start.reviewEmailDefault, mode: start.mode || 'replies' } }));",
    },
    position: [784, 208],
  },
  output: [{ campaignId: 'camp-uuid', campaignName: 'Bavaria GC' }],
});

const loopCampaigns = splitInBatches({
  version: 3,
  config: { name: 'Loop — Campaigns', parameters: { options: {} }, position: [1008, 208] },
});

// Per-campaign (loop output 1): fetch the ERP campaign config (niche/region/project)
// + KEEP the Drive templates download. Replaces the Drive config-folder chain.
const erpGetCampaignConfig = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Get Campaign Config',
    parameters: {
      method: 'GET',
      url: expr(`${ERP}/campaigns/{{ $json.campaignId }}/config`),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    position: [1232, 320],
  },
  output: [{ campaignId: 'camp-uuid', name: 'Bavaria GC', project: 'Golf clubs', country: 'DE', region: 'Bavaria', sender: 'info', gmailLabel: 'Bavaria', driveFolderId: 'drv1', niche: { id: 'n', name: 'Golf Clubs', slug: 'golf' } }],
});

const collectCampaign = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Collect Campaign',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "// Store the resolved campaign (config niche/city/project + ids + the Drive folder for templates)\n" +
        "// in global static data, keyed per run, so the reply monitor (which runs AFTER the loop) sees ALL\n" +
        "// active campaigns and can attach campaign context to a reply by campaignId.\n" +
        "const loop = $('Loop — Campaigns').item.json;\n" +
        "const cfg = $input.item.json || {};\n" +
        "const niche = (cfg.niche && (cfg.niche.name || cfg.niche.slug)) || '';\n" +
        "const campaign = {\n" +
        "  campaignId: cfg.campaignId || loop.campaignId,\n" +
        "  campaignName: cfg.name || loop.campaignName || 'unknown',\n" +
        "  niche,\n" +
        "  city: cfg.region || '',\n" +
        "  project: cfg.project || '',\n" +
        "  sender: cfg.sender || 'info',\n" +
        "  gmailLabel: cfg.gmailLabel || '',\n" +
        "  driveFolderId: cfg.driveFolderId || loop.driveFolderId || null,\n" +
        "};\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "if (sd.aggRunId !== loop.runId) { sd.aggRunId = loop.runId; sd.aggCampaigns = []; }\n" +
        "sd.aggCampaigns = (sd.aggCampaigns || []).filter(c => c.campaignId !== campaign.campaignId);\n" +
        "sd.aggCampaigns.push(campaign);\n" +
        "return { json: { ...loop, ...campaign, templatesFolderId: campaign.driveFolderId } };",
    },
    position: [1456, 320],
  },
  output: [{ campaignId: 'camp-uuid', campaignName: 'Bavaria GC', niche: 'Golf Clubs', city: 'Bavaria', project: 'Golf clubs', driveFolderId: 'drv1' }],
});

// KEEP — templates are CONTENT, stay in Drive (like Ammo Forge). The slot-proposal +
// meeting-confirmation emails rely on them. List the campaign folder, find templates.doc, download it.
const driveListCampaignFiles = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Drive — List Campaign Files',
    parameters: {
      resource: 'fileFolder',
      operation: 'search',
      returnAll: true,
      filter: { folderId: { __rl: true, mode: 'id', value: expr('{{ $json.driveFolderId }}') } },
      options: {},
    },
    credentials: { googleDriveOAuth2Api: CRED_DRIVE },
    alwaysOutputData: true,
    position: [1680, 320],
  },
  output: [{ id: 'file1', name: 'templates.doc' }],
});

const findTemplatesFile = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Find Templates File',
    parameters: {
      jsCode:
        "// Find templates.doc by name in the campaign Drive folder. Drive v3 list has alwaysOutputData,\n" +
        "// so an empty folder yields a placeholder with no .name — filter those out.\n" +
        "const campaign = $('Code — Collect Campaign').first().json;\n" +
        "const files = items.map(i => i.json).filter(f => f && f.name);\n" +
        "const templatesFile = files.find(f => (f.name || '').toLowerCase().includes('template'));\n" +
        "return [{ json: { ...campaign, templatesFileId: templatesFile ? templatesFile.id : null, templatesPresent: !!templatesFile } }];",
    },
    position: [1904, 320],
  },
  output: [{ campaignId: 'camp-uuid', templatesFileId: 'file1', templatesPresent: true }],
});

// Only proceed to download when a templates file exists; otherwise notify (parity with
// the original's missing-file alert) and continue the loop.
const ifTemplatesPresent = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Templates Present',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { id: 'c1', leftValue: expr('{{ $json.templatesPresent }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } },
        ],
      },
      options: {},
    },
    position: [2128, 320],
  },
  output: [{}],
});

const driveDownloadTemplates = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Drive — Download templates.doc',
    parameters: {
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: expr('{{ $json.templatesFileId }}') },
      options: { googleFileConversion: { conversion: { docsToFormat: 'text/plain' } } },
    },
    credentials: { googleDriveOAuth2Api: CRED_DRIVE },
    position: [2352, 224],
  },
  output: [{}],
});

const parseTemplateBlocks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Parse Template Blocks',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const campaign = $('Code — Find Templates File').first().json;\n" +
        "const bin = $input.item.binary && $input.item.binary.data;\n" +
        "let text = '';\n" +
        "if (bin) {\n" +
        "  try {\n" +
        "    const buf = await this.helpers.getBinaryDataBuffer(0, 'data');\n" +
        "    text = buf.toString('utf8');\n" +
        "  } catch (e) {}\n" +
        "  if (!text && typeof bin.data === 'string') {\n" +
        "    text = bin.data;\n" +
        "  }\n" +
        "  if (text && !/\\[(COLD|FOLLOWUP|FINALPUSH)\\]/i.test(text) && /^[A-Za-z0-9+/=\\s]+$/.test(text)) {\n" +
        "    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch (e) {}\n" +
        "  }\n" +
        "}\n" +
        "function extract(blockTag) {\n" +
        "  const re = new RegExp('\\\\[' + blockTag + '\\\\]([\\\\s\\\\S]*?)(?=\\\\n\\\\[(?:COLD|FOLLOWUP|FINALPUSH)\\\\]|$)', 'i');\n" +
        "  const m = text.match(re);\n" +
        "  if (!m) return { subject: '', body: '' };\n" +
        "  const raw = m[1];\n" +
        "  const subjMatch = raw.match(/Subject:\\s*(.+)/i);\n" +
        "  const bodyMatch = raw.match(/Body:\\s*([\\s\\S]+)/i);\n" +
        "  return { subject: (subjMatch && subjMatch[1] || '').trim(), body: (bodyMatch && bodyMatch[1] || '').trim() };\n" +
        "}\n" +
        "const templates = { COLD: extract('COLD'), FOLLOWUP: extract('FOLLOWUP'), FINALPUSH: extract('FINALPUSH') };\n" +
        "return { json: { ...campaign, templates } };",
    },
    position: [2576, 224],
  },
  output: [{ campaignId: 'camp-uuid', templates: { COLD: { subject: '', body: '' } } }],
});

// Missing-templates alert (parity with the original WA — Missing File Alert) + ERP notification.
const buildMissingMsg = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Missing Templates Msg',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const c = $input.item.json;\n" +
        "const body = 'Mag jammed — missing ammo\\nCampaign: ' + (c.campaignName || c.campaignId) + '\\nMissing: templates.doc (Google Doc)\\nAction: holstered for today. Reload the file to fire.';\n" +
        "return { json: { ...c, missingMessageBody: body } };",
    },
    position: [2352, 432],
  },
  output: [{ missingMessageBody: 'Mag jammed' }],
});

const waMissingFileAlert = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Missing File Alert',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr('{{ $json.missingMessageBody }}'),
      additionalFields: {},
    },
    credentials: { whatsAppApi: CRED_WA },
    onError: 'continueRegularOutput',
    position: [2576, 432],
  },
  output: [{}],
});

const erpNotifyMissingFile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Missing File',
    parameters: {
      method: 'POST',
      url: `${ERP}/notifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "type": "campaign_missing_file",\n' +
          '  "title": "Campaign missing templates.doc",\n' +
          '  "body": {{ JSON.stringify($json.missingMessageBody || "") }},\n' +
          '  "link": "/campaigns/{{ $json.campaignId }}",\n' +
          '  "campaignId": "{{ $json.campaignId }}"\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    position: [2576, 592],
  },
  output: [{}],
});

// ===========================================================================
// REPLY DETECTION (KEPT verbatim — both inboxes)
// ===========================================================================
const collectActiveLabels = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Collect Active Labels',
    parameters: {
      jsCode:
        "// Globals come from the campaign loop item (carries runId/today/manager/sender).\n" +
        "const globals = $('Loop — Campaigns').first().json;\n" +
        "// Resolved campaigns live in global static data (Code — Collect Campaign).\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "const aggCampaigns = sd.aggCampaigns || [];\n" +
        "const labels = aggCampaigns.map(c => c.gmailLabel).filter(Boolean);\n" +
        "// Search broadly for unread replies; match to known prospects per-reply via the ERP.\n" +
        "// 'subject:Re:' excludes calendar-system messages and brand-new emails; exclude calendar/noreply senders.\n" +
        "const gmailQuery = 'is:unread newer_than:30d subject:Re: -from:calendar-notification@google.com -from:noreply@google.com -from:pictory.ai -from:activecampaign.com -from:otter.ai -from:read.ai -from:e.read.ai';\n" +
        "return [{ json: { runId: globals.runId, today: globals.today, managerWhatsAppNumber: globals.managerWhatsAppNumber, senderPhoneNumberId: globals.senderPhoneNumberId, activeLabels: labels, gmailQuery, hasActiveCampaigns: labels.length > 0 } }];",
    },
    position: [1232, 96],
  },
  output: [{ runId: '2026-06-12-1200', gmailQuery: 'is:unread newer_than:30d subject:Re:' }],
});

const getReplies = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Get Replies',
    parameters: { operation: 'getAll', filters: { q: expr('{{ $json.gmailQuery }}'), readStatus: 'unread' } },
    credentials: { gmailOAuth2: CRED_GMAIL },
    position: [1456, 0],
  },
  output: [{ id: 'msg1', threadId: 'thr1' }],
});

const getRepliesHanna = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Get Replies (Hanna)',
    parameters: { operation: 'getAll', filters: { q: expr('{{ $json.gmailQuery }}'), readStatus: 'unread' } },
    credentials: { gmailOAuth2: CRED_GMAIL },
    position: [1456, 192],
  },
  output: [{ id: 'msg2', threadId: 'thr2' }],
});

const hydrateBody = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Hydrate Body',
    parameters: { operation: 'get', messageId: expr('{{ $json.id }}'), simple: false, options: {} },
    credentials: { gmailOAuth2: CRED_GMAIL },
    onError: 'continueRegularOutput',
    position: [1680, 0],
  },
  output: [{ id: 'msg1', payload: {} }],
});

const hydrateBodyHanna = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Hydrate Body (Hanna)',
    parameters: { operation: 'get', messageId: expr('{{ $json.id }}'), simple: false, options: {} },
    credentials: { gmailOAuth2: CRED_GMAIL },
    onError: 'continueRegularOutput',
    position: [1680, 192],
  },
  output: [{ id: 'msg2', payload: {} }],
});

// Enrich replies (KEPT — dedupe + body extraction + sender detection). The ONLY change
// vs. the original: sender (info/hanna) is detected from the To/Delivered-To header
// instead of the lead's "Send From" column; prospect matching now happens per-reply
// against the ERP (next node) instead of against a pre-loaded leads list.
const enrichReplyContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Enrich Reply Context',
    parameters: {
      jsCode:
        "// --- Enrich Gmail replies robustly, always returns something ---\n" +
        "const globalsNode = $('Code — Collect Active Labels').first();\n" +
        "if (!globalsNode || !globalsNode.json) throw new Error('Globals node not found');\n" +
        "const globals = globalsNode.json;\n" +
        "\n" +
        "function getBody(m) {\n" +
        "  try {\n" +
        "    if (m.text) return String(m.text);\n" +
        "    if (m.textPlain) return String(m.textPlain);\n" +
        "    const acc={plain:'',html:''};\n" +
        "    function walkParts(p){\n" +
        "      if(!p) return;\n" +
        "      if(p.mimeType==='text/plain' && p.body?.data) acc.plain += Buffer.from(p.body.data,'base64').toString('utf8');\n" +
        "      else if(p.mimeType==='text/html' && p.body?.data) acc.html += Buffer.from(p.body.data,'base64').toString('utf8');\n" +
        "      if(Array.isArray(p.parts)) p.parts.forEach(c=>walkParts(c));\n" +
        "    }\n" +
        "    walkParts(m.payload);\n" +
        "    return (acc.plain || acc.html.replace(/<[^>]+>/g,' ')).trim();\n" +
        "  } catch(e){ return ''; }\n" +
        "}\n" +
        "function getHeader(m,name){\n" +
        "  const h = m.payload?.headers?.find(h=>h.name?.toLowerCase()===name.toLowerCase());\n" +
        "  return h?.value || m[name] || '';\n" +
        "}\n" +
        "\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "sd._processedReplyIds = sd._processedReplyIds || {};\n" +
        "\n" +
        "const byThread = new Map();\n" +
        "for(const it of items){\n" +
        "  const m = it.json;\n" +
        "  const tid = m.threadId || m.id;\n" +
        "  const ts = Number(m.internalDate || Date.parse(m.date) || 0);\n" +
        "  const existing = byThread.get(tid);\n" +
        "  if(!existing || ts>Number(existing.internalDate || 0)) byThread.set(tid,m);\n" +
        "}\n" +
        "\n" +
        "const results = [];\n" +
        "for(const m of byThread.values()){\n" +
        "  const fromEmail = (getHeader(m,'From').match(/<([^>]+)>/)?.[1] || getHeader(m,'From')).trim();\n" +
        "  const subject = getHeader(m,'Subject') || '';\n" +
        "  const bodyText = getBody(m);\n" +
        "  // Which inbox received it? Detect Hanna from the recipient headers.\n" +
        "  const recipients = (getHeader(m,'To') + ' ' + getHeader(m,'Delivered-To') + ' ' + getHeader(m,'Cc')).toLowerCase();\n" +
        "  const sender = /hanna/.test(recipients) ? 'hanna' : 'info';\n" +
        "\n" +
        "  if(sd._processedReplyIds[m.id]) continue;\n" +
        "  sd._processedReplyIds[m.id] = Date.now();\n" +
        "\n" +
        "  results.push({\n" +
        "    json: {\n" +
        "      runId: globals.runId,\n" +
        "      today: globals.today,\n" +
        "      managerWhatsAppNumber: globals.managerWhatsAppNumber,\n" +
        "      senderPhoneNumberId: globals.senderPhoneNumberId,\n" +
        "      messageId: m.id || m.messageId,\n" +
        "      threadId: m.threadId,\n" +
        "      fromEmail,\n" +
        "      leadEmail: fromEmail,\n" +
        "      subject,\n" +
        "      replyText: bodyText,\n" +
        "      sender,\n" +
        "      matched: true\n" +
        "    }\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "if(results.length === 0){\n" +
        "  results.push({ json: {\n" +
        "    runId: globals.runId,\n" +
        "    today: globals.today,\n" +
        "    messageId: 'no-message',\n" +
        "    threadId: 'no-thread',\n" +
        "    fromEmail: 'no-email',\n" +
        "    leadEmail: 'no-email',\n" +
        "    subject: 'no-subject',\n" +
        "    replyText: 'No messages matched the enrichment rules',\n" +
        "    sender: 'info',\n" +
        "    matched: false\n" +
        "  }});\n" +
        "}\n" +
        "\n" +
        "return results;",
    },
    position: [1904, 96],
  },
  output: [{ messageId: 'msg1', fromEmail: 'a@b.de', leadEmail: 'a@b.de', subject: 'Re: x', replyText: 'yes', sender: 'info', matched: true }],
});

const loopReplies = splitInBatches({
  version: 3,
  config: { name: 'Loop — Replies', parameters: { options: {} }, position: [2128, 96] },
});

// ===========================================================================
// SWAP — PER-REPLY PROSPECT RESOLUTION via ERP (replaces Sheets — Read Leads)
// + ADD outreach-message ledger entry once the reply is matched to a prospect.
// ===========================================================================
const erpGetProspect = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Get Prospect by Email',
    parameters: {
      method: 'GET',
      url: `${ERP}/prospects`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'email', value: expr('{{ $json.fromEmail }}') },
          { name: 'limit', value: '1' },
        ],
      },
      options: { response: { response: { neverError: true } } },
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    position: [2352, 0],
  },
  output: [[{ id: 'prospect-uuid', email: 'a@b.de', companyName: 'ACME', status: 'REPLIED', campaignId: 'camp-uuid' }]],
});

const resolveProspect = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Resolve Prospect',
    parameters: {
      jsCode:
        "// Match the reply to an ERP prospect. The HTTP node returns an array of ProspectDto.\n" +
        "// Not-found -> emit NOTHING (skip), mirroring the original's missing-lead path.\n" +
        "const reply = $('Code — Enrich Reply Context').item.json;\n" +
        "if (reply && reply.matched === false) return [];\n" +
        "\n" +
        "const raw = $input.first().json;\n" +
        "let rows = [];\n" +
        "if (Array.isArray(raw)) rows = raw;\n" +
        "else if (raw && Array.isArray(raw.data)) rows = raw.data;\n" +
        "else if (raw && raw.id) rows = [raw];\n" +
        "const p = rows[0];\n" +
        "if (!p || !p.id) return []; // unknown sender — skip like the original missing-lead path\n" +
        "\n" +
        "// Attach campaign context (niche/city/project) resolved earlier into static data.\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "const camp = (sd.aggCampaigns || []).find(c => c.campaignId === p.campaignId) || {};\n" +
        "\n" +
        "return [{ json: {\n" +
        "  ...reply,\n" +
        "  prospectId: p.id,\n" +
        "  campaignId: p.campaignId || camp.campaignId || '',\n" +
        "  campaignName: camp.campaignName || 'unknown',\n" +
        "  companyName: p.companyName || '',\n" +
        "  companyType: p.companyType || '',\n" +
        "  currentStatus: p.status || '',\n" +
        "  niche: camp.niche || '',\n" +
        "  city: camp.city || '',\n" +
        "  project: camp.project || '',\n" +
        "  sender: reply.sender || camp.sender || 'info'\n" +
        "} }];",
    },
    position: [2576, 0],
  },
  output: [{ prospectId: 'prospect-uuid', campaignId: 'camp-uuid', companyName: 'ACME', currentStatus: 'REPLIED', niche: 'Golf Clubs', city: 'Bavaria', project: 'Golf clubs', sender: 'info' }],
});

// ADD — conversation-ledger inbound entry (idempotent on gmailMessageId). Runs right
// after the reply is matched to a prospect; failure must not block the pipeline.
const erpLogInbound = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Log Inbound Message',
    parameters: {
      method: 'POST',
      url: `${ERP}/outreach-messages`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "prospectId": "{{ $json.prospectId }}",\n' +
          '  "direction": "INBOUND",\n' +
          '  "status": "RECEIVED",\n' +
          '  "gmailMessageId": {{ JSON.stringify($json.messageId || "") }},\n' +
          '  "gmailThreadId": {{ JSON.stringify($json.threadId || "") }},\n' +
          '  "subject": {{ JSON.stringify(($json.subject || "").slice(0, 2000)) }},\n' +
          '  "bodySnippet": {{ JSON.stringify(($json.replyText || "").slice(0, 8000)) }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    position: [2800, 0],
  },
  output: [{ id: 'msg-row-uuid', prospectId: 'prospect-uuid' }],
});

// Already-Interested gate (KEPT) — but keyed on the prospect's ERP status.
const ifAlreadyInterested = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Already Interested',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [
          { id: 'c1', leftValue: expr('{{ $json.currentStatus }}'), rightValue: 'INTERESTED', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } },
        ],
      },
      options: {},
    },
    position: [3024, 0],
  },
  output: [{}],
});

// ===========================================================================
// CLASSIFY (KEPT verbatim — prompt unchanged)
// ===========================================================================
const buildClassifyPrompt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Classify Prompt',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const { __sibReset, ...d } = $input.item.json;\n" +
        "const now = DateTime.now().setZone('Europe/Berlin');\n" +
        "const nowHuman = now.setLocale('en-GB').toFormat(\"EEE, dd LLL yyyy 'at' HH:mm\");\n" +
        "const prompt = `You are classifying a reply to a cold outreach email.\\n\\nCampaign: ${d.niche} in ${d.city} — ${d.project}\\nLead: ${d.companyName} (${d.companyType})\\nTheir reply: ${d.replyText}\\n\\nToday is ${nowHuman} (Europe/Berlin).\\n\\nClassify \"classification\" as exactly one of: Interested, Unsure, Not Interested.\\nIf and only if classification is \"Not Interested\", also set \"niType\":\\n- \"temporary\" = a soft no for now (busy, bad timing, no budget/project now, \"maybe later\", \"circle back\").\\n- \"permanent\" = a hard no / opt-out (stop contacting, remove us, unsubscribe, not relevant, do not contact).\\nWhen unsure between temporary and permanent, choose \"temporary\".\\nFor Interested or Unsure, set \"niType\" to \"\".\\n\\nIf the lead proposes or requests a specific meeting date/time, set \"proposedDateTime\" to that moment as ISO 8601 with timezone offset (assume Europe/Berlin if none given), resolving relative phrases (\"tomorrow 3pm\", \"next Tue morning\") against today above. If no specific time is proposed, set \"proposedDateTime\" to \"\". Set \"proposedRaw\" to their exact wording (or \"\").\\n\\nReturn JSON only:\\n{\\n  \"classification\": \"Interested\" or \"Unsure\" or \"Not Interested\",\\n  \"niType\": \"temporary\" or \"permanent\" or \"\",\\n  \"proposedDateTime\": \"ISO 8601 or empty\",\\n  \"proposedRaw\": \"their words or empty\",\\n  \"confidence\": \"high\" or \"low\",\\n  \"reasoning\": \"one sentence\"\\n}`;\n" +
        "return { json: { ...d, classifyPrompt: prompt } };",
    },
    position: [3248, 112],
  },
  output: [{ classifyPrompt: 'You are classifying...' }],
});

const openAiClassify = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 1.7,
  config: {
    name: 'OpenAI — Classify Reply',
    parameters: {
      modelId: { __rl: true, value: 'deepseek', mode: 'list', cachedResultName: 'DEEPSEEK' },
      messages: {
        values: [
          { content: 'You are a reply classifier. Always respond with raw JSON only — no prose, no code fences.', role: 'system' },
          { content: expr('{{ $json.classifyPrompt }}') },
        ],
      },
      jsonOutput: true,
      options: { temperature: 0.1 },
    },
    credentials: { openAiApi: CRED_OPENAI },
    position: [3472, 112],
  },
  output: [{ message: { content: { classification: 'Interested' } } }],
});

const parseClassification = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Parse Classification',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const lead = $('Code — Build Classify Prompt').item.json;\n" +
        "const raw = $input.item.json;\n" +
        "let parsed = raw.message?.content ?? raw.content ?? raw;\n" +
        "if (typeof parsed === 'string') {\n" +
        "  try { parsed = JSON.parse(parsed); } catch (e) { parsed = { classification: 'Unsure', confidence: 'low', reasoning: 'LLM JSON parse failed' }; }\n" +
        "}\n" +
        "const c = (parsed.classification || '').trim();\n" +
        "const normalized = c === 'Interested' ? 'Interested' : (c === 'Not Interested' ? 'Not Interested' : 'Unsure');\n" +
        "\n" +
        "// Sub-classify Not Interested. Deleting a lead is irreversible, so only hard-stop on an explicit permanent signal.\n" +
        "let niType = '';\n" +
        "let niStatus = '';\n" +
        "let snoozeUntil = '';\n" +
        "if (normalized === 'Not Interested') {\n" +
        "  niType = ((parsed.niType || '').toString().trim().toLowerCase() === 'permanent') ? 'permanent' : 'temporary';\n" +
        "  if (niType === 'permanent') {\n" +
        "    niStatus = 'Not Interested - Do Not Contact';\n" +
        "  } else {\n" +
        "    niStatus = 'Not Interested - Snoozed';\n" +
        "    const base = (lead.today || '').toString().slice(0, 10);\n" +
        "    const d0 = base ? new Date(base + 'T00:00:00Z') : new Date();\n" +
        "    snoozeUntil = new Date(d0.getTime() + 60 * 86400000).toISOString().slice(0, 10);\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "// Client-proposed meeting time (honored only when Interested + parseable + in the future).\n" +
        "let proposedStart = '', proposedEnd = '';\n" +
        "const proposedRaw = (parsed.proposedRaw || '').toString();\n" +
        "try {\n" +
        "  const pdt = (parsed.proposedDateTime || '').toString().trim();\n" +
        "  if (normalized === 'Interested' && pdt) {\n" +
        "    const dt = DateTime.fromISO(pdt, { zone: 'Europe/Berlin' });\n" +
        "    if (dt.isValid && dt.toMillis() > DateTime.now().toMillis()) {\n" +
        "      proposedStart = dt.toISO();\n" +
        "      proposedEnd = dt.plus({ minutes: 30 }).toISO();\n" +
        "    }\n" +
        "  }\n" +
        "} catch (e) {}\n" +
        "return { json: { ...lead, classification: normalized, niType, niStatus, snoozeUntil, proposedStart, proposedEnd, proposedRaw, confidence: parsed.confidence || 'low', reasoning: parsed.reasoning || '' } };",
    },
    position: [3696, 112],
  },
  output: [{ prospectId: 'prospect-uuid', campaignId: 'camp-uuid', companyName: 'ACME', classification: 'Interested', niType: '', proposedStart: '', reasoning: '', confidence: 'low', replyText: 'yes', senderPhoneNumberId: '1030239273516528', managerWhatsAppNumber: '84333634500' }],
});

const switchRoute = switchCase({
  version: 3.4,
  config: {
    name: 'Switch — Route by Class',
    parameters: {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: 'r-int', leftValue: expr('{{ $json.classification }}'), rightValue: 'Interested', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'interested' },
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: 'r-uns', leftValue: expr('{{ $json.classification }}'), rightValue: 'Unsure', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'unsure' },
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }, conditions: [{ id: 'r-not', leftValue: expr('{{ $json.classification }}'), rightValue: 'Not Interested', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }], combinator: 'and' }, renameOutput: true, outputKey: 'notInterested' },
        ],
      },
      options: {},
    },
    position: [3920, 112],
  },
  output: [{}],
});

// ===========================================================================
// MEETING-BOOKING FLOW (KEPT verbatim)
// ===========================================================================
const ifHasProposedTime = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Has Proposed Time?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ id: 'c1', leftValue: expr('{{ $json.proposedStart }}'), rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    },
    position: [4144, 0],
  },
  output: [{}],
});

const calCheckProposed = node({
  type: 'n8n-nodes-base.googleCalendar',
  version: 1.3,
  config: {
    name: 'Calendar — Check Proposed Window',
    parameters: {
      operation: 'getAll',
      calendar: { __rl: true, mode: 'id', value: 'info@evertrust-germany.de' },
      timeMin: expr('{{ $json.proposedStart }}'),
      timeMax: expr('{{ $json.proposedEnd }}'),
      options: { orderBy: 'startTime' },
    },
    credentials: { googleCalendarOAuth2Api: CRED_CAL },
    alwaysOutputData: true,
    position: [4368, -96],
  },
  output: [{}],
});

const resolveProposedSlot = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Resolve Proposed Slot',
    parameters: {
      jsCode:
        "const lead = $('Code — Parse Classification').item.json;\n" +
        "const tz = 'Europe/Berlin';\n" +
        "const INTERNAL = ['evertrust-germany.de','evertrust.de'];\n" +
        "const domOf = (e)=>((e||'').split('@')[1]||'').toLowerCase().trim();\n" +
        "const isExt = (e)=>{const d=domOf(e); return !!d && !INTERNAL.includes(d);};\n" +
        "const extParty = (j)=>{const xs=[]; if(Array.isArray(j.attendees))for(const a of j.attendees){if(a&&a.email)xs.push(a.email);} if(j.organizer&&j.organizer.email)xs.push(j.organizer.email); if(j.creator&&j.creator.email)xs.push(j.creator.email); return xs.some(isExt);};\n" +
        "const ps = lead.proposedStart, pe = lead.proposedEnd;\n" +
        "const psM = ps ? DateTime.fromISO(ps).toMillis() : 0;\n" +
        "const peM = pe ? DateTime.fromISO(pe).toMillis() : 0;\n" +
        "let clash = false;\n" +
        "for (const it of items) {\n" +
        "  const j = (it && it.json) || {};\n" +
        "  if (!j.start) continue;\n" +
        "  if (j.status === 'cancelled') continue;\n" +
        "  if (j.transparency === 'transparent') continue;\n" +
        "  if (!extParty(j)) continue;\n" +
        "  let s=null,e=null;\n" +
        "  if (j.start.dateTime){ s=DateTime.fromISO(j.start.dateTime).toMillis(); e=DateTime.fromISO(j.end.dateTime).toMillis(); }\n" +
        "  else if (j.start.date){ s=DateTime.fromISO(j.start.date,{zone:tz}).toMillis(); e=DateTime.fromISO(j.end.date,{zone:tz}).toMillis(); }\n" +
        "  if (s!=null && e!=null && !(peM<=s || psM>=e)) { clash = true; break; }\n" +
        "}\n" +
        "const free = !!ps && !clash;\n" +
        "const d0 = ps ? DateTime.fromISO(ps).setZone(tz) : null;\n" +
        "const human = d0 ? d0.setLocale('en-GB').toFormat(\"EEE, dd LLL yyyy 'at' HH:mm\") + (d0.offset===120?' CEST':' CET') : '';\n" +
        "return [{ json: { ...lead, proposedFree: free, chosenStart: ps, chosenEnd: pe, chosenHuman: human } }];",
    },
    position: [4592, -96],
  },
  output: [{ proposedFree: true, chosenStart: '2026-06-13T10:00:00+02:00' }],
});

const ifProposedFree = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Proposed Free?',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c1', leftValue: expr('{{ $json.proposedFree }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      },
      options: {},
    },
    position: [4816, -96],
  },
  output: [{}],
});

const calFindFreeSlots = node({
  type: 'n8n-nodes-base.googleCalendar',
  version: 1.3,
  config: {
    name: 'Calendar — Find Free Slots',
    parameters: {
      operation: 'getAll',
      calendar: { __rl: true, mode: 'id', value: 'info@evertrust-germany.de' },
      timeMin: expr("{{ $now.plus({ days: 1 }).startOf('day').toISO() }}"),
      timeMax: expr("{{ $now.plus({ days: 14 }).endOf('day').toISO() }}"),
      options: { orderBy: 'startTime' },
    },
    credentials: { googleCalendarOAuth2Api: CRED_CAL },
    position: [4368, 112],
  },
  output: [{}],
});

const propose2Slots = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Propose 2 Slots',
    parameters: {
      jsCode:
        "// Find 2 vacant 30-minute slots in the next 14 weekdays, Berlin business hours (09:00-17:00).\n" +
        "// CONFLICT RULE: only block REAL external meetings — events with at least one attendee/organizer/creator\n" +
        "// whose email domain is outside our own (INTERNAL_DOMAINS). Internal-only events are IGNORED so a lead\n" +
        "// can be booked over them. Cancelled and 'Free'/transparent events are also ignored.\n" +
        "// Slots stored to workflow static data, keyed by lead email, so the confirmation flow can resolve '1'/'2'.\n" +
        "const lead = $('Code — Parse Classification').item.json;\n" +
        "const tz = 'Europe/Berlin';\n" +
        "\n" +
        "const INTERNAL_DOMAINS = ['evertrust-germany.de', 'evertrust.de'];\n" +
        "const domainOf = (email) => ((email || '').split('@')[1] || '').toLowerCase().trim();\n" +
        "const isExternal = (email) => { const d = domainOf(email); return !!d && !INTERNAL_DOMAINS.includes(d); };\n" +
        "const hasExternalParty = (j) => {\n" +
        "  const emails = [];\n" +
        "  if (Array.isArray(j.attendees)) for (const a of j.attendees) { if (a && a.email) emails.push(a.email); }\n" +
        "  if (j.organizer && j.organizer.email) emails.push(j.organizer.email);\n" +
        "  if (j.creator && j.creator.email) emails.push(j.creator.email);\n" +
        "  return emails.some(isExternal);\n" +
        "};\n" +
        "\n" +
        "const busy = [];\n" +
        "for (const it of items) {\n" +
        "  const j = it.json;\n" +
        "  if (j.status === 'cancelled') continue;\n" +
        "  if (j.transparency === 'transparent') continue;\n" +
        "  if (!hasExternalParty(j)) continue;\n" +
        "  let s, e;\n" +
        "  if (j.start && j.start.dateTime) {\n" +
        "    s = DateTime.fromISO(j.start.dateTime);\n" +
        "    e = DateTime.fromISO(j.end.dateTime);\n" +
        "  } else if (j.start && j.start.date) {\n" +
        "    s = DateTime.fromISO(j.start.date, { zone: tz });\n" +
        "    e = DateTime.fromISO(j.end.date, { zone: tz });\n" +
        "  }\n" +
        "  if (s && e && s.isValid && e.isValid) busy.push({ start: s, end: e, summary: j.summary || '' });\n" +
        "}\n" +
        "\n" +
        "const SLOT_MIN = 30;\n" +
        "const businessStartHour = 9;\n" +
        "const businessEndHour = 17;\n" +
        "const slots = [];\n" +
        "const now = DateTime.now().setZone(tz);\n" +
        "\n" +
        "for (let d = 1; d <= 14 && slots.length < 2; d++) {\n" +
        "  const day = now.plus({ days: d }).startOf('day');\n" +
        "  if (day.weekday > 5) continue;\n" +
        "  for (let h = businessStartHour; h < businessEndHour && slots.length < 2; h++) {\n" +
        "    for (let m = 0; m < 60 && slots.length < 2; m += 30) {\n" +
        "      const slotStart = day.set({ hour: h, minute: m });\n" +
        "      const slotEnd = slotStart.plus({ minutes: SLOT_MIN });\n" +
        "      if (slotEnd.hour > businessEndHour || (slotEnd.hour === businessEndHour && slotEnd.minute > 0)) continue;\n" +
        "      const ss = slotStart.toMillis();\n" +
        "      const se = slotEnd.toMillis();\n" +
        "      const clash = busy.some(b => !(se <= b.start.toMillis() || ss >= b.end.toMillis()));\n" +
        "      if (!clash) {\n" +
        "        slots.push({\n" +
        "          start: slotStart.toISO(),\n" +
        "          end: slotEnd.toISO(),\n" +
        "          human: slotStart.setLocale('en-GB').toFormat(\"EEE, dd LLL yyyy 'at' HH:mm\") + (slotStart.offset === 120 ? ' CET' : ' CEST'),\n" +
        "        });\n" +
        "      }\n" +
        "    }\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "if (slots.length > 0 && lead.fromEmail) {\n" +
        "  const sd = $getWorkflowStaticData('global');\n" +
        "  if (!sd.pendingSlots) sd.pendingSlots = {};\n" +
        "  sd.pendingSlots[(lead.fromEmail || '').toLowerCase()] = {\n" +
        "    slot1: slots[0] || null,\n" +
        "    slot2: slots[1] || null,\n" +
        "    proposedAt: Date.now(),\n" +
        "    project: lead.project || '',\n" +
        "    companyName: lead.companyName || '',\n" +
        "  };\n" +
        "}\n" +
        "\n" +
        "return [{ json: { ...lead, slots, slot1Human: slots[0]?.human || 'TBC', slot2Human: slots[1]?.human || 'TBC', slot1Start: slots[0]?.start || '', slot1End: slots[0]?.end || '', slot2Start: slots[1]?.start || '', slot2End: slots[1]?.end || '' } }];",
    },
    position: [4592, 112],
  },
  output: [{ prospectId: 'prospect-uuid', campaignId: 'camp-uuid', companyName: 'ACME', leadEmail: 'a@b.de', fromEmail: 'a@b.de', subject: 'Re: x', replyText: 'yes', sender: 'info', niche: 'Golf Clubs', city: 'Bavaria', project: 'Golf clubs', classification: 'Interested', reasoning: '', confidence: 'low', slot1Human: 'Mon 09:00', slot2Human: 'Tue 10:00', slot1Start: '2026-06-13T09:00:00+02:00', slot2Start: '2026-06-13T10:00:00+02:00', senderPhoneNumberId: '1030239273516528', managerWhatsAppNumber: '84333634500' }],
});

const openAiChatModel = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'OpenAI Chat Model',
    parameters: { model: { __rl: true, value: 'deepseek', mode: 'list', cachedResultName: 'deepseek' }, builtInTools: {}, options: {} },
    credentials: { openAiApi: CRED_OPENAI },
    position: [4816, 320],
  },
  output: [{}],
});

const aiAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'AI Agent',
    parameters: {
      promptType: 'define',
      text: expr(
        "=Write Hanna's reply to a lead who just answered our cold outreach with interest. The reply proposes two meeting slots. Make it sound like a real person wrote it — never like a template.\n" +
          'CONTEXT:\n' +
          '- fromEmail: {{ $json.fromEmail }}\n' +
          '- leadEmail: {{ $json.leadEmail }}\n' +
          '- Subject: {{ $json.subject }}\n' +
          '- Company: {{ $json.companyName }}\n' +
          '- Their reply: {{ $json.replyText }}\n' +
          '- Campaign: {{ $json.niche }} in {{ $json.city }} — {{ $json.project }}\n' +
          "- Sender identity: {{ $json.sender || $('Code — Enrich Reply Context').item.json.sender || 'info' }}\n" +
          'VOICE — follow strictly:\n' +
          '- Decisive and warm, NEVER apologetic. Never use: "I\'m sorry", "Sorry", "Unfortunately", "I\'m afraid", "I hope this finds you well", "Please do not hesitate". No emojis.\n' +
          "- Open with genuine appreciation for their interest — register the person, don't just transact.\n" +
          '- Include exactly ONE specific, true detail pulled from their reply or the campaign ({{ $json.companyName }}, {{ $json.niche }}, {{ $json.city }}, or {{ $json.project }}). One real detail beats any pleasantry. Do not invent facts.\n' +
          '- Use "I would love to…" for the personal offer to take it further; "we" for company actions. Measured eagerness, never gushing. Treat them as a peer, never deferential.\n' +
          '- Short paragraphs (max 3 sentences), one blank line between, exactly one ask. Close facing forward.\n' +
          'LANGUAGE: Detect the language of their reply. If it is German, write the ENTIRE email in German; otherwise English.\n' +
          'SALUTATION: "Dear {{ $json.companyName }}," (English) or "Sehr geehrte Damen und Herren von {{ $json.companyName }}," (German).\n' +
          'REQUIRED — these must appear exactly, on their own lines (keep the slot text unchanged; translate only the instruction sentence if writing in German):\n' +
          '{{ $json.slot1Human }}\n' +
          '{{ $json.slot2Human }}\n' +
          'SIGN-OFF — match the sender identity above:\n' +
          '- If sender is "hanna": end with  Kind regards,<br>Hanna Nguyen<br>EVERTRUST GmbH   (German: Mit freundlichen Grüßen,<br>Hanna Nguyen<br>EVERTRUST GmbH)\n' +
          '- Otherwise: end with  Kind regards,<br>EVERTRUST GmbH   (German: Mit freundlichen Grüßen,<br>EVERTRUST GmbH)\n\n' +
          'OUTPUT — raw JSON only, no prose, no code fences:\n' +
          '{"bodyHtml": "<the full email as HTML, salutation through sign-off, using <br> for every line break>"}\n' +
          'The bodyHtml MUST literally contain "{{ $json.slot1Human }}" and "{{ $json.slot2Human }}". Output ONLY this field — the workflow re-attaches all lead data (email, messageId, sender, slots) automatically.',
      ),
      options: {
        systemMessage:
          'You write the email yourself, in the voice of Hanna Nguyen at EVERTRUST GmbH. You are NOT filling in a template — you compose a fresh, human reply every time. Respond with raw JSON only, no prose, no code fences.',
      },
      subnodes: { model: openAiChatModel },
    },
    position: [4816, 112],
  },
  output: [{ output: '{"bodyHtml":"Dear ACME,..."}' }],
});

const parseAgentResponse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: "Code — Parse Agent's Response",
    parameters: {
      jsCode:
        "const lead = $('Code — Propose 2 Slots').first().json;\n" +
        "const raw = $input.first().json.output || '';\n" +
        "\n" +
        "let bodyHtml = '';\n" +
        "let draftedText = '';\n" +
        "try {\n" +
        "  const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());\n" +
        "  bodyHtml = parsed.bodyHtml || '';\n" +
        "  draftedText = parsed.draftedBody || parsed.body || '';\n" +
        "} catch (e) {}\n" +
        "\n" +
        "if (!bodyHtml) bodyHtml = (draftedText || raw).replace(/\\n/g, '<br>');\n" +
        "\n" +
        "const body = bodyHtml\n" +
        "  .replace(/<br\\s*\\/?>/gi, '\\n')\n" +
        "  .replace(/<\\/p>/gi, '\\n\\n')\n" +
        "  .replace(/<p[^>]*>/gi, '')\n" +
        "  .replace(/<[^>]+>/g, '')\n" +
        "  .replace(/&nbsp;/g, ' ')\n" +
        "  .replace(/&amp;/g, '&')\n" +
        "  .replace(/&lt;/g, '<')\n" +
        "  .replace(/&gt;/g, '>')\n" +
        "  .replace(/\\n{3,}/g, '\\n\\n')\n" +
        "  .trim();\n" +
        "\n" +
        "return { json: { ...lead, body, bodyHtml } };",
    },
    position: [5040, 112],
  },
  output: [{ prospectId: 'prospect-uuid', campaignId: 'camp-uuid', companyName: 'ACME', leadEmail: 'a@b.de', subject: 'Re: x', sender: 'info', slot1Human: 'Mon 09:00', slot2Human: 'Tue 10:00', bodyHtml: 'Dear ACME,...', body: 'Dear ACME,...' }],
});

// Slot proposal send (KEPT — Hanna/info branches → draft)
const ifProposalSenderHanna = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Proposal Sender Hanna?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ id: 'c-prop', leftValue: expr("{{ $json.sender || $('Code — Enrich Reply Context').item.json.sender || 'info' }}"), rightValue: 'hanna', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }],
        combinator: 'and',
      },
      options: {},
    },
    position: [5264, 112],
  },
  output: [{}],
});

const sendSlotProposalHanna = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Send Slot Proposal (Hanna)',
    parameters: {
      resource: 'draft',
      subject: expr('{{ $json.subject }}'),
      emailType: 'html',
      message: expr('{{ $json.bodyHtml }}' + SIG_IMG),
      options: { sendTo: expr('{{ $json.leadEmail }}') },
    },
    credentials: { gmailOAuth2: CRED_GMAIL },
    position: [5488, 16],
  },
  output: [{}],
});

const sendSlotProposal = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Send Slot Proposal',
    parameters: {
      resource: 'draft',
      subject: expr('{{ $json.subject }}'),
      emailType: 'html',
      message: expr('{{ $json.bodyHtml }}' + SIG_IMG),
      options: { sendTo: expr('{{ $json.leadEmail }}') },
    },
    credentials: { gmailOAuth2: CRED_GMAIL },
    position: [5488, 208],
  },
  output: [{}],
});

// Interested verdict writeback to ERP (replaces Sheets — Set Interested):
// classification THEN graduate.
const erpClassifyInterested = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Classify Interested',
    parameters: {
      method: 'POST',
      url: `${ERP}/reply-classifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "prospectId": "{{ $(\'Code — Propose 2 Slots\').first().json.prospectId }}",\n' +
          '  "verdict": "INTERESTED",\n' +
          '  "model": "deepseek",\n' +
          '  "raw": {{ JSON.stringify({ classification: $(\'Code — Propose 2 Slots\').first().json.classification, reasoning: $(\'Code — Propose 2 Slots\').first().json.reasoning, confidence: $(\'Code — Propose 2 Slots\').first().json.confidence, replyText: ($(\'Code — Propose 2 Slots\').first().json.replyText || \'\').slice(0,2000) }) }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    position: [5712, 208],
  },
  output: [{ id: 'rc-uuid', status: 'INTERESTED' }],
});

const erpGraduate = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Graduate to Hot Lead',
    parameters: {
      method: 'POST',
      url: expr(`${ERP}/prospects/{{ $('Code — Propose 2 Slots').first().json.prospectId }}/graduate`),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "stage": "INTERESTED",\n' +
          '  "hotReason": {{ JSON.stringify("Reply Glock: interested reply — slots proposed " + ($(\'Code — Propose 2 Slots\').first().json.slot1Human || \'\') + " | " + ($(\'Code — Propose 2 Slots\').first().json.slot2Human || \'\')) }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    position: [5936, 208],
  },
  output: [{ graduated: true }],
});

const waInterestedNotify = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Interested Notify',
    parameters: {
      operation: 'send',
      phoneNumberId: expr("{{ $('Code — Propose 2 Slots').first().json.senderPhoneNumberId }}"),
      recipientPhoneNumber: expr("{{ $('Code — Propose 2 Slots').first().json.managerWhatsAppNumber }}"),
      textBody: expr("{{ 'Target acquired — interested reply\\nCampaign: ' + $('Code — Propose 2 Slots').first().json.campaignName + '\\nCompany: ' + $('Code — Propose 2 Slots').first().json.companyName + '\\nSlots zeroed: ' + $('Code — Propose 2 Slots').first().json.slot1Human + ', ' + $('Code — Propose 2 Slots').first().json.slot2Human }}"),
      additionalFields: {},
    },
    credentials: { whatsAppApi: CRED_WA },
    onError: 'continueRegularOutput',
    position: [6160, 112],
  },
  output: [{}],
});

const erpNotifyInterested = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Interested',
    parameters: {
      method: 'POST',
      url: `${ERP}/notifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "type": "reply_interested",\n' +
          '  "title": {{ JSON.stringify("Interested reply: " + ($(\'Code — Propose 2 Slots\').first().json.companyName || \'\')) }},\n' +
          '  "body": {{ JSON.stringify("Slots proposed: " + ($(\'Code — Propose 2 Slots\').first().json.slot1Human || \'\') + " | " + ($(\'Code — Propose 2 Slots\').first().json.slot2Human || \'\')) }},\n' +
          '  "link": "/campaigns/{{ $(\'Code — Propose 2 Slots\').first().json.campaignId }}",\n' +
          '  "campaignId": "{{ $(\'Code — Propose 2 Slots\').first().json.campaignId }}"\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    position: [6160, 304],
  },
  output: [{}],
});

// Slot-pick path (already-interested lead replies to a slot proposal) — KEPT.
const buildSlotPickPrompt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Build Slot Pick Prompt',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode:
        "const d = $input.item.json;\n" +
        "// Resolve the previously-proposed slots from static data (keyed by the lead's email).\n" +
        "const sd = $getWorkflowStaticData('global');\n" +
        "const pending = (sd.pendingSlots && sd.pendingSlots[(d.fromEmail || '').toLowerCase()]) || {};\n" +
        "const slot1 = pending.slot1 || null;\n" +
        "const slot2 = pending.slot2 || null;\n" +
        "const prompt = `You are parsing a reply to a slot-proposal email.\\nThe lead was offered:\\nSlot 1: ${slot1?.human || '(unknown)'} (start ${slot1?.start || ''})\\nSlot 2: ${slot2?.human || '(unknown)'} (start ${slot2?.start || ''})\\n\\nTheir reply: ${d.replyText || ''}\\n\\nReturn JSON only:\\n{\\n  \"chosenSlot\": 1 or 2 or null,\\n  \"reasoning\": \"one sentence\"\\n}\\nIf they didn't clearly pick one of the two slots, set chosenSlot to null.`;\n" +
        "return { json: { ...d, slot1, slot2, slotPickPrompt: prompt } };",
    },
    position: [3248, -112],
  },
  output: [{ slotPickPrompt: 'You are parsing...' }],
});

const openAiParseSlot = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 1.7,
  config: {
    name: 'OpenAI — Parse Slot Choice',
    parameters: {
      modelId: { __rl: true, value: 'deepseek', mode: 'list', cachedResultName: 'DEEPSEEK' },
      messages: {
        values: [
          { content: 'You are a slot-confirmation parser. Always respond with raw JSON only — no prose, no code fences.', role: 'system' },
          { content: expr('{{ $json.slotPickPrompt }}') },
        ],
      },
      jsonOutput: true,
      options: { temperature: 0.1 },
    },
    credentials: { openAiApi: CRED_OPENAI },
    position: [3472, -112],
  },
  output: [{ message: { content: { chosenSlot: 1 } } }],
});

const parseSlotChoice = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Parse Slot Choice Response',
    parameters: {
      jsCode:
        "const prev = $('Code — Build Slot Pick Prompt').item.json;\n" +
        "const raw = $input.item.json;\n" +
        "let parsed = raw.message?.content ?? raw.content ?? raw;\n" +
        "if (typeof parsed === 'string') {\n" +
        "  try { parsed = JSON.parse(parsed); } catch (e) { parsed = { chosenSlot: null, reasoning: 'JSON parse failed' }; }\n" +
        "}\n" +
        "const which = parsed.chosenSlot;\n" +
        "let chosen = null;\n" +
        "if (which === 1 && prev.slot1) chosen = prev.slot1;\n" +
        "if (which === 2 && prev.slot2) chosen = prev.slot2;\n" +
        "return { json: { ...prev, chosenSlotNum: which, chosenSlot: chosen, chosenStart: chosen?.start || '', chosenEnd: chosen?.end || '', chosenHuman: chosen?.human || '', slotPickReasoning: parsed.reasoning || '' } };",
    },
    position: [3696, -112],
  },
  output: [{ chosenStart: '2026-06-13T09:00:00+02:00', chosenHuman: 'Mon 09:00' }],
});

const ifSlotChosen = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Slot Chosen',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c1', leftValue: expr('{{ $json.chosenStart }}'), rightValue: '', operator: { type: 'string', operation: 'notEmpty', name: 'filter.operator.notEmpty', singleValue: true } }],
      },
      options: {},
    },
    position: [3920, -112],
  },
  output: [{}],
});

const waSlotUnclear = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Slot Unclear',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr("{{ 'Target wobble — slot reply unclear\\nCampaign: ' + $json.campaignName + '\\nCompany: ' + $json.companyName + '\\nReply: ' + ($json.replyText || '').slice(0, 200) + '\\nLLM reasoning: ' + ($json.slotPickReasoning || '') }}"),
      additionalFields: {},
    },
    credentials: { whatsAppApi: CRED_WA },
    onError: 'continueRegularOutput',
    position: [4144, -224],
  },
  output: [{}],
});

const meetingFields = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Meeting Fields',
    parameters: { jsCode: 'return items;' },
    position: [4368, -288],
  },
  output: [{ prospectId: 'prospect-uuid', campaignId: 'camp-uuid', messageId: 'msg1', fromEmail: 'a@b.de', companyName: 'ACME', project: 'Golf clubs', chosenStart: '2026-06-13T09:00:00+02:00', chosenEnd: '2026-06-13T09:30:00+02:00', chosenHuman: 'Mon 09:00', senderPhoneNumberId: '1030239273516528', managerWhatsAppNumber: '84333634500' }],
});

const calCreateMeeting = node({
  type: 'n8n-nodes-base.googleCalendar',
  version: 1.3,
  config: {
    name: 'Calendar — Create Meeting',
    parameters: {
      resource: 'event',
      operation: 'create',
      calendar: { __rl: true, mode: 'id', value: 'info@evertrust-germany.de' },
      start: expr('{{ $json.chosenStart }}'),
      end: expr('{{ $json.chosenEnd }}'),
      additionalFields: {
        attendees: [expr('{{ $json.fromEmail }}'), 'info@evertrust-germany.de'],
        conferenceDataUi: { conferenceDataValues: { conferenceSolution: 'hangoutsMeet' } },
        description: expr("=Project: {{ $json.project || 'Evertrust outreach' }}\n\nScheduled via Evertrust's outreach workflow."),
        guestsCanInviteOthers: false,
        sendUpdates: 'all',
        summary: expr('=Evertrust GmbH × {{ $json.companyName }} — Intro Call'),
      },
    },
    credentials: { googleCalendarOAuth2Api: CRED_CAL },
    position: [4592, -288],
  },
  output: [{ hangoutLink: 'https://meet.google.com/x' }],
});

const ifConfirmSenderHanna = ifElse({
  version: 2.3,
  config: {
    name: 'IF — Confirm Sender Hanna?',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c-conf', leftValue: expr("{{ $json.sender || $('Code — Enrich Reply Context').item.json.sender || 'info' }}"), rightValue: 'hanna', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }],
      },
      options: {},
    },
    position: [4816, -288],
  },
  output: [{}],
});

const sendMeetingConfirmHanna = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Send Meeting Confirmation (Hanna)',
    parameters: {
      operation: 'reply',
      messageId: expr("{{ $('Code — Meeting Fields').item.json.messageId }}"),
      message: expr(
        "=Dear {{ $('Code — Meeting Fields').item.json.companyName }},<br><br>Great — looking forward to our call!<br><br>Date & time: {{ $('Code — Meeting Fields').item.json.chosenHuman }}<br>Google Meet: {{ $json.hangoutLink || $json.conferenceData?.entryPoints?.[0]?.uri || 'invitation will follow' }}<br><br>You should also receive a Google Calendar invite shortly.<br><br>Best regards,<br>Evertrust GmbH" +
          SIG_IMG,
      ),
      options: { appendAttribution: false },
    },
    credentials: { gmailOAuth2: CRED_GMAIL },
    position: [5040, -384],
  },
  output: [{}],
});

const sendMeetingConfirm = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Send Meeting Confirmation',
    parameters: {
      operation: 'reply',
      messageId: expr("{{ $('Code — Meeting Fields').item.json.messageId }}"),
      message: expr(
        "=Dear {{ $('Code — Meeting Fields').item.json.companyName }},<br><br>Great — looking forward to our call!<br><br>Date & time: {{ $('Code — Meeting Fields').item.json.chosenHuman }}<br>Google Meet: {{ $json.hangoutLink || $json.conferenceData?.entryPoints?.[0]?.uri || 'invitation will follow' }}<br><br>You should also receive a Google Calendar invite shortly.<br><br>Best regards,<br>Evertrust GmbH" +
          SIG_IMG,
      ),
      options: { appendAttribution: false },
    },
    credentials: { gmailOAuth2: CRED_GMAIL },
    position: [5040, -192],
  },
  output: [{}],
});

// Meeting verdict writeback (replaces Sheets — Set Meeting Scheduled) — server projects MEETING_SCHEDULED.
const erpClassifyMeeting = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Classify Meeting Request',
    parameters: {
      method: 'POST',
      url: `${ERP}/reply-classifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "prospectId": "{{ $(\'Code — Meeting Fields\').item.json.prospectId }}",\n' +
          '  "verdict": "MEETING_REQUEST",\n' +
          '  "model": "deepseek",\n' +
          '  "raw": {{ JSON.stringify({ chosenHuman: $(\'Code — Meeting Fields\').item.json.chosenHuman, chosenStart: $(\'Code — Meeting Fields\').item.json.chosenStart }) }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    position: [5264, -288],
  },
  output: [{ status: 'MEETING_SCHEDULED' }],
});

const waMeetingNotify = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Meeting Scheduled Notify',
    parameters: {
      operation: 'send',
      phoneNumberId: expr("{{ $('Code — Meeting Fields').item.json.senderPhoneNumberId }}"),
      recipientPhoneNumber: expr("{{ $('Code — Meeting Fields').item.json.managerWhatsAppNumber }}"),
      textBody: expr("{{ 'Direct hit — meeting booked\\nCampaign: ' + $('Code — Meeting Fields').item.json.campaignName + '\\nCompany: ' + $('Code — Meeting Fields').item.json.companyName + '\\nWhen: ' + $('Code — Meeting Fields').item.json.chosenHuman + '\\nMeet: ' + ($('Calendar — Create Meeting').first().json.hangoutLink || 'auto-added by Calendar') }}"),
      additionalFields: {},
    },
    credentials: { whatsAppApi: CRED_WA },
    onError: 'continueRegularOutput',
    position: [5488, -384],
  },
  output: [{}],
});

const erpNotifyMeeting = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Meeting',
    parameters: {
      method: 'POST',
      url: `${ERP}/notifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "type": "meeting_scheduled",\n' +
          '  "title": {{ JSON.stringify("Meeting booked: " + ($(\'Code — Meeting Fields\').item.json.companyName || \'\')) }},\n' +
          '  "body": {{ JSON.stringify("When: " + ($(\'Code — Meeting Fields\').item.json.chosenHuman || \'\') + " | Meet: " + ($(\'Calendar — Create Meeting\').first().json.hangoutLink || \'pending\')) }},\n' +
          '  "link": "/campaigns/{{ $(\'Code — Meeting Fields\').item.json.campaignId }}",\n' +
          '  "campaignId": "{{ $(\'Code — Meeting Fields\').item.json.campaignId }}"\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    position: [5488, -192],
  },
  output: [{}],
});

// ===========================================================================
// UNSURE verdict (auto-reply DROPPED; classification + notify KEPT)
// ===========================================================================
const erpClassifyUnsure = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Classify Unsure',
    parameters: {
      method: 'POST',
      url: `${ERP}/reply-classifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "prospectId": "{{ $(\'Code — Parse Classification\').item.json.prospectId }}",\n' +
          '  "verdict": "UNSURE",\n' +
          '  "model": "deepseek",\n' +
          '  "raw": {{ JSON.stringify({ classification: $(\'Code — Parse Classification\').item.json.classification, reasoning: $(\'Code — Parse Classification\').item.json.reasoning, confidence: $(\'Code — Parse Classification\').item.json.confidence, replyText: ($(\'Code — Parse Classification\').item.json.replyText || \'\').slice(0,2000) }) }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    position: [4144, 304],
  },
  output: [{ status: 'REPLIED' }],
});

const waUnsureNotify = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Unsure Notify',
    parameters: {
      operation: 'send',
      phoneNumberId: expr("{{ $('Code — Parse Classification').first().json.senderPhoneNumberId }}"),
      recipientPhoneNumber: expr("{{ $('Code — Parse Classification').first().json.managerWhatsAppNumber }}"),
      textBody: expr("{{ 'Unsure reply — needs your follow-up\\nCampaign: ' + $('Code — Parse Classification').first().json.campaignName + '\\nCompany: ' + $('Code — Parse Classification').first().json.companyName + '\\n\\nTheir message: \"' + ($('Code — Parse Classification').first().json.replyText || '').slice(0, 200) + '\"\\n\\nLogged as UNSURE — RAG draft queue will pick it up. Open the ERP draft review to follow up.' }}"),
      additionalFields: {},
    },
    credentials: { whatsAppApi: CRED_WA },
    onError: 'continueRegularOutput',
    position: [4368, 208],
  },
  output: [{}],
});

const erpNotifyUnsure = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Unsure',
    parameters: {
      method: 'POST',
      url: `${ERP}/notifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "type": "reply_unsure",\n' +
          '  "title": {{ JSON.stringify("Unsure reply: " + ($(\'Code — Parse Classification\').item.json.companyName || \'\')) }},\n' +
          '  "body": {{ JSON.stringify("Logged UNSURE — RAG draft queue will draft a reply. " + ($(\'Code — Parse Classification\').item.json.replyText || \'\').slice(0,300)) }},\n' +
          '  "link": "/campaigns/{{ $(\'Code — Parse Classification\').item.json.campaignId }}",\n' +
          '  "campaignId": "{{ $(\'Code — Parse Classification\').item.json.campaignId }}"\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    position: [4368, 400],
  },
  output: [{}],
});

// ===========================================================================
// NOT INTERESTED verdict (replaces Sheets — Set Not Interested)
// ===========================================================================
const erpClassifyNotInterested = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Classify Not Interested',
    parameters: {
      method: 'POST',
      url: `${ERP}/reply-classifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "prospectId": "{{ $(\'Code — Parse Classification\').item.json.prospectId }}",\n' +
          '  "verdict": "NOT_INTERESTED",\n' +
          '  "model": "deepseek",\n' +
          '  "raw": {{ JSON.stringify({ classification: $(\'Code — Parse Classification\').item.json.classification, niType: $(\'Code — Parse Classification\').item.json.niType, reasoning: $(\'Code — Parse Classification\').item.json.reasoning }) }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    position: [4144, 496],
  },
  output: [{ status: 'NOT_INTERESTED' }],
});

// ===========================================================================
// MARK READ (KEPT — Hanna/info branches), loop-back to Loop — Replies
// ===========================================================================
const ifMarkReadHanna = ifElse({
  version: 2.3,
  config: {
    name: 'IF — MarkRead Sender Hanna?',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 },
        combinator: 'and',
        conditions: [{ id: 'c-mr', leftValue: expr("{{ $json.sender || $('Code — Enrich Reply Context').item.json.sender || 'info' }}"), rightValue: 'hanna', operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }],
      },
      options: {},
    },
    position: [6608, 112],
  },
  output: [{}],
});

const markReadHanna = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Mark Reply Read (Hanna)',
    parameters: { operation: 'markAsRead', messageId: expr("{{ $('Code — Enrich Reply Context').item.json.messageId }}") },
    credentials: { gmailOAuth2: CRED_GMAIL },
    onError: 'continueRegularOutput',
    position: [6832, 16],
  },
  output: [{}],
});

const markRead = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Gmail — Mark Reply Read',
    parameters: { operation: 'markAsRead', messageId: expr("{{ $('Code — Enrich Reply Context').item.json.messageId }}") },
    credentials: { gmailOAuth2: CRED_GMAIL },
    onError: 'continueRegularOutput',
    position: [6832, 208],
  },
  output: [{}],
});

// ===========================================================================
// DAILY SUMMARY (KEPT) — Loop — Replies done output + ERP notify
// ===========================================================================
const aggregateDailyCounts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Code — Aggregate Daily Counts',
    parameters: {
      jsCode:
        "// Pick whichever globals node fired (outbound 8AM or replies 15-min).\n" +
        "let globals = null;\n" +
        "try { const g = $('Config — Globals').first(); if (g && g.json && g.json.runId) globals = g.json; } catch (e) {}\n" +
        "if (!globals) {\n" +
        "  try { const g = $('Config — Globals (Replies)').first(); if (g && g.json && g.json.runId) globals = g.json; } catch (e) {}\n" +
        "}\n" +
        "if (!globals) throw new Error('No globals node executed.');\n" +
        "const mode = globals.mode || 'outbound';\n" +
        "\n" +
        "let actions = [];\n" +
        "try { actions = $('Code — Compute Action').all().map(a => a.json.actionType); } catch (e) {}\n" +
        "const emailsSent = actions.filter(a => a === 'cold' || a === 'followup' || a === 'finalpush').length;\n" +
        "const skipped = actions.filter(a => a === 'skip').length;\n" +
        "let campaignsActivated = 0;\n" +
        "try { campaignsActivated = $('Code — Build Activated Message').all().length; } catch (e) {}\n" +
        "let classifications = [];\n" +
        "try { classifications = $('Code — Parse Classification').all().map(c => c.json.classification); } catch (e) {}\n" +
        "const interested = classifications.filter(c => c === 'Interested').length;\n" +
        "const unsure = classifications.filter(c => c === 'Unsure').length;\n" +
        "const notInterested = classifications.filter(c => c === 'Not Interested').length;\n" +
        "let scheduled = 0;\n" +
        "try { scheduled = $('ERP — Graduate to Hot Lead').all().length; } catch (e) {}\n" +
        "let errors = 0;\n" +
        "try { errors = $('Sheets — Log Error').all().length; } catch (e) {}\n" +
        "\n" +
        "if (mode === 'replies') {\n" +
        "  if (interested === 0 && unsure === 0 && errors === 0) {\n" +
        "    return [];\n" +
        "  }\n" +
        "  const body = 'Recon report\\nRun ID: ' + globals.runId + '\\nTargets locked: ' + interested + ' | Maybe: ' + unsure + ' | Dodged: ' + notInterested + '\\nMeetings booked: ' + scheduled + (errors > 0 ? ('\\nJams: ' + errors) : '');\n" +
        "  return [{ json: { runId: globals.runId, managerWhatsAppNumber: globals.managerWhatsAppNumber, senderPhoneNumberId: globals.senderPhoneNumberId, mode, interested, unsure, notInterested, scheduled, errors, summaryMessageBody: body } }];\n" +
        "}\n" +
        "\n" +
        "const body = 'Mission report\\nRun ID: ' + globals.runId + '\\nCampaigns run: ' + campaignsActivated + '\\nShots fired today: ' + emailsSent + '\\nTargets locked: ' + interested + ' | Maybe: ' + unsure + ' | Dodged: ' + notInterested + '\\nMeetings booked: ' + scheduled + '\\nJams: ' + errors;\n" +
        "return [{ json: { runId: globals.runId, managerWhatsAppNumber: globals.managerWhatsAppNumber, senderPhoneNumberId: globals.senderPhoneNumberId, mode, campaignsActivated, emailsSent, skipped, interested, unsure, notInterested, scheduled, errors, summaryMessageBody: body } }];",
    },
    position: [2352, 304],
  },
  output: [{ summaryMessageBody: 'Recon report' }],
});

const waDailySummary = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'WA — Daily Summary',
    parameters: {
      operation: 'send',
      phoneNumberId: expr('{{ $json.senderPhoneNumberId }}'),
      recipientPhoneNumber: expr('{{ $json.managerWhatsAppNumber }}'),
      textBody: expr('{{ $json.summaryMessageBody }}'),
      additionalFields: {},
    },
    credentials: { whatsAppApi: CRED_WA },
    onError: 'continueRegularOutput',
    position: [2576, 208],
  },
  output: [{}],
});

const erpNotifyDailySummary = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Daily Summary',
    parameters: {
      method: 'POST',
      url: `${ERP}/notifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "type": "reply_daily_summary",\n' +
          '  "title": {{ JSON.stringify("Reply Glock recon — " + ($json.runId || \'\')) }},\n' +
          '  "body": {{ JSON.stringify($json.summaryMessageBody || \'\') }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    position: [2576, 400],
  },
  output: [{}],
});

// ===========================================================================
// ERROR HANDLING (KEPT) + ERP error notification
// ===========================================================================
const onWorkflowError = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'On Workflow Error', parameters: {}, position: [-160, 880] },
  output: [{}],
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
          { id: '3', name: 'errorPayload', value: expr('{{ $json }}'), type: 'object' },
        ],
      },
      options: {},
    },
    position: [64, 880],
  },
  output: [{}],
});

const formatErrorMessage = node({
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
        "return { json: { managerWhatsAppNumber: d.managerWhatsAppNumber, senderPhoneNumberId: d.senderPhoneNumberId, errorMessageBody: body } };",
    },
    position: [288, 880],
  },
  output: [{ errorMessageBody: 'Weapon jammed' }],
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
      additionalFields: {},
    },
    credentials: { whatsAppApi: CRED_WA },
    onError: 'continueRegularOutput',
    position: [512, 784],
  },
  output: [{}],
});

const erpNotifyError = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP — Notify Error',
    parameters: {
      method: 'POST',
      url: `${ERP}/notifications`,
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '={\n' +
          '  "type": "workflow_error",\n' +
          '  "title": "Reply Glock workflow jammed",\n' +
          '  "body": {{ JSON.stringify($json.errorMessageBody || \'Unknown error\') }}\n' +
          '}',
      ),
      options: {},
    },
    credentials: { httpHeaderAuth: CRED_ERP},
    onError: 'continueRegularOutput',
    position: [512, 976],
  },
  output: [{}],
});

// ===========================================================================
// STICKIES
// ===========================================================================
const noteErp = sticky(
  '## Select ERP Ingest (x-arsenal-token)\nThe HTTP nodes named "ERP — …" call the EverTrust ERP machine routes at https://evertrust-api.onrender.com. They authenticate with **Header Auth** (header `x-arsenal-token`). This credential is intentionally **UNBOUND** — open each ERP node and pick/create the "ERP Ingest (x-arsenal-token)" Header Auth credential (header name `x-arsenal-token`, value = ARSENAL_INGEST_TOKEN).',
  [erpListCampaigns, erpGetProspect, erpLogInbound, erpClassifyInterested],
  { color: 3 },
);

const noteSwap = sticky(
  '## Lead data → ERP (the only change)\nCampaign discovery, prospect lookup and all verdict writebacks now use the ERP instead of Drive/Sheets. Everything else (Gmail reply detection, classify prompt, the full meeting-booking flow, WhatsApp, the AI Agent, error handling) is cloned verbatim from "EVERTRUST - REPLY GLOCK". Templates stay in Drive (content, not lead data). The Unsure auto-reply was dropped — UNSURE now just logs the classification for the RAG draft-review queue.',
  [configGlobals, erpListCampaigns],
  { color: 4 },
);

// ===========================================================================
// COMPOSE
// ===========================================================================
export default workflow('reply-glock-pg-v2', 'EVERTRUST - REPLY GLOCK (PG) v2')
  // --- setup flow ---
  .add(scheduleTrigger)
  .to(configGlobals)
  .add(webhookTrigger)
  .to(configGlobals)
  .add(configGlobals)
  .to(erpListCampaigns)
  .to(buildRunStart)
  .to(explodeCampaigns)
  .to(loopCampaigns
    // loop DONE (after all campaigns): reply detection
    .onDone(collectActiveLabels
      .to(getReplies.to(hydrateBody.to(enrichReplyContext)))
    )
    // loop EACH BATCH (per campaign): resolve config + templates, then nextBatch
    .onEachBatch(erpGetCampaignConfig.to(collectCampaign.to(driveListCampaignFiles.to(findTemplatesFile.to(
      ifTemplatesPresent
        .onTrue(driveDownloadTemplates.to(parseTemplateBlocks.to(nextBatch(loopCampaigns))))
        .onFalse(buildMissingMsg.to(waMissingFileAlert.to(nextBatch(loopCampaigns))))
    )))))
  )
  // second inbox (Hanna) — parallel branch from Collect Active Labels into Enrich
  .add(collectActiveLabels).to(getRepliesHanna.to(hydrateBodyHanna.to(enrichReplyContext)))
  // missing-file: ERP notify in parallel with the WA alert
  .add(buildMissingMsg).to(erpNotifyMissingFile)
  .add(enrichReplyContext).to(loopReplies
    // loop replies DONE -> daily summary
    .onDone(aggregateDailyCounts.to(waDailySummary))
    // loop replies EACH BATCH -> resolve prospect -> log inbound -> already-interested gate
    .onEachBatch(erpGetProspect.to(resolveProspect.to(erpLogInbound.to(
      ifAlreadyInterested
        .onTrue(buildSlotPickPrompt.to(openAiParseSlot.to(parseSlotChoice.to(
          ifSlotChosen
            .onTrue(meetingFields)
            .onFalse(buildClassifyPrompt)
        ))))
        .onFalse(buildClassifyPrompt)
    ))))
  )
  // daily summary -> ERP notify (parallel)
  .add(aggregateDailyCounts).to(erpNotifyDailySummary)
  // slot-unclear WA branch (kept)
  .add(ifSlotChosen.onFalse(waSlotUnclear.to(ifMarkReadHanna)))
  // classify -> switch
  .add(buildClassifyPrompt).to(openAiClassify).to(parseClassification).to(switchRoute)
  // switch interested -> has-proposed-time
  .add(switchRoute.onCase(0, ifHasProposedTime
    .onTrue(calCheckProposed.to(resolveProposedSlot.to(
      ifProposedFree
        .onTrue(meetingFields)
        .onFalse(calFindFreeSlots)
    )))
    .onFalse(calFindFreeSlots)
  ))
  // find-free-slots -> propose -> agent -> parse -> proposal send (Hanna/info) -> classify interested + graduate
  .add(calFindFreeSlots).to(propose2Slots).to(aiAgent).to(parseAgentResponse).to(
    ifProposalSenderHanna
      .onTrue(sendSlotProposalHanna)
      .onFalse(sendSlotProposal)
  )
  .add(sendSlotProposalHanna).to(erpClassifyInterested)
  .add(sendSlotProposal).to(erpClassifyInterested)
  .add(erpClassifyInterested).to(erpGraduate).to(waInterestedNotify).to(ifMarkReadHanna)
  .add(waInterestedNotify).to(erpNotifyInterested)
  // meeting-fields -> create meeting -> confirm (Hanna/info) -> classify meeting
  .add(meetingFields).to(calCreateMeeting).to(
    ifConfirmSenderHanna
      .onTrue(sendMeetingConfirmHanna)
      .onFalse(sendMeetingConfirm)
  )
  .add(sendMeetingConfirmHanna).to(erpClassifyMeeting)
  .add(sendMeetingConfirm).to(erpClassifyMeeting)
  .add(erpClassifyMeeting).to(waMeetingNotify).to(ifMarkReadHanna)
  .add(waMeetingNotify).to(erpNotifyMeeting)
  // switch unsure -> classify unsure -> WA + ERP notify -> mark read (auto-reply dropped)
  .add(switchRoute.onCase(1, erpClassifyUnsure.to(waUnsureNotify.to(ifMarkReadHanna))))
  .add(waUnsureNotify).to(erpNotifyUnsure)
  // switch not-interested -> classify not interested -> mark read
  .add(switchRoute.onCase(2, erpClassifyNotInterested.to(ifMarkReadHanna)))
  // mark read (Hanna/info) -> nextBatch loop replies
  .add(ifMarkReadHanna
    .onTrue(markReadHanna.to(nextBatch(loopReplies)))
    .onFalse(markRead.to(nextBatch(loopReplies)))
  )
  // error subtree
  .add(onWorkflowError).to(configErrorGlobals).to(formatErrorMessage).to(waErrorAlert)
  .add(formatErrorMessage).to(erpNotifyError)
  // stickies
  .add(noteErp)
  .add(noteSwap);
