"""Sweep routing — pure logic. Decides what to do with a lead given its status today.

Reads the Reply Glock status vocabulary (dual-vocab, verbatim from the n8n 'Route Leads'
node), but FIXES the two n8n bugs:
  1. The snooze date is honoured; a snooze acts only when DUE.
  2. A due snooze RE-ENGAGES the lead (status -> '') instead of deleting it — that is what
     "snooze then re-engage" means; the n8n code just deleted everything immediately.

Post-migration the snooze date is NO LONGER concatenated into the status string
('Not Interested - Snoozed2026-08-11'). The Postgres schema keeps it in the structured
column leads.snooze_until (a date); leads.status is clean text 'Not Interested - Snoozed'.
So we route on the snooze_until date passed in, never by regex-parsing the status.

Actions:
  'reengage' — snooze date has passed: reset to '' so Bazooka cold-outreaches again
  'delete'   — do-not-contact: archive then remove from the active pipeline
  'skip'     — not a sweep target, or snooze not yet due, or undated temp
"""
from __future__ import annotations

from datetime import date

# do-not-contact bucket (dual-vocab, lowercased)
DELETE_STATUSES = {"not interested - do not contact", "not interested at all"}
# snooze buckets (clean status text; snooze date lives in leads.snooze_until)
SNOOZE_STATUS_PREFIX = "not interested - snoozed"
SNOOZE_UNDATED = "not interested temp"


def route_lead(status: str, today: date, snooze_until: date | None = None) -> tuple[str, str]:
    s = (status or "").strip().lower()
    if s in DELETE_STATUSES:
        return ("delete", "do-not-contact")
    if s.startswith(SNOOZE_STATUS_PREFIX):
        if snooze_until is None:
            return ("skip", "snooze status has no snooze_until date")
        if today >= snooze_until:
            return ("reengage", f"snooze due {snooze_until.isoformat()}")
        return ("skip", f"snooze not due until {snooze_until.isoformat()}")
    if s == SNOOZE_UNDATED:
        return ("skip", "undated temp snooze — left for manual review")
    return ("skip", "not a sweep target")
