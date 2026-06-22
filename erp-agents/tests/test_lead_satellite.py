"""Lead Satellite — pure-function + offline-path regression tests (no network/LLM).

Covers the deterministic surface of the real-search engine: locale-aware query
planning, domain canonicalization/noise filtering, email extraction + ranking, and
the offline fallback (which must keep producing leads when no search is available).
"""

from erp_agents.core.job import AgentJob
from erp_agents.settings import settings
from erp_agents.workflows.reach.lead_satellite.locale import profile_for
from erp_agents.workflows.reach.lead_satellite.models import LeadSatelliteInput
from erp_agents.workflows.reach.lead_satellite.scrape import (
    extract_emails,
    find_contact_url,
)
from erp_agents.workflows.reach.lead_satellite.tools import plan_search_queries
from erp_agents.workflows.reach.lead_satellite.verify import (
    canonical_domain,
    is_noise_domain,
    rank_emails,
    valid_syntax,
)
from erp_agents.workflows.reach.lead_satellite.workflow import LeadSatelliteWorkflow


def _aim(**kw):
    base = dict(campaign_id="c", niche="LED displays", region="Bavaria", country="Germany")
    base.update(kw)
    return LeadSatelliteInput(**base)


def test_query_plan_is_locale_native():
    de = plan_search_queries(_aim(segment="stadiums"), profile_for("Germany"))
    assert any("Unternehmen" in q for q in de)  # German connective word
    assert any("site:wlw.de" in q for q in de)  # German B2B directory
    fr = plan_search_queries(_aim(niche="panneaux LED", region="Lyon", country="France"),
                             profile_for("France"))
    assert any("entreprises" in q for q in fr)
    assert any("pagesjaunes.fr" in q for q in fr)


def test_query_plan_dedups():
    qs = plan_search_queries(_aim(), profile_for("Germany"))
    assert len(qs) == len({q.lower() for q in qs})


def test_canonical_domain_and_noise():
    assert canonical_domain("https://www.Rhein-LED.de/kontakt?x=1") == "rhein-led.de"
    assert canonical_domain("not a url") is None
    assert is_noise_domain("facebook.com") is True
    assert is_noise_domain("m.linkedin.com") is True
    assert is_noise_domain("rhein-led.de") is False


def test_email_extraction_deobfuscates_and_filters():
    html = ('<a href="mailto:Vertrieb@Rhein-LED.de">x</a> '
            'info [at] rhein-led [dot] de and logo@x.png and example@y.de')
    emails = extract_emails(html)
    assert "vertrieb@rhein-led.de" in emails
    assert "info@rhein-led.de" in emails
    assert all(not e.endswith(".png") for e in emails)
    assert "example@y.de" not in emails  # placeholder filtered


def test_email_ranking_prefers_named_on_domain():
    ranked = rank_emails(["info@rhein-led.de", "max.muster@rhein-led.de", "x@gmail.com"],
                         "rhein-led.de")
    assert ranked[0] == "max.muster@rhein-led.de"
    assert ranked[-1] == "x@gmail.com"


def test_contact_link_discovery():
    url = find_contact_url('<a href="/impressum">Impressum</a><a href="/x">x</a>',
                           "https://rhein-led.de", profile_for("Germany"))
    assert url == "https://rhein-led.de/impressum"


def test_syntax_validation():
    assert valid_syntax("a@b.de") is True
    assert valid_syntax("not-an-email") is False


def test_offline_fallback_still_produces_leads(monkeypatch):
    # Force no usable search provider -> deterministic offline path.
    monkeypatch.setattr(settings, "search_provider", "serper")
    monkeypatch.setattr(settings, "search_api_key", None)
    wf = LeadSatelliteWorkflow(llm=None)
    res = wf.run(AgentJob(job_id="j", workflow="reach.lead_satellite",
                          input=_aim(max_leads=8).model_dump()))
    assert res.status == "success"
    assert res.metrics["path"] == "offline"
    assert len(res.output["leads"]) == 8
    assert res.output["leads"][0]["email"]
