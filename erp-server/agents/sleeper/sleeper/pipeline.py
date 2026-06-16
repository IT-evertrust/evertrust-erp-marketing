"""Sleeper core — the function the ERP route calls: run(settings, opts, erp, llm, gmail, whatsapp).

Faithful to n8n workflow cZDGIoudM6yg17kV (SLEEPER GRENADE (PG)):
  GET /prospects?snoozeDue=true -> per prospect:
    do-not-contact  -> POST /suppressions + PATCH status=DO_NOT_CONTACT  (row kept, never deleted)
    otherwise       -> AI re-engage draft -> (approval) -> Gmail send -> POST /outreach-messages
                       + PATCH status=RE_ENGAGED (lastContactedAt, followupCount+1)

Dry-run (default): draft + decide, NO ERP writes, NO sends. --live arms suppression, send, writes.
NOTE: the n8n WhatsApp send-and-wait approval gate is a manager-in-the-loop step; the ERP-native
agent defers approval to the ERP/manager UI — in --live it sends after drafting.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients import llm as llm_default
from .domain.models import Prospect

TZ = "Europe/Berlin"


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True
    limit: int = 100


def run(settings, opts: RunOptions, erp, llm=llm_default, gmail=None, whatsapp=None) -> dict:
    now = datetime.now(ZoneInfo(TZ))
    run_id = now.strftime("%Y-%m-%d-%H%M")
    counts = {"due": 0, "doNotContact": 0, "reengaged": 0, "skipped": 0, "errors": 0}
    result: dict = {"runId": run_id, "mode": "live" if opts.live else "dry", "prospects": []}

    due = erp.get_snooze_due(opts.limit)
    counts["due"] = len(due)
    dnc_n = sum(1 for p in due if p.do_not_contact)
    if opts.live and whatsapp is not None:
        try:
            whatsapp.notify(settings, f"Sleeper Grenade — run {run_id}\nDue {len(due)} "
                                      f"(re-engage {len(due) - dnc_n}, do-not-contact {dnc_n})")
        except Exception:
            pass

    for p in due:
        entry = {"email": p.email, "prospectId": p.id, "company": p.company_name}
        if p.do_not_contact:
            if opts.live:
                try:
                    erp.add_suppression(p.email, p.id)
                    erp.patch_prospect(p.id, {"status": "DO_NOT_CONTACT"})
                except Exception:
                    counts["errors"] += 1
            counts["doNotContact"] += 1
            entry["action"] = "do_not_contact"
            result["prospects"].append(entry)
            continue

        try:
            draft = llm.draft_reengage(settings, p) if opts.use_llm else llm.offline_reengage(p)
        except ValueError as exc:
            counts["errors"] += 1
            entry["action"] = "draft_failed"
            entry["reason"] = str(exc)
            result["prospects"].append(entry)
            continue

        entry["subject"] = draft.subject
        if opts.live:
            message_id, thread_id = gmail.send_text(settings, "hanna", p.email, draft.subject, draft.body)
            erp.log_outreach(p.id, draft.subject, draft.body, message_id, thread_id)
            erp.patch_prospect(p.id, {"status": "RE_ENGAGED", "lastContactedAt": now.isoformat(),
                                      "followupCount": (p.followup_count or 0) + 1})
        counts["reengaged"] += 1
        entry["action"] = "reengaged"
        result["prospects"].append(entry)

    result["counts"] = counts
    return result
