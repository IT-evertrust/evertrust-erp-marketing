# erp-agents

Python workflow-automation + LLM/external-tool execution layer for the EVERTRUST ERP Growth Engine.
The agents are the **brain**: they validate input, prepare prompts, call the LLM, parse + validate
output, and return a structured `AgentResult` with a trace. The **backend** (NestJS) owns state, jobs,
permissions, persistence, and side-effect orchestration; the **frontend** (Next.js) owns the UI.

## Layout

```
src/erp_agents/
├── settings.py            # central config (pydantic-settings, reads .env)
├── logging.py
├── core/                  # AgentJob, AgentResult, Workflow base, registry
├── clients/               # LlmClient, ErpClient, Gmail/Calendar/Docs, WhatsApp, ReadAI, Search
├── schemas/               # shared cross-workflow models (common.py)
└── workflows/
    ├── reach/             # lead_satellite, reach_bazooka      (not yet ported)
    ├── engage/            # reply_glock ✅, rag_agent ✅
    ├── activate/          # contract_maker, sales_agent        (not yet ported)
    └── nurture/           # crm_customers, crm_hot_leads        (not yet ported)
```

## Setup

```bash
cd erp-agents
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env          # fill in LLM_BASE_URL / LLM_API_KEY (Hermes gateway)
```

## Run a workflow on a local JSON input

```bash
python scripts/run_workflow.py --workflow engage.reply_glock --input examples/reply_glock_interested.json
python scripts/run_workflow.py --workflow engage.rag_agent   --input examples/rag_agent_unsure.json
```

Prints an `AgentResult` JSON: `status`, `output`, `metrics`, `errors`, and a step-by-step `trace`.

## Workflows

- **engage.reply_glock** — classifies an inbound reply into INTERESTED / UNINTERESTED / UNSURE /
  TEMPORARY, extracts signals, and drafts a status-specific reply (Hanna voice). Pure classify+draft —
  sending / booking / persistence are the backend's job. LLM only.
- **engage.rag_agent** — drafts a confident answer for an UNSURE reply, grounded ONLY on the email
  thread, and emits the 7-field analysis (subject, unsureSection, unsureSignal, unsureArea,
  areaExplanation, draftReply, citations) for human review in the ERP queue. LLM only.

Both run model calls through `LlmClient` → local **Hermes** via the LiteLLM gateway. Neither writes to
the ERP or sends email in this phase (the backend Engage wiring comes next).
