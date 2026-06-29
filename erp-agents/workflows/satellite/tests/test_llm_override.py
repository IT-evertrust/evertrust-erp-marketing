"""Per-org LLM override: the ERP dispatch (AI Engine page) can point the agent at a
different gateway/model per request, falling back to the agent's env default when a
field is omitted (request value ?? env)."""
from __future__ import annotations

from satellite.settings import Settings, with_llm_override, with_scraper_override


def test_scraper_override_applies_and_falls_back():
    s = Settings()  # env defaults: lead_target=100, max_queries=240, min_keep_score=40
    out = with_scraper_override(s, lead_target=20, max_queries=40, min_score=55)
    assert out.lead_target == 20 and out.max_queries == 40 and out.min_keep_score == 55
    # omitted fields keep the agent's env default (request value ?? env)
    out2 = with_scraper_override(s, lead_target=15)
    assert out2.lead_target == 15
    assert out2.max_queries == s.max_queries and out2.min_keep_score == s.min_keep_score
    # no overrides → same object
    assert with_scraper_override(s) is s
    # 0 is a real value (min_score=0), not treated as "unset"
    assert with_scraper_override(s, min_score=0).min_keep_score == 0


def test_scraper_override_scrape_timeout_minutes_to_seconds():
    s = Settings()
    # SCRAPE TIMEOUT knob is in MINUTES on the Config page; stored as seconds internally.
    assert with_scraper_override(s, scrape_timeout_min=30).max_runtime_sec == 1800
    assert with_scraper_override(s, scrape_timeout_min=0).max_runtime_sec == 0   # 0 = no cap
    assert with_scraper_override(s).max_runtime_sec == s.max_runtime_sec          # omitted = env default


def test_override_applies_all_fields():
    s = Settings()  # env defaults (hermes, sk-anything)
    out = with_llm_override(
        s, base_url="https://gw.example/v1", model="llama-3", api_key="sk-org"
    )
    assert out.llm_base_url == "https://gw.example/v1"
    assert out.llm_api_key == "sk-org"
    # one model maps to every per-step model field
    assert out.lead_model == "llama-3"
    assert out.email_model == "llama-3"
    assert out.buzzword_model == "llama-3"


def test_override_falls_back_to_env_when_omitted():
    s = Settings(llm_base_url="http://env-gw/v1", lead_model="hermes")
    # empty/None fields keep the agent's env values (request value ?? env)
    out = with_llm_override(s, base_url=None, model=None, api_key=None)
    assert out.llm_base_url == "http://env-gw/v1"
    assert out.lead_model == "hermes"
    # partial override: only the model changes
    out2 = with_llm_override(s, model="phi-3")
    assert out2.llm_base_url == "http://env-gw/v1"  # unchanged
    assert out2.lead_model == "phi-3"


def test_override_is_immutable_and_noop_when_empty():
    s = Settings()
    assert with_llm_override(s) is s  # no changes → same object
