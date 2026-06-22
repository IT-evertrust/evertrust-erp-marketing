from typing import Any

import httpx

from erp_agents.settings import settings

# The ERP machine API authenticates agents with the arsenal ingest token.
# (Matches the NestJS ArsenalTokenGuard and every n8n (PG) workflow.)
AGENT_TOKEN_HEADER = "x-arsenal-token"


# Class-based wrapper around the NestJS backend machine API. The ONLY data layer.
# Only used in live mode — the engage agents run brain-only in dry_run.
class ErpClient:
    def __init__(self) -> None:
        self.base_url = settings.erp_api_url.rstrip("/")
        self.token = settings.erp_agent_token

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers[AGENT_TOKEN_HEADER] = self.token
        return headers

    # ---- generic verbs ----
    def get(self, path: str) -> Any:
        response = httpx.get(f"{self.base_url}{path}", headers=self._headers(), timeout=30)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, payload: dict[str, Any]) -> Any:
        response = httpx.post(f"{self.base_url}{path}", headers=self._headers(), json=payload, timeout=60)
        response.raise_for_status()
        return response.json()

    def patch(self, path: str, payload: dict[str, Any]) -> Any:
        response = httpx.patch(f"{self.base_url}{path}", headers=self._headers(), json=payload, timeout=60)
        response.raise_for_status()
        return response.json()

    # ---- engage machine endpoints (used in live mode; wired with the backend phase) ----
    def get_thread(self, prospect_id: str, *, limit: int = 50) -> Any:
        """Conversation ledger for a prospect (Reply Glock + RAG grounding)."""
        return self.get(f"/outreach-messages?prospectId={prospect_id}&limit={limit}")

    def get_rag_backlog(self, *, limit: int = 50) -> Any:
        """UNSURE replies still needing a drafted answer (RAG backlog drain)."""
        return self.get(f"/reply-classifications?needsRag=true&limit={limit}")

    def post_reply_classification(self, payload: dict[str, Any]) -> Any:
        """Record a reply verdict (+ optional suggestedReply / snoozeUntil)."""
        return self.post("/reply-classifications", payload)

    def graduate_prospect(self, prospect_id: str, *, stage: str, hot_reason: str) -> Any:
        """Graduate an INTERESTED prospect into a hot lead."""
        return self.post(f"/prospects/{prospect_id}/graduate", {"stage": stage, "hotReason": hot_reason})

    def post_notification(self, payload: dict[str, Any]) -> Any:
        return self.post("/notifications", payload)
