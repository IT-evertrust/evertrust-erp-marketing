import uuid
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from erp_agents.core.job import AgentJob
from erp_agents.core.registry import WORKFLOW_REGISTRY, get_workflow

# Synchronous agent HTTP server. The ERP backend POSTs a job here and gets the structured
# AgentResult back in the same request (the engage flow is per-reply, not a campaign batch).
app = FastAPI(title="erp-agents", version="0.1.0")


class RunRequest(BaseModel):
    workflow: str
    mode: Literal["dry_run", "live"] = "dry_run"
    input: dict[str, Any] = Field(default_factory=dict)
    job_id: str | None = None
    requested_by: str | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "workflows": sorted(WORKFLOW_REGISTRY)}


@app.post("/run")
def run(req: RunRequest) -> dict[str, Any]:
    try:
        workflow = get_workflow(req.workflow)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    job = AgentJob(
        job_id=req.job_id or f"job_{uuid.uuid4().hex[:8]}",
        workflow=req.workflow,
        mode=req.mode,
        input=req.input,
        requested_by=req.requested_by,
    )
    result = workflow.run(job)
    return result.model_dump()
