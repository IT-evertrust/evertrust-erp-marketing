from erp_agents.workflows.engage.reply_glock.models import parse_scheduling


def test_accepts_offered_slot():
    v = parse_scheduling({"accepted_index": 0, "counter_time": None}, [{"start": "x", "end": "y"}])
    assert v.accepted_index == 0 and v.counter_time is None


def test_clamps_out_of_range_index():
    v = parse_scheduling({"accepted_index": 5, "counter_time": None}, [{"start": "x", "end": "y"}])
    assert v.accepted_index is None


def test_counter_time():
    v = parse_scheduling({"accepted_index": None, "counter_time": "2026-06-25T15:00:00Z"}, [])
    assert v.counter_time == "2026-06-25T15:00:00Z" and v.accepted_index is None
