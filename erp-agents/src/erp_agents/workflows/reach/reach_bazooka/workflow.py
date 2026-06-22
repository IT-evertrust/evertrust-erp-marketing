"""Reach Bazooka workflow — ADAPTER over MAIN's standalone ``bazooka`` agent.

Kobe's monolith is the serving layer; main's already-improved Reach Bazooka
under ``erp-agents/workflows/bazooka/`` is the brain and runs VERBATIM (its
per-prospect action logic, LLM personalisation, Gmail info@/hanna send split,
SENT/FAILED logging, prospect PATCH, ERP notifications, send caps). This class is
a thin wrapper: it builds the agent's Settings (env + per-org LLM override),
constructs its ERP gateway, calls ``bazooka.pipeline.run(...)``, and maps the run
report into ``AgentResult``.

Bazooka is a BATCH sender — it pulls every ACTIVE campaign's send list itself
(it is NOT driven by a single campaign_id like the other two reach agents), so
the input contract differs:

/run input contract (request value ?? env default for the override):
  campaign (str | None) — restrict to one campaign by name/project (case-insensitive)
  limit    (int | None) — override the per-run send cap (settings.max_sends_per_run)
  use_llm  (bool, default True)
  llm: {baseUrl, model, apiKey} -> with_llm_override

mode: "live" arms Gmail sends + ERP writes; "dry_run" returns the fire plan only.
"""

from __future__ import annotations

from typing import Any

from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.reach import _agents_path  # noqa: F401  (sys.path shim)

# MAIN's standalone agent (resolved via the _agents_path shim).
from bazooka.clients.erp import ErpClient  # type: ignore
from bazooka.pipeline import RunOptions, run as bazooka_run  # type: ignore
from bazooka.settings import load_settings, with_llm_override  # type: ignore


def _close(gw: Any) -> None:
    close = getattr(gw, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


class ReachBazookaWorkflow(Workflow):
    name = "reach.reach_bazooka"

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        inp = job.input or {}

        live = job.mode == "live"
        campaign = inp.get("campaign")
        limit = inp.get("limit")
        use_llm = bool(inp.get("use_llm", inp.get("useLlm", True)))

        settings = load_settings()
        llm = inp.get("llm") or {}
        if isinstance(llm, dict):
            settings = with_llm_override(
                settings, llm.get("baseUrl"), llm.get("model"), llm.get("apiKey")
            )
        trace.append(
            AgentTraceStep(
                name="build_settings",
                input={"llm": dict(llm), "campaign": campaign, "limit": limit},
                output={
                    "litellm_base_url": bool(settings.litellm_base_url),
                    "llm_model": settings.llm_model,
                    "max_sends_per_run": settings.max_sends_per_run,
                },
            )
        )

        erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
        opts = RunOptions(
            live=live,
            campaign=campaign,
            limit=int(limit) if isinstance(limit, (int, float)) else None,
            use_llm=use_llm,
        )
        try:
            result = bazooka_run(settings, opts, erp)
        except Exception as exc:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=[f"bazooka pipeline failed: {exc}"],
                trace=trace,
            )
        finally:
            _close(erp)

        counts = result.get("counts") or {}
        output = {
            "campaigns": result.get("campaigns", []),
            "messages": result.get("messages", []),
            "emailsSent": result.get("emailsSent", 0),
            "generated_by": "bazooka",
            "run": result,
        }
        trace.append(
            AgentTraceStep(name="bazooka_run", output={"emailsSent": result.get("emailsSent", 0)})
        )
        return AgentResult(
            job_id=job.job_id,
            workflow=self.name,
            status="success",
            output=output,
            metrics={
                "emails_sent": result.get("emailsSent", 0),
                "mode": result.get("mode", "dry"),
                **{k: v for k, v in counts.items() if isinstance(v, (int, float))},
            },
            trace=trace,
        )
