
from pydantic import BaseModel, Field

class LeadSatelliteInput(BaseModel):
    aim_id: str
    aim: str
    niche: str
    region: str
    segment: str | None = None
    source: str | None = None
    max_leads: int = 25
    
class leadCandidate(BaseModel):
    company: str
    website: str | None = None
    contact_name: str | None = None
    contact_title: str | None = None
    email: str | None = None
    phone: str | None = None
    localtion: str | None = None
    source: str | None = None
    qualification_reason: str
    confidence: float = Field(ge=0, le=1)

class LeadSatelliteOutput(BaseModel):
    search_strategy: list[str]
    lead_candidates: list[LeadCandidate]
    notes: list[str] = []