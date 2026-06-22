"""INJECTED-config / return-only mode (the Reach flow).

The Reach flow drives AmmoForge with a reach_aim id that has NO GET /campaigns/:id/config
endpoint, so the config is INJECTED via the ERP gateway seam and the run is RETURN-ONLY:
no /campaigns/:id/config fetch over HTTP, no template/notification writes. This mirrors the
monolith's ConfigInjectingErp: fetch_campaign_config serves a pre-built CampaignConfig and
every write method is a no-op. country + region (a zone like "North") are just copy context
for AmmoForge — no geo resolution here.
"""
from __future__ import annotations

from ammoforge.domain.models import CampaignConfig
from ammoforge.pipeline import RunOptions, run as ammoforge_run
from ammoforge.settings import Settings


class InjectingErp:
    """Serves an injected CampaignConfig; every write is a no-op (return-only)."""

    def __init__(self, cfg: CampaignConfig) -> None:
        self._cfg = cfg
        self.posted: list = []
        self.notifications: list = []

    def fetch_campaign_config(self, campaign_id):
        # INJECTED: return the pre-built config, NO network / no /campaigns/:id/config call.
        return self._cfg

    def post_templates(self, campaign_id, templates):
        self.posted.append((campaign_id, templates))
        return {"ok": True, "skipped": True}

    def post_notification(self, ntype, title, body, campaign_id=None, link=None):
        self.notifications.append(ntype)
        return {"ok": True, "skipped": True}


def _injected_cfg() -> CampaignConfig:
    # Built from the wire `config` dict the NestJS Reach service sends (mapped to the dataclass).
    return CampaignConfig(
        campaign_id="aim-uuid-1",
        name="Reach AIM",
        niche="LED Container Rental",
        country="Germany",
        region="North",      # a ZONE word — copy context only for the forge
        project="Reach AIM",
        overrides={},
    )


def test_injected_return_only_no_fetch_no_writes():
    cfg = _injected_cfg()
    erp = InjectingErp(cfg)
    opts = RunOptions(campaign_id=cfg.campaign_id, live=False, persist=False, use_llm=False)
    result = ammoforge_run(Settings(llm_base_url=""), opts, erp)

    # (a) config was injected, not fetched over /campaigns/:id/config
    assert result["status"] == "ok"
    assert result["name"] == "Reach AIM"
    assert result["niche"] == "LED Container Rental"
    # (b) templates returned in the result dict (offline forge: tagged 3-block coldEmail + newsBrief)
    cold = result["templates"]["coldEmail"]
    assert "[COLD]" in cold and "[FOLLOWUP]" in cold and "[FINALPUSH]" in cold
    assert result["templates"]["newsBrief"]
    # (c) return-only: nothing posted, nothing notified
    assert result["posted"] is False
    assert result["notified"] is False
    assert erp.posted == []
    assert erp.notifications == []
