from typing import Any

from googleapiclient.discovery import build

from erp_agents.clients.google_auth import build_google_credentials
from erp_agents.settings import settings

CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
]


class GoogleCalendarClient:
    def __init__(self) -> None:
        credentials = build_google_credentials(CALENDAR_SCOPES)
        self.service = build("calendar", "v3", credentials=credentials)
        self.calendar_id = settings.google_calendar_id

    # Getting all calendar events in a window:
    def list_events(
        self,
        *,
        time_min: str,
        time_max: str,
        max_results: int = 50,
    ) -> list[dict[str, Any]]:
        response = (
            self.service.events()
            .list(
                calendarId=self.calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        return response.get("items", [])

    # Creating a calendar event:
    def create_event(
        self,
        *,
        summary: str,
        start_datetime: str,
        end_datetime: str,
        timezone: str = "Europe/Berlin",
        attendees: list[str] | None = None,
        description: str | None = None,
        location: str | None = None,
    ) -> dict[str, Any]:
        event = {
            "summary": summary,
            "description": description,
            "location": location,
            "start": {"dateTime": start_datetime, "timeZone": timezone},
            "end": {"dateTime": end_datetime, "timeZone": timezone},
            "attendees": [{"email": email} for email in attendees or []],
        }
        return (
            self.service.events()
            .insert(calendarId=self.calendar_id, body=event)
            .execute()
        )
