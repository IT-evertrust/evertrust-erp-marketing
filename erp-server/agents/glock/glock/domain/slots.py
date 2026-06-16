"""Free-slot computation — pure port of 'Code — Propose 2 Slots' / 'Code — Resolve
Proposed Slot'. Takes a list of BUSY intervals (already filtered to external-party
events by the calendar client) and returns free slots.

Window: next N weekdays, business hours, fixed-length slots. A slot is free if it
overlaps no busy interval. The CET/CEST label bug from n8n is fixed here (offset +120
min = CEST).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .models import Slot

TZ = ZoneInfo("Europe/Berlin")


def _human(dt: datetime) -> str:
    label = "CEST" if dt.utcoffset() == timedelta(minutes=120) else "CET"
    return dt.strftime("%a, %d %b %Y at %H:%M") + " " + label


def overlaps(start: datetime, end: datetime, busy: list[tuple[datetime, datetime]]) -> bool:
    return any(not (end <= bs or start >= be) for bs, be in busy)


def find_free_slots(
    busy: list[tuple[datetime, datetime]],
    now: datetime,
    *,
    days_ahead: int = 14,
    start_hour: int = 9,
    end_hour: int = 17,
    slot_minutes: int = 30,
    count: int = 2,
) -> list[Slot]:
    """Propose up to `count` free slots. Starts from tomorrow, weekdays only."""
    now = now.astimezone(TZ)
    day0 = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    out: list[Slot] = []
    for d in range(days_ahead):
        day = day0 + timedelta(days=d)
        if day.weekday() >= 5:  # 5,6 = Sat,Sun
            continue
        t = day.replace(hour=start_hour)
        end_of_day = day.replace(hour=end_hour)
        while t + timedelta(minutes=slot_minutes) <= end_of_day:
            s_end = t + timedelta(minutes=slot_minutes)
            if not overlaps(t, s_end, busy):
                out.append(Slot(start=t, end=s_end, human=_human(t)))
                if len(out) >= count:
                    return out
            t = s_end
    return out


def is_window_free(
    start: datetime, end: datetime, busy: list[tuple[datetime, datetime]]
) -> bool:
    """Used by the direct-time path when the lead named a specific moment."""
    return not overlaps(start.astimezone(TZ), end.astimezone(TZ), busy)


def make_slot(start: datetime, end: datetime) -> Slot:
    s = start.astimezone(TZ)
    return Slot(start=s, end=end.astimezone(TZ), human=_human(s))
