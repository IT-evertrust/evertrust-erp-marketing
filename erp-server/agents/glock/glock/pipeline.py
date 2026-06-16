"""Reply Glock core — the function the ERP route calls:
    run(settings, opts, erp, gmail, calendar, llm, whatsapp) -> dict

Faithful to n8n workflow 5QkBzSzK1UdxiE96 (REPLY GLOCK (PG) v2): list active campaigns +
configs → fetch unread `Re:` replies (Gmail) → per reply: resolve prospect (ERP) → log
inbound → classify (Interested/Unsure/Not Interested) → route → ERP verdict writeback +
side effects → mark read → summary.

Routing:
  Interested + a free proposed time  -> book meeting + confirm + graduate (MEETING_REQUEST)
  Interested (no/blocked time)       -> propose 2 free slots (Gmail draft) + graduate (INTERESTED)
  Unsure                             -> log UNSURE (RAG draft queue picks it up)
  Not Interested                     -> SNOOZE (temporary, +60d) or NOT_INTERESTED (permanent)

Dry-run (default): classify + decide, but NO calendar/Gmail/ERP writes and no mark-read.
--live arms every effect. Gateways are injected so tests use fakes.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .domain import classify as classify_domain
from .domain import slots as slots_domain
from .domain.models import Lead, RunCounts
from .settings import REPLY_QUERY, TZ


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True
    accounts: tuple = ("info", "hanna")


def _campaign_context(erp) -> dict:
    ctx = {}
    for c in erp.list_active_campaigns():
        cid = c.get("campaignId")
        if not cid:
            continue
        try:
            cfg = erp.get_campaign_config(cid) or {}
        except Exception:
            cfg = {}
        niche_obj = cfg.get("niche") if isinstance(cfg.get("niche"), dict) else {}
        niche = (niche_obj.get("name") or niche_obj.get("slug") or "") if niche_obj else str(cfg.get("niche") or "")
        templates = cfg.get("templates") or {}
        ctx[cid] = {
            "campaignName": cfg.get("name") or c.get("campaignName") or "unknown",
            "niche": niche, "city": cfg.get("region") or "", "project": cfg.get("project") or "",
            "sender": cfg.get("sender") or "info", "hasTemplates": bool(templates.get("coldEmail")),
        }
    return ctx


def run(settings, opts: RunOptions, erp, gmail, calendar, llm, whatsapp=None) -> dict:
    tz = ZoneInfo(TZ)
    now = datetime.now(tz)
    today = now.date()
    run_id = now.strftime("%Y-%m-%d-%H%M")
    counts = RunCounts()
    result: dict = {"runId": run_id, "mode": "live" if opts.live else "dry", "replies": []}

    def notify(text: str) -> None:
        if opts.live and whatsapp is not None:
            try:
                whatsapp.notify(settings, text)
            except Exception:
                pass

    camp_ctx = _campaign_context(erp)
    result["campaigns"] = len(camp_ctx)

    replies = []
    for acct in opts.accounts:
        try:
            replies.extend(gmail.fetch_replies(settings, acct, REPLY_QUERY))
        except Exception:
            counts.errors += 1
    seen, uniq = set(), []
    for r in replies:
        if r.message_id in seen:
            continue
        seen.add(r.message_id)
        uniq.append(r)

    for reply in uniq:
        entry = {"email": reply.from_email, "messageId": reply.message_id}
        prospect = erp.get_prospect_by_email(reply.from_email)
        if not prospect or not prospect.get("id"):
            counts.skipped += 1
            entry["action"] = "skipped"
            entry["reason"] = "no_prospect"
            result["replies"].append(entry)
            continue

        ctx = camp_ctx.get(prospect.get("campaignId"), {})
        lead = Lead(
            prospect_id=str(prospect["id"]), campaign_id=str(prospect.get("campaignId") or ""),
            company_name=prospect.get("companyName") or "", company_type=prospect.get("companyType") or "",
            email=reply.from_email, status=prospect.get("status") or "",
            sender=reply.account or ctx.get("sender") or "info",
            niche=ctx.get("niche", ""), project=ctx.get("project", ""),
            campaign_name=ctx.get("campaignName", "unknown"),
        )
        entry["prospectId"] = lead.prospect_id
        entry["company"] = lead.company_name

        if opts.live:
            try:
                erp.log_inbound_message(lead.prospect_id, reply.message_id, reply.thread_id,
                                        reply.subject, reply.reply_text)
            except Exception:
                pass

        cls = (llm.classify(settings, lead, reply, today, now) if opts.use_llm
               else classify_domain.offline_classify(reply.reply_text, today, now))
        entry["classification"] = cls.classification

        if cls.classification == "Interested":
            _handle_interested(settings, opts, erp, gmail, calendar, llm, lead, reply, cls,
                               now, counts, entry, notify)
        elif cls.classification == "Unsure":
            if opts.live:
                try:
                    erp.post_reply_classification(lead.prospect_id, "UNSURE", {
                        "classification": cls.classification, "reasoning": cls.reasoning,
                        "confidence": cls.confidence, "replyText": reply.reply_text[:2000]})
                except Exception:
                    pass
            counts.unsure += 1
            entry["action"] = "unsure_logged"
            notify(f"Unsure reply — needs follow-up\nCompany: {lead.company_name}")
        else:  # Not Interested
            verdict = "SNOOZE" if (cls.ni_type == "temporary" and cls.snooze_until) else "NOT_INTERESTED"
            if opts.live:
                try:
                    erp.post_reply_classification(
                        lead.prospect_id, verdict,
                        {"classification": cls.classification, "niType": cls.ni_type, "reasoning": cls.reasoning},
                        snooze_until=(cls.snooze_until or None))
                except Exception:
                    pass
            counts.not_interested += 1
            entry["action"] = verdict.lower()

        if opts.live:
            try:
                gmail.mark_read(settings, reply.account, reply.message_id)
            except Exception:
                pass
        result["replies"].append(entry)

    result["counts"] = counts.as_dict()
    notify(f"Recon report — Interested {counts.interested} | Unsure {counts.unsure} | "
           f"Not interested {counts.not_interested} | Booked {counts.booked}")
    return result


def _handle_interested(settings, opts, erp, gmail, calendar, llm, lead, reply, cls,
                       now, counts, entry, notify) -> None:
    # Direct booking when the lead named a specific, free time.
    if cls.proposed_start and cls.proposed_end:
        try:
            start = datetime.fromisoformat(cls.proposed_start)
            end = datetime.fromisoformat(cls.proposed_end)
        except ValueError:
            start = end = None
        if start and end:
            try:
                busy = calendar.busy_windows(settings, now, settings.slot_days_ahead)
            except Exception:
                busy = []
            if slots_domain.is_window_free(start, end, busy):
                slot = slots_domain.make_slot(start, end)
                if opts.live:
                    link = calendar.create_meeting(settings, lead.company_name, lead.project, lead.email, start, end)
                    body = (f"Dear {lead.company_name},<br><br>Great — looking forward to our call!<br><br>"
                            f"Date &amp; time: {slot.human}<br>Google Meet: {link or 'invitation will follow'}")
                    gmail.send_reply(settings, lead.sender, lead.email, reply.thread_id, reply.subject, body)
                    erp.post_reply_classification(lead.prospect_id, "MEETING_REQUEST",
                                                  {"chosenHuman": slot.human, "chosenStart": cls.proposed_start})
                    erp.graduate(lead.prospect_id, "INTERESTED", f"Reply Glock: meeting booked {slot.human}")
                counts.booked += 1
                entry["action"] = "meeting_booked"
                entry["when"] = slot.human
                notify(f"Meeting booked — {lead.company_name} @ {slot.human}")
                return

    # Otherwise propose two free slots as a draft (soft human gate, matching n8n).
    try:
        busy = calendar.busy_windows(settings, now, settings.slot_days_ahead)
    except Exception:
        busy = []
    free = slots_domain.find_free_slots(
        busy, now, days_ahead=settings.slot_days_ahead, start_hour=settings.slot_start_hour,
        end_hour=settings.slot_end_hour, slot_minutes=settings.slot_minutes, count=settings.slot_count)
    if len(free) < 2:
        counts.skipped += 1
        entry["action"] = "no_slots"
        return
    slot1, slot2 = free[0], free[1]
    body = (llm.draft_proposal(settings, lead, reply, slot1, slot2) if opts.use_llm
            else llm.offline_proposal(lead, slot1, slot2))
    if opts.live:
        gmail.create_draft(settings, lead.sender, lead.email, reply.thread_id, reply.subject, body)
        erp.post_reply_classification(lead.prospect_id, "INTERESTED", {
            "classification": "Interested", "reasoning": cls.reasoning,
            "confidence": cls.confidence, "replyText": reply.reply_text[:2000]})
        erp.graduate(lead.prospect_id, "INTERESTED",
                     f"Reply Glock: interested — slots proposed {slot1.human} | {slot2.human}")
    counts.interested += 1
    entry["action"] = "slots_proposed"
    entry["slots"] = [slot1.human, slot2.human]
    notify(f"Target acquired — interested\nCompany: {lead.company_name}\nSlots: {slot1.human}, {slot2.human}")
