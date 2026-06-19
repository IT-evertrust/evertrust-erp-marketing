"""Pure logic ports from the LEAD SATELLITE (PG) JS nodes."""
from __future__ import annotations

from satellite.domain.models import (
    CampaignConfig,
    Lead,
    build_segments,
    decode_cf_email,
    dedup_leads,
    email_status,
    extract_emails_from_html,
    leads_to_prospects,
    norm_city,
)


def test_norm_city_folds_diacritics():
    assert norm_city("Stróże") == "stroze"
    assert norm_city("Wrocław") == "wroclaw"
    assert norm_city("München ") == "munchen"


def test_email_status():
    assert email_status("info@acme.de") == ("info@acme.de", "")
    assert email_status("[email protected]") == ("", "PROTECTED")
    assert email_status("") == ("", "NO_EMAIL")


def _cf_encode(email: str, key: int = 0x42) -> str:
    out = format(key, "02x")
    for ch in email:
        out += format(ord(ch) ^ key, "02x")
    return out


def test_cloudflare_decode_roundtrip():
    assert decode_cf_email(_cf_encode("info@acme.de")) == "info@acme.de"
    assert decode_cf_email("zz") == ""


def test_extract_emails_from_html():
    html = f'<a class="__cf_email__" data-cfemail="{_cf_encode("kontakt@firma.de")}">x</a>'
    assert extract_emails_from_html(html, "firma.de") == "kontakt@firma.de"
    assert extract_emails_from_html('<a href="mailto:sales@x.de">m</a>', "x.de") == "sales@x.de"
    assert extract_emails_from_html("no emails here", "x.de") == ""


def test_build_segments_caps_and_fanout():
    cfg = CampaignConfig(
        campaign_id="c1", niche="LED", region="Berlin, Munich", country="Germany",
        targets=[{"id": "t1", "name": "LED Rental", "slug": "led"}],
    )
    segs = build_segments(cfg)
    # 1 target x 2 cities x 4 foci (<=2 cities -> segPerCity 4)
    assert len(segs) == 8
    assert {s.city for s in segs} == {"Berlin", "Munich"}
    assert all(s.niche_target_id == "t1" for s in segs)


def test_build_segments_empty_without_targets_or_cities():
    assert build_segments(CampaignConfig(campaign_id="c1", niche="LED", region="")) == []


def test_dedup_and_prospects():
    leads = [
        Lead(name="Acme", website="https://acme.de", email="info@acme.de", city="Berlin", country="DE"),
        Lead(name="Acme Dup", website="https://www.acme.de/contact", email="x@acme.de"),
        Lead(name="NoEmail", website="https://b.de", email="", status="NO_EMAIL"),
    ]
    deduped = dedup_leads(leads)
    assert len(deduped) == 2  # acme.de collapsed
    prospects = leads_to_prospects(deduped)
    assert prospects[0]["emailVerified"] is True
    assert prospects[1]["emailVerified"] is False and prospects[1]["email"] == ""


def test_build_segments_uses_explicit_cities():
    # build_segments works off the cities it's given (the pipeline passes an explicit list).
    cfg = CampaignConfig(
        campaign_id="c1", niche="LED", region="Berlin, München, Köln", country="Germany",
        targets=[{"id": "t1", "name": "LED Rental", "slug": "led"}],
    )
    segs = build_segments(cfg)
    cities = {s.city for s in segs}
    assert len(segs) > 0 and cities == {"Berlin", "München", "Köln"}


def test_build_segments_nationwide_defers_to_profiler():
    # "Anywhere" -> geo.cities_for returns [] (no hardcoded table) -> no segments here; the pipeline
    # supplies the real cities from the LLM profiler instead.
    cfg = CampaignConfig(
        campaign_id="c1", niche="LED", region="Anywhere", country="Germany",
        targets=[{"id": "t1", "name": "LED Rental", "slug": "led"}],
    )
    assert build_segments(cfg) == []


def test_is_bad_email_placeholders():
    from satellite.domain.models import is_bad_email

    assert is_bad_email("adres@email.com")
    assert is_bad_email("your@domain.com")
    assert not is_bad_email("kontakt@firma.de")
    assert not is_bad_email("info@nflo.pl")


def test_prospect_carries_tier():
    # Tiers AAA / A / B / C. C = below the keep floor (default 40 = noise, dropped by the pipeline).
    assert leads_to_prospects([Lead(name="X", website="https://x.de", email="i@x.de", score=80)])[0]["tier"] == "AAA"
    assert leads_to_prospects([Lead(name="Y", website="https://y.de", email="i@y.de", score=60)])[0]["tier"] == "A"
    assert leads_to_prospects([Lead(name="W", website="https://w.de", score=45)])[0]["tier"] == "B"
    assert leads_to_prospects([Lead(name="Z", website="https://z.de", score=30)])[0]["tier"] == "C"
