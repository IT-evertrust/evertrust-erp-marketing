import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

// ===== Credentials (IDs resolved from list_credentials) =====
const driveHanna = newCredential('Google Drive account: Hanna');
const docsHanna = newCredential('Google Docs account: Hanna');
const liteLlm = newCredential('LiteLLM Gateway (mac-mini)');

// ===== Triggers =====
const readaiWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Read.ai Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'readai-contract-pg',
      responseMode: 'onReceived',
      options: {}
    },
    position: [-1200, 200]
  },
  output: [{ body: { session_id: 'sess_123', title: 'PL Container: Baltic Boxes — Contract Signing', summary: 'Agreed to sign.' } }]
});

const runManually = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Manually', position: [-1200, 480] },
  output: [{}]
});

const sampleMeetings = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Sample Meetings',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "return [{ json: {\n  sourceDoc: 'Baltic Boxes — final',\n  title: 'PL Container: Baltic Boxes — Contract Signing',\n  text: 'Final cooperation call between EVERTRUST and Baltic Boxes Sp. z o.o. Both sides reviewed the cooperation agreement and AGREED TO SIGN the contract this week. Partner company: Baltic Boxes Sp. z o.o., registered at ul. Morska 12, 81-001 Gdynia, Poland. Authorized signatory: Marek Kowalczyk, Prezes Zarzadu. Agreed commission 3,5% of awarded net value, plus 5.000 EUR upfront for the first 10 tenders. EVERTRUST will send the contract for signature.'\n} }];"
    },
    position: [-980, 480]
  },
  output: [{ sourceDoc: 'Baltic Boxes — final', title: 'PL Container: Baltic Boxes — Contract Signing', text: 'Final cooperation call...' }]
});

const adaptMeetingText = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Adapt Meeting Text',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const body = ($json.body) || $json || {};\nfunction v(x){ return (x === undefined || x === null) ? '' : ('' + x); }\nconst title = v(body.title);\nconst parts = [];\nif (title) parts.push('Meeting title: ' + title);\nif (v(body.summary)) parts.push('# Summary\\n' + v(body.summary));\nif (Array.isArray(body.chapter_summaries)) { let s='# Chapters\\n'; for (const c of body.chapter_summaries){ s += '- ' + v(c && c.title) + ': ' + v(c && c.description) + '\\n'; } parts.push(s); }\nif (body.transcript && Array.isArray(body.transcript.speaker_blocks)) { let t='# Transcript\\n'; for (const b of body.transcript.speaker_blocks){ const nm=(b&&b.speaker&&b.speaker.name)?b.speaker.name:'Unknown'; const w=(b&&typeof b.words==='string')?b.words:''; t += nm+': '+w+'\\n'; } parts.push(t); }\nreturn [{ json: { text: parts.join('\\n\\n'), title: title, sourceDoc: title, meetingId: v(body.session_id) } }];"
    },
    position: [-980, 200]
  },
  output: [{ text: 'Meeting title: ...', title: 'PL Container: Baltic Boxes — Contract Signing', sourceDoc: 'PL Container', meetingId: 'sess_123' }]
});

// ===== AI signing/niche/country detection (KEPT) =====
const signalModel = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Signal Model',
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini', cachedResultName: 'gpt-5-mini' }, options: { timeout: 120000 } },
    credentials: { openAiApi: liteLlm },
    position: [-760, 380]
  },
  output: [{}]
});

const signalExtractor = node({
  type: '@n8n/n8n-nodes-langchain.informationExtractor',
  version: 1.2,
  config: {
    name: 'Signal Extractor',
    parameters: {
      text: expr('{{ $json.text }}'),
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "companyName": "Baltic Boxes", "country": "Poland", "niche": "Container", "contractSigningMentioned": true, "signingReason": "both sides agreed to sign the contract", "meetingOutcome": "Both sides agreed to sign the contract this week", "cooperationTerm": "" }',
      options: { systemPromptTemplate: 'You read a post-meeting note between EVERTRUST (a German public-tender bidding/advisory firm) and a PARTNER company. Extract:\n- companyName = the partner company common/short name as spoken; empty if not named.\n- country = "Poland" for a Polish partner (Sp. z o.o. / .pl), "Germany" for a German partner (GmbH / .de); infer only from explicit cues, else empty.\n- niche = the cooperation sector/niche as ONE short word, chosen from: Container, LED, IT, PV, Cleaning, Painting, BESS. Infer from the meeting topic/products/title; empty if unclear.\n- contractSigningMentioned = true ONLY if the note clearly indicates BOTH sides have agreed to sign / are signing / will sign the EVERTRUST cooperation contract NOW. If it is just interest, a pitch, "will review", "will consult", or negotiating, it is false.\n- signingReason = brief reason/quote.\n- meetingOutcome = ONE short sentence (max ~20 words) summarizing what happened or the next step in THIS meeting (e.g. "Pricing discussed, partner will review internally", "Agreed to sign next week").\n- cooperationTerm = the agreed cooperation DURATION/term ONLY if explicitly stated (e.g. "3-6 month trial", "12 months", "trial then annual"); empty if not stated.\nNever invent. Output only what the text supports.' }
    },
    subnodes: { model: signalModel },
    position: [-760, 200]
  },
  output: [{ output: { companyName: 'Baltic Boxes', country: 'Poland', niche: 'Container', contractSigningMentioned: true, meetingOutcome: 'Agreed to sign', cooperationTerm: '' } }]
});

// ===== Build Signal (was Build Log Row) — no sheet row; emits ERP id fields =====
const buildSignal = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Signal',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const raw = $input.item.json; const d = raw.output || raw;\nfunction v(x){ return (x==null)?'':(''+x).trim(); }\nlet meet = {}; try { meet = ($('Sample Meetings').item && $('Sample Meetings').item.json) || {}; } catch(e){}\nlet wb = {}; try { wb = ($('Read.ai Webhook').item && $('Read.ai Webhook').item.json.body) || {}; } catch(e){}\nlet text=''; try { text = ($('Adapt Meeting Text').item && $('Adapt Meeting Text').item.json.text) || ''; } catch(e){}\nif (!text) text = v(meet.text);\nconst title = v(meet.title) || v(wb.title) || '';\nconst companyName = v(d.companyName);\nfunction norm(s){ var x=(''+s).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,''); x=x.split('sp. z o.o.').join(' ').split('sp.z o.o.').join(' ').split('sp z o o').join(' ').split('gmbh').join(' '); return x.replace(/[^a-z0-9]/g,''); }\nlet companyKey = norm(companyName); if (!companyKey) companyKey = norm(title);\nconst signNow = (d.contractSigningMentioned === true || v(d.contractSigningMentioned).toLowerCase()==='true');\nconst dd = new Date(); const pad=function(n){return (n<10?'0':'')+n;};\nconst meetingDate = dd.getFullYear()+'-'+pad(dd.getMonth()+1)+'-'+pad(dd.getDate());\nlet meetingId = v(wb.session_id) || v(meet.sourceDoc); if (!meetingId) meetingId = companyKey + '-' + dd.getTime();\n// ERP linkage passthrough: Read.ai payload may carry leadId/customerId; else empty (documented assumption)\nconst leadId = v(wb.leadId) || v(wb.lead_id) || '';\nconst customerId = v(wb.customerId) || v(wb.customer_id) || '';\nreturn { json: { companyKey: companyKey, companyName: companyName, country: v(d.country), niche: v(d.niche), meetingId: meetingId, signingMeetingId: meetingId, leadId: leadId, customerId: customerId, meetingDate: meetingDate, title: title, transcript: text.slice(0,45000), signNow: signNow ? 'YES':'', meetingOutcome: v(d.meetingOutcome), cooperationTerm: v(d.cooperationTerm) } };"
    },
    position: [-540, 200]
  },
  output: [{ companyKey: 'balticboxes', companyName: 'Baltic Boxes', country: 'Poland', niche: 'Container', meetingId: 'sess_123', signingMeetingId: 'sess_123', leadId: '', customerId: '', signNow: 'YES', cooperationTerm: '' }]
});

// ===== Ping CRM (notification leg, onError continue) =====
const pingCrm = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Ping CRM Sync',
    parameters: { method: 'POST', url: 'https://evertrustgmbh.app.n8n.cloud/webhook/crm-customer', sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ companyKey: $json.companyKey, companyName: $json.companyName, country: $json.country, niche: $json.niche, meetingId: $json.meetingId, signNow: $json.signNow, meetingOutcome: $json.meetingOutcome }) }}'), options: {} },
    onError: 'continueRegularOutput',
    position: [-320, 60]
  },
  output: [{ ok: true }]
});

// ===== Gate: Signing (KEPT) =====
const gateSigning = ifElse({
  version: 2.2,
  config: {
    name: 'Gate: Signing',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.signNow }}'), rightValue: 'YES', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and'
      }
    },
    position: [-320, 320]
  }
});

// ===== Check & Aggregate (KEPT, simplified to current item) =====
const checkAggregate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Check & Aggregate',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const rows = $input.all().map(function(i){ return i.json; });\nif (!rows.length) return [];\nconst parts = [];\nfor (const r of rows){ if (r.transcript) parts.push('=== ' + (r.meetingDate||'') + ' | ' + (r.title||'') + ' ===\\n' + r.transcript); }\nconst agg = parts.join('\\n\\n').slice(0, 120000);\nvar niche=''; var country='';\nfor (const r of rows){ var sn=((r.signNow||'')+'').trim().toUpperCase(); if(sn==='YES'||sn==='TRUE'){ if(r.niche) niche=r.niche; if(r.country) country=r.country; } }\nif(!niche){ for (const r of rows){ if(r.niche) niche=r.niche; } }\nif(!country){ for (const r of rows){ if(r.country) country=r.country; } }\nconst r0 = rows[0];\nreturn [{ json: { companyKey: r0.companyKey, companyName: r0.companyName, country: country||r0.country||'', niche: niche, meetingCount: rows.length, leadId: r0.leadId||'', customerId: r0.customerId||'', signingMeetingId: r0.signingMeetingId||r0.meetingId||'', cooperationTerm: r0.cooperationTerm||'', aggregateText: agg } }];"
    },
    position: [-100, 320]
  },
  output: [{ companyKey: 'balticboxes', companyName: 'Baltic Boxes', country: 'Poland', niche: 'Container', meetingCount: 1, leadId: '', customerId: '', signingMeetingId: 'sess_123', cooperationTerm: '', aggregateText: '=== ...' }]
});

// ===== Deal legal-identity extraction (KEPT) =====
const dealModel = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Deal Model',
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini', cachedResultName: 'gpt-5-mini' }, options: { timeout: 120000 } },
    credentials: { openAiApi: liteLlm },
    position: [120, 480]
  },
  output: [{}]
});

const dealExtractor = node({
  type: '@n8n/n8n-nodes-langchain.informationExtractor',
  version: 1.2,
  config: {
    name: 'Deal Extractor',
    parameters: {
      text: expr('{{ $json.aggregateText }}'),
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "companyName": "", "partnerLegalName": "", "partnerStreet": "", "partnerPostalCity": "", "partnerSignatory": "", "partnerSignatoryRole": "", "commissionDetail": "", "setupFee": "" }',
      options: { systemPromptTemplate: 'You extract the PARTNER company legal identity from these aggregated EVERTRUST sales-meeting transcripts to prepare a cooperation contract. ABSOLUTE RULE — NO FABRICATION: output a value ONLY if it is literally stated in the text; otherwise an empty string. partnerLegalName = the full registered name including the legal form (Sp. z o.o., GmbH, S.A.) only if that form was literally spoken. partnerStreet, partnerPostalCity = the registered address only if stated. partnerSignatory + partnerSignatoryRole = the person who will sign and their role, only if explicitly named. commissionDetail + setupFee = the agreed figures verbatim if stated. An empty string is the correct, safe answer whenever a fact was not spoken — never guess a plausible company name, address, or person.' }
    },
    subnodes: { model: dealModel },
    position: [120, 320]
  },
  output: [{ output: { partnerLegalName: 'Baltic Boxes Sp. z o.o.', partnerStreet: 'ul. Morska 12', partnerPostalCity: '81-001 Gdynia', partnerSignatory: 'Marek Kowalczyk', partnerSignatoryRole: 'Prezes Zarzadu' } }]
});

// ===== ERP: Active Campaigns (REPLACES Search Configs + Download Config) =====
const erpActiveCampaigns = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP: Active Campaigns',
    parameters: {
      method: 'GET',
      url: 'https://evertrust-api.onrender.com/campaigns/machine/list',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'lifecycle', value: 'ACTIVE' }] },
      options: {}
    },
    position: [340, 320]
  },
  output: [{ data: [{ id: 'camp_pl_container', niche: 'Container', country: 'Poland', driveFolderId: '1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M', templateAssetName: 'Template_Container_EN', templateAssetId: 'asset_1' }] }]
});

// ===== Match Campaign (RE-POINTED to ERP list) =====
const matchCampaign = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Match Campaign',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const agg = $('Check & Aggregate').first().json;\nconst mNiche = ((agg.niche||'')+'').trim().toLowerCase();\nconst mCountry = ((agg.country||'')+'').trim().toLowerCase();\nconst resp = $input.first().json;\nconst list = Array.isArray(resp) ? resp : (resp.data || resp.items || resp.campaigns || []);\nconst STUB_FOLDER = '1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M';\nfunction lc(s){ return (''+(s==null?'':s)).toLowerCase().trim(); }\nfunction nicheMatch(a,b){ if(!a||!b) return false; a=lc(a); b=lc(b); return a===b || a.indexOf(b)>=0 || b.indexOf(a)>=0; }\nfunction g(c, keys){ for (const k of keys){ if (c[k]!=null && (''+c[k])!=='') return c[k]; var cfg=c.config||c.machineConfig||{}; if (cfg[k]!=null && (''+cfg[k])!=='') return cfg[k]; } return ''; }\nconst cands = list.map(function(c){ return {\n  campaignId: g(c,['id','campaignId','_id']),\n  niche: g(c,['niche','sector']),\n  country: g(c,['country']),\n  folderId: g(c,['driveFolderId','folderId','campaignFolderId','contractFolderId']),\n  templateAssetId: g(c,['templateAssetId','templateId','contractTemplateAssetId']),\n  templateName: g(c,['templateAssetName','templateName','contractTemplateName'])\n}; });\nvar chosen = null;\nfor (const c of cands){ if (lc(c.country)===mCountry && nicheMatch(c.niche,mNiche)){ chosen=c; break; } }\nif(!chosen){ for (const c of cands){ if (lc(c.country)===mCountry){ chosen=c; break; } } }\nif(!chosen){ for (const c of cands){ if (nicheMatch(c.niche,mNiche)){ chosen=c; break; } } }\nif(!chosen) chosen = cands[0] || {};\nreturn [{ json: {\n  campaignId: chosen.campaignId || '',\n  campaignFolderId: chosen.folderId || STUB_FOLDER,\n  templateAssetId: chosen.templateAssetId || '',\n  templateNameFromCampaign: chosen.templateName || '',\n  niche: chosen.niche || mNiche || 'DEFAULT',\n  country: chosen.country || mCountry || 'Poland',\n  companyKey: agg.companyKey, companyName: agg.companyName, meetingCount: agg.meetingCount,\n  leadId: agg.leadId||'', customerId: agg.customerId||'', signingMeetingId: agg.signingMeetingId||'', cooperationTerm: agg.cooperationTerm||''\n} }];"
    },
    position: [560, 320]
  },
  output: [{ campaignId: 'camp_pl_container', campaignFolderId: '1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M', templateAssetId: 'asset_1', templateNameFromCampaign: 'Template_Container_EN', niche: 'Container', country: 'Poland', companyKey: 'balticboxes', leadId: '', signingMeetingId: 'sess_123', cooperationTerm: '' }]
});

// ===== ERP: Contract Idempotency (GET) =====
const erpIdempotency = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP: Contract Idempotency',
    parameters: {
      method: 'GET',
      url: 'https://evertrust-api.onrender.com/contracts',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'leadId', value: expr('{{ $json.leadId }}') }, { name: 'campaignId', value: expr('{{ $json.campaignId }}') }, { name: 'limit', value: '1' }] },
      options: {}
    },
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    position: [780, 320]
  },
  output: [{ data: [] }]
});

// ===== Has Existing Contract? IF gate =====
const hasExisting = ifElse({
  version: 2.2,
  config: {
    name: 'Existing Contract?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ leftValue: expr('{{ (($json.data || $json.items || (Array.isArray($json) ? $json : [])).filter(c => ["GENERATED","SIGNED"].includes((c.status||"").toUpperCase()))).length }}'), rightValue: 0, operator: { type: 'number', operation: 'equals' } }],
        combinator: 'and'
      }
    },
    position: [1000, 320]
  }
});

// ===== Build Fields (KEPT) =====
const buildFields = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Fields',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const dealRaw = $('Deal Extractor').first().json; const d = dealRaw.output || dealRaw;\nconst agg = ($('Check & Aggregate').first() && $('Check & Aggregate').first().json.aggregateText) || '';\nconst mc = $('Match Campaign').first().json;\nfunction v(x){ return (x==null)?'':(''+x).trim(); }\nfunction pick(){ for (let i=0;i<arguments.length;i++){ const x=v(arguments[i]); if(x!=='') return x; } return ''; }\nfunction fold(x){ return (''+x).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\u0142/g,'l').replace(/\\u00f8/g,'o').replace(/\\u00df/g,'ss'); }\nconst HAY = fold(agg);\nfunction grounded(val){ const s=v(val); if(s==='')return ''; const low=fold(s); if(HAY && HAY.indexOf(low)>=0) return s; const toks=low.split(/[^0-9a-z]+/).filter(function(t){return t.length>=4;}); for(let i=0;i<toks.length;i++){ if(HAY.indexOf(toks[i])>=0) return s; } return ''; }\nconst country = pick(mc.country, d.country, 'Poland');\nconst isDE = country.toLowerCase().indexOf('german')>=0 || country.toLowerCase().indexOf('deutsch')>=0;\nconst LANG = isDE ? 'DE':'EN';\nconst niche = pick(mc.niche, 'DEFAULT');\nconst gName = pick(grounded(d.partnerLegalName), grounded(d.companyName));\nconst gStreet = grounded(d.partnerStreet);\nconst gPostalCity = grounded(d.partnerPostalCity);\nconst gSignatory = grounded(d.partnerSignatory);\nconst gRole = grounded(d.partnerSignatoryRole);\nconst clientName = gName || (isDE?'\\u00abFirmenname\\u00bb':'\\u00abCompany name\\u00bb');\nconst clientStreet = gStreet || (isDE?'\\u00abStra\\u00dfe und Hausnummer\\u00bb':'\\u00abStreet and number\\u00bb');\nconst clientPostalCity = gPostalCity || (isDE?'\\u00abPLZ und Ort\\u00bb':'\\u00abPostal code and city\\u00bb');\nconst clientSignatory = gSignatory || (isDE?'\\u00abUnterzeichnende/r\\u00bb':'\\u00abSignatory\\u00bb');\nconst clientSignatoryTitle = gRole || (isDE?'Gesch\\u00e4ftsf\\u00fchrer':'Managing Director');\nlet signCity = clientPostalCity; { const p = clientPostalCity.split(' '); if (p.length>1 && /^[0-9-]+$/.test(p[0])) p.shift(); signCity = p.join(' ').trim()||clientPostalCity; } signCity = signCity.split(',')[0].trim(); if(!signCity||signCity.indexOf('\\u00ab')>=0) signCity = isDE?'\\u00abOrt\\u00bb':'\\u00abCity\\u00bb';\nconst dd = new Date(); const pad=function(n){return (n<10?'0':'')+n;}; const signDate = pad(dd.getDate())+'.'+pad(dd.getMonth()+1)+'.'+dd.getFullYear();\nconst templateName = pick(mc.templateNameFromCampaign, 'Template_' + niche + '_' + LANG);\nconst safe = clientName.split('/').join('-');\nconst fileBase = (isDE?'Vertragsvereinbarung_':'Contract_Agreement_') + safe + (isDE?'_EVERTRUST':'_EN');\nreturn { json: {\n  language: isDE?'de':'en', niche: niche, country: country, templateName: templateName,\n  clientName: clientName, clientStreet: clientStreet, clientPostalCity: clientPostalCity, clientSignatory: clientSignatory, clientSignatoryTitle: clientSignatoryTitle, signCity: signCity, signDate: signDate,\n  tenderCount: '10', upfrontFee: 'EUR 5,000.00', marketEntryFee: 'EUR 2,000.00', projectFee: 'EUR 3,000.00', commissionRate: '3.5%', furtherPackageFee: 'EUR 3,000.00',\n  testphaseFee: '500,00 \\u20ac', packageFee: '2.990,00 \\u20ac', freeTenders: '5', threshold1: '999.000 EUR', commissionRate1: '3,5 %', threshold2: '1.000.000 EUR', commissionRate2: '2,5 %',\n  campaignFolderId: pick(mc.campaignFolderId, '1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M'), fileBase: fileBase,\n  campaignId: mc.campaignId||'', templateAssetId: mc.templateAssetId||'', companyKey: mc.companyKey, companyName: mc.companyName, meetingCount: mc.meetingCount,\n  leadId: mc.leadId||'', customerId: mc.customerId||'', signingMeetingId: mc.signingMeetingId||'', cooperationTerm: mc.cooperationTerm||''\n} };"
    },
    position: [1220, 220]
  },
  output: [{ language: 'en', niche: 'Container', country: 'Poland', templateName: 'Template_Container_EN', clientName: 'Baltic Boxes Sp. z o.o.', clientStreet: 'ul. Morska 12', clientPostalCity: '81-001 Gdynia', clientSignatory: 'Marek Kowalczyk', clientSignatoryTitle: 'Prezes Zarzadu', signCity: 'Gdynia', signDate: '12.06.2026', tenderCount: '10', upfrontFee: 'EUR 5,000.00', marketEntryFee: 'EUR 2,000.00', projectFee: 'EUR 3,000.00', commissionRate: '3.5%', furtherPackageFee: 'EUR 3,000.00', testphaseFee: '500,00', packageFee: '2.990,00', freeTenders: '5', threshold1: '999.000 EUR', commissionRate1: '3,5 %', threshold2: '1.000.000 EUR', commissionRate2: '2,5 %', campaignFolderId: '1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M', fileBase: 'Contract_Agreement_Baltic Boxes Sp. z o.o._EN', campaignId: 'camp_pl_container', templateAssetId: 'asset_1', companyKey: 'balticboxes', companyName: 'Baltic Boxes', meetingCount: 1, leadId: '', customerId: '', signingMeetingId: 'sess_123', cooperationTerm: '' }]
});

// ===== Resolve Template (KEPT — Drive lookup of the Doc template by name) =====
const resolveTemplate = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Resolve Template',
    parameters: {
      method: 'GET',
      url: 'https://www.googleapis.com/drive/v3/files',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'googleDriveOAuth2Api',
      sendQuery: true,
      queryParameters: { parameters: [{ name: 'q', value: expr("name = '{{ $json.templateName }}' and mimeType = 'application/vnd.google-apps.document' and trashed = false") }, { name: 'fields', value: 'files(id,name)' }, { name: 'supportsAllDrives', value: 'true' }, { name: 'includeItemsFromAllDrives', value: 'true' }] },
      options: {}
    },
    credentials: { googleDriveOAuth2Api: driveHanna },
    onError: 'continueRegularOutput',
    position: [1440, 220]
  },
  output: [{ files: [{ id: 'doc_tpl_1', name: 'Template_Container_EN' }] }]
});

const pickTemplate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Pick Template',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const files = ($input.item.json.files) || [];\nconst bf = $('Build Fields').item.json;\nlet chosen = null;\nfor (const f of files){ if (f.name === bf.templateName){ chosen = f; break; } }\nif (!chosen) chosen = files[0] || null;\nreturn { json: Object.assign({}, bf, { templateDocId: chosen ? chosen.id : '', templateNameResolved: chosen ? chosen.name : '' }) };"
    },
    position: [1660, 220]
  },
  output: [{ templateDocId: 'doc_tpl_1', templateNameResolved: 'Template_Container_EN', language: 'en', niche: 'Container', country: 'Poland', templateName: 'Template_Container_EN', clientName: 'Baltic Boxes Sp. z o.o.', clientStreet: 'ul. Morska 12', clientPostalCity: '81-001 Gdynia', clientSignatory: 'Marek Kowalczyk', clientSignatoryTitle: 'Prezes Zarzadu', signCity: 'Gdynia', signDate: '12.06.2026', tenderCount: '10', upfrontFee: 'EUR 5,000.00', marketEntryFee: 'EUR 2,000.00', projectFee: 'EUR 3,000.00', commissionRate: '3.5%', furtherPackageFee: 'EUR 3,000.00', testphaseFee: '500,00', packageFee: '2.990,00', freeTenders: '5', threshold1: '999.000 EUR', commissionRate1: '3,5 %', threshold2: '1.000.000 EUR', commissionRate2: '2,5 %', campaignFolderId: '1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M', fileBase: 'Contract_Agreement_Baltic Boxes Sp. z o.o._EN', campaignId: 'camp_pl_container', templateAssetId: 'asset_1', companyKey: 'balticboxes', companyName: 'Baltic Boxes', meetingCount: 1, leadId: '', customerId: '', signingMeetingId: 'sess_123', cooperationTerm: '' }]
});

// ===== Copy Template (KEPT — Drive binary) =====
const copyTemplate = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Copy Template',
    parameters: {
      resource: 'file',
      operation: 'copy',
      fileId: { __rl: true, mode: 'id', value: expr('{{ $json.templateDocId }}') },
      name: expr('{{ $json.fileBase }}'),
      sameFolder: false,
      driveId: { __rl: true, mode: 'list', value: 'My Drive', cachedResultName: 'My Drive' },
      folderId: { __rl: true, mode: 'id', value: expr('{{ $json.campaignFolderId }}') },
      options: {}
    },
    credentials: { googleDriveOAuth2Api: driveHanna },
    position: [1880, 220]
  },
  output: [{ id: 'copied_doc_1' }]
});

// ===== Fill (KEPT — Docs binary) =====
const fill = node({
  type: 'n8n-nodes-base.googleDocs',
  version: 2,
  config: {
    name: 'Fill',
    parameters: {
      resource: 'document',
      operation: 'update',
      documentURL: expr('{{ $json.id }}'),
      actionsUi: {
        actionFields: [
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{CLIENT_NAME}}', replaceText: expr("{{ $('Pick Template').item.json.clientName }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{CLIENT_STREET}}', replaceText: expr("{{ $('Pick Template').item.json.clientStreet }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{CLIENT_POSTAL_CITY}}', replaceText: expr("{{ $('Pick Template').item.json.clientPostalCity }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{CLIENT_SIGNATORY_TITLE}}', replaceText: expr("{{ $('Pick Template').item.json.clientSignatoryTitle }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{CLIENT_SIGNATORY}}', replaceText: expr("{{ $('Pick Template').item.json.clientSignatory }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{SIGN_CITY}}', replaceText: expr("{{ $('Pick Template').item.json.signCity }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{SIGN_DATE}}', replaceText: expr("{{ $('Pick Template').item.json.signDate }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{TENDER_COUNT}}', replaceText: expr("{{ $('Pick Template').item.json.tenderCount }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{UPFRONT_FEE}}', replaceText: expr("{{ $('Pick Template').item.json.upfrontFee }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{MARKET_ENTRY_FEE}}', replaceText: expr("{{ $('Pick Template').item.json.marketEntryFee }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{PROJECT_FEE}}', replaceText: expr("{{ $('Pick Template').item.json.projectFee }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{COMMISSION_RATE}}', replaceText: expr("{{ $('Pick Template').item.json.commissionRate }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{FURTHER_PACKAGE_FEE}}', replaceText: expr("{{ $('Pick Template').item.json.furtherPackageFee }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{TESTPHASE_FEE}}', replaceText: expr("{{ $('Pick Template').item.json.testphaseFee }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{PACKAGE_FEE}}', replaceText: expr("{{ $('Pick Template').item.json.packageFee }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{FREE_TENDERS}}', replaceText: expr("{{ $('Pick Template').item.json.freeTenders }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{THRESHOLD_1}}', replaceText: expr("{{ $('Pick Template').item.json.threshold1 }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{COMMISSION_RATE_1}}', replaceText: expr("{{ $('Pick Template').item.json.commissionRate1 }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{THRESHOLD_2}}', replaceText: expr("{{ $('Pick Template').item.json.threshold2 }}"), matchCase: true },
          { object: 'text', action: expr('{{ "replaceAll" }}'), text: '{{COMMISSION_RATE_2}}', replaceText: expr("{{ $('Pick Template').item.json.commissionRate2 }}"), matchCase: true }
        ]
      }
    },
    credentials: { googleDocsOAuth2Api: docsHanna },
    onError: 'continueRegularOutput',
    position: [2100, 220]
  },
  output: [{ id: 'copied_doc_1' }]
});

// ===== Export PDF (KEPT — Drive binary) =====
const exportPdf = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Export PDF',
    parameters: {
      resource: 'file',
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: expr("{{ $('Copy Template').item.json.id }}") },
      options: { binaryPropertyName: 'data', googleFileConversion: { conversion: { docsToFormat: 'application/pdf' } }, fileName: expr("{{ $('Pick Template').item.json.fileBase }}.pdf") }
    },
    credentials: { googleDriveOAuth2Api: driveHanna },
    position: [2320, 220]
  },
  output: [{ id: 'copied_doc_1' }]
});

// ===== Save PDF (KEPT — Drive binary) =====
const savePdf = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Save PDF',
    parameters: {
      resource: 'file',
      operation: 'upload',
      name: expr("{{ $('Pick Template').item.json.fileBase }}.pdf"),
      driveId: { __rl: true, mode: 'list', value: 'My Drive', cachedResultName: 'My Drive' },
      folderId: { __rl: true, mode: 'id', value: expr("{{ $('Pick Template').item.json.campaignFolderId }}") },
      options: {}
    },
    credentials: { googleDriveOAuth2Api: driveHanna },
    position: [2540, 220]
  },
  output: [{ id: 'saved_pdf_file_1', webViewLink: 'https://drive.google.com/file/d/saved_pdf_file_1/view' }]
});

// ===== ERP: Record Contract (POST — SPINE, fails loud) REPLACES Mark Processed =====
const erpRecordContract = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP: Record Contract',
    parameters: {
      method: 'POST',
      url: 'https://evertrust-api.onrender.com/contracts',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ leadId: $('Pick Template').item.json.leadId || undefined, customerId: $('Pick Template').item.json.customerId || undefined, campaignId: $('Pick Template').item.json.campaignId || undefined, templateAssetId: $('Pick Template').item.json.templateAssetId || undefined, signingMeetingId: $('Pick Template').item.json.signingMeetingId || undefined, status: 'GENERATED', driveFileId: $json.id, driveUrl: ($json.webViewLink || $json.webContentLink || '') }) }}"),
      options: {}
    },
    position: [2760, 220]
  },
  output: [{ id: 'contract_1', status: 'GENERATED' }]
});

// ===== ERP: Mark Signed (PATCH — SPINE, fails loud) REPLACES sheet status flip =====
const erpMarkSigned = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'ERP: Mark Signed',
    parameters: {
      method: 'PATCH',
      url: expr('https://evertrust-api.onrender.com/contracts/{{ $json.id || $json.contractId }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ status: 'SIGNED', signedAt: $now.toISO(), cooperationTerm: $('Pick Template').item.json.cooperationTerm || undefined }) }}"),
      options: {}
    },
    position: [2980, 220]
  },
  output: [{ id: 'contract_1', status: 'SIGNED' }]
});

// ===== Sticky notes =====
const stickyErp = sticky('## ERP HTTP nodes (UNBOUND)\nSelect the **ERP Ingest (x-arsenal-token)** credential on the 4 ERP nodes\n(Active Campaigns, Contract Idempotency, Record Contract, Mark Signed).\nBase URL https://evertrust-api.onrender.com — update if it differs; live only post-deploy.', [erpActiveCampaigns, erpIdempotency, erpRecordContract, erpMarkSigned], { color: 4 });
const stickyDrive = sticky('## Contract PDF generation (KEPT in Drive/Docs)\nBinary work stays in Google Drive/Docs (Hanna credential).\nOnly the config.json lookup + hot_leads Sheet writes moved to the ERP.', [resolveTemplate, copyTemplate, fill, exportPdf, savePdf], { color: 6 });

// ===== Compose =====
export default workflow('contractmaker-pg', 'EVERTRUST - ContractMaker (PG)')
  // webhook path
  .add(readaiWebhook)
  .to(adaptMeetingText)
  .to(signalExtractor)
  .to(buildSignal)
  .to(pingCrm)
  .add(buildSignal)
  .to(gateSigning
    .onTrue(
      checkAggregate
        .to(dealExtractor)
        .to(erpActiveCampaigns)
        .to(matchCampaign)
        .to(erpIdempotency)
        .to(hasExisting
          .onTrue(
            buildFields
              .to(resolveTemplate)
              .to(pickTemplate)
              .to(copyTemplate)
              .to(fill)
              .to(exportPdf)
              .to(savePdf)
              .to(erpRecordContract)
              .to(erpMarkSigned)
          )
        )
    )
  )
  // manual test path
  .add(runManually)
  .to(sampleMeetings)
  .to(signalExtractor)
  // stickies
  .add(stickyErp)
  .add(stickyDrive);
