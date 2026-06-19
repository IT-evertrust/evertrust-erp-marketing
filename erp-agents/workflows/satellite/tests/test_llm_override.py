"""Per-org LLM override: the ERP dispatch (AI Engine page) can point the agent at a
different gateway/model per request, falling back to the agent's env default when a
field is omitted (request value ?? env)."""
from __future__ import annotations

from satellite.settings import Settings, with_llm_override


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
