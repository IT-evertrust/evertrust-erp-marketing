#!/usr/bin/env python3
"""Generate n8n Workflow SDK code for LEAD SATELLITE copy 3 with SearXNG agent rewiring.

Reads the MCP get_workflow_details JSON dump and emits SDK JS code:
- every node except the two (Web) openAi nodes is carried over verbatim
  (type, typeVersion, position, flags, parameters incl. big jsCode strings)
- the two (Web) nodes become AI Agent nodes (same names!) with
  lmChatOpenAi (hermes via LiteLLM gateway) + a shared httpRequestTool
  named web_search pointing at the funneled SearXNG instance.
"""
import json, re, sys

SRC = sys.argv[1]
OUT = sys.argv[2]

wf = json.load(open(SRC))["workflow"]
nodes = {n["name"]: n for n in wf["nodes"]}

# Fix (2026-06-11, execution 5399): $('Parse Webhook Body') hangs the n8n cloud
# task runner when that node didn't execute (manual/drive path) — node-reference
# resolution happens OUTSIDE the user script, so try/catch can't intercept it and
# the task dies at the 60s runner timeout as "Unknown error". 'Valid Payload?'
# executes on BOTH entry paths and passes the meta item through unchanged.
_decide = nodes["Decide: Should Hunt?"]["parameters"]
_old_meta = (
    "let meta = {};\n"
    "try { meta = $('Parse Webhook Body').item.json; } catch (e) {}\n"
    "if (!meta || !meta.campaignFolderId) {\n"
    "  try { meta = $('Inspect Drive Item').item.json; } catch (e) {}\n"
    "}"
)
_new_meta = (
    "let meta = {};\n"
    "try { const m = $('Valid Payload?').first(); if (m && m.json) meta = m.json; } catch (e) {}"
)
assert _old_meta in _decide["jsCode"], "Decide: Should Hunt? jsCode drifted — review the meta patch"
_decide["jsCode"] = _decide["jsCode"].replace(_old_meta, _new_meta)

REPLACED = {"Country Profiler (Web)", "Find Missing Emails (Web)"}
TRIGGER_TYPES = {"n8n-nodes-base.webhook", "n8n-nodes-base.manualTrigger"}

# stable JS identifiers per node name
def ident(name):
    s = re.sub(r"[^0-9a-zA-Z]+", "_", name).strip("_")
    s = re.sub(r"_+", "_", s)
    if re.match(r"^\d", s):
        s = "n_" + s
    return s[0].lower() + s[1:]

ids = {}
for name in nodes:
    base = ident(name)
    cand, i = base, 2
    while cand in ids.values():
        cand = f"{base}{i}"; i += 1
    ids[name] = cand

# output samples to quiet expression-path warnings where it matters
SAMPLES = {
    "Parse Webhook Body": [{"isValid": True, "campaignFolderId": "x", "project": "p", "niche": "n", "country": "Germany", "source": "webhook", "runId": "wf3-wh-1"}],
    "Inspect Drive Item": [{"isValid": True, "campaignFolderId": "x", "project": "p", "source": "drive", "runId": "wf3-drv-1"}],
    "Decide: Should Hunt?": [{"shouldHunt": True, "campaignFolderId": "x", "project": "p", "niche": "n", "country": "Germany"}],
    "Extract Config (fromJson)": [{"cfg": {"country": "Germany", "niche": "roofing"}}],
    "Build Search Query": [{"runId": "wf3-wh-1", "country": "Germany", "searchCountry": "DE", "segments": [{"city": "Berlin"}]}],
    "Build Groups": [{"runId": "wf3-wh-1", "segments": [{"city": "Berlin"}], "groupIndex": 0, "groupCount": 1, "expected": 4}],
    "Make Wait Control": [{"runId": "wf3-wh-1", "expected": 4, "polls": 0}],
    "Eval Poll": [{"done": False, "polls": 1, "expected": 4, "runId": "wf3-wh-1"}],
    "Collect Missing Emails": [{"chunkIndex": 0, "count": 8, "systemContent": "sys", "userContent": "user", "searchCountry": "DE", "maxTokens": 8000, "maxToolsIterations": 80, "maxToolCalls": 80}],
    "Parse And Validate Leads": [{"Company Name": "Acme GmbH", "Email": "", "Status": "NO_EMAIL", "Website": "https://acme.de", "City": "Berlin", "Country": "Germany"}],
    "Merge Recovered Emails": [{"Company Name": "Acme GmbH", "Email": "info@acme.de", "Status": ""}],
    "Decode Protected Emails": [{"Company Name": "Acme GmbH", "Email": "info@acme.de"}],
    "Create Leads Sheet": [{"spreadsheetId": "sheet123", "sheetName": "leads"}],
}

def emit_node(n):
    name = n["name"]
    factory = "trigger" if n["type"] in TRIGGER_TYPES else "node"
    cfg = [f"name: {json.dumps(name)}"]
    if n.get("webhookId"):
        cfg.append(f"webhookId: {json.dumps(n['webhookId'])}")
    if n.get("position"):
        cfg.append(f"position: {json.dumps(n['position'])}")
    for flag in ("onError", "executeOnce", "alwaysOutputData", "retryOnFail"):
        if n.get(flag) is not None:
            cfg.append(f"{flag}: {json.dumps(n[flag])}")
    cfg.append(f"parameters: {json.dumps(n.get('parameters', {}), ensure_ascii=False)}")
    sample = SAMPLES.get(name, [{}])
    return (f"const {ids[name]} = {factory}({{\n"
            f"  type: {json.dumps(n['type'])},\n"
            f"  version: {n['typeVersion']},\n"
            f"  config: {{ {', '.join(cfg)} }},\n"
            f"  output: {json.dumps(sample, ensure_ascii=False)}\n"
            f"}});\n")

parts = ["import { workflow, node, trigger, newCredential, languageModel, tool, fromAi, expr } from '@n8n/workflow-sdk';\n"]

for n in wf["nodes"]:
    if n["name"] in REPLACED:
        continue
    parts.append(emit_node(n))

# --- agent clusters -------------------------------------------------------
cp = nodes["Country Profiler (Web)"]
fm = nodes["Find Missing Emails (Web)"]
cp_pos = cp.get("position", [0, 0])
fm_pos = fm.get("position", [0, 0])
cp_system = cp["parameters"]["responses"]["values"][0]["content"]
cp_user = cp["parameters"]["responses"]["values"][1]["content"]

GATEWAY_CRED = "{ id: '2YgDmy9NuLHvOgzJ', name: 'LiteLLM Gateway (mac-mini)' }"

parts.append(f"""
const webSearchTool = tool({{
  type: 'n8n-nodes-base.httpRequestTool',
  version: 4.4,
  config: {{
    name: 'web_search',
    position: {json.dumps([(cp_pos[0] + fm_pos[0]) // 2, max(cp_pos[1], fm_pos[1]) + 260])},
    parameters: {{
      toolDescription: 'Web search. Call with a search query string; returns JSON results with title, url and content snippet for each hit. Write queries in the local language of the target country when possible.',
      method: 'GET',
      url: 'https://mac-mini-ca-mac.tailc3d837.ts.net:10000/search',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: {{ parameters: [
        {{ name: 'q', value: fromAi('query', 'The web search query') }},
        {{ name: 'format', value: 'json' }}
      ] }},
      optimizeResponse: true,
      responseType: 'json',
      dataField: 'results',
      fieldsToInclude: 'selected',
      fields: 'title,url,content',
      options: {{ timeout: 30000 }}
    }},
    credentials: {{ httpHeaderAuth: newCredential('SearXNG (mac-mini)') }}
  }}
}});

const profilerModel = languageModel({{
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {{
    name: 'Hermes — Profiler Model',
    position: {json.dumps([cp_pos[0] - 120, cp_pos[1] + 220])},
    parameters: {{
      model: {{ __rl: true, mode: 'list', value: 'hermes', cachedResultName: 'HERMES' }},
      responsesApiEnabled: false,
      options: {{ temperature: 0.2, maxTokens: 6000, timeout: 180000, maxRetries: 2 }}
    }},
    credentials: {{ openAiApi: {GATEWAY_CRED} }}
  }}
}});

const countryProfilerWeb = node({{
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {{
    name: 'Country Profiler (Web)',
    position: {json.dumps(cp_pos)},
    onError: 'continueRegularOutput',
    parameters: {{
      promptType: 'define',
      text: {json.dumps(cp_user, ensure_ascii=False)},
      options: {{
        systemMessage: {json.dumps(cp_system, ensure_ascii=False)},
        maxIterations: 20,
        enableStreaming: false
      }}
    }},
    subnodes: {{ model: profilerModel, tools: [webSearchTool] }}
  }},
  output: [{{ output: '{{"countryName":"Germany","iso2":"DE","cities":["Berlin"]}}' }}]
}});

const emailModel = languageModel({{
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {{
    name: 'Hermes — Email Model',
    position: {json.dumps([fm_pos[0] - 120, fm_pos[1] + 220])},
    parameters: {{
      model: {{ __rl: true, mode: 'list', value: 'hermes', cachedResultName: 'HERMES' }},
      responsesApiEnabled: false,
      options: {{ temperature: 0.1, maxTokens: 8000, timeout: 180000, maxRetries: 2 }}
    }},
    credentials: {{ openAiApi: {GATEWAY_CRED} }}
  }}
}});

const findMissingEmailsWeb = node({{
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {{
    name: 'Find Missing Emails (Web)',
    position: {json.dumps(fm_pos)},
    onError: 'continueRegularOutput',
    retryOnFail: true,
    parameters: {{
      promptType: 'define',
      text: '={{{{ $json.userContent }}}}',
      options: {{
        systemMessage: '={{{{ $json.systemContent }}}}',
        maxIterations: expr('{{{{ $json.maxToolsIterations || 80 }}}}'),
        enableStreaming: false
      }}
    }},
    subnodes: {{ model: emailModel, tools: [webSearchTool] }}
  }},
  output: [{{ output: '{{"emails":[{{"id":0,"email":"info@acme.de"}}]}}' }}]
}});
""")

parts.append("""
const onNewFolderDrivePoll = trigger({
  type: 'n8n-nodes-base.googleDriveTrigger',
  version: 1,
  config: {
    name: 'On New Folder (Drive Poll)',
    position: [0, 192],
    parameters: {
      pollTimes: { item: [{ mode: 'everyX', value: 15, unit: 'minutes' }] },
      triggerOn: 'specificFolder',
      folderToWatch: { __rl: true, value: '1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId', mode: 'id' },
      event: 'folderCreated'
    },
    credentials: { googleDriveOAuth2Api: { id: 'R1hfa3xjcJxi0F2E', name: 'Google Drive account: Hanna' } }
  },
  output: [{ id: '1AbCDef', name: 'NEW CAMPAIGN', mimeType: 'application/vnd.google-apps.folder' }]
});
""")

# --- wiring ---------------------------------------------------------------
w = ids  # shorthand
parts.append(f"""
{w['Build Search Query']}.to({w['Build Groups']}.to({w['Dispatch Groups']}.to({w['Make Wait Control']}.to({w['Wait For Children']}.to({w['Count Done']}.to({w['Eval Poll']}.to(
  {w['All Done?']}
    .onTrue({w['Collect Results']}.to({w['Reshape For Parse']}.to({w['Parse And Validate Leads']}.to({w['Collect Missing Emails']}.to(findMissingEmailsWeb.to({w['Merge Recovered Emails']}.to({w['Decode Protected Emails']}.to({w['Create Leads Sheet']}.to({w['Move Leads Sheet To Folder']}.to({w['Build Sheet Rows']}.to({w['Append Leads Rows']})))))))))))
    .onFalse({w['Wait For Children']})
)))))));

{w['Extract Config (fromJson)']}.to({w['Has Static Profile?']}
  .onTrue({w['Build Search Query']})
  .onFalse(countryProfilerWeb.to({w['Build Search Query']})));

export default workflow('Ew0W0JFnCuCK9XlV', 'EVERTRUST - LEAD SATELLITE copy 3')
  .add({w['WF-03 Webhook (AIM calls)']})
  .to({w['Parse Webhook Body']})
  .to({w['Valid Payload?']}.onTrue(
    {w['Search leads.xlsx in Folder']}.to({w['Decide: Should Hunt?']}.to({w['Should Hunt?']}.onTrue(
      {w['Drive — Find config.json']}.to({w['Drive — Download config.json']}.to({w['Extract Config (fromJson)']}))
    )))
  ))
  .add({w["When clicking ‘Execute workflow’"]})
  .to({w['Inspect Drive Item']})
  .to({w['Valid Payload?']})
  .add(onNewFolderDrivePoll)
  .to({w['Inspect Drive Item']});
""")

open(OUT, "w").write("\n".join(parts))
print(f"wrote {OUT}: {len(open(OUT).read())} chars")
