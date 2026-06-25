"""Patch coverage: SearXNG-first (DDG gated), evidence-based email + provenance, the CLI --live
persist fix, and the COUNTRY-AGNOSTIC profiler (regions+cities for ANY country, no hardcoding).
Pure-logic + fakes, no network."""
from __future__ import annotations

from satellite.clients.search import WebSearch
from satellite.domain.models import Lead
from satellite.domain.scrape import scrape_one


# --- SearXNG-first: DDG only as an opt-in / last-resort fallback ----------------

class _Searx:
    def __init__(self, hits): self._hits = hits

    def query(self, q, pageno=1, language=""): return self._hits

    def close(self): pass


def test_ddg_disabled_when_searxng_present(monkeypatch):
    ws = WebSearch(searxng_url="http://searx", enable_ddg=False)
    assert ws._ddg is None                              # no DDG built -> can't sneak in
    monkeypatch.setattr(ws, "_searx", _Searx([{"title": "A", "url": "https://a.de/", "content": "x"}]))
    assert ws.query("q")[0]["url"] == "https://a.de/"


def test_ddg_kept_as_last_resort_without_searxng():
    ws = WebSearch(searxng_url="", enable_ddg=False)
    assert ws._ddg is not None                          # no SearXNG -> DDG is the keyless engine


def test_ddg_optional_when_explicitly_enabled():
    ws = WebSearch(searxng_url="http://searx", enable_ddg=True)
    assert ws._ddg is not None


# --- SearXNG engines pinned (fixes the disabled-google / junk-default-mix discovery) ---

class _RecordingHttp:
    def __init__(self): self.params = None

    def get(self, url, params=None):
        self.params = params
        return type("R", (), {"raise_for_status": lambda self: None,
                              "json": lambda self: {"results": []}})()

    def close(self): pass


def test_searxng_pins_engines_in_request():
    from satellite.clients.search import SearxngClient
    c = SearxngClient("http://searx", engines="google,bing,brave")
    c._http = _RecordingHttp()
    c.query("widgets", language="pl")
    assert c._http.params["engines"] == "google,bing,brave"   # pinned engines sent
    assert c._http.params["q"] == "widgets" and c._http.params["language"] == "pl"


def test_searxng_omits_engines_when_unset():
    from satellite.clients.search import SearxngClient
    c = SearxngClient("http://searx")          # default: no engines -> instance default
    c._http = _RecordingHttp()
    c.query("widgets")
    assert "engines" not in c._http.params


def test_websearch_threads_engines_to_searxng():
    ws = WebSearch(searxng_url="http://searx", engines="google,bing")
    assert ws._searx._engines == "google,bing"


# --- crawler: source_url first + email provenance ------------------------------

class _Fetcher:
    def __init__(self, pages): self.pages = pages; self.order = []

    def get(self, url):
        self.order.append(url)
        return self.pages.get(url, "")


def test_scrape_prefers_source_url_and_records_evidence():
    lead = Lead(name="ACME", website="https://acme.de", source_url="https://acme.de/kontakt")
    f = _Fetcher({"https://acme.de/kontakt": "mailto:info@acme.de"})
    assert scrape_one(f, lead) is True
    assert lead.email == "info@acme.de"
    assert f.order[0] == "https://acme.de/kontakt"      # source_url crawled FIRST
    assert lead.email_source_url == "https://acme.de/kontakt"
    assert lead.email_source_type == "search-page"
    assert lead.email_confidence >= 0.9                 # on-domain -> high confidence


def test_scrape_falls_back_to_homepage_then_paths():
    lead = Lead(name="Beta", website="https://beta.example", source_url="https://beta.example/")
    f = _Fetcher({"https://beta.example/kapcsolat": "office@beta.example"})  # multilingual contact path
    assert scrape_one(f, lead) is True
    assert lead.email == "office@beta.example"
    assert lead.email_source_url.endswith("/kapcsolat")
    assert lead.email_source_type == "contact-page"


# --- CLI --live persist bugfix + --live/--no-llm guard -------------------------

def test_cli_live_maps_persist(monkeypatch):
    from satellite import cli
    captured = {}
    monkeypatch.setattr(cli, "run", lambda s, o, e, se, f: captured.setdefault("opts", o) and None or {"status": "ok"})
    assert cli.main(["--campaign-id", "c1", "--live"]) == 0
    assert captured["opts"].live is True and captured["opts"].persist is True


def test_cli_dry_does_not_persist(monkeypatch):
    from satellite import cli
    captured = {}
    monkeypatch.setattr(cli, "run", lambda s, o, e, se, f: captured.setdefault("opts", o) and None or {"status": "ok"})
    assert cli.main(["--campaign-id", "c1"]) == 0
    assert captured["opts"].live is False and captured["opts"].persist is False


def test_cli_live_no_llm_rejected():
    import pytest
    from satellite import cli
    with pytest.raises(SystemExit):
        cli.main(["--campaign-id", "c1", "--live", "--no-llm"])


# --- country-agnostic profiler: regions+cities for ANY country (no hardcoding) --

def test_profile_country_parses_regions_for_any_country(monkeypatch):
    from satellite.clients import llm
    from satellite.settings import Settings

    # A FICTIONAL country (Narnia) proves nothing is hardcoded — every field comes from the model.
    # profile_country now asks in small ROUNDS, so the fake answers the right shape per round.
    def _for(prompt):
        if "ISO 3166" in prompt:
            return '{"iso2":"NA","language":"Narnian","langCode":"na"}'
        if "keywordsLocal" in prompt:
            return '{"keywordsLocal":["alfa","beta"],"keywordsEnglish":["widgets","gadgets"]}'
        if "FIRST-LEVEL administrative regions" in prompt:
            return '{"regions":["Northshire","Southshire"]}'
        if "largest cities" in prompt:
            return '{"Northshire":["Aslan City","Cair Paravel"],"Southshire":["Archenland"]}'
        return "{}"

    class _Completions:
        def create(self, **k):
            content = _for(k["messages"][-1]["content"])
            msg = type("M", (), {"content": content})()
            return type("R", (), {"choices": [type("C", (), {"message": msg})()]})()

    class FakeOpenAI:
        def __init__(self, **k):
            self.chat = type("Chat", (), {"completions": _Completions()})()

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)
    out = llm.profile_country(Settings(llm_base_url="http://gw", profile_model="qwen3"), "Narnia", "widgets")

    assert out["iso2"] == "NA" and out["langCode"] == "na"                       # round 1
    assert [r["name"] for r in out["regions"]] == ["Northshire", "Southshire"]   # round 3 (model-driven)
    assert "Aslan City" in out["cities"] and "Archenland" in out["cities"]       # round 4 cities
    assert "alfa" in out["keywordsLocal"] and "widgets" in out["keywordsEnglish"]  # round 2


def test_profile_country_empty_without_gateway():
    from satellite.clients import llm
    from satellite.settings import Settings
    assert llm.profile_country(Settings(llm_base_url=""), "Anyland", "widgets") == {}


# --- (A) multilingual noise filter (news/courses/gov/edu/associations, any language) ----------

def test_niche_block_multilingual_noise():
    from satellite.domain.filters import is_blocked
    # Slovak news / courses / gov / education / association surfaced by the AI-Platform test = noise
    assert is_blocked("Najnovšie správy https://bratislavskenoviny.sk")       # noviny
    assert is_blocked("Balík AI kurzov https://kurzy.sk")                      # kurzy / kurzov
    assert is_blocked("Školenia a vzdelávanie https://skolenia.sk")           # školenia / vzdeláv
    assert is_blocked("AI vo vzdelávaní https://ai.iedu.sk")                   # edu.
    assert is_blocked("Ministerstvo https://mirri.gov.sk")                     # gov.
    assert is_blocked("Digitálna koalícia https://digitalnakoalicia.sk")      # koalíci
    assert is_blocked("Aktuality https://zive.aktuality.sk")                   # aktuality.
    # a real software vendor must NOT be blocked, and the PL regression guard still holds
    assert not is_blocked("AI platform & MLOps for enterprises https://sk-ai-vendor.sk")
    assert not is_blocked("Penetration Testing | stmcyber.pl Warszawa")


# --- tier C quality floor: keep B and above, drop C ----------------------------

def test_rank_label_has_tier_c_below_floor():
    from satellite.domain.tender import rank_label
    assert rank_label(80) == "AAA"
    assert rank_label(60) == "A"
    assert rank_label(45) == "B"
    assert rank_label(39) == "C"            # below default floor 40 -> noise
    assert rank_label(20) == "C"
    assert rank_label(39, min_b=35) == "B"  # floor is configurable


def test_route_dispatch_is_async_by_default():
    # The ERP fires /satellite/run with no `wait` -> must return 2xx + {status:dispatched} FAST
    # (the real work happens in the background so the ERP's 120s POST doesn't time out).
    from fastapi.testclient import TestClient

    from satellite import server
    from satellite.clients.search import OfflineFetcher, OfflineSearch
    from satellite.domain.models import CampaignConfig

    class FakeErp:
        def fetch_campaign_config(self, cid):
            return CampaignConfig(campaign_id=cid, niche="LED", targets=[{"id": "t", "name": "LED"}],
                                  region="Berlin", country="Germany")
        def post_prospects_bulk(self, *a, **k): return {"created": 0, "updated": 0}
        def post_run_callback(self, *a, **k): return {}
        def trigger_niche_analytics(self, *a, **k): return {}

    server.app.dependency_overrides[server.get_erp] = lambda: FakeErp()
    server.app.dependency_overrides[server.get_search] = lambda: OfflineSearch()
    server.app.dependency_overrides[server.get_fetcher] = lambda: OfflineFetcher()
    try:
        r = TestClient(server.app).post("/satellite/run", json={"campaignId": "c1", "useLlm": False})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "dispatched" and body["campaignId"] == "c1"
    finally:
        server.app.dependency_overrides.clear()


def test_pipeline_drops_tier_c(monkeypatch):
    # A low-score lead is tier C and must NOT appear in the returned prospects.
    from satellite import server
    from satellite.clients.search import OfflineFetcher
    from satellite.domain.models import CampaignConfig, Lead

    class FakeErp:
        def fetch_campaign_config(self, cid):
            return CampaignConfig(campaign_id=cid, niche="Widgets", targets=[{"id": "t", "name": "Widgets"}],
                                  region="Berlin", country="Germany", max_leads_per_run=500)
        def post_prospects_bulk(self, *a, **k): return {"created": 0, "updated": 0}
        def post_run_callback(self, *a, **k): return {}
        def trigger_niche_analytics(self, *a, **k): return {}

    class JunkSearch:
        offline = False
        def query(self, q):
            # one on-niche vendor on a .de domain (high score -> kept) + one on-niche-but-junk page
            # on a neutral .com with no email (low score -> tier C -> dropped)
            return [
                {"title": "Widgets GmbH Berlin", "url": "https://widgets-berlin.de/", "content": "widgets manufacturer"},
                {"title": "Widgets discussion thread", "url": "https://bigcorp.com/threads/widgets", "content": "about widgets"},
            ]
        def query_paged(self, q, pages=1, language=""): return self.query(q)

    server.app.dependency_overrides[server.get_erp] = lambda: FakeErp()
    server.app.dependency_overrides[server.get_search] = lambda: JunkSearch()
    server.app.dependency_overrides[server.get_fetcher] = lambda: OfflineFetcher()
    try:
        from fastapi.testclient import TestClient
        data = TestClient(server.app).post("/satellite/run", json={"campaignId": "c", "useLlm": False, "wait": True}).json()
        tiers = [p["tier"] for p in data.get("leads", [])]
        assert "C" not in tiers                 # tier C dropped
        assert data.get("droppedTierC", 0) >= 1  # the junk .com was dropped
    finally:
        server.app.dependency_overrides.clear()
