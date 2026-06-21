from typing import Any,Literal
from pydantic import BaseModel, Field

# Agent Job defines the input agents should receive
class AgentJob(BaseModel):
    job_id: str
    workflow: str
    mode: Literal["dry_run", "live"] = "dry_run"
    input: dict[str, Any] = Field(default_factory = dict)
    requested_by: str | None = None
    
