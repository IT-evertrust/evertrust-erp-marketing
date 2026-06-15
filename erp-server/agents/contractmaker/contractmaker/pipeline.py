"""Handle one Read.ai meeting: extract signal -> log -> if signing, aggregate the
company's meetings -> extract partner identity -> match campaign -> build contract fields
-> (live) generate the PDF + lock the company. Dry-run produces a 'contract plan' and
writes nothing.

Fixes vs n8n: the empty-body CRM ping is gone — CRM reads the meetings table directly.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from . import db, readai
from .clients import llm
from .domain.company import company_key
from .domain.contract import build_fields, match_campaign
from .settings import Settings

AGG_CAP = 120_000


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True


def handle_meeting(settings: Settings, opts: RunOptions, body: dict, today: date | None = None) -> dict:
    today = today or datetime.now().date()
    report: list[str] = []

    def log(m: str) -> None:
        print(m, flush=True)
        report.append(f"- {m}")

    adapted = readai.adapt(body)
    signal = (llm.offline_signal(adapted["text"]) if not opts.use_llm
              else llm.signal_extract(settings, adapted["text"]))
    name = signal.get("companyName") or adapted["title"]
    key = company_key(name)
    sign_now = str(signal.get("contractSigningMentioned")).lower() == "true" or signal.get("contractSigningMentioned") is True
    log(f"[signal] {name!r} key={key} niche={signal.get('niche')!r} "
        f"country={signal.get('country')!r} signNow={sign_now}")

    conn = db.connect(settings.database_url)
    meeting_row = {
        "company_key": key, "company_name": name, "country": signal.get("country", ""),
        "niche": signal.get("niche", ""), "meeting_id": adapted["meeting_id"],
        "meeting_date": today, "title": adapted["title"],
        "transcript": adapted["text"][:45_000], "sign_now": sign_now,
        "meeting_outcome": signal.get("meetingOutcome", ""),
        "cooperation_term": signal.get("cooperationTerm", ""),
    }
    if opts.live:
        db.log_meeting(conn, meeting_row)
        log("[log] meeting appended to meetings table")
    else:
        log("[log] (dry) would append meeting row")

    result = {"company_key": key, "sign_now": sign_now, "contract": None}
    if not sign_now:
        log("[gate] not a signing — done")
        _write_report(settings, key, report)
        conn.close()
        return result

    # signing path — aggregate the company's meeting history
    history = db.company_history(conn, key) if opts.live else [meeting_row]
    if opts.live and db.any_processed(conn, key):
        log("[idempotency] company already has a generated contract — halt")
        _write_report(settings, key, report)
        conn.close()
        return result

    agg_parts, niche, country = [], "", ""
    for m in history:
        agg_parts.append(f"=== {m.get('meeting_date')} | {m.get('title','')} ===\n{m.get('transcript','')}")
        if m.get("sign_now"):
            niche = niche or m.get("niche", "")
            country = country or m.get("country", "")
    niche = niche or signal.get("niche", "")
    country = country or signal.get("country", "")
    aggregate_text = "\n\n".join(agg_parts)[:AGG_CAP]

    deal = ({"companyName": name} if not opts.use_llm
            else llm.deal_extract(settings, aggregate_text) or {"companyName": name})
    campaign = match_campaign(niche, country, db.fetch_campaigns(conn))
    log(f"[campaign] niche={niche!r} country={country!r} -> "
        f"{('campaign ' + str(campaign['id'])) if campaign else 'NO MATCH (stub)'}")

    built = build_fields(deal, aggregate_text, niche, country, today)
    log(f"[contract] template={built['template_name']} file={built['file_base']}")
    log(f"    fields: CLIENT_NAME={built['fields']['CLIENT_NAME']!r} "
        f"SIGN_CITY={built['fields']['SIGN_CITY']!r}")

    pdf_ref = None
    if opts.live:
        from .clients import gdocs
        # n8n stored PDFs in the campaign Drive folder; here that id would come from the
        # campaign row when wired up. Requires a folder id — left to deployment config.
        folder_id = (campaign or {}).get("drive_folder_id")
        if folder_id:
            pdf_ref = gdocs.generate_contract_pdf(
                settings, built["template_name"], folder_id, built["file_base"], built["fields"])
            db.record_contract(conn, key, name, (campaign or {}).get("id"),
                               built["template_name"], pdf_ref, built["fields"])
            db.mark_processed(conn, key)
            log(f"[pdf] generated + stored ({pdf_ref}); company locked")
        else:
            log("[pdf] no Drive folder configured for campaign — plan only, not generated")
    else:
        log("[pdf] (dry) would generate + store contract PDF")

    result["contract"] = {"template": built["template_name"], "file_base": built["file_base"],
                          "campaign_id": (campaign or {}).get("id"), "pdf_ref": pdf_ref}
    _write_report(settings, key, report)
    conn.close()
    return result


def _write_report(settings: Settings, key: str, lines: list[str]) -> None:
    run_id = "cm-" + datetime.now().strftime("%Y-%m-%d-%H%M%S") + "-" + (key or "x")[:12]
    path = Path(settings.report_dir) / f"{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# ContractMaker {run_id}\n\n" + "\n".join(lines) + "\n")
    print(f"Run report: {path}")
