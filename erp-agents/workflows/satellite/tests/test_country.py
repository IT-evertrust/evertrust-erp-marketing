"""Country-agnostic bits: LLM profiler degrades gracefully, geo filter keeps the target ccTLD."""
from __future__ import annotations

from satellite.clients import llm
from satellite.domain.tender import geo_relevant
from satellite.settings import Settings


def test_profile_country_no_gateway_returns_empty():
    # No LLM gateway configured -> {} (caller falls back to tables + deterministic keywords).
    assert llm.profile_country(Settings(llm_base_url=""), "Bulgaria", "Cybersecurity") == {}


def test_geo_relevant_keeps_target_country_cctld():
    # A Vietnam campaign: .vn is in the off-market list, but as the TARGET ccTLD it must be kept,
    # while another off-market ccTLD (.cn) is still dropped.
    assert geo_relevant("https://acme.vn", "Acme", "", "Vietnam", [], market_tld=".vn") is True
    assert geo_relevant("https://foo.cn", "Foo", "", "Vietnam", [], market_tld=".vn") is False
    assert geo_relevant("https://firma.de", "Firma", "", "Germany", []) is True
