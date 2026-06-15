"""The unsure-lead drafting loop. For each campaign:
  get unsure leads (deduped, cap 10) → per lead: fetch the Gmail thread (skip if no lead
  message) → skip if dedupKey already in unsure_analysis (idempotency, fixes the DISABLED
  'Skip Seen Messages' node) → load knowledge → build verbatim prompts → analyze (or
  offline) → parse → (live) stage a Gmail DRAFT routed by inbox + insert unsure_analysis;
  (dry) log the plan.

Dry-run (default): computes the plan, writes NOTHING, sends NOTHING. --live arms the
Gmail draft creation + DB writes. HARD INVARIANT: drafts only, never send. Fail-loud on
unexpected empty results.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import db
from .clients import llm
from .domain import parse, prompts, select
from .domain.enums import account_for
from .domain.models import UnsureLead
from .domain.thread import build_thread_context
from .settings import TZ, Settings


@dataclass
class RunCounts:
    campaigns: int = 0
    leads: int = 0
    skipped_no_thread: int = 0
    skipped_seen: int = 0
    drafted: int = 0
    errors: int = 0

    def as_dict(self) -> dict:
        return {
            "campaigns": self.campaigns, "leads": self.leads,
            "skipped_no_thread": self.skipped_no_thread, "skipped_seen": self.skipped_seen,
            "drafted": self.drafted, "errors": self.errors,
        }


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True
    campaign_id: int | None = None
    # injected in tests / offline runs: maps thread_id (or lead email) -> list[message dict]
    threads: dict | None = None


def run(settings: Settings, opts: RunOptions) -> RunCounts:
    now = datetime.now(ZoneInfo(TZ))
    run_id = "rag-" + now.strftime("%Y-%m-%d-%H%M%S")
    report: list[str] = [f"# RAG Agent run {run_id} ({'live' if opts.live else 'dry'})", ""]
    counts = RunCounts()

    def log(msg: str) -> None:
        print(msg, flush=True)
        report.append(f"- {msg}")

    conn = db.connect(settings.database_url)
    knowledge = db.load_knowledge_doc(conn, settings.knowledge_cap)

    campaigns = db.list_campaigns(conn, opts.campaign_id)
    if not campaigns:
        raise RuntimeError(
            f"no campaigns found (campaign_id={opts.campaign_id}) — nothing to scan."
        )

    for campaign in campaigns:
        counts.campaigns += 1
        rows = db.get_unsure_lead_rows(conn, campaign["id"])
        leads = select.cap(
            select.extract_unsure_leads(rows, campaign), settings.per_run_cap
        )
        log(f"[campaign {campaign['id']} {campaign.get('name','')}] "
            f"{len(rows)} unsure rows → {len(leads)} leads (cap {settings.per_run_cap})")

        for lead in leads:
            counts.leads += 1
            try:
                _handle_lead(conn, settings, opts, lead, knowledge, counts, log)
            except Exception as exc:  # one bad lead must not abort the batch
                counts.errors += 1
                log(f"ERROR {lead.lead_email}: {exc}")

    log(f"[summary] {counts.as_dict()}")
    conn.close()

    report.append("")
    path = Path(settings.report_dir) / f"{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(report) + "\n")
    print(f"Run report: {path}")
    print(f"Counts: {counts.as_dict()}")
    return counts


def _fetch_messages(settings, opts: RunOptions, lead: UnsureLead) -> tuple[list[dict], str]:
    """Return (messages, thread_id). Injected in tests; live → Gmail (route by inbox)."""
    if opts.threads is not None:
        msgs = opts.threads.get(lead.lead_email) or opts.threads.get(lead.lead_email.lower()) or []
        thread_id = msgs[0].get("threadId", "") if msgs else ""
        return msgs, thread_id
    from .clients import gmail
    account = account_for(lead.sent_from)
    thread_ids = gmail.search_threads(settings, account, lead.lead_email)
    if not thread_ids:
        return [], ""
    thread_id = thread_ids[0]
    return gmail.get_thread(settings, account, thread_id), thread_id


def _handle_lead(conn, settings, opts, lead: UnsureLead, knowledge: str, counts, log) -> None:
    messages, thread_id = _fetch_messages(settings, opts, lead)
    ctx = build_thread_context(
        messages, lead, thread_id=thread_id,
        msgs_cap=settings.thread_msgs_cap, body_cap=settings.body_cap,
    )
    if ctx is None:
        counts.skipped_no_thread += 1
        log(f"SKIP [no lead message] {lead.lead_email}")
        return

    # idempotency — fixes the DISABLED 'Skip Seen Messages' node
    if db.dedup_key_seen(conn, ctx.dedup_key):
        counts.skipped_seen += 1
        log(f"SKIP [already seen] {lead.lead_email} key={ctx.dedup_key}")
        return

    system = prompts.build_system_prompt(knowledge)
    user = prompts.build_user_prompt(
        ctx.company_name, ctx.country, ctx.lead_email, ctx.formatted_thread
    )
    raw = (llm.offline_analyze(lead, ctx) if not opts.use_llm
           else llm.analyze(settings, system, user))
    out = parse.parse_reply(raw)

    account = account_for(ctx.scanned_from)
    log(f"[draft] {lead.company_name} <{ctx.client_reply_email}> area={out.unsure_area!r} "
        f"inbox={account} subj={out.subject!r}")

    if opts.live:
        from .clients import gmail
        body_html = out.draft_reply.replace("\n", "<br>")
        draft_id = gmail.create_draft(
            settings, account, ctx.client_reply_email, out.subject, body_html
        )
        db.insert_unsure_analysis(conn, {
            "campaign_id": lead.campaign_id,
            "lead_id": lead.lead_id or None,
            "client_email": ctx.client_reply_email,
            "company_name": lead.company_name,
            "unsure_section": out.unsure_section,
            "category": out.unsure_area,
            "draft_subject": out.subject,
            "drafted_reply": out.draft_reply,
            "scanned_from": ctx.scanned_from,
            "thread_dedup_key": ctx.dedup_key,
        })
        log(f"    DREW draft={draft_id} + WROTE unsure_analysis row")
    else:
        log(f"    would create draft to {ctx.client_reply_email} + insert unsure_analysis "
            f"(key={ctx.dedup_key})")
    counts.drafted += 1
