
from typing import Any, Literal
from pydantic import BaseModel, Field

# What tracing an agent's workflow should look like:
class AgentTraceStep(BaseModel):
    name: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    
# What the standard output for an agent should look like:
class AgentResult(BaseModel):
    job_id: str
    workflow: str
    status: Literal["success", "failed", "partial"]
    output: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)
    trace: list[AgentTraceStep] = Field(default_factory=list)