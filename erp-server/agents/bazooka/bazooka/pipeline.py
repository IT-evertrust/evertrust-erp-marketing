"""Reach core — the run loop, ERP edition.

This is the function a route calls: `run(settings, opts, erp) -> dict`. It pulls the
ERP send-list, decides the action per prospect, personalises, (in live mode) sends via
Gmail + writes back to the ERP, and returns a JSON-serialisable result the caller relays
to the client. The ERP gateway is injected so tests feed canned data with no network.

Dry-run (default): no Gmail, no ERP writes, no run callback — just the fire plan + counts.
--live arms Gmail sends, POST /outreach-messages, PATCH /prospects/:id, and the
POST /arsenal/runs/callback at the end.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients import llm
from .clients.erp import ErpGateway
from .domain.actions import STATUS_AFTER_SEND, compute_action
from .domain.hygiene import clean_email
from .domain.models import RunCounts, parse_template
from .report import RunReport
from .settings import TZ, Settings


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    campaign: str | None = None  # only this campaign (name/project, case-insensitive)
    limit: int | None = None  # max emails this run (live training wheels)
    use_llm: bool = True  # False => offline placeholder fill (tests / isolated)


def run(settings: Settings, opts: RunOptions, erp: ErpGateway) -> dict:
    now = datetime.now(ZoneInfo(TZ))
    run_id = now.strftime("%Y-%m-%d-%H%M%S")
    mode = "live" if opts.live else "dry"
    report = RunReport(settings.report_dir, run_id, mode)
    counts = RunCounts()
    sends_done = 0
    result: dict = {"runId": run_id, "mode": mode, "campaigns": [], "messages": []}

    def notify(text: str) -> None:
        report.whatsapp(text, sent=opts.live)
        result["messages"].append(text)
        if opts.live:
            try:
                from .clients import whatsapp

                whatsapp.notify(settings, text)
            except Exception:  # WhatsApp must never break the run
                pass

    campaigns = erp.fetch_active_campaigns()
    if opts.campaign:
        want = opts.campaign.lower()
        campaigns = [c for c in campaigns if want in (c.name.lower(), c.project.lower())]

    if not campaigns:
        notify(f"Bazooka — run {run_id}: no active campaigns")
        result["counts"] = counts.as_dict()
        result["emailsSent"] = 0
        result["reportPath"] = str(report.write())
        return result

    notify(f"Locked and loaded — run {run_id}, {len(campaigns)} campaign(s)")

    for campaign in campaigns:
        report.section(f"Campaign: {campaign.name}")
        try:
            cfg = erp.fetch_campaign_config(campaign.id)
        except Exception:
            cfg = {}
        templates = cfg.get("templates") if isinstance(cfg, dict) else None
        templates = templates or {}
        niche = campaign.niche
        if isinstance(cfg, dict) and isinstance(cfg.get("niche"), dict):
            niche = cfg["niche"].get("name") or niche
        camp = replace(
            campaign,
            niche=niche,
            region=(cfg.get("region") if isinstance(cfg, dict) else None) or campaign.region,
            project=(cfg.get("project") if isinstance(cfg, dict) else None) or campaign.project,
            sender=(cfg.get("sender") if isinstance(cfg, dict) else None) or campaign.sender,
        )

        block = {"id": campaign.id, "name": campaign.name, "prospects": 0, "planned": []}

        if not templates:
            notify(f"Mag jammed — {campaign.name}: no templates configured, holstered.")
            block["skippedReason"] = "no templates"
            result["campaigns"].append(block)
            continue

        prospects = erp.fetch_send_list(campaign.id)
        block["prospects"] = len(prospects)
        notify(f"{campaign.name} hot — {len(prospects)} eligible prospect(s)")

        for p in prospects:
            if opts.limit is not None and sends_done >= opts.limit:
                block["planned"].append({"status": "stopped", "reason": f"limit {opts.limit}"})
                break

            email = clean_email(p.email)
            action = compute_action(p, templates)
            if action.action_type == "skip":
                counts.skipped += 1
                block["planned"].append(
                    {"email": p.email, "company": p.company_name,
                     "status": "skipped", "reason": action.skip_reason}
                )
                continue

            template = parse_template(templates.get(action.template_key) or "", camp)
            if opts.use_llm:
                validation = llm.personalize(settings, p, camp, template, email)
            else:
                validation = llm.offline_fill(p, camp, template, email)

            if not validation.valid:
                counts.invalid += 1
                block["planned"].append(
                    {"email": email, "company": p.company_name,
                     "status": "invalid", "reason": validation.reason}
                )
                continue

            sender = "hanna" if "hanna" in (camp.sender or "info").lower() else "info"
            sent_status = "planned"
            if opts.live:
                from .clients import gmail

                body_html = gmail.html_body(validation.final_body, settings.signature_img_url)
                message_id, thread_id = gmail.send_html(
                    settings, sender, email, validation.final_subject, body_html
                )
                erp.record_outreach(
                    p.id, validation.final_subject, validation.final_body, message_id, thread_id
                )
                erp.update_prospect(p.id, STATUS_AFTER_SEND, p.followup_count + 1)
                sent_status = "sent"

            report.email(
                to=email, sender=sender, action=action.action_type,
                subject=validation.final_subject, body=validation.final_body, sent=opts.live,
            )
            block["planned"].append(
                {"email": email, "company": p.company_name, "action": action.action_type,
                 "sender": sender, "subject": validation.final_subject,
                 "body": validation.final_body, "status": sent_status}
            )
            setattr(counts, action.action_type, getattr(counts, action.action_type) + 1)
            sends_done += 1

        result["campaigns"].append(block)

    notify(
        f"Shots fired — cold {counts.cold} | follow-up {counts.followup} | "
        f"final {counts.finalpush} | skipped {counts.skipped} | invalid {counts.invalid}"
    )
    if opts.live:
        try:
            erp.post_run_callback("SUCCESS", {"emailsSent": counts.emails_sent})
        except Exception:
            pass

    result["counts"] = counts.as_dict()
    result["emailsSent"] = counts.emails_sent
    result["reportPath"] = str(report.write())
    return result
