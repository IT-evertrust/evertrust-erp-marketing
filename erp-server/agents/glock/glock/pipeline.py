"""The reply-handling loop. For each unread reply across both inboxes:
link to lead (by thread, then email) -> dedup -> if already-Interested parse slot pick &
book, else classify -> route (interested/unsure/not-interested) -> write status -> notify.

Dry-run (default): classifies and decides, but sends nothing, books nothing, writes no
status, marks nothing read — only the run report. --live arms every effect.

Fixes carried over the n8n bugs: context hydrated from Postgres, replies linked by
threadId, slots stored in pending_slots (not a Notes marker).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import db
from .clients import llm
from .domain import slots as slots_domain
from .domain.classify import offline_classify
from .domain.models import Lead, Reply, RunCounts, Slot
from .settings import TZ, REPLY_QUERY, UNSURE_REPLY, Settings


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True
    accounts: tuple[str, ...] = ("info", "hanna")
    replies: list[Reply] | None = None  # injected in tests / offline runs


def run(settings: Settings, opts: RunOptions) -> RunCounts:
    now = datetime.now(ZoneInfo(TZ))
    today = now.date()
    run_id = "glock-" + now.strftime("%Y-%m-%d-%H%M%S")
    report: list[str] = [f"# Reply Glock run {run_id} ({'live' if opts.live else 'dry'})", ""]
    counts = RunCounts()

    def log(msg: str) -> None:
        print(msg, flush=True)
        report.append(f"- {msg}")

    conn = db.connect(settings.database_url)

    # 1. discover replies (injected, or polled from Gmail in live/real mode)
    replies = opts.replies
    if replies is None:
        from .clients import gmail
        replies = []
        for acct in opts.accounts:
            found = gmail.fetch_replies(settings, acct, REPLY_QUERY)
            log(f"[discovery] {acct}: {len(found)} unread replies")
            replies.extend(found)

    for reply in replies:
        # 2. dedup
        if db.already_processed(conn, reply.message_id):
            counts.skipped += 1
            log(f"SKIP [processed] {reply.from_email} msg={reply.message_id}")
            continue

        # 3. link to lead — threadId first (the upgrade), then email
        lead = db.lead_by_thread(conn, reply.thread_id) or db.lead_by_email(conn, reply.from_email)
        if lead is None:
            counts.skipped += 1
            log(f"SKIP [no lead] {reply.from_email} (not ours)")
            continue

        try:
            _handle(conn, settings, opts, lead, reply, now, today, counts, log)
        except Exception as exc:  # one bad reply must not abort the batch
            counts.errors += 1
            log(f"ERROR {reply.from_email}: {exc}")

    summary = (
        f"Recon report\nInterested: {counts.interested} | Unsure: {counts.unsure} | "
        f"Not interested: {counts.not_interested} | Booked: {counts.booked}"
    )
    if (counts.interested or counts.unsure or counts.errors):
        _notify(settings, opts, summary, log)
    log(f"[summary] {counts.as_dict()}")

    conn.close()
    report.append("")
    path = Path(settings.report_dir) / f"{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(report) + "\n")
    print(f"Run report: {path}")
    print(f"Counts: {counts.as_dict()}")
    return counts


def _handle(conn, settings, opts, lead: Lead, reply: Reply, now, today, counts, log) -> None:
    # already-Interested → this reply is a slot pick
    if lead.status == "Interested":
        pending = db.get_pending_slots(conn, lead.email)
        if pending:
            slot1, slot2 = pending
            chosen = (1 if not opts.use_llm else llm.pick_slot(settings, reply.reply_text, slot1, slot2))
            if chosen in (1, 2):
                _book(conn, settings, opts, lead, reply, slot1 if chosen == 1 else slot2, counts, log)
                _finish(conn, settings, opts, lead, reply, "Interested", log)
                return
            log(f"[slot-pick] {lead.company_name}: unclear — WA wobble, awaiting reply")
            _finish(conn, settings, opts, lead, reply, lead.status, log)
            return

    # classify
    cls = (offline_classify(reply.reply_text, today, now) if not opts.use_llm
           else llm.classify(settings, lead, reply, today, now))
    log(f"[classify] {lead.company_name} <{lead.email}> -> {cls.classification} "
        f"(status={cls.status!r}; {cls.reasoning})")

    if cls.classification == "Not Interested":
        counts.not_interested += 1
        _set_status(conn, settings, opts, lead, cls.status,
                    f"Reply: not interested ({cls.ni_type})", log)
    elif cls.classification == "Unsure":
        counts.unsure += 1
        body = UNSURE_REPLY.format(company=lead.company_name)
        _send(settings, opts, lead, reply, body, "Unsure holding reply", log)
        _set_status(conn, settings, opts, lead, "Unsure",
                    "Auto-holding reply sent — pending manual follow-up", log)
        _notify(settings, opts, f"Unsure reply from {lead.company_name} — needs follow-up", log)
    else:  # Interested
        counts.interested += 1
        _interested(conn, settings, opts, lead, reply, cls, now, log)

    _finish(conn, settings, opts, lead, reply, cls.classification, log)


def _interested(conn, settings, opts, lead, reply, cls, now, log) -> None:
    # propose two slots (the direct-time booking path is live-only via calendar)
    if opts.use_llm and settings.llm_base_url and opts.live:
        from .clients import calendar
        busy = calendar.busy_windows(settings, now, settings.slot_days_ahead)
    else:
        busy = []  # dry/offline: assume open calendar
    free = slots_domain.find_free_slots(
        busy, now, days_ahead=settings.slot_days_ahead, start_hour=settings.slot_start_hour,
        end_hour=settings.slot_end_hour, slot_minutes=settings.slot_minutes, count=settings.slot_count,
    )
    if len(free) < 2:
        log(f"[interested] {lead.company_name}: <2 free slots — manual follow-up")
        _notify(settings, opts, f"Interested: {lead.company_name} but no free slots", log)
        return
    slot1, slot2 = free[0], free[1]
    body = (llm.draft_proposal(settings, lead, reply, slot1, slot2)
            if (opts.use_llm and settings.llm_base_url)
            else llm.offline_proposal(lead, slot1, slot2))
    log(f"[interested] {lead.company_name}: proposing {slot1.human} / {slot2.human}")
    log(f"    draft body: {body[:160]}...")
    if opts.live:
        from .clients import gmail
        gmail.create_draft(settings, lead.sender, lead.email, reply.thread_id, reply.subject, body)
        db.store_pending_slots(conn, lead.email, lead.campaign_id, slot1, slot2)
    notes = f"Slots proposed: {slot1.human} | {slot2.human}"
    _set_status(conn, settings, opts, lead, "Interested", notes, log)
    _notify(settings, opts, f"Target acquired: {lead.company_name} interested — slots proposed", log)


def _book(conn, settings, opts, lead, reply, slot: dict, counts, log) -> None:
    human = slot.get("human", "")
    log(f"[book] {lead.company_name}: {human}")
    link = ""
    if opts.live:
        from .clients import calendar
        start = datetime.fromisoformat(slot["start"])
        end = datetime.fromisoformat(slot["end"])
        link = calendar.create_meeting(settings, lead.company_name, lead.project, lead.email, start, end)
        confirm = (f"Dear {lead.company_name},<br><br>Confirmed for {human}.<br>"
                   f"Meet link: {link or 'to follow'}<br><br>Kind regards,<br>EVERTRUST GmbH")
        from .clients import gmail
        gmail.send_reply(settings, lead.sender, lead.email, reply.thread_id, reply.subject, confirm)
    counts.booked += 1
    _set_status(conn, settings, opts, lead, "Meeting Scheduled",
                f"Meeting at {human} | Meet: {link or 'pending'}", log)
    _notify(settings, opts, f"Direct hit — meeting booked with {lead.company_name} at {human}", log)


# --- gated effect helpers -------------------------------------------------------

def _set_status(conn, settings, opts, lead, status: str, notes: str, log) -> None:
    if opts.live:
        db.set_status(conn, lead.id, status, notes)
    log(f"    {'WROTE' if opts.live else 'would write'} status={status!r}")


def _send(settings, opts, lead, reply, body: str, label: str, log) -> None:
    log(f"    {'SENT' if opts.live else 'would send'} {label} to {lead.email}")
    if opts.live:
        from .clients import gmail
        gmail.send_reply(settings, lead.sender, lead.email, reply.thread_id, reply.subject, body)


def _notify(settings, opts, text: str, log) -> None:
    log(f"    WA: {text}")
    if opts.live:
        from .clients import whatsapp
        whatsapp.notify(settings, text)


def _finish(conn, settings, opts, lead, reply, classification: str, log) -> None:
    if opts.live:
        db.mark_processed(conn, reply.message_id, reply.thread_id, lead.email, classification)
        from .clients import gmail
        gmail.mark_read(settings, reply.account, reply.message_id)
