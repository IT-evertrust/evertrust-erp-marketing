"""Live per-phase progress hook: the pipeline emits (phase, current, total, label)
ticks through on_progress, and a failing sink never breaks the run. Offline (no LLM,
no network) so only the 'search' region-sweep phase fires."""
from __future__ import annotations

from satellite import pipeline
from satellite.clients.search import OfflineFetcher, OfflineSearch
from satellite.domain.models import CampaignConfig
from satellite.settings import Settings


class FakeErp:
    def fetch_campaign_config(self, campaign_id):
        return CampaignConfig(
            campaign_id=campaign_id, niche="LED Container Rental", niche_id="n1",
            targets=[{"id": "t1", "name": "LED Rental", "slug": "led"}],
            region="Berlin, Munich", country="Germany", max_leads_per_run=500,
        )

    def post_prospects_bulk(self, campaign_id, prospects):
        return {"created": len(prospects), "updated": 0}

    def post_run_callback(self, campaign_id, metrics, status="SUCCESS"):
        return {"ok": True}

    def trigger_niche_analytics(self, campaign_id):
        return {"status": 200}


def _opts():
    return pipeline.RunOptions(campaign_id="c1", live=False, persist=False, use_llm=False)


def test_pipeline_emits_search_progress():
    events: list = []
    pipeline.run(
        Settings(), _opts(), FakeErp(), OfflineSearch(), OfflineFetcher(),
        on_progress=lambda *a: events.append(a),
    )
    phases = [e[0] for e in events]
    assert "search" in phases  # the region sweep reported progress
    for phase, cur, tot, label in events:
        assert isinstance(cur, int) and isinstance(tot, int) and isinstance(label, str)
        assert phase in ("search", "scrape", "qualify", "load")


def test_progress_sink_failure_never_breaks_run():
    def boom(*_a):
        raise RuntimeError("progress sink down")

    data = pipeline.run(
        Settings(), _opts(), FakeErp(), OfflineSearch(), OfflineFetcher(), on_progress=boom,
    )
    # The run still produced a result despite every progress tick raising.
    assert isinstance(data, dict) and "status" in data
