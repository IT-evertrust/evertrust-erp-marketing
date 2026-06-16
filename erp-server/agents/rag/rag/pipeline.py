"""RAG Agent core — the function the ERP route calls: run(settings, opts, erp, llm) -> dict.

Faithful to n8n workflow ffd3c2uRgkMLFaxT (RAG AGENT (PG)): hourly, drain the UNSURE backlog
that still needs a drafted reply.
  GET /reply-classifications?needsRag=true -> per item:
    GET /outreach-messages?prospectId=  (thread) -> gpt-4o drafts a Hanna reply (strict JSON,
    fail-loud) -> POST /reply-classifications {verdict:UNSURE, suggestedReply} + notify RAG_DRAFT_READY.

Dry-run (default): draft only, NO ERP writes. --live: save the draft + notify. No Gmail send —
the PG agent stores suggestedReply for human review (the Drive-draft step is gone).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from .clients import llm as llm_default
from .clients.erp import ErpGateway
from .domain.parse import ParseError, parse_reply
from .domain.prompts import build_system_prompt, build_user_prompt
from .domain.thread import format_erp_thread


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True
    limit: int = 50


def run(settings, opts: RunOptions, erp: ErpGateway, llm=llm_default) -> dict:
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    result: dict = {"runId": run_id, "mode": "live" if opts.live else "dry", "drafts": []}
    drafted = saved = errors = 0

    backlog = erp.get_rag_backlog(opts.limit)
    for lead in backlog:
        pid = str(lead.get("prospectId") or "")
        cid = str(lead.get("campaignId") or "")
        lead_email = str(lead.get("prospectEmail") or lead.get("leadEmail") or "").lower()
        company = str(lead.get("companyName") or lead.get("company") or "")
        country = str(lead.get("country") or "")
        entry = {"prospectId": pid, "company": company}
        if not pid:
            errors += 1
            entry["status"] = "error"
            entry["reason"] = "missing prospectId"
            result["drafts"].append(entry)
            continue

        try:
            messages = erp.get_thread(pid)
        except Exception:
            messages = []
        thread = format_erp_thread(messages, lead_email)
        system = build_system_prompt("")
        user = build_user_prompt(company, country, lead_email, thread)

        try:
            raw = llm.analyze(settings, system, user) if opts.use_llm else llm.offline_analyze(lead, thread)
            parsed = parse_reply(raw, validate_area=opts.use_llm)
        except ParseError as exc:
            errors += 1
            entry["status"] = "error"
            entry["reason"] = str(exc)
            result["drafts"].append(entry)
            continue

        entry["subject"] = parsed.subject
        entry["unsureArea"] = parsed.unsure_area
        entry["draftChars"] = len(parsed.draft_reply)
        drafted += 1

        if opts.live:
            raw_json = json.dumps({
                "subject": parsed.subject, "unsureSection": parsed.unsure_section,
                "unsureSignal": parsed.unsure_signal, "unsureArea": parsed.unsure_area,
                "areaExplanation": parsed.area_explanation, "draftReply": parsed.draft_reply,
                "citations": parsed.citations,
            })
            erp.save_draft(pid, settings.llm_model, raw_json, parsed.draft_reply)
            saved += 1
            try:
                erp.notify_draft_ready(cid, parsed.unsure_area, parsed.subject)
            except Exception:
                pass
            entry["status"] = "saved"
        else:
            entry["status"] = "drafted"
        result["drafts"].append(entry)

    result["counts"] = {"backlog": len(backlog), "drafted": drafted, "saved": saved, "errors": errors}
    return result
