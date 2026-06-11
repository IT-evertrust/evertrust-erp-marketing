#!/usr/bin/env python3
"""Generate WF-03 LEAD SATELLITE copy 5 (SEAR batched) from copy 4's SDK code.

Surgery on tasks/wf03-copy3.sdk.js (the validated code that created copy 4):
- Fan-out rebuilt around splitInBatches(batchSize=1): groups dispatch ONE AT A
  TIME, the parent polls the results table until that group's cumulative rows
  arrive (or a 25-min per-group budget lapses), then advances to the next group.
  Fixes execution 5420's failure mode: 6 simultaneous children starved n8n
  cloud's ~5-execution concurrency cap, 0 rows ever arrived, and the run ended
  "successfully" doing nothing.
- Wait between polls raised 20s -> 90s: waits >65s park the execution
  ("waiting" state), releasing its concurrency slot to the child.
- NEW Guard Results node: zero rows for the runId now THROWS (loud failed
  execution) instead of the silent zero-item stop at Reshape For Parse;
  partial results proceed with a logged shortfall.
- Reshape For Parse reads runId from Build Groups (Make Wait Control is gone).
"""
import json, re, uuid

SRC = "/Users/macco/Documents/evertrust-erp-marketing/tasks/wf03-copy3.sdk.js"
OUT = "/Users/macco/Documents/evertrust-erp-marketing/tasks/wf03-copy5.sdk.js"

src = open(SRC).read()

# 1. imports: add splitInBatches + nextBatch
src = src.replace(
    "import { workflow, node, trigger, newCredential, languageModel, tool, fromAi, expr } from '@n8n/workflow-sdk';",
    "import { workflow, node, trigger, newCredential, languageModel, tool, fromAi, expr, splitInBatches, nextBatch } from '@n8n/workflow-sdk';",
)

# 2. Reshape For Parse: runId now comes from Build Groups
src = src.replace("const runId = $('Make Wait Control').first().json.runId;",
                  "const runId = $('Build Groups').first().json.runId;")

# 3. new node definitions, inserted before the fan-out wiring line
mk_batch_control = (
    "const g = $('Loop Over Groups').first().json;\n"
    "const N = g.expectedSegments || 0;\n"
    "const G = g.expectedGroups || 1;\n"
    "const gi = g.groupIndex || 0;\n"
    "let cum = 0;\n"
    "for (let k = 0; k <= gi; k++) cum += Math.floor(N / G) + (k < N % G ? 1 : 0);\n"
    "console.log('[Batch] dispatched group ' + gi + '/' + (G - 1) + ' -> cumulative target ' + cum + '/' + N + ' rows');\n"
    "return [{ json: { runId: g.runId, groupIndex: gi, expectedGroups: G, expectedSegments: N, cumTarget: cum, pollStartMs: Date.now(), batchMaxWaitMs: 1500000 } }];"
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

NEW_WIRING = """build_Search_Query.to(build_Groups.to(loop_Over_Groups
  .onEachBatch(dispatch_Groups.to(make_Batch_Control.to(wait_For_Batch.to(count_Done.to(eval_Batch_Poll.to(
    batch_Done
      .onTrue(nextBatch(loop_Over_Groups))
      .onFalse(wait_For_Batch)
  ))))))
  .onDone(collect_Results.to(guard_Results.to(reshape_For_Parse.to(parse_And_Validate_Leads.to(collect_Missing_Emails.to(findMissingEmailsWeb.to(merge_Recovered_Emails.to(decode_Protected_Emails.to(create_Leads_Sheet.to(move_Leads_Sheet_To_Folder.to(build_Sheet_Rows.to(append_Leads_Rows))))))))))))
));"""

assert OLD_WIRING in src, "fan-out wiring block not found - source drifted"
src = src.replace(OLD_WIRING, new_nodes + NEW_WIRING)

# 4. drop the now-unused node definitions (make_Wait_Control, wait_For_Children, eval_Poll, all_Done)
for name in ["make_Wait_Control", "wait_For_Children", "eval_Poll", "all_Done"]:
    src, n = re.subn(rf"const {name} = (?:node|trigger)\(\{{.*?\n\}}\);\n", "", src, count=1, flags=re.S)
    assert n == 1, f"could not remove {name}"

# 5. rename the workflow
src = src.replace("export default workflow('Ew0W0JFnCuCK9XlV', 'EVERTRUST - LEAD SATELLITE copy 3')",
                  "export default workflow('wf03-copy5-batched', 'EVERTRUST - LEAD SATELLITE copy 5 (SEAR batched)')")

open(OUT, "w").write(src)
print(f"wrote {OUT}: {len(src)} chars")
