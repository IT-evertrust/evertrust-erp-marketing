"""ContractMaker core — the function the ERP route calls: run(settings, opts, erp, llm, gdocs).

Faithful to n8n workflow wZWcjzx7fSbbsT7c (ContractMaker (PG)): a Read.ai meeting →
signal-extract → if signing agreed → deal-extract (no fabrication) → match campaign (ERP) →
idempotency check (ERP /contracts) → generate contract PDF (Google Docs/Drive, kept) →
POST /contracts GENERATED → PATCH /contracts SIGNED.

Dry-run (default): extract + match + build fields, NO PDF, NO ERP writes. --live arms PDF + writes.
Reuses the existing readai/company/contract/llm/gdocs modules; only the data layer is the ERP.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from . import readai
from .clients import gdocs as gdocs_default
from .clients import llm as llm_default
from .clients.erp import ErpGateway
from .domain import contract as contract_domain
from .domain.company import company_key

_STUB_FOLDER = "1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M"


@dataclass(frozen=True)
class RunOptions:
    meeting: dict = field(default_factory=dict)  # Read.ai webhook body
    live: bool = False
    use_llm: bool = True


def _drop_none(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "")}


def run(settings, opts: RunOptions, erp: ErpGateway, llm=llm_default, gdocs=gdocs_default) -> dict:
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    meeting = opts.meeting or {}
    adapted = readai.adapt(meeting)
    text = adapted.get("text", "")
    title = adapted.get("title", "")
    meeting_id = adapted.get("meetingId", "")

    signal = llm.signal_extract(settings, text) if opts.use_llm else llm.offline_signal(text)
    company_name = str(signal.get("companyName") or "").strip()
    country = str(signal.get("country") or "").strip()
    niche = str(signal.get("niche") or "").strip()
    cs = signal.get("contractSigningMentioned")
    sign_now = cs is True or str(cs).strip().lower() == "true"
    ck = company_key(company_name or title)

    result: dict = {"runId": run_id, "mode": "live" if opts.live else "dry",
                    "companyKey": ck, "companyName": company_name, "signNow": sign_now, "status": "ok"}

    if not sign_now:
        return {**result, "status": "no_signing", "action": "skipped"}

    lead_id = str(meeting.get("leadId") or meeting.get("lead_id") or "")
    customer_id = str(meeting.get("customerId") or meeting.get("customer_id") or "")
    aggregate_text = text

    deal = llm.deal_extract(settings, aggregate_text) if opts.use_llm else {}
    campaigns = erp.list_active_campaigns()
    camp = contract_domain.match_campaign(niche, country, campaigns) or {}
    campaign_id = str(camp.get("id") or "")
    folder_id = camp.get("folderId") or _STUB_FOLDER
    template_asset_id = camp.get("templateAssetId") or ""

    existing = erp.get_contracts(lead_id, campaign_id)
    if any(str(c.get("status", "")).upper() in ("GENERATED", "SIGNED") for c in existing):
        return {**result, "status": "exists", "action": "skipped_existing", "campaignId": campaign_id}

    built = contract_domain.build_fields(
        deal, aggregate_text, niche or camp.get("niche") or "DEFAULT",
        country or camp.get("country") or "Poland", date.today(),
    )
    result.update({"campaignId": campaign_id, "templateName": built["template_name"],
                   "fileBase": built["file_base"], "clientName": built["fields"]["CLIENT_NAME"],
                   "posted": False})

    if opts.live:
        drive_url = gdocs.generate_contract_pdf(
            settings, built["template_name"], folder_id, built["file_base"], built["fields"])
        contract = erp.record_contract(_drop_none({
            "leadId": lead_id, "customerId": customer_id, "campaignId": campaign_id,
            "templateAssetId": template_asset_id, "signingMeetingId": meeting_id,
            "status": "GENERATED", "driveUrl": drive_url,
        }))
        contract_id = str(contract.get("id") or contract.get("contractId") or "")
        if contract_id:
            erp.mark_signed(contract_id, _drop_none({
                "status": "SIGNED", "signedAt": datetime.now(timezone.utc).isoformat(),
                "cooperationTerm": signal.get("cooperationTerm") or "",
            }))
        result["posted"] = True
        result["action"] = "generated_signed"
        result["driveUrl"] = drive_url
    else:
        result["action"] = "planned"

    return result
