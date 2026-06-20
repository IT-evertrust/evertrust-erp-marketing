from pydantic import BaseModel, Field


# Shared, cross-workflow models. Workflow-specific shapes live in each workflow's models.py.
class Evidence(BaseModel):
    url: str
    text: str
    confidence: float = Field(default=1.0, ge=0, le=1)


class ContactPoint(BaseModel):
    name: str | None = None
    title: str | None = None
    email: str | None = None
    phone: str | None = None


class CompanyProfile(BaseModel):
    name: str
    website: str | None = None
    country: str | None = None
    city: str | None = None
    industry: str | None = None
