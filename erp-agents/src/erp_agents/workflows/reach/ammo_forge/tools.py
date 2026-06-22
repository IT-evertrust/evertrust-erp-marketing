"""Ammo Forge deterministic helpers.

The offline_* builders produce sensible, campaign-specific scaffolding when no LLM
is reachable, so AIM always yields usable templates + a news brief. They are pure
functions of the input — no randomness — so runs are reproducible and testable.
"""

from erp_agents.workflows.reach.ammo_forge.models import (
    AmmoForgeInput,
    CampaignTemplates,
    EmailTemplate,
    NewsBrief,
)

DEFAULT_SIGNATURE = (
    "Hanna Nguyen\nEVERTRUST GmbH\nWe are at your disposal."
)


def resolve_signature(data: AmmoForgeInput) -> str:
    return (data.signature or DEFAULT_SIGNATURE).strip()


def offline_research(data: AmmoForgeInput) -> str:
    """A deterministic demand-driver brief when no search/LLM model is available."""
    segment = data.segment or "the broader market"
    return (
        f"Demand drivers for {data.niche} in {data.region}, {data.country}. "
        f"Public budgets and regulatory pressure continue to push {data.niche} "
        f"procurement, with {segment} under particular pressure to modernize. "
        f"Recent funding programs and compliance deadlines in {data.region} are "
        f"pulling forward purchasing decisions that would otherwise sit idle, which "
        f"opens a credible reason to reach out now rather than next quarter. "
        f"(Offline scaffold — connect a search-capable LLM to replace with live news.)"
    )


def offline_templates(data: AmmoForgeInput) -> CampaignTemplates:
    sig = resolve_signature(data)
    company = "{{Company Name}}"
    niche = data.niche
    region = data.region

    cold = EmailTemplate(
        subject=f"{niche} in {region} — a quick idea for {company}",
        body=(
            f"Hello {company} team,\n\n"
            f"We work with {niche} organizations across {region} and noticed timing "
            f"is unusually good right now given current funding and compliance pressure. "
            f"We help teams like yours move faster without adding overhead.\n\n"
            f"Would a short 15-minute call next week make sense to see if it's a fit?\n\n"
            f"{sig}"
        ),
    )
    follow_up = EmailTemplate(
        subject=f"Re: {niche} in {region} — following up",
        body=(
            f"Hello {company} team,\n\n"
            f"Circling back on my note. Many {niche} teams in {region} are weighing "
            f"the same decision this quarter, and I'd hate for you to miss the window.\n\n"
            f"Happy to share a one-page summary — just reply and I'll send it over.\n\n"
            f"{sig}"
        ),
    )
    final_push = EmailTemplate(
        subject=f"Last note re: {company}",
        body=(
            f"Hello {company} team,\n\n"
            f"I'll close the loop here so I'm not crowding your inbox. If {niche} is on "
            f"your roadmap for {region} this year, a quick call now saves time later.\n\n"
            f"Open to a short call? If not, no problem at all — I'll check back next season.\n\n"
            f"{sig}"
        ),
    )
    return CampaignTemplates(cold_outreach=cold, follow_up=follow_up, final_push=final_push)


def offline_news_brief(data: AmmoForgeInput, research: str | None = None) -> NewsBrief:
    return NewsBrief(
        title=f"Demand drivers: {data.niche} · {data.region}",
        body=research or offline_research(data),
    )
