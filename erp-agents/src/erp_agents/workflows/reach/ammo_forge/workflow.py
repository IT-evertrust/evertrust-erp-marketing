"""Ammo Forge workflow — ADAPTER over MAIN's standalone ``ammoforge`` agent.

Kobe's monolith is the serving layer; main's already-improved AmmoForge under
``erp-agents/workflows/ammoforge/`` is the brain and runs VERBATIM (its FORGE
prompt, strict-JSON fail-loud parse, and ERP-persist behaviour). This class is a
thin wrapper: it builds the agent's Settings (env + per-org LLM override),
constructs its ERP gateway, calls ``ammoforge.pipeline.run(...)``, and maps the
forged ``{coldEmail, newsBrief}`` into the ``output.templates`` /
``output.news_brief`` shape ``ReachService.sanitizeTemplates`` / ``sanitizeNews``
read back.

/run input contract (request value ?? env default for the override):
  campaign_id  (str, required) — the AIM campaign whose config the agent fetches
  persist      (bool)  — write forged templates to the ERP (POST /campaigns/:id/
                         templates). Defaults to True in live mode, False in dry_run.
  use_llm      (bool, default True)
  llm: {baseUrl, model, apiKey} -> with_llm_override

Main's AmmoForge returns the campaign's coldEmail as a single tagged
[COLD]/[FOLLOWUP]/[FINALPUSH] string (Reach Bazooka parses the blocks at send
time). The monolith's three-template shape is derived from those blocks here so
the existing ReachService/UI keep working without change.
"""

from __future__ import annotations

import re
from typing import Any

from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.reach import _agents_path  # noqa: F401  (sys.path shim)
from erp_agents.workflows.reach._inject import ConfigInjectingErp, ammoforge_config

# MAIN's standalone agent (resolved via the _agents_path shim).
from ammoforge.clients.erp import ErpClient  # type: ignore
from ammoforge.pipeline import RunOptions, run as ammoforge_run  # type: ignore
from ammoforge.settings import load_settings, with_llm_override  # type: ignore

_BLOCKS = ("COLD-AGG", "COLD", "FOLLOWUP", "FINALPUSH")


def _close(gw: Any) -> None:
    close = getattr(gw, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def _extract_block(text: str, tag: str) -> dict[str, str]:
    """Pull one [TAG] block (Subject:/Body:) out of the forged coldEmail string —
    same shape as the bazooka send-time parser, so what's previewed matches what's
    sent."""
    pattern = re.compile(
        r"\[" + tag + r"\]([\s\S]*?)(?=\n\[(?:COLD-AGG|COLD|FOLLOWUP|FINALPUSH)\]|$)",
        re.IGNORECASE,
    )
    m = pattern.search(text or "")
    if not m:
        return {"subject": "", "body": ""}
    raw = m.group(1)
    subj = re.search(r"Subject:\s*(.+)", raw, re.IGNORECASE)
    body = re.search(r"Body:\s*([\s\S]+)", raw, re.IGNORECASE)
    return {
        "subject": subj.group(1).strip() if subj else "",
        "body": body.group(1).strip() if body else "",
    }


def _templates_from_cold_email(cold_email: str) -> dict[str, dict[str, str]]:
    text = (cold_email or "").strip()
    parsed = {tag: _extract_block(text, tag) for tag in _BLOCKS}
    has_blocks = any(parsed[t]["subject"] or parsed[t]["body"] for t in _BLOCKS)
    if has_blocks:
        return {
            "cold_outreach": parsed["COLD"],
            "follow_up": parsed["FOLLOWUP"],
            "final_push": parsed["FINALPUSH"],
        }
    # No [BLOCK] markers: the whole text is the body for all three rounds.
    base = {"subject": "", "body": text}
    return {"cold_outreach": base, "follow_up": dict(base), "final_push": dict(base)}


def _news_brief(news_brief: str, niche: str) -> dict[str, str]:
    body = (news_brief or "").strip()
    return {"title": f"News brief — {niche}" if niche else "News brief", "body": body}


class AmmoForgeWorkflow(Workflow):
    name = "reach.ammo_forge"

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

        # INJECTED config (Reach flow): the reach_aim has no GET /campaigns/:id/config, so the
        # NestJS server hands the agent its config in `input.config`. In that mode the agent is
        # RETURN-ONLY — it never fetches and never writes (persist forced off, ERP wrapped so every
        # write is a no-op). Absent `config` keeps the original campaigns flow (fetch + persist).
        cfg_in = inp.get("config")
        injected = isinstance(cfg_in, dict) and bool(cfg_in)
        persist = False if injected else bool(inp.get("persist", live))

        settings = load_settings()
        llm = inp.get("llm") or {}
        if isinstance(llm, dict):
            settings = with_llm_override(
                settings, llm.get("baseUrl"), llm.get("model"), llm.get("apiKey")
            )
        trace.append(
            AgentTraceStep(
                name="build_settings",
                input={"llm": dict(llm)},
                output={
                    "llm_base_url": bool(settings.llm_base_url),
                    "forge_model": settings.forge_model,
                },
            )
        )

        # ERP gateway: real client for the campaigns flow; for the Reach flow wrap a
        # ConfigInjectingErp that serves the injected config and no-ops every write (return-only).
        real_erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
        erp = ConfigInjectingErp(ammoforge_config(cfg_in), real=real_erp) if injected else real_erp
        opts = RunOptions(
            campaign_id=campaign_id, live=live, persist=persist, use_llm=use_llm
        )
        try:
            result = ammoforge_run(settings, opts, erp)
        except Exception as exc:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=[f"ammoforge pipeline failed: {exc}"],
                trace=trace,
            )
        finally:
            _close(real_erp)  # the underlying httpx client (erp may be the no-op wrapper)

        if result.get("status") != "ok":
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=[result.get("error") or "ammoforge returned a non-ok status"],
                output={"run": result},
                trace=trace,
            )

        templates = result.get("templates") or {}
        cold_email = str(templates.get("coldEmail") or "")
        news_brief = str(templates.get("newsBrief") or "")
        niche = str(result.get("niche") or "")
        output = {
            "campaign_id": campaign_id,
            "name": result.get("name") or "",
            "niche": niche,
            "templates": _templates_from_cold_email(cold_email),
            "news_brief": _news_brief(news_brief, niche),
            "generated_by": "ammoforge",
            "run": result,
        }
        trace.append(AgentTraceStep(name="ammoforge_run", output={"posted": result.get("posted")}))
        return AgentResult(
            job_id=job.job_id,
            workflow=self.name,
            status="success",
            output=output,
            metrics={
                "posted": result.get("posted", False),
                "notified": result.get("notified", False),
                "mode": result.get("mode", "dry"),
                "cold_email_chars": len(cold_email),
                "news_brief_chars": len(news_brief),
            },
            trace=trace,
        )
