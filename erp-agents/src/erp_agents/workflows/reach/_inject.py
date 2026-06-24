"""Inject a campaign config into MAIN's standalone Satellite / AmmoForge agents.

The standalone agents are written to FETCH their config over HTTP
(``GET /campaigns/:id/config`` via the ``ErpGateway.fetch_campaign_config`` seam)
and to WRITE their results back to the ERP (``post_prospects_bulk`` /
``post_templates`` / callbacks / notifications). The Reach flow drives them with a
``reach_aim`` id that has NO ``/campaigns/:id/config`` endpoint, so the adapters
hand the agent its config in the job ``input`` instead.

``ConfigInjectingErp`` is the drop-in for both agents' ``ErpGateway`` Protocol:

  - ``fetch_campaign_config(id)`` returns a pre-built package ``CampaignConfig``
    (mapped from the injected ``config`` dict) — NO HTTP call is made.
  - every WRITE method is a no-op returning a benign dict — this is "return only":
    the pipeline still returns leads/templates in its result dict (the adapter maps
    them back), nothing is persisted.

There is one class that satisfies BOTH Protocols (their write surfaces don't
overlap, so a single object can carry every method). The mapping from the wire
``config`` dict to each package's frozen ``CampaignConfig`` dataclass lives here so
the adapters stay thin.

Wire ``config`` shape (sent by the NestJS Reach service):

    {
      campaignId: "<reach_aim uuid>",
      name: "<aim name>",
      project: "<project or name>",
      niche: { id, name, slug, industry, targets: [ {id,name,slug,searchHint}, ... ] },
      region: "<zone: Anywhere|North|South|East|West|Border-DE>",
      country: "<e.g. Germany>"
    }
"""
from __future__ import annotations

from typing import Any


def _niche_dict(config: dict) -> dict:
    n = config.get("niche")
    return n if isinstance(n, dict) else {}


def _industry_name(niche: dict) -> str:
    raw = niche.get("industry") or niche.get("industryName") or ""
    return raw.get("name") if isinstance(raw, dict) else str(raw or "")


def satellite_config(config: dict):
    """Map the wire ``config`` dict -> ``satellite.domain.models.CampaignConfig``."""
    from satellite.domain.models import CampaignConfig  # type: ignore

    niche = _niche_dict(config)
    targets = [t for t in (niche.get("targets") or []) if isinstance(t, dict)]
    return CampaignConfig(
        campaign_id=str(config.get("campaignId") or config.get("id") or ""),
        niche=str(niche.get("name") or config.get("nicheName") or ""),
        industry=str(_industry_name(niche) or config.get("industry") or ""),
        niche_id=niche.get("id"),
        niche_slug=str(niche.get("slug") or ""),
        targets=targets,
        region=str(config.get("region") or ""),
        country=str(config.get("country") or ""),
        project=str(config.get("project") or config.get("name") or ""),
    )


def ammoforge_config(config: dict):
    """Map the wire ``config`` dict -> ``ammoforge.domain.models.CampaignConfig``."""
    from ammoforge.domain.models import CampaignConfig  # type: ignore

    niche = _niche_dict(config)
    niche_name = str(niche.get("name") or config.get("nicheName") or "")
    return CampaignConfig(
        campaign_id=str(config.get("campaignId") or config.get("id") or ""),
        name=str(config.get("name") or ""),
        niche=niche_name,
        country=str(config.get("country") or ""),
        region=str(config.get("region") or ""),
        project=str(config.get("project") or config.get("name") or ""),
        overrides={},
    )


class ConfigInjectingErp:
    """ERP gateway stand-in that serves an INJECTED config and swallows every write.

    Satisfies both ``satellite.clients.erp.ErpGateway`` and
    ``ammoforge.clients.erp.ErpGateway``: ``fetch_campaign_config`` returns the
    pre-built dataclass; all write methods are no-ops (return-only mode). The
    optional ``real`` gateway is kept only so the adapter can ``close()`` it; this
    wrapper never calls it.
    """

    def __init__(self, config_obj: Any, real: Any = None) -> None:
        self._config = config_obj
        self._real = real

    # --- read seam: serve the injected config, no HTTP -----------------------
    def fetch_campaign_config(self, campaign_id: str) -> Any:
        return self._config

    # --- write seams: NO-OPS (return-only) -----------------------------------
    # satellite gateway
    def post_prospects_bulk(self, campaign_id: str, prospects: list) -> dict:
        return {"created": 0, "updated": 0, "skipped": len(prospects or [])}

    def post_run_callback(self, campaign_id: str, metrics: dict, status: str = "SUCCESS") -> dict:
        return {"ok": True, "skipped": True}

    def trigger_niche_analytics(self, campaign_id: str) -> dict:
        return {"status": 0, "skipped": True}

    # ammoforge gateway
    def post_templates(self, campaign_id: str, templates: dict) -> dict:
        return {"ok": True, "skipped": True}

    def post_notification(
        self, ntype: str, title: str, body: str, campaign_id: str | None = None, link: str | None = None
    ) -> dict:
        return {"ok": True, "skipped": True}

    # parity with the real ErpClient so the adapter's _close() is a no-op here.
    def close(self) -> None:
        pass
