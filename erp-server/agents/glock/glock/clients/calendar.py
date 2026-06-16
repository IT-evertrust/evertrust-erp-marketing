"""Google Calendar — free/busy lookup (external-party filtered) + meeting creation.

The 'only external-party events block a slot' rule (verbatim) lives here, since it needs
the raw attendee/organizer data. Returns plain (start, end) busy tuples that the pure
slots.py consumes.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
INTERNAL_DOMAINS = ("evertrust-germany.de", "evertrust.de")
SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _service(settings):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    from pathlib import Path
    token_file = Path(settings.gmail_token_dir) / "calendar.json"
    if not token_file.exists():
        # RuntimeError (not SystemExit) so the pipeline's `except Exception` catches it
        # and degrades to busy=[] instead of aborting the whole run.
        raise RuntimeError("No calendar token. Run the calendar consent flow first.")
    creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _domain(email: str) -> str:
    return email.split("@")[-1].lower() if "@" in email else ""


def _has_external_party(event: dict) -> bool:
    emails = [a.get("email", "") for a in event.get("attendees", [])]
    emails.append(event.get("organizer", {}).get("email", ""))
    emails.append(event.get("creator", {}).get("email", ""))
    return any(d and d not in INTERNAL_DOMAINS for d in (_domain(e) for e in emails))


def busy_windows(settings, now: datetime, days_ahead: int) -> list[tuple[datetime, datetime]]:
    """Fetch events in the proposal window, keep only external-party ones as busy."""
    service = _service(settings)
    time_min = (now.astimezone(TZ) + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    time_max = (time_min + timedelta(days=days_ahead)).replace(hour=23, minute=59)
    events = service.events().list(
        calendarId=settings.sales_calendar_id, timeMin=time_min.isoformat(),
        timeMax=time_max.isoformat(), singleEvents=True, orderBy="startTime",
    ).execute().get("items", [])

    busy: list[tuple[datetime, datetime]] = []
    for ev in events:
        if ev.get("status") == "cancelled" or ev.get("transparency") == "transparent":
            continue
        if not _has_external_party(ev):
            continue
        start = ev.get("start", {}).get("dateTime")
        end = ev.get("end", {}).get("dateTime")
        if start and end:
            busy.append((datetime.fromisoformat(start).astimezone(TZ),
                         datetime.fromisoformat(end).astimezone(TZ)))
    return busy


def create_meeting(
    settings, company_name: str, project: str, attendee_email: str,
    start: datetime, end: datetime,
) -> str:
    """Create the event with an auto Google Meet link. Returns the hangout link (or '')."""
    service = _service(settings)
    event = service.events().insert(
        calendarId=settings.sales_calendar_id, sendUpdates="all", conferenceDataVersion=1,
        body={
            "summary": f"Evertrust GmbH × {company_name} — Intro Call",
            "description": f"Intro call regarding {project}.",
            "start": {"dateTime": start.isoformat(), "timeZone": "Europe/Berlin"},
            "end": {"dateTime": end.isoformat(), "timeZone": "Europe/Berlin"},
            "attendees": [{"email": attendee_email}, {"email": settings.sales_calendar_id}],
            "guestsCanInviteOthers": False,
            "conferenceData": {"createRequest": {"requestId": f"glock-{start.timestamp()}"}},
        },
    ).execute()
    return event.get("hangoutLink", "")
