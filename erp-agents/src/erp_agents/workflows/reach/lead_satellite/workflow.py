"""Lead Satellite workflow — ADAPTER over MAIN's standalone ``satellite`` agent.

The serving layer is Kobe's monolith (``/run`` dispatcher + registry + AgentJob/
AgentResult contract). The brains are main's already-improved keyless lead scraper
under ``erp-agents/workflows/satellite/`` — it runs VERBATIM here (real web-search
discovery, evidence-based email scraping, the "never auto-verify LLM-guessed
emails" safety fix). This class is a thin wrapper: it builds the agent's Settings
(env + per-org override), constructs its ERP/search/fetcher gateways, calls
``satellite.pipeline.run(...)``, and maps the result into ``AgentResult`` plus the
``output.leads[]`` shape ``ReachService.sanitizeLeads`` reads back.

/run input contract (request value ?? env default for every override):
  campaign_id  (str, required) — the AIM campaign whose config the agent fetches
  persist      (bool)  — write scraped prospects to the ERP (POST /prospects/bulk).
                         Defaults to True in live mode, False in dry_run.
  use_llm      (bool, default True)
  max_segments (int | None)
  llm:     {baseUrl, model, apiKey}            -> with_llm_override
  scraper: {leadTarget, maxQueries, minScore}  -> with_scraper_override
"""

from __future__ import annotations

from typing import Any

from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.reach import _agents_path  # noqa: F401  (sys.path shim)
from erp_agents.workflows.reach._inject import ConfigInjectingErp, satellite_config

# MAIN's standalone agent (resolved via the _agents_path shim).
from satellite.clients.erp import ErpClient  # type: ignore
from satellite.clients.search import HttpFetcher, WebSearch  # type: ignore
from satellite.domain import geo  # type: ignore
from satellite.pipeline import RunOptions, run as satellite_run  # type: ignore
from satellite.settings import (  # type: ignore
    load_settings,
    with_llm_override,
    with_scraper_override,
)


def _close(gw: Any) -> None:
    close = getattr(gw, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def _map_leads(result: dict) -> list[dict[str, Any]]:
    """Map main's ranked prospect rows (result["leads"]) into the lead shape the
    NestJS ReachService.sanitizeLeads reads (company / website / email / location /
    source / qualification_reason / confidence). The agent's richer fields (score,
    tier, status, emailVerified, provenance) are carried through too — sanitizeLeads
    ignores unknown keys, and they're useful for the leads sidebar."""
    leads: list[dict[str, Any]] = []
    for p in result.get("leads") or []:
        if not isinstance(p, dict):
            continue
        score = p.get("score")
        # confidence in [0,1]: prefer email confidence, else normalise the 0..100 score.
        conf = p.get("emailConfidence")
        if not isinstance(conf, (int, float)) or conf <= 0:
            conf = (float(score) / 100.0) if isinstance(score, (int, float)) else None
        leads.append(
            {
                "company": p.get("companyName") or "",
                "website": p.get("website") or None,
                "email": p.get("email") or None,
                "location": p.get("city") or p.get("country") or None,
                "source": p.get("source") or p.get("sourceUrl") or None,
                "qualification_reason": (
                    f"{p.get('companyType') or 'company'} · tier {p.get('tier') or '?'} "
                    f"· score {score if score is not None else '?'}"
                ),
                "confidence": conf,
                # passthrough (UI/debug; sanitizeLeads tolerates extra keys)
                "score": score,
                "tier": p.get("tier"),
                "status": p.get("status"),
                "emailVerified": p.get("emailVerified"),
                "city": p.get("city"),
                "country": p.get("country"),
                "sourceUrl": p.get("sourceUrl"),
                "emailSourceType": p.get("emailSourceType"),
            }
        )
    return leads


class LeadSatelliteWorkflow(Workflow):
    name = "reach.lead_satellite"

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        inp = job.input or {}

        campaign_id = str(inp.get("campaign_id") or inp.get("campaignId") or "")
        if not campaign_id:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=["campaign_id is required"],
            )

        live = job.mode == "live"
        use_llm = bool(inp.get("use_llm", inp.get("useLlm", True)))
        max_segments = inp.get("max_segments", inp.get("maxSegments"))

        # INJECTED config (Reach flow): the reach_aim has no GET /campaigns/:id/config, so the
        # NestJS server hands the agent its config in `input.config`. In that mode the agent is
        # RETURN-ONLY — it never fetches and never writes (persist forced off, ERP wrapped so every
        # write is a no-op). Absent `config` keeps the original campaigns flow (fetch + persist).
        cfg_in = inp.get("config")
        injected = isinstance(cfg_in, dict) and bool(cfg_in)
        if injected:
            persist = False
        else:
            persist = bool(inp.get("persist", live))

        # Settings: env defaults, then per-org overrides (request value ?? env).
        settings = load_settings()
        llm = inp.get("llm") or {}
        if isinstance(llm, dict):
            settings = with_llm_override(
                settings, llm.get("baseUrl"), llm.get("model"), llm.get("apiKey")
            )
        scraper = inp.get("scraper") or {}
        if isinstance(scraper, dict):
            settings = with_scraper_override(
                settings,
                scraper.get("leadTarget"),
                scraper.get("maxQueries"),
                scraper.get("minScore"),
            )
        trace.append(
            AgentTraceStep(
                name="build_settings",
                input={"llm": dict(llm), "scraper": dict(scraper)},
                output={
                    "llm_base_url": bool(settings.llm_base_url),
                    "lead_model": settings.lead_model,
                    "lead_target": settings.lead_target,
                    "max_queries": settings.max_queries,
                    "min_keep_score": settings.min_keep_score,
                },
            )
        )

        # ERP gateway: real client for the campaigns flow; for the Reach flow wrap a
        # ConfigInjectingErp that serves the injected config and no-ops every write (return-only).
        # Region is a ZONE word (North/South/…) in the Reach flow — pass it to the pipeline as
        # region_focus (resolved via the LLM profiler), NOT as a literal city list.
        real_erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
        region_focus = None
        if injected:
            cfg = satellite_config(cfg_in)
            erp = ConfigInjectingErp(cfg, real=real_erp)
            zone = (cfg.region or "").strip()
            if zone and not geo.is_nationwide(zone):
                region_focus = zone
        else:
            erp = real_erp
        search = WebSearch(
            settings.searxng_url,
            settings.searxng_api_key,
            pages=settings.ddg_pages,
            enable_ddg=settings.enable_ddg_fallback,
        )
        fetcher = HttpFetcher()
        opts = RunOptions(
            campaign_id=campaign_id,
            live=live,
            persist=persist,
            use_llm=use_llm,
            max_segments=max_segments,
            region_focus=region_focus,
        )
        try:
            result = satellite_run(settings, opts, erp, search, fetcher)
        except Exception as exc:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=[f"satellite pipeline failed: {exc}"],
                trace=trace,
            )
        finally:
            _close(real_erp)  # the underlying httpx client (erp may be the no-op wrapper)
            _close(search)
            _close(fetcher)

        status = "success" if result.get("status") in ("ok", None) else "partial"
        output = {
            "campaign_id": campaign_id,
            "leads": _map_leads(result),
            "generated_by": "satellite",
            "run": result,  # the full agent run dict (counts, mode, status, runId, ...)
        }
        trace.append(
            AgentTraceStep(name="satellite_run", output={"status": result.get("status")})
        )
        return AgentResult(
            job_id=job.job_id,
            workflow=self.name,
            status=status,
            output=output,
            metrics={
                "leads_found": result.get("leadsFound", len(output["leads"])),
                "prospects": result.get("prospects", 0),
                "verified": result.get("verified", 0),
                "posted": result.get("posted", False),
                "queries_run": result.get("queriesRun", 0),
                "mode": result.get("mode", "dry"),
            },
            errors=[result["error"]] if result.get("error") else [],
            trace=trace,
        )
