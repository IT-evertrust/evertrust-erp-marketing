#!/usr/bin/env python3
"""Generate WF-03 LEAD SATELLITE copy 6 (PG) from copy 5's transform of copy 4's SDK.

This EXTENDS tasks/wf03-copy5-gen.py: it first applies the copy-5 surgery
(splitInBatches(1) batched fan-out, parked 90s waits, per-group budget, Guard
Results THROW-on-zero, Reshape runId from Build Groups, Build Search Query
.item->.first()) to tasks/wf03-copy3.sdk.js, then layers the copy-6 deltas on
top of that copy-5 baseline:

  A. ENTRY    - webhook path wf03-lead-research-v2, body {campaignId, source};
                keep manual + Drive-poll triggers (Drive-poll gets a legacy sticky).
  B. CONFIG   - replace the Drive config.json read (Find/Download/Extract) with
                HTTP GET /campaigns/{{campaignId}}/config (httpHeaderAuth, cred
                UNBOUND) + a "Normalize Config" Code node mapping the ERP response
                onto the cfg shape copy-5 downstream nodes expect.
  C. THE GATE - IF on niche.targets length: empty -> POST .../webhook/niche-analytics
                -> Code THROW; non-empty -> continue to profiler/query.
  D. TARGETS x CITIES - Build Search Query iterates cfg.niche.targets
                (phrase = searchHint||name) x the existing city logic, carrying
                nicheTargetId per segment, capped into copy-5's ceiling
                (MAX_PAIRS=500 target-city pairs, MAX_SEGMENTS=500 backstop),
                truncating cities-per-target with console.warn. splitInBatches(1)/
                parked-wait/per-group-budget/Guard-Results mechanics UNCHANGED.
  E. PROSPECTS -> POSTGRES - KEEP Sheet append; thread sourceURL/nicheTargetId
                through mkRow (stripped in Build Sheet Rows so the sheet stays
                byte-clean) -> after append, "Build Prospect Payload" Code ->
                HTTP POST /prospects/bulk (httpHeaderAuth, same unbound cred,
                FAILS on 4xx/5xx). emailVerified = true only where Email non-empty
                AND Status ''.
  F. RUN CALLBACK - final HTTP POST /arsenal/runs/callback with
                {stage:'LEAD_SATELLITE', status:'SUCCESS', campaignId,
                metrics:{prospectsUpserted, segmentsPlanned}}
                (onError continueRegularOutput).
  G. Everything else (SEAR worker dispatch on wf03-segment-worker, parsers,
                Guard Results, Reshape by runId, $('...').first() fixes, Google +
                SearXNG credential IDs) stays byte-equivalent. The 3 new ERP HTTP
                nodes are left credential-UNBOUND (sticky note).

The two ERP base URLs use https://evertrust-api.onrender.com (per the task spec).
"""
import json, re, uuid

SRC = "/Users/macco/Documents/evertrust-erp-marketing/tasks/wf03-copy3.sdk.js"
OUT = "/Users/macco/Documents/evertrust-erp-marketing/tasks/wf03-copy6.sdk.js"

src = open(SRC).read()

# =====================================================================
# PART 1 — replay the copy-5 surgery (kept byte-identical to wf03-copy5-gen.py)
# =====================================================================

# 1. imports: add splitInBatches + nextBatch (copy-6 adds sticky too, below)
src = src.replace(
    "import { workflow, node, trigger, newCredential, languageModel, tool, fromAi, expr } from '@n8n/workflow-sdk';",
    "import { workflow, node, trigger, sticky, newCredential, languageModel, tool, fromAi, expr, splitInBatches, nextBatch } from '@n8n/workflow-sdk';",
)

# 2. Reshape For Parse: runId now comes from Build Groups
src = src.replace("const runId = $('Make Wait Control').first().json.runId;",
                  "const runId = $('Build Groups').first().json.runId;")

# 2b. Build Search Query: $('...').item hangs the cloud task runner -> .first()
_item_old = "const meta = $('Decide: Should Hunt?').item.json;"
_item_new = "const meta = (($('Decide: Should Hunt?').first() || {}).json) || {};"
assert json.dumps(_item_old)[1:-1] in src, "Build Search Query .item line not found"
src = src.replace(json.dumps(_item_old)[1:-1], json.dumps(_item_new)[1:-1])

# 3. copy-5 batched fan-out node definitions
mk_batch_control = (
    "const g = $('Loop Over Groups').first().json;\n"
    "const N = g.expectedSegments || 0;\n"
    "const G = g.expectedGroups || 1;\n"
    "const gi = g.groupIndex || 0;\n"
    "let cum = 0;\n"
    "for (let k = 0; k <= gi; k++) cum += Math.floor(N / G) + (k < N % G ? 1 : 0);\n"
    "const groupSize = Math.floor(N / G) + (gi < N % G ? 1 : 0);\n"
    "const perSegmentMs = 240000;\n"
    "const batchMaxWaitMs = Math.min(groupSize * perSegmentMs, 5400000);\n"
    "console.log('[Batch] group ' + gi + '/' + (G - 1) + ' (' + groupSize + ' segments) -> target ' + cum + '/' + N + ' rows, budget ' + Math.round(batchMaxWaitMs / 60000) + 'min');\n"
    "return [{ json: { runId: g.runId, groupIndex: gi, expectedGroups: G, expectedSegments: N, cumTarget: cum, pollStartMs: Date.now(), batchMaxWaitMs: batchMaxWaitMs } }];"
)
eval_batch_poll = (
    "const ctrl = $('Make Batch Control').first().json;\n"
    "const rows = $input.all().map(r => r.json).filter(r => r && r.runId === ctrl.runId);\n"
    "const done = rows.length;\n"
    "const elapsed = Date.now() - ctrl.pollStartMs;\n"
    "const reached = done >= ctrl.cumTarget;\n"
    "const timedOut = elapsed > ctrl.batchMaxWaitMs;\n"
    "console.log('[BatchPoll] group=' + ctrl.groupIndex + ' rows=' + done + '/' + ctrl.cumTarget + ' elapsed=' + Math.round(elapsed / 1000) + 's reached=' + reached + ' timedOut=' + timedOut);\n"
    "return [{ json: Object.assign({}, ctrl, { done: done, reached: reached, timedOut: timedOut, proceed: reached || timedOut }) }];"
)
guard_results = (
    "const g = $('Build Groups').first().json;\n"
    "const rows = $input.all().map(r => r.json).filter(r => r && r.runId === g.runId && r.leadsJson);\n"
    "if (!rows.length) {\n"
    "  throw new Error('[FanOut] ZERO segment rows for runId=' + g.runId + ' (expected ' + g.expectedSegments + ' segments) - all children failed or timed out. Failing loudly instead of ending silently.');\n"
    "}\n"
    "if (rows.length < g.expectedSegments) {\n"
    "  console.warn('[FanOut] SHORTFALL ' + rows.length + '/' + g.expectedSegments + ' rows for runId=' + g.runId + ' - proceeding with partial results.');\n"
    "}\n"
    "return $input.all();"
)
batch_done_conditions = {
    "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 1},
    "combinator": "and",
    "conditions": [{
        "id": "cond_batch_done",
        "leftValue": "={{ $json.proceed }}",
        "rightValue": "",
        "operator": {"type": "boolean", "operation": "true", "singleValue": True},
    }],
}

new_nodes = f"""
const loop_Over_Groups = splitInBatches({{
  version: 3,
  config: {{ name: 'Loop Over Groups', position: [2860, 96], parameters: {{ batchSize: 1, options: {{}} }} }}
}});

const make_Batch_Control = node({{
  type: "n8n-nodes-base.code",
  version: 2,
  config: {{ name: "Make Batch Control", position: [2384, 336], parameters: {{"jsCode": {json.dumps(mk_batch_control)}}} }},
  output: [{{}}]
}});

const wait_For_Batch = node({{
  type: "n8n-nodes-base.wait",
  version: 1.1,
  config: {{ name: "Wait For Batch", webhookId: "{uuid.uuid4()}", position: [2560, 336], parameters: {{"amount": 90}} }},
  output: [{{}}]
}});

const eval_Batch_Poll = node({{
  type: "n8n-nodes-base.code",
  version: 2,
  config: {{ name: "Eval Batch Poll", position: [2912, 544], parameters: {{"jsCode": {json.dumps(eval_batch_poll)}}} }},
  output: [{{}}]
}});

const batch_Done = node({{
  type: "n8n-nodes-base.if",
  version: 2.3,
  config: {{ name: "Batch Done?", position: [3104, 544], parameters: {{"conditions": {json.dumps(batch_done_conditions)}, "options": {{}}}} }},
  output: [{{}}]
}});

const guard_Results = node({{
  type: "n8n-nodes-base.code",
  version: 2,
  config: {{ name: "Guard Results", position: [3400, 352], parameters: {{"jsCode": {json.dumps(guard_results)}}} }},
  output: [{{}}]
}});

"""

OLD_WIRING = """build_Search_Query.to(build_Groups.to(dispatch_Groups.to(make_Wait_Control.to(wait_For_Children.to(count_Done.to(eval_Poll.to(
  all_Done
    .onTrue(collect_Results.to(reshape_For_Parse.to(parse_And_Validate_Leads.to(collect_Missing_Emails.to(findMissingEmailsWeb.to(merge_Recovered_Emails.to(decode_Protected_Emails.to(create_Leads_Sheet.to(move_Leads_Sheet_To_Folder.to(build_Sheet_Rows.to(append_Leads_Rows)))))))))))
    .onFalse(wait_For_Children)
)))))));"""

# copy-6 NEW_WIRING: same batched fan-out, with the post-collect tail extended to the
# Postgres dual-write + run callback. Built programmatically so the .to()/.onDone() paren
# nesting is balanced by construction (hand-counting the deep chain is error-prone).
def _chain(nodes):
    # nodes[0].to(nodes[1].to(...nodes[-1]))  — n-1 opens, n-1 closes, balanced
    return nodes[0] if len(nodes) == 1 else nodes[0] + ".to(" + _chain(nodes[1:]) + ")"

_onDoneChain = _chain([
    "collect_Results", "guard_Results", "reshape_For_Parse", "parse_And_Validate_Leads",
    "collect_Missing_Emails", "findMissingEmailsWeb", "merge_Recovered_Emails",
    "decode_Protected_Emails", "create_Leads_Sheet", "move_Leads_Sheet_To_Folder",
    "build_Sheet_Rows", "append_Leads_Rows", "build_Prospect_Payload",
    "post_Prospects_Bulk", "build_Run_Callback", "post_Run_Callback",
])
NEW_WIRING = ("""build_Search_Query.to(build_Groups.to(loop_Over_Groups
  .onEachBatch(dispatch_Groups.to(make_Batch_Control.to(wait_For_Batch.to(count_Done.to(eval_Batch_Poll.to(
    batch_Done
      .onTrue(nextBatch(loop_Over_Groups))
      .onFalse(wait_For_Batch)
  ))))))
  .onDone(""" + _onDoneChain + """)
));""")
assert NEW_WIRING.count("(") == NEW_WIRING.count(")"), "NEW_WIRING paren imbalance"

assert OLD_WIRING in src, "fan-out wiring block not found - source drifted"
src = src.replace(OLD_WIRING, new_nodes + NEW_WIRING)

# drop the now-unused copy-4 fan-out node definitions
for name in ["make_Wait_Control", "wait_For_Children", "eval_Poll", "all_Done"]:
    src, n = re.subn(rf"const {name} = (?:node|trigger)\(\{{.*?\n\}}\);\n", "", src, count=1, flags=re.S)
    assert n == 1, f"could not remove {name}"

# =====================================================================
# PART 2 — copy-6 deltas A..G
# =====================================================================

# ---- A. ENTRY: webhook path + body {campaignId, source} -------------
assert '"path": "wf03-lead-research-c3"' in src
src = src.replace('"path": "wf03-lead-research-c3"', '"path": "wf03-lead-research-v2"')

# Parse Webhook Body: accept {campaignId, source}; carry campaignId; validity = campaignId present.
# (folderId/niche/city/cities/country/region kept for backward-compat with the manual/Drive paths.)
pwb_old = ("const body = ($input.first().json && $input.first().json.body) || $input.first().json || {};\\n"
           "const campaignFolderId = (body.campaignFolderId || body.folderId || '').toString().trim();\\n")
pwb_new = ("const body = ($input.first().json && $input.first().json.body) || $input.first().json || {};\\n"
           "const campaignId = (body.campaignId || '').toString().trim();\\n"
           "const campaignFolderId = (body.campaignFolderId || body.folderId || '').toString().trim();\\n")
assert pwb_old in src, "Parse Webhook Body head not found"
src = src.replace(pwb_old, pwb_new)
# validity now keys off campaignId (the v2 contract) OR the legacy folderId
src = src.replace("const isValid = !!campaignFolderId;\\nconst runId = 'wf3-wh-'",
                  "const isValid = !!(campaignId || campaignFolderId);\\nconst runId = 'wf3-wh-'")
# emit campaignId on the webhook payload (and bump the source default to the v2 path)
src = src.replace("return [{ json: { campaignFolderId, project, niche, city, cities, country, region, source: 'webhook', isValid, runId } }];",
                  "return [{ json: { campaignId, campaignFolderId, project, niche, city, cities, country, region, source: (body.source || 'webhook'), isValid, runId } }];")

# Inspect Drive Item (manual + Drive-poll entry): surface an empty campaignId so the
# downstream nodes have a consistent key (the ERP fetch needs campaignId; manual/Drive
# runs without one will 4xx at the ERP node, which is the honest pre-cutover behaviour).
src = src.replace(
    "return [{ json: { campaignFolderId, niche: '', city: '', cities: '', country: '', project: campaignName, source: 'drive', isValid, runId } }];",
    "return [{ json: { campaignId: (item.campaignId || ''), campaignFolderId, niche: '', city: '', cities: '', country: '', project: campaignName, source: 'drive', isValid, runId } }];")

# Decide: Should Hunt? — carry campaignId through (consumed by the ERP fetch + callbacks)
src = src.replace(
    "return [{ json: {\\n  campaignFolderId: meta.campaignFolderId,\\n  niche: meta.niche || '',",
    "return [{ json: {\\n  campaignId: meta.campaignId || '',\\n  campaignFolderId: meta.campaignFolderId,\\n  niche: meta.niche || '',")

# ---- B. CONFIG VIA ERP --------------------------------------------
# Remove the three Drive config nodes; replace with Fetch Campaign Config (ERP) + Normalize Config.
for name in ["drive_Find_config_json", "drive_Download_config_json", "extract_Config_fromJson"]:
    src, n = re.subn(rf"const {name} = node\(\{{.*?\n\}}\);\n", "", src, count=1, flags=re.S)
    assert n == 1, f"could not remove {name}"

ERP_BASE = "https://evertrust-api.onrender.com"

# Normalize Config: map the ERP /campaigns/:id/config response onto the cfg shape
# copy-5 downstream nodes (Build Search Query, Has Static Profile?) expect, and surface
# the niche.targets array for the gate + the target x city fan-out.
normalize_config_js = (
    "const r = ($input.first() && $input.first().json) || {};\n"
    "const meta = (($('Decide: Should Hunt?').first() || {}).json) || {};\n"
    "const body = (r && typeof r === 'object' && r.data && typeof r.data === 'object' && !r.campaignId) ? r.data : r;\n"
    "const niche = (body.niche && typeof body.niche === 'object') ? body.niche : {};\n"
    "const targets = Array.isArray(niche.targets) ? niche.targets.filter(function (t) { return t && (t.id != null || t.name || t.slug); }) : [];\n"
    "const campaignId = (body.campaignId || meta.campaignId || '').toString();\n"
    "const cfg = {\n"
    "  campaignId: campaignId,\n"
    "  niche: (niche.name || body.nicheName || '').toString(),\n"
    "  nicheId: (niche.id != null ? niche.id : ''),\n"
    "  nicheSlug: (niche.slug || '').toString(),\n"
    "  targets: targets,\n"
    "  region: (body.region || '').toString(),\n"
    "  country: (body.country || '').toString(),\n"
    "  project: (body.name || body.project || meta.project || 'Unknown Campaign').toString(),\n"
    "  lifecycle: (body.lifecycle || '').toString(),\n"
    "  sender: (body.sender || 'info').toString(),\n"
    "  gmailLabel: (body.gmailLabel || '').toString(),\n"
    "  salesCalendarId: (body.salesCalendarId || '').toString(),\n"
    "  whatsappNumber: (body.whatsappNumber || '').toString(),\n"
    "  driveFolderId: (body.driveFolderId || meta.campaignFolderId || '').toString(),\n"
    "  maxToolCalls: 200,\n"
    "  maxTokens: 24000,\n"
    "  targetTotal: 0\n"
    "};\n"
    "console.log('[Normalize Config] campaignId=' + campaignId + ' niche=' + cfg.niche + ' targets=' + targets.length + ' region=' + cfg.region + ' country=' + cfg.country);\n"
    "return [{ json: { campaignId: campaignId, cfg: cfg, niche: niche, targets: targets, targetCount: targets.length } }];"
)

config_nodes = f"""const fetch_Campaign_Config_ERP = node({{
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {{ name: "Fetch Campaign Config (ERP)", position: [1344, 96], parameters: {{"method": "GET", "url": "={{{{ '{ERP_BASE}/campaigns/' + ($json.campaignId || '') + '/config' }}}}", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "options": {{}}}} }},
  output: [{{"campaignId": "c1", "niche": {{"id": 1, "name": "Cybersecurity", "targets": [{{"id": 10, "name": "SOC provider", "slug": "soc", "searchHint": "SOC SIEM MDR"}}]}}, "region": "Warszawa", "country": "Poland"}}]
}});

const normalize_Config = node({{
  type: "n8n-nodes-base.code",
  version: 2,
  config: {{ name: "Normalize Config", position: [1568, 96], parameters: {{"jsCode": {json.dumps(normalize_config_js)}}} }},
  output: [{{"campaignId": "c1", "cfg": {{"niche": "Cybersecurity", "region": "Warszawa", "country": "Poland"}}, "targetCount": 1}}]
}});

"""

# ---- C. THE GATE ---------------------------------------------------
gate_throw_js = (
    "const g = (($('Normalize Config').first() || {}).json) || {};\n"
    "throw new Error('No niche analysis yet for campaignId=' + (g.campaignId || '?') + ' - NICHE ANALYTICS triggered; it will re-trigger this workflow (wf03-lead-research-v2) when targets are ready.');"
)
gate_conditions = {
    "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
    "combinator": "and",
    "conditions": [{
        "id": "cond_no_targets",
        "leftValue": "={{ ($json.targetCount || ($json.cfg && $json.cfg.targets ? $json.cfg.targets.length : 0)) }}",
        "rightValue": 0,
        "operator": {"type": "number", "operation": "equals", "singleValue": False},
    }],
}
gate_nodes = f"""const niche_Gate = node({{
  type: "n8n-nodes-base.if",
  version: 2.3,
  config: {{ name: "Niche Gate (targets ready?)", position: [1792, 96], parameters: {{"conditions": {json.dumps(gate_conditions)}, "options": {{}}}} }},
  output: [{{}}]
}});

const trigger_Niche_Analytics = node({{
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {{ name: "Trigger NICHE ANALYTICS", position: [2016, -64], onError: "continueRegularOutput", parameters: {{"method": "POST", "url": "https://evertrustgmbh.app.n8n.cloud/webhook/niche-analytics", "sendBody": true, "specifyBody": "json", "jsonBody": "={{{{ JSON.stringify({{ campaignId: ($('Normalize Config').first().json.campaignId || ''), trigger: 'satellite-gate' }}) }}}}", "options": {{}}}} }},
  output: [{{}}]
}});

const gate_Throw = node({{
  type: "n8n-nodes-base.code",
  version: 2,
  config: {{ name: "Gate: No Targets (throw)", position: [2240, -64], parameters: {{"jsCode": {json.dumps(gate_throw_js)}}} }},
  output: [{{}}]
}});

"""

# Insert the new config + gate node definitions just before the Build Search Query def.
anchor_bsq = "const build_Search_Query = node({"
assert anchor_bsq in src, "Build Search Query def anchor not found"
src = src.replace(anchor_bsq, config_nodes + gate_nodes + anchor_bsq, 1)

# Repoint the config-subgraph wiring: drop the Drive config chain, splice ERP fetch + gate.
config_wiring_old = ("extract_Config_fromJson.to(has_Static_Profile\n"
                     "  .onTrue(build_Search_Query)\n"
                     "  .onFalse(countryProfilerWeb.to(build_Search_Query)));")
config_wiring_new = ("fetch_Campaign_Config_ERP.to(normalize_Config.to(niche_Gate\n"
                     "  .onTrue(trigger_Niche_Analytics.to(gate_Throw))\n"
                     "  .onFalse(has_Static_Profile\n"
                     "    .onTrue(build_Search_Query)\n"
                     "    .onFalse(countryProfilerWeb.to(build_Search_Query)))));")
assert config_wiring_old in src, "config subgraph wiring not found"
src = src.replace(config_wiring_old, config_wiring_new)

# should_Hunt.onTrue now reaches the ERP fetch instead of the Drive config chain.
should_hunt_wire_old = "drive_Find_config_json.to(drive_Download_config_json.to(extract_Config_fromJson))"
assert should_hunt_wire_old in src, "should_Hunt -> drive config wiring not found"
src = src.replace(should_hunt_wire_old, "fetch_Campaign_Config_ERP")

# Build Search Query + Has Static Profile? read cfg from Normalize Config now (was Extract Config).
src = src.replace("$('Extract Config (fromJson)').first()", "$('Normalize Config').first()")

# =====================================================================
# PART 3 — delta D: target x city fan-out inside Build Search Query
# =====================================================================
# Operate on the decoded jsCode string for Build Search Query, then re-encode.

bsq_start = src.index('const build_Search_Query = node({')
bsq_jscode_key = src.index('"jsCode": ', bsq_start) + len('"jsCode": ')
# the jsCode value is a JSON string literal; find its bounds
assert src[bsq_jscode_key] == '"', "Build Search Query jsCode not a string literal"
# walk to the matching closing quote (respect escapes)
i = bsq_jscode_key + 1
while i < len(src):
    if src[i] == '\\':
        i += 2
        continue
    if src[i] == '"':
        break
    i += 1
bsq_jscode_end = i
encoded = src[bsq_jscode_key:bsq_jscode_end + 1]      # includes the surrounding quotes
js = json.loads(encoded)                               # decoded JS source of the node

# D1. niche becomes per-target: rename the run-level const to nicheBase, then set a mutable
#     `niche` per target iteration. cityEntries truncation per target is applied in the loop.
js_old_niche = "const niche = (cfg.niche || meta.niche || '').toString().trim().toUpperCase();"
assert js_old_niche in js, "Build Search Query niche const not found"
js = js.replace(js_old_niche,
                "const nicheBase = (cfg.niche || meta.niche || '').toString().trim().toUpperCase();\n"
                "let niche = nicheBase;")

# D2. Build the target list + the per-target city cap right after cityEntries are finalized
#     (after the MAX_CITIES truncation block). Anchor on the EXPANDED_REGION log line.
js_anchor_after_cities = "if (expandedFrom.length) console.log('[Build Query] EXPANDED_REGION '"
assert js_anchor_after_cities in js, "post-cities anchor not found"
target_setup = (
    "const NICHE_TARGETS = (Array.isArray(cfg.targets) && cfg.targets.length)\n"
    "  ? cfg.targets.filter(function (t) { return t && (t.id != null || t.name || t.slug); })\n"
    "  : [{ id: (cfg.nicheId != null ? cfg.nicheId : null), name: cfg.niche || nicheBase, slug: cfg.nicheSlug || '', searchHint: '' }];\n"
    "const MAX_SEGMENTS = 500;\n"
    "const MAX_PAIRS = 500;\n"
    "const T = Math.max(1, NICHE_TARGETS.length);\n"
    "const citiesPerTarget = Math.max(1, Math.floor(MAX_PAIRS / T));\n"
    "const cityEntriesFull = cityEntries.slice();\n"
    "if (cityEntriesFull.length > citiesPerTarget) console.warn('[Build Query] TRUNCATE_CITIES_PER_TARGET ' + T + ' targets -> keeping ' + citiesPerTarget + '/' + cityEntriesFull.length + ' cities per target to stay within MAX_PAIRS=' + MAX_PAIRS);\n"
    "const cityEntriesForTarget = cityEntriesFull.slice(0, citiesPerTarget);\n"
    "console.log('[Build Query] TARGETS=' + T + ' (' + NICHE_TARGETS.map(function (t) { return (t.searchHint || t.name || t.slug || '?'); }).join(' | ') + ') citiesPerTarget=' + cityEntriesForTarget.length);\n"
    + js_anchor_after_cities
)
js = js.replace(js_anchor_after_cities, target_setup)

# D3. From here, the existing code uses `cityEntries`; point it at the per-target slice.
#     The remaining references after target_setup all want the (possibly truncated) list.
#     Replace the two emit-loop city sources (nationwide uses its own natCities; the city
#     path loops `cityEntries`). We rewrite the city-path loop bound + the requestedCities/
#     citiesAll built from cityEntries to use cityEntriesForTarget.
js = js.replace("const requestedCities = cityEntries.map(e =>",
                "const requestedCities = cityEntriesForTarget.map(e =>")
js = js.replace("const citiesAll = cityEntries.map(e => e.city).join(', ');",
                "const citiesAll = cityEntriesForTarget.map(e => e.city).join(', ');")
js = js.replace("const segPerCity = segOverride > 0 ? segOverride : (cityEntries.length <= 2",
                "const segPerCity = segOverride > 0 ? segOverride : (cityEntriesForTarget.length <= 2")
js = js.replace("(cityEntries.length <= 4 ? 3 : (cityEntries.length <= 8 ? 2 : 1)));",
                "(cityEntriesForTarget.length <= 4 ? 3 : (cityEntriesForTarget.length <= 8 ? 2 : 1)));")
js = js.replace("const totalSegs = Math.max(1, cityEntries.length * segPerCity);",
                "const totalSegs = Math.max(1, cityEntriesForTarget.length * segPerCity * T);")

# D4. Wrap the city-path emit loop in a target loop. The city path begins at `const out = [];`
#     near the end and runs `for (let ci = 0; ci < cityEntries.length; ci++) { ... } ... return out;`.
js_city_loop_head = "const out = [];\nlet segIdx = 0;\nfor (let ci = 0; ci < cityEntries.length; ci++) {"
assert js_city_loop_head in js, "city-path emit loop head not found"
js = js.replace(
    js_city_loop_head,
    "const out = [];\n"
    "let segIdx = 0;\n"
    "for (let ti = 0; ti < NICHE_TARGETS.length; ti++) {\n"
    "const __tg = NICHE_TARGETS[ti];\n"
    "const __phrase = ((__tg.searchHint || __tg.name || __tg.slug || cfg.niche || nicheBase) + '').toString().trim();\n"
    "niche = __phrase.toUpperCase();\n"
    "for (let ci = 0; ci < cityEntriesForTarget.length; ci++) {"
)
# the inner city loop body references `cityEntries[ci]` -> `cityEntriesForTarget[ci]`
js = js.replace("const entry = cityEntries[ci];", "const entry = cityEntriesForTarget[ci];")
# tag each emitted segment with the niche target attribution
js_seg_push_old = ("      segmentIndex: segIdx, segmentFocus: cityName + ':' + seg.focus, segmentLabel: seg.label,\n"
                   "      systemContent, userContent\n"
                   "    } });")
js_seg_push_new = ("      segmentIndex: segIdx, segmentFocus: cityName + ':' + seg.focus, segmentLabel: seg.label,\n"
                   "      nicheTargetId: (__tg.id != null ? __tg.id : null), nicheTargetName: (__tg.name || ''), nicheTargetSlug: (__tg.slug || ''), nicheTargetPhrase: __phrase,\n"
                   "      systemContent, userContent\n"
                   "    } });")
assert js_seg_push_old in js, "city-path segment push shape not found"
js = js.replace(js_seg_push_old, js_seg_push_new)
# close the target loop just before the final summary log + `return out;`
js_city_loop_tail = ("    segIdx++;\n  }\n}\nconsole.log('[Build Query] niche=' + niche")
assert js_city_loop_tail in js, "city-path emit loop tail not found"
js = js.replace(
    js_city_loop_tail,
    "    segIdx++;\n  }\n}\n}\n"
    "if (out.length > MAX_SEGMENTS) { console.warn('[Build Query] SEGMENT_CAP truncating ' + out.length + ' -> ' + MAX_SEGMENTS + ' segments (MAX_SEGMENTS) across ' + NICHE_TARGETS.length + ' targets'); out.length = MAX_SEGMENTS; }\n"
    "console.log('[Build Query] targets=' + NICHE_TARGETS.length + ' niche=' + niche")

# D5. nationwide path: tag its segments with the (single, run-level) target too, so the
#     attribution survives even on the rare "anywhere" path. The nationwide emit uses nout.push.
js_nat_push_old = ("      segmentIndex: nIdx, segmentFocus: 'nationwide-city:' + cityName + ':' + __seg.focus, segmentLabel: cityName + ' (' + npCountry + ') - ' + __seg.focus,\n"
                   "      systemContent: npSystem, userContent: npUser")
js_nat_push_new = ("      segmentIndex: nIdx, segmentFocus: 'nationwide-city:' + cityName + ':' + __seg.focus, segmentLabel: cityName + ' (' + npCountry + ') - ' + __seg.focus,\n"
                   "      nicheTargetId: (NICHE_TARGETS[0] && NICHE_TARGETS[0].id != null ? NICHE_TARGETS[0].id : null), nicheTargetName: (NICHE_TARGETS[0] ? (NICHE_TARGETS[0].name || '') : ''), nicheTargetSlug: (NICHE_TARGETS[0] ? (NICHE_TARGETS[0].slug || '') : ''), nicheTargetPhrase: niche,\n"
                   "      systemContent: npSystem, userContent: npUser")
assert js_nat_push_old in js, "nationwide segment push shape not found"
js = js.replace(js_nat_push_old, js_nat_push_new)

# re-encode the modified jsCode back into the SDK source
src = src[:bsq_jscode_key] + json.dumps(js) + src[bsq_jscode_end + 1:]

# =====================================================================
# PART 4 — delta E: thread sourceURL/nicheTargetId, dual-write to Postgres
# =====================================================================
# E1. mkRow gains sourceURL + nicheTargetId (extra keys ride on the row object).
mkrow_old = "  'Send From': (meta.sender === 'hanna' ? 'hanna@evertrust-germany.de' : 'info@evertrust-germany.de')\\n});"
mkrow_new = ("  'Send From': (meta.sender === 'hanna' ? 'hanna@evertrust-germany.de' : 'info@evertrust-germany.de'),\\n"
             "  sourceURL: pick(lead.sourceURL || lead.sourceUrl || lead.url || lead.source_url || ''),\\n"
             "  nicheTargetId: (NICHE_TARGET_ID != null ? NICHE_TARGET_ID : null)\\n});")
assert mkrow_old in src, "mkRow Send From tail not found"
src = src.replace(mkrow_old, mkrow_new)
# Parse And Validate Leads: derive a run-level NICHE_TARGET_ID (single target -> its id, else null).
pvl_meta_old = "const reqCities = (meta && Array.isArray(meta.requestedCities)) ? meta.requestedCities : [];"
pvl_meta_new = ("const reqCities = (meta && Array.isArray(meta.requestedCities)) ? meta.requestedCities : [];\\n"
                "const NICHE_TARGET_ID = (meta && meta.nicheTargetId != null) ? meta.nicheTargetId : null;")
assert pvl_meta_old in src, "Parse And Validate Leads reqCities line not found"
src = src.replace(pvl_meta_old, pvl_meta_new)

# E2. Build Sheet Rows: strip the PG-only keys so the Google Sheet stays byte-clean.
bsr_old = "const rows = $('Decode Protected Emails').all();\\nreturn rows.map(r => ({ json: r.json }));"
bsr_new = ("const rows = $('Decode Protected Emails').all();\\n"
           "return rows.map(r => { const o = Object.assign({}, r.json); delete o.sourceURL; delete o.nicheTargetId; return { json: o }; });")
assert bsr_old in src, "Build Sheet Rows body not found"
src = src.replace(bsr_old, bsr_new)

# E3. Build Prospect Payload + POST /prospects/bulk node definitions (defined before wiring).
build_prospect_payload_js = (
    "const rows = $('Decode Protected Emails').all().map(r => r.json);\n"
    "const meta = (($('Build Search Query').first() || {}).json) || {};\n"
    "const decideMeta = (($('Decide: Should Hunt?').first() || {}).json) || {};\n"
    "const campaignId = (decideMeta.campaignId || meta.campaignId || '').toString();\n"
    "const isBad = (e) => { const s = String(e == null ? '' : e).trim().toLowerCase(); if (!s) return true; if (s.indexOf('@') < 0) return true; if (s.indexOf('protected') >= 0) return true; if (s.indexOf('[email') >= 0) return true; if (s.indexOf('cloudflare') >= 0) return true; if (s.indexOf('example.') >= 0) return true; return false; };\n"
    "const prospects = [];\n"
    "for (const r of rows) {\n"
    "  const email = (r.Email || '').toString().trim();\n"
    "  const companyName = (r['Company Name'] || '').toString().trim();\n"
    "  if (!companyName) continue;\n"
    "  const status = (r.Status || '').toString().trim();\n"
    "  const emailVerified = !!(email && !isBad(email) && status === '');\n"
    "  prospects.push({\n"
    "    email: emailVerified ? email : '',\n"
    "    companyName: companyName,\n"
    "    website: (r.Website || '').toString().trim(),\n"
    "    city: (r.City || '').toString().trim(),\n"
    "    country: (r.Country || '').toString().trim(),\n"
    "    sourceUrl: (r.sourceURL || '').toString().trim(),\n"
    "    nicheTargetId: (r.nicheTargetId != null ? r.nicheTargetId : (meta.nicheTargetId != null ? meta.nicheTargetId : null)),\n"
    "    emailVerified: emailVerified\n"
    "  });\n"
    "}\n"
    "const segmentsPlanned = (meta && meta.segmentsPlanned != null) ? meta.segmentsPlanned : ((($('Build Groups').first() || {}).json || {}).expectedSegments || 0);\n"
    "console.log('[Prospect Payload] campaignId=' + campaignId + ' prospects=' + prospects.length + ' verified=' + prospects.filter(p => p.emailVerified).length + ' segmentsPlanned=' + segmentsPlanned);\n"
    "return [{ json: { campaignId: campaignId, segmentsPlanned: segmentsPlanned, prospects: prospects } }];"
)

# F. run-callback Code reads created+updated out of the /prospects/bulk response.
run_callback_payload_js = (
    "const bulk = ($input.first() && $input.first().json) || {};\n"
    "const data = (bulk && typeof bulk === 'object' && bulk.data && typeof bulk.data === 'object') ? bulk.data : bulk;\n"
    "const created = parseInt(data.created != null ? data.created : (data.inserted != null ? data.inserted : 0), 10) || 0;\n"
    "const updated = parseInt(data.updated != null ? data.updated : (data.upserted != null ? data.upserted : 0), 10) || 0;\n"
    "const pp = (($('Build Prospect Payload').first() || {}).json) || {};\n"
    "const campaignId = (pp.campaignId || '').toString();\n"
    "const segmentsPlanned = pp.segmentsPlanned != null ? pp.segmentsPlanned : 0;\n"
    "const prospectsUpserted = (data.created != null || data.updated != null || data.inserted != null || data.upserted != null) ? (created + updated) : (Array.isArray(pp.prospects) ? pp.prospects.length : 0);\n"
    "console.log('[Run Callback] campaignId=' + campaignId + ' prospectsUpserted=' + prospectsUpserted + ' segmentsPlanned=' + segmentsPlanned);\n"
    "return [{ json: { stage: 'LEAD_SATELLITE', status: 'SUCCESS', campaignId: campaignId, metrics: { prospectsUpserted: prospectsUpserted, segmentsPlanned: segmentsPlanned } } }];"
)

pg_nodes = f"""
const build_Prospect_Payload = node({{
  type: "n8n-nodes-base.code",
  version: 2,
  config: {{ name: "Build Prospect Payload", position: [4720, 96], parameters: {{"jsCode": {json.dumps(build_prospect_payload_js)}}} }},
  output: [{{"campaignId": "c1", "segmentsPlanned": 4, "prospects": [{{"email": "info@acme.de", "companyName": "Acme GmbH", "website": "https://acme.de", "city": "Berlin", "country": "Germany", "sourceUrl": "https://acme.de", "nicheTargetId": 10, "emailVerified": true}}]}}]
}});

const post_Prospects_Bulk = node({{
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {{ name: "POST /prospects/bulk (ERP)", position: [4896, 96], parameters: {{"method": "POST", "url": "{ERP_BASE}/prospects/bulk", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "sendBody": true, "specifyBody": "json", "jsonBody": "={{{{ JSON.stringify({{ campaignId: $json.campaignId, prospects: $json.prospects }}) }}}}", "options": {{}}}} }},
  output: [{{"created": 12, "updated": 3}}]
}});

const build_Run_Callback = node({{
  type: "n8n-nodes-base.code",
  version: 2,
  config: {{ name: "Build Run Callback", position: [5072, 96], parameters: {{"jsCode": {json.dumps(run_callback_payload_js)}}} }},
  output: [{{"stage": "LEAD_SATELLITE", "status": "SUCCESS", "campaignId": "c1", "metrics": {{"prospectsUpserted": 15, "segmentsPlanned": 4}}}}]
}});

const post_Run_Callback = node({{
  type: "n8n-nodes-base.httpRequest",
  version: 4.2,
  config: {{ name: "POST /arsenal/runs/callback (ERP)", position: [5248, 96], onError: "continueRegularOutput", parameters: {{"method": "POST", "url": "{ERP_BASE}/arsenal/runs/callback", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "sendBody": true, "specifyBody": "json", "jsonBody": "={{{{ JSON.stringify($json) }}}}", "options": {{}}}} }},
  output: [{{}}]
}});

"""

# Insert the PG node definitions before the (now copy-6) fan-out wiring block.
# (The PG tail is already wired inside NEW_WIRING's .onDone(...) chain — built
# programmatically above — so no separate splice is needed here.)
anchor_fanout_wire = "build_Search_Query.to(build_Groups.to(loop_Over_Groups"
assert anchor_fanout_wire in src, "copy-6 fan-out wiring anchor not found"
src = src.replace(anchor_fanout_wire, pg_nodes + anchor_fanout_wire, 1)
assert "append_Leads_Rows.to(build_Prospect_Payload.to(post_Prospects_Bulk.to(build_Run_Callback.to(post_Run_Callback))))" in src, \
    "PG tail not present in NEW_WIRING"

# =====================================================================
# PART 5 — sticky notes (deltas A, B, E credential guidance + legacy trigger)
# =====================================================================
stickies = """
const note_Erp_Creds = sticky('## ERP HTTP nodes — UNBOUND credential\\nThe 3 ERP nodes (Fetch Campaign Config, POST /prospects/bulk, POST /arsenal/runs/callback) use httpHeaderAuth with NO credential selected.\\nOpen each and select **ERP Ingest (x-arsenal-token)** before running.\\nEndpoints go live only after the ERP backend deploys (evertrust-api.onrender.com).', { color: 3, position: [1300, -200], width: 520, height: 200 });

const note_Legacy_Trigger = sticky('## legacy trigger — remove after cutover\\nThe Drive-poll + manual triggers predate the v2 ERP contract. The v2 entry is the webhook `wf03-lead-research-v2` with body { campaignId, source }. Manual/Drive runs have no campaignId and will 4xx at the ERP fetch until removed.', { color: 4, position: [-360, 120], width: 360, height: 180 });

const note_Niche_Gate = sticky('## Niche Gate\\nIf niche.targets is empty: POST NICHE ANALYTICS then THROW (loud). NICHE ANALYTICS re-calls wf03-lead-research-v2 when targets are ready, so the 2nd run passes the gate.', { color: 5, position: [1980, -260], width: 360, height: 150 });
"""

# add the stickies just before the export, and register them on the workflow.
anchor_export = "export default workflow("
assert anchor_export in src
src = src.replace(anchor_export, stickies + "\n" + anchor_export, 1)

# rename + register stickies on the workflow composition
src = src.replace("export default workflow('Ew0W0JFnCuCK9XlV', 'EVERTRUST - LEAD SATELLITE copy 3')",
                  "export default workflow('wf03-copy6-pg', 'EVERTRUST - LEAD SATELLITE copy 6 (PG)')")
# attach stickies via .add at the very end of the composition (after the last .to(inspect_Drive_Item);)
src = src.replace("  .add(onNewFolderDrivePoll)\n  .to(inspect_Drive_Item);",
                  "  .add(onNewFolderDrivePoll)\n  .to(inspect_Drive_Item)\n"
                  "  .add(note_Erp_Creds)\n  .add(note_Legacy_Trigger)\n  .add(note_Niche_Gate);")

open(OUT, "w").write(src)
print(f"wrote {OUT}: {len(src)} chars")
