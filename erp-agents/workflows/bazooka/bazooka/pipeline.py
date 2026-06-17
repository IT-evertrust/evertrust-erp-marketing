"""Reach core — the run loop, faithful to n8n workflow zyCTVLpZj3YyR2qV
(EVERTRUST - REACH BAZOOKA (PG) v2).

The function a route calls: `run(settings, opts, erp) -> dict`. Per active campaign it pulls
the ERP config + send list, decides the action per prospect (cold/followup/finalpush, COLD-AGG
on bad news), personalises via the LLM, and — in live mode — sends via Gmail (info@/hanna
split), logs SENT/FAILED to /outreach-messages, PATCHes the prospect to EMAILED, fires ERP
/notifications at each stage, and posts /arsenal/runs/callback at the end. Send-capped.

Dry-run (default): no Gmail, no ERP writes — just the fire plan + counts. --live arms it all.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients import llm
from .clients.erp import ErpGateway
from .domain.actions import STATUS_AFTER_SEND, compute_action
from .domain.hygiene import clean_email
from .domain.models import (
    News,
    RunCounts,
    detect_bad_news,
    parse_template_blocks,
)
from .report import RunReport
from .settings import TZ, Settings


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    campaign: str | None = None  # only this campaign (name/project, case-insensitive)
    limit: int | None = None  # overrides settings.max_sends_per_run for this run
    use_llm: bool = True  # False => offline placeholder fill (tests / isolated)


def _dig(d: dict, *path):
    cur = d
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def run(settings: Settings, opts: RunOptions, erp: ErpGateway) -> dict:
    now = datetime.now(ZoneInfo(TZ))
    run_id = now.strftime("%Y-%m-%d-%H%M")
    mode = "live" if opts.live else "dry"
    report = RunReport(settings.report_dir, run_id, mode)
    counts = RunCounts()
    sends_done = 0
    max_sends = opts.limit if opts.limit is not None else settings.max_sends_per_run
    # LLM is optional: if the gateway isn't configured, degrade to deterministic
    # placeholder fill rather than crash the batch (the template is still filled).
    use_llm = opts.use_llm and bool(settings.litellm_base_url)
    result: dict = {"runId": run_id, "mode": mode, "campaigns": [], "messages": []}

    def notify(text: str, ntype: str, title: str, campaign_id: str | None = None) -> None:
        report.whatsapp(text, sent=opts.live)
        result["messages"].append({"type": ntype, "text": text})
        if opts.live:
            try:
                erp.post_notification(ntype, title, text, campaign_id)
            except Exception:
                pass
            try:
                from .clients import whatsapp

                whatsapp.notify(settings, text)
            except Exception:
                pass

    campaigns = erp.fetch_active_campaigns()
    if opts.campaign:
        want = opts.campaign.lower()
        campaigns = [c for c in campaigns if want in (c.name.lower(), c.project.lower())]

    if not campaigns:
        notify(
            f"Bazooka dry-fire — no ammo loaded\nRun ID: {run_id}\n\nNo ACTIVE campaigns.",
            "REACH_BAZOOKA_RUN_START", "Reach Bazooka — run start",
        )
        result["counts"] = counts.as_dict()
        result["emailsSent"] = 0
        result["reportPath"] = str(report.write())
        return result

    notify(
        f"Locked and loaded\nRun ID: {run_id}\nLoading {len(campaigns)} mags now...",
        "REACH_BAZOOKA_RUN_START", "Reach Bazooka — run start",
    )

    for campaign in campaigns:
        report.section(f"Campaign: {campaign.name}")
        try:
            cfg = erp.fetch_campaign_config(campaign.id)
        except Exception:
            cfg = {}
        cfg = cfg if isinstance(cfg, dict) else {}
        tfield = cfg.get("templates") if isinstance(cfg.get("templates"), dict) else {}
        cold_email = str(tfield.get("coldEmail") or "")
        news_brief = str(tfield.get("newsBrief") or "")
        templ_subject = str(cfg.get("templateSubject") or "")
        templ_body = str(cfg.get("templateBody") or "")
        template_asset_id = cfg.get("templateAssetId") or cfg.get("templateId")

        camp = replace(
            campaign,
            niche=str(cfg.get("niche") or campaign.niche),
            region=str(cfg.get("city") or campaign.region),
            project=str(cfg.get("project") or campaign.project),
            sender=str(cfg.get("sender") or campaign.sender),
        )
        block = {"id": campaign.id, "name": campaign.name, "prospects": 0, "planned": []}

        # completeness gate (n8n "Check Config Present")
        missing = []
        if not cfg:
            missing.append("campaign config")
        elif not cold_email and not (templ_subject or templ_body):
            missing.append("templates")
        if missing:
            notify(
                f"Mag jammed — missing ammo\nCampaign: {campaign.name}\n"
                f"Missing: {', '.join(missing)}\nAction: holstered for today.",
                "REACH_BAZOOKA_MISSING_FILE", "Reach Bazooka — missing file", campaign.id,
            )
            block["skippedReason"] = ", ".join(missing)
            result["campaigns"].append(block)
            continue

        templates = parse_template_blocks(cold_email, templ_subject, templ_body)
        news = News(news_brief, detect_bad_news(news_brief))

        prospects = erp.fetch_send_list(campaign.id, settings.send_list_limit)
        block["prospects"] = len(prospects)
        notify(
            f"Mag loaded — campaign hot\nCampaign: {campaign.name}\n"
            f"Rounds chambered: {len(prospects)}",
            "REACH_BAZOOKA_CAMPAIGN_ACTIVATED", "Reach Bazooka — campaign activated", campaign.id,
        )

        cap = _dig(cfg, "automation", "leads", "dailySendCap")
        cap = int(cap) if isinstance(cap, (int, float)) and cap else max_sends

        for p in prospects:
            if sends_done >= cap:
                block["planned"].append({"status": "capped", "email": p.email})
                continue

            email = clean_email(p.email)
            action = compute_action(p, templates, news)
            if action.action_type == "skip":
                counts.skipped += 1
                block["planned"].append(
                    {"email": p.email, "company": p.company_name,
                     "status": "skipped", "reason": action.skip_reason}
                )
                continue

            template = templates.get(action.template_block) or templates["COLD"]
            if use_llm:
                validation = llm.personalize(
                    settings, p, camp, template, action.template_block, news, email
                )
            else:
                validation = llm.offline_fill(p, camp, template, email)

            if not validation.valid:
                counts.invalid += 1
                block["planned"].append(
                    {"email": email, "company": p.company_name,
                     "status": "invalid", "reason": validation.reason}
                )
                if opts.live:
                    try:
                        erp.log_failed_outreach(
                            p.id, validation.final_subject,
                            validation.reason or "validation failed", template_asset_id,
                        )
                    except Exception:
                        pass
                continue

            sender = "hanna" if "hanna" in (camp.sender or "info").lower() else "info"
            sent_status = "planned"
            if opts.live:
                from .clients import gmail

                try:
                    body_html = gmail.html_body(validation.final_body, settings.signature_img_url)
                    message_id, thread_id = gmail.send_html(
                        settings, sender, email, validation.final_subject, body_html
                    )
                    erp.record_outreach(
                        p.id, validation.final_subject, validation.final_body,
                        message_id, thread_id, template_asset_id,
                    )
                    erp.update_prospect(p.id, STATUS_AFTER_SEND, p.followup_count + 1)
                    sent_status = "sent"
                except Exception as exc:  # noqa: BLE001 — per-item failure must not abort the run
                    try:
                        erp.log_failed_outreach(
                            p.id, validation.final_subject,
                            f"gmail send failed: {exc}"[:280], template_asset_id,
                        )
                    except Exception:
                        pass
                    block["planned"].append(
                        {"email": email, "company": p.company_name,
                         "status": "failed", "reason": "gmail send failed"}
                    )
                    continue

            report.email(
                to=email, sender=sender, action=action.action_type,
                subject=validation.final_subject, body=validation.final_body, sent=opts.live,
            )
            block["planned"].append(
                {"email": email, "company": p.company_name, "action": action.action_type,
                 "block": action.template_block, "sender": sender,
                 "subject": validation.final_subject, "body": validation.final_body,
                 "status": sent_status}
            )
            setattr(counts, action.action_type, getattr(counts, action.action_type) + 1)
            sends_done += 1

        notify(
            f"Shots fired\nCold: {counts.cold} | Follow-up: {counts.followup} | "
            f"Final push: {counts.finalpush}\nMisfires (validation failed): {counts.invalid}",
            "REACH_BAZOOKA_OUTBOUND_SUMMARY", "Reach Bazooka — outbound summary", campaign.id,
        )
        result["campaigns"].append(block)

    if opts.live:
        try:
            erp.post_run_callback("SUCCESS", {"emailsSent": counts.emails_sent})
        except Exception:
            pass

    result["counts"] = counts.as_dict()
    result["emailsSent"] = counts.emails_sent
    result["reportPath"] = str(report.write())
    return result
