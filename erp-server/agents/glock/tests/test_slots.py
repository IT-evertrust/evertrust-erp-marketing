from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from glock.domain.slots import find_free_slots, is_window_free, make_slot

TZ = ZoneInfo("Europe/Berlin")
# Friday 2026-06-12 10:00
NOW = datetime(2026, 6, 12, 10, 0, tzinfo=TZ)


def test_proposes_two_slots_on_open_calendar():
    free = find_free_slots([], NOW, count=2)
    assert len(free) == 2
    # first slot is the next weekday (Mon 15th, since Sat/Sun skipped) at 09:00
    assert free[0].start.weekday() == 0 and free[0].start.hour == 9


def test_skips_weekend():
    free = find_free_slots([], NOW, count=20)
    assert all(s.start.weekday() < 5 for s in free)


def test_business_hours_only():
    free = find_free_slots([], NOW, count=50)
    assert all(9 <= s.start.hour < 17 for s in free)


def test_busy_window_blocks_slot():
    mon9 = (NOW + timedelta(days=3)).replace(hour=9, minute=0, second=0, microsecond=0)
    busy = [(mon9, mon9 + timedelta(minutes=30))]
    free = find_free_slots(busy, NOW, count=1)
    assert free[0].start != mon9   # 09:00 blocked, first free is 09:30


def test_is_window_free():
    mon = (NOW + timedelta(days=3)).replace(hour=14, minute=0)
    busy = [(mon, mon + timedelta(hours=1))]
    assert not is_window_free(mon, mon + timedelta(minutes=30), busy)
    free_at = mon.replace(hour=16)
    assert is_window_free(free_at, free_at + timedelta(minutes=30), busy)


def test_cest_label_fixed():
    # June is CEST (+02:00); the n8n bug labeled it CET
    s = make_slot(NOW.replace(hour=11), NOW.replace(hour=11, minute=30))
    assert "CEST" in s.human
