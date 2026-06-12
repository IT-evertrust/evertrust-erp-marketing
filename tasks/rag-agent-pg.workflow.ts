import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  splitInBatches,
  nextBatch,
  expr,
} from '@n8n/workflow-sdk';

const everyHour = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Every Hour',
    parameters: { rule: { interval: [{ field: 'hours' }] } },
    position: [240, 400],
  },
  output: [{}],
});

const getBacklog = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get RAG Backlog',
    parameters: {
      method: 'GET',
      url: 'https://evertrust-api.onrender.com/reply-classifications',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'needsRag', value: 'true' },
          { name: 'limit', value: '50' },
        ],
      },
    },
    position: [480, 400],
  },
  output: [
    {
      id: 'rc_1',
      prospectId: 'pr_1',
      prospectEmail: 'lead@example.com',
      campaignId: 'cmp_1',
      verdict: 'UNSURE',
      createdAt: '2026-06-12T10:00:00Z',
    },
  ],
});

const loopBacklog = splitInBatches({
  version: 3,
  config: {
    name: 'Loop Over Backlog',
    parameters: { batchSize: 1, options: {} },
    position: [720, 400],
  },
});

const getThread = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Get Thread Context',
    parameters: {
      method: 'GET',
      url: 'https://evertrust-api.onrender.com/outreach-messages',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {
        parameters: [
          { name: 'prospectId', value: expr('{{ $json.prospectId }}') },
          { name: 'limit', value: '50' },
        ],
      },
      options: { response: { response: { fullResponse: false } } },
    },
    position: [960, 320],
  },
  output: [
    [
      {
        id: 'om_1',
        prospectId: 'pr_1',
        direction: 'OUTBOUND',
        subject: 'Introducing EVERTRUST',
        body: 'Hello, we would love to work with you.',
        fromAddress: 'hanna@evertrust-germany.de',
        toAddress: 'lead@example.com',
        sentAt: '2026-06-10T09:00:00Z',
      },
      {
        id: 'om_2',
        prospectId: 'pr_1',
        direction: 'INBOUND',
        subject: 'Re: Introducing EVERTRUST',
        body: 'Thanks, but I am not sure about your references.',
        fromAddress: 'lead@example.com',
        toAddress: 'hanna@evertrust-germany.de',
        sentAt: '2026-06-11T11:00:00Z',
      },
    ],
  ],
});

const buildPrompt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build RAG Prompt',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "function fmtThread(messages, leadEmail) {\n  const arr = Array.isArray(messages) ? messages : [];\n  const sorted = [...arr].sort((a, b) => {\n    const ta = Date.parse(a.sentAt || a.createdAt || a.date || '') || 0;\n    const tb = Date.parse(b.sentAt || b.createdAt || b.date || '') || 0;\n    return ta - tb;\n  });\n  const capped = sorted.slice(-20);\n  let formatted = '';\n  let hasLeadMessage = false;\n  for (const msg of capped) {\n    const dir = (msg.direction || '').toString().toUpperCase();\n    const from = (msg.fromAddress || msg.from || '').toString().toLowerCase();\n    const isFromLead = dir === 'INBOUND' || (leadEmail && from.includes(leadEmail));\n    if (isFromLead) hasLeadMessage = true;\n    const label = isFromLead ? '[LEAD]' : '[EVERTRUST]';\n    const when = (msg.sentAt || msg.createdAt || msg.date || '').toString();\n    const fromDisp = (msg.fromAddress || msg.from || '').toString();\n    const subject = (msg.subject || '').toString();\n    const body = (msg.body || msg.text || msg.snippet || '').toString().trim().slice(0, 2000);\n    if (formatted) formatted += '\\n\\n';\n    formatted += '--- ' + label + ' | ' + when + ' ---\\nFrom: ' + fromDisp + '\\nSubject: ' + subject + '\\n\\n' + (body || '[no text content]');\n  }\n  return { formatted, hasLeadMessage };\n}\n\nconst out = [];\nconst items = $input.all();\nfor (let i = 0; i < items.length; i++) {\n  const lead = $('Get RAG Backlog').itemMatching(i).json;\n  const prospectId = (lead.prospectId ?? '').toString();\n  const campaignId = (lead.campaignId ?? '').toString();\n  const leadEmail = (lead.prospectEmail ?? lead.leadEmail ?? '').toString().toLowerCase();\n  const company = (lead.companyName ?? lead.company ?? '').toString();\n  const country = (lead.country ?? '').toString();\n\n  const threadRaw = items[i].json;\n  const messages = Array.isArray(threadRaw) ? threadRaw\n    : (Array.isArray(threadRaw.data) ? threadRaw.data\n      : (Array.isArray(threadRaw.messages) ? threadRaw.messages\n        : (Array.isArray(threadRaw.items) ? threadRaw.items : [])));\n  const ft = fmtThread(messages, leadEmail);\n  const formattedThread = ft.formatted || '[no prior messages on file]';\n\n  const sp = [];\n  sp.push('You are working on a lead marked \"Unsure\" in the sales pipeline. You have the full email thread between EVERTRUST GmbH and this lead.');\n  sp.push('');\n  sp.push('Your two tasks:');\n  sp.push('1. IDENTIFY the \"unsure section\" — scan the entire thread and find the specific text where the lead expresses hesitation, raises an unanswered question, or signals uncertainty. This may appear anywhere in the thread. Extract the relevant sentence(s) verbatim or as a close paraphrase.');\n  sp.push('2. DRAFT a confident reply that directly addresses that specific concern, on behalf of Hanna Nguyen at EVERTRUST GmbH.');\n  sp.push('');\n  sp.push('Work ONLY from the email thread for factual claims. Never use outside knowledge. Do not invent facts. The subject field is for the reply — do not prefix with \"Re:\".');\n  sp.push('');\n  sp.push('=== CORE RULE: BE HANNA — DECISIVE, NEVER APOLOGETIC ===');\n  sp.push('');\n  sp.push('BANNED phrases: \"At the moment, I do not have...\" / \"I do not have confirmed information...\" / \"I want to be transparent here...\" / \"I am sorry, but...\" / \"Based on the materials I have...\" / \"The brochure does not specify...\" / \"I cannot confirm from our current materials...\"');\n  sp.push('');\n  sp.push('MODE A — DIRECT ANSWER. Use when the thread contains material that meaningfully answers the question. 1-2 short paragraphs (max 3 sentences each).');\n  sp.push('');\n  sp.push('MODE B — BRIEF STALL. Use when the thread does NOT contain the information.');\n  sp.push('');\n  sp.push('English: \"Thank you for getting back to us. We have carefully gone through your point and are currently checking with our operations team to provide you with a complete answer as soon as possible.\\n\\nWe will follow up with you very shortly.\"');\n  sp.push('');\n  sp.push('German: \"Vielen Dank für Ihre Rückmeldung. Wir haben Ihren Punkt sorgfältig durchgegangen und stimmen uns derzeit mit unserem Team ab, um Ihnen schnellstmöglich eine vollständige Antwort zu geben.\\n\\nWir melden uns in Kürze bei Ihnen.\"');\n  sp.push('');\n  sp.push('If part is answerable: MODE A on that part, end with \"We will follow up on the remaining details shortly.\"');\n  sp.push('');\n  sp.push('=== LANGUAGE ===');\n  sp.push('Language of the IDENTIFIED UNSURE SECTION determines both body and salutation language.');\n  sp.push('');\n  sp.push('=== SALUTATION ===');\n  sp.push('English: \"Dear <FirstName>,\" or \"Dear <Company Name>,\"');\n  sp.push('German: \"Sehr geehrte Damen und Herren von <Company Name>,\" (default)');\n  sp.push('NEVER \"Hello,\". NEVER invent a recipient name.');\n  sp.push('');\n  sp.push('=== TONE ===');\n  sp.push('Max 3 sentences/paragraph. \"We\" for company actions. No filler, no emojis. Do NOT repeat info already in the thread.');\n  sp.push('');\n  sp.push('=== MEETING-REQUEST PATTERN ===');\n  sp.push('\"Thank you for your interest. To take this further, please choose one of the following 30-minute slots:\\n\\n1) <Weekday>, <DD MMM YYYY> at <HH:MM> Berlin\\n2) <Weekday>, <DD MMM YYYY> at <HH:MM> Berlin\\n\\nReply with just the number (1 or 2) and we will send a calendar invite with a Google Meet link.\"');\n  sp.push('');\n  sp.push('=== REFERENCE-REQUEST PATTERN ===');\n  sp.push('\"I would love to share these with you; however, we have signed NDAs with all of our clients which prevents us from sharing direct references.\" Add max 4 awarded-project bullets if present in the thread.');\n  sp.push('');\n  sp.push('=== CLOSERS ===');\n  sp.push('English: Kind regards,\\nHanna Nguyen\\nEVERTRUST GmbH');\n  sp.push('German: Mit freundlichen Grüßen,\\nHanna Nguyen\\nEVERTRUST GmbH');\n  sp.push('');\n  sp.push('=== OUTPUT FIELDS ===');\n  sp.push('1. subject (max ~70 chars, same language, no \"Re:\").');\n  sp.push('2. unsureSection: verbatim/close-paraphrase of the key hesitation text. Same language as original.');\n  sp.push('3. unsureSignal: brief English description (one phrase).');\n  sp.push('4. unsureArea: exactly one of \"Finance\", \"Operation\", \"Organization\", \"Legality\", \"Reference - Past Projects/Wins\".');\n  sp.push('5. areaExplanation: 5-12 words why this category applies.');\n  sp.push('6. draftReply: full email reply, same language as unsure section. Use real line breaks for paragraphs.');\n  sp.push('7. citations: array of verbatim quotes from the thread that support the answer. Empty array for MODE B.');\n  sp.push('');\n  sp.push('=== CRITICAL OUTPUT FORMAT ===');\n  sp.push('Return ONLY a single valid JSON object with exactly these keys: subject, unsureSection, unsureSignal, unsureArea, areaExplanation, draftReply, citations. Output nothing else — no markdown, no code fences, no commentary. \"citations\" MUST be an array of strings (use [] if none).');\n  const systemPrompt = sp.join(String.fromCharCode(10));\n\n  const up = [];\n  up.push('Lead context:');\n  up.push('Company: ' + company);\n  up.push('Country: ' + country);\n  up.push('Lead email: ' + leadEmail);\n  up.push('');\n  up.push('Full email thread (oldest first):');\n  up.push(formattedThread);\n  const userPrompt = up.join(String.fromCharCode(10));\n\n  out.push({ json: { prospectId, campaignId, leadEmail, company, country, systemPrompt, userPrompt } });\n}\nreturn out;",
    },
    position: [1200, 320],
  },
  output: [
    {
      prospectId: 'pr_1',
      campaignId: 'cmp_1',
      leadEmail: 'lead@example.com',
      company: 'Acme GmbH',
      country: 'Germany',
      systemPrompt: 'You are working on a lead marked Unsure...',
      userPrompt: 'Lead context: Company Acme GmbH...',
    },
  ],
});

const gptModel = node({
  type: '@n8n/n8n-nodes-langchain.openAi',
  version: 1.7,
  config: {
    name: 'Draft Reply (gpt-4o)',
    parameters: {
      resource: 'text',
      operation: 'message',
      modelId: { __rl: true, mode: 'list', value: 'gpt-4o', cachedResultName: 'gpt-4o' },
      messages: {
        values: [
          { content: expr('{{ $json.systemPrompt }}'), role: 'system' },
          { content: expr('{{ $json.userPrompt }}'), role: 'user' },
        ],
      },
      simplify: true,
      jsonOutput: true,
      options: { temperature: 0.2 },
    },
    credentials: { openAiApi: newCredential('OpenAI account') },
    position: [1440, 320],
  },
  output: [
    {
      message: {
        content: {
          subject: 'Our references and how we can move forward',
          unsureSection: 'I am not sure about your references.',
          unsureSignal: 'doubts about client references',
          unsureArea: 'Reference - Past Projects/Wins',
          areaExplanation: 'Lead questions proof of past delivered projects',
          draftReply: 'Dear Acme GmbH, Thank you for getting back to us...',
          citations: [],
        },
      },
    },
  ],
});

const parseDraft = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Draft',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const out = [];\nconst items = $input.all();\nfor (let i = 0; i < items.length; i++) {\n  const j = items[i].json || {};\n  const ctx = $('Build RAG Prompt').itemMatching(i).json;\n  let v = (j.message && j.message.content !== undefined) ? j.message.content\n        : (j.content !== undefined ? j.content : j);\n  let parsed = v;\n  if (typeof v === 'string') {\n    let text = v.trim().replace(/^```(?:json)?\\s*/i, '').replace(/\\s*```$/i, '').trim();\n    const first = text.indexOf('{');\n    const last = text.lastIndexOf('}');\n    if (first !== -1 && last !== -1 && last > first) text = text.slice(first, last + 1);\n    try { parsed = JSON.parse(text); }\n    catch (e) { throw new Error('Failed to parse model JSON: ' + e.message + ' | Raw: ' + v.slice(0, 800)); }\n  }\n  if (!parsed || typeof parsed !== 'object') {\n    throw new Error('Model returned no usable JSON. Raw: ' + JSON.stringify(j).slice(0, 600));\n  }\n  const draftReply = (parsed.draftReply ?? '').toString().trim();\n  if (!draftReply) {\n    throw new Error('Model returned an empty draftReply for prospect ' + (ctx.prospectId || '?'));\n  }\n  const output = {\n    subject: (parsed.subject ?? '').toString(),\n    unsureSection: (parsed.unsureSection ?? '').toString(),\n    unsureSignal: (parsed.unsureSignal ?? '').toString(),\n    unsureArea: (parsed.unsureArea ?? '').toString(),\n    areaExplanation: (parsed.areaExplanation ?? '').toString(),\n    draftReply: draftReply,\n    citations: Array.isArray(parsed.citations) ? parsed.citations : [],\n  };\n  out.push({ json: { prospectId: ctx.prospectId, campaignId: ctx.campaignId, model: 'gpt-4o', output, raw: JSON.stringify(output) } });\n}\nreturn out;",
    },
    position: [1680, 320],
  },
  output: [
    {
      prospectId: 'pr_1',
      campaignId: 'cmp_1',
      model: 'gpt-4o',
      output: {
        subject: 'Our references and how we can move forward',
        unsureSection: 'I am not sure about your references.',
        unsureSignal: 'doubts about client references',
        unsureArea: 'Reference - Past Projects/Wins',
        areaExplanation: 'Lead questions proof of past delivered projects',
        draftReply: 'Dear Acme GmbH, Thank you...',
        citations: [],
      },
      raw: '{}',
    },
  ],
});

const saveDraft = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Save Draft Analysis',
    parameters: {
      method: 'POST',
      url: 'https://evertrust-api.onrender.com/reply-classifications',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ { "prospectId": $json.prospectId, "verdict": "UNSURE", "model": $json.model, "raw": $json.raw, "suggestedReply": $json.output.draftReply } }}'),
    },
    position: [1920, 240],
  },
  output: [{ id: 'rc_1', prospectId: 'pr_1', verdict: 'UNSURE', suggestedReply: 'Dear Acme GmbH...' }],
});

const notifyReady = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Notify Draft Ready',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: 'https://evertrust-api.onrender.com/notifications',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ { "type": "RAG_DRAFT_READY", "title": "RAG draft ready for " + ($json.output.unsureArea || "review"), "body": $json.output.subject, "link": "/campaigns/" + $json.campaignId, "campaignId": $json.campaignId } }}'),
    },
    position: [1920, 400],
  },
  output: [{ id: 'ntf_1', type: 'RAG_DRAFT_READY' }],
});

const loopDone = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Backlog Drained', position: [960, 560] },
  output: [{}],
});

const noteSchedule = sticky(
  '## Hourly RAG backlog scan\nReplaces the live Drive-folder scan + leads-sheet find-Unsure steps. One call to GET /reply-classifications?needsRag=true returns the UNSURE replies that still need a drafted answer.',
  [everyHour, getBacklog],
  { color: 4, position: [200, 200], height: 320, width: 520 },
);

const noteBaseUrl = sticky(
  '## ERP base URL\nAll HTTP nodes call https://evertrust-api.onrender.com . Update the base URL in all HTTP nodes if it differs. Endpoints go live only after the backend deploys (expected).',
  [getThread, saveDraft],
  { color: 3, position: [900, 120], height: 200, width: 560 },
);

const noteHeaderAuth = sticky(
  '## ERP Header Auth — bind credential\nThe ERP HTTP nodes (Get RAG Backlog, Get Thread Context, Save Draft Analysis, Notify Draft Ready) use Header Auth with no credential bound. Select the ERP Ingest (x-arsenal-token) Header Auth credential here on each of these four nodes.',
  [getBacklog, notifyReady],
  { color: 5, position: [1880, 120], height: 200, width: 420 },
);

parseDraft.to(saveDraft.to(nextBatch(loopBacklog)));
parseDraft.to(notifyReady);

export default workflow('rag-agent-pg', 'EVERTRUST - RAG AGENT (PG)')
  .add(everyHour)
  .to(getBacklog)
  .to(
    loopBacklog
      .onDone(loopDone)
      .onEachBatch(getThread.to(buildPrompt).to(gptModel).to(parseDraft)),
  )
  .add(noteSchedule)
  .add(noteBaseUrl)
  .add(noteHeaderAuth);
