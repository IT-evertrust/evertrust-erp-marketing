import { workflow, node, trigger, newCredential, languageModel, tool, fromAi, expr } from '@n8n/workflow-sdk';

const segmentIn = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Segment In',
    webhookId: 'bdecbabd-aa78-4ff5-a434-83bcda4e5bfa',
    position: [0, 0],
    parameters: { httpMethod: 'POST', path: 'wf03-segment-worker', options: { responseData: 'received' } }
  },
  output: [{ body: { runId: 'wf3-drv-1', segments: [{ city: 'Warszawa' }] } }]
});

const explodeSegments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Explode Segments',
    position: [224, 0],
    parameters: {
      jsCode: "const body = ($input.first().json && $input.first().json.body) || $input.first().json || {};\nconst segs = Array.isArray(body.segments) ? body.segments : (body.segment ? [body.segment] : []);\nconst runId = (body.runId || '').toString();\nif (!segs.length) { return []; }\nreturn segs.map((s, i) => ({ json: Object.assign({}, s, { runId: (s && s.runId) || runId, _gi: i }) }));"
    }
  },
  output: [{ runId: 'wf3-drv-1', _gi: 0, city: 'Warszawa', segmentIndex: 0, systemContent: 'sys', userContent: 'user', searchCountry: 'PL', maxTokens: 8000, maxToolsIterations: 200, maxToolCalls: 200 }]
});

const webSearchTool = tool({
  type: 'n8n-nodes-base.httpRequestTool',
  version: 4.4,
  config: {
    name: 'web_search',
    position: [560, 260],
    parameters: {
      toolDescription: 'Web search. Call with a search query string; returns JSON results with title, url and content snippet for each hit. Write queries in the local language of the target country when possible.',
      method: 'GET',
      url: 'https://mac-mini-ca-mac.tailc3d837.ts.net:10000/search',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'q', value: fromAi('query', 'The web search query') },
        { name: 'format', value: 'json' }
      ] },
      optimizeResponse: true,
      responseType: 'json',
      dataField: 'results',
      fieldsToInclude: 'selected',
      fields: 'title,url,content',
      options: { timeout: 30000 }
    },
    credentials: { httpHeaderAuth: newCredential('SearXNG (mac-mini)') }
  }
});

const searchModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Hermes — Search Model',
    position: [300, 260],
    parameters: {
      model: { __rl: true, mode: 'list', value: 'hermes', cachedResultName: 'HERMES' },
      responsesApiEnabled: false,
      options: { temperature: 0.2, maxTokens: 8000, timeout: 180000, maxRetries: 2 }
    },
    credentials: { openAiApi: { id: '2YgDmy9NuLHvOgzJ', name: 'LiteLLM Gateway (mac-mini)' } }
  }
});

const searchCompaniesWeb = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Search Companies (Web)',
    position: [400, 0],
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      promptType: 'define',
      text: '={{ $json.userContent }}',
      options: {
        systemMessage: '={{ $json.systemContent }}',
        maxIterations: expr('{{ $json.maxToolsIterations || 200 }}'),
        enableStreaming: false
      }
    },
    subnodes: { model: searchModel, tools: [webSearchTool] }
  },
  output: [{ output: '{"leads":[{"name":"Acme Sp. z o.o.","type":"installer"}],"searchSummary":"q1","lowestConfidence":0.4}' }]
});

const parseSegmentLeads = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Segment Leads',
    position: [704, 0],
    parameters: {
      jsCode: "const segMeta = $('Explode Segments').all().map(r => r.json);\nconst items = $input.all();\nconst stripFences = (s) => { if (typeof s !== 'string') return s; let t = s.trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) t = t.slice(a, b + 1); return t; };\nconst tryParse = (v) => { if (!v) return null; if (typeof v === 'object' && v && Array.isArray(v.leads)) return v; if (typeof v === 'string') { try { return JSON.parse(stripFences(v)); } catch (e) { return null; } } return null; };\nconst fromResp = (raw) => { if (!raw || !Array.isArray(raw.output)) return null; for (const o of raw.output) { if (o && Array.isArray(o.content)) { for (const c of o.content) { const p = tryParse(c && c.text); if (p) return p; } } } return null; };\nconst out = [];\nfor (let i = 0; i < items.length; i++) {\n  const raw = (items[i] && items[i].json) || {};\n  let parsed = fromResp(raw) || tryParse(raw) || tryParse(raw.text) || tryParse(raw.output) || tryParse(raw.message) || tryParse(raw.content) || tryParse(raw.output_text);\n  const leads = (parsed && Array.isArray(parsed.leads)) ? parsed.leads : [];\n  const meta = segMeta[i] || {};\n  out.push({ json: { runId: (meta.runId || '').toString(), segmentIndex: (meta.segmentIndex != null ? meta.segmentIndex : i), leadsJson: JSON.stringify({ leads: leads }), status: 'done' } });\n}\nreturn out;"
    }
  },
  output: [{ runId: 'wf3-drv-1', segmentIndex: 0, leadsJson: '{"leads":[]}', status: 'done' }]
});

const saveSegmentResult = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Save Segment Result',
    position: [928, 0],
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: 'WCl6m01M1RXxe1q8', cachedResultName: 'wf3_segment_results' },
      columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] },
      options: {}
    }
  },
  output: [{ runId: 'wf3-drv-1', segmentIndex: 0, status: 'done' }]
});

export default workflow('mW1FZfk7OaM1utBS', 'WF-03 Segment Worker (fan-out child)')
  .add(segmentIn)
  .to(explodeSegments)
  .to(searchCompaniesWeb)
  .to(parseSegmentLeads)
  .to(saveSegmentResult);
