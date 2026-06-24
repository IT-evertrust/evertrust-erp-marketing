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


def test_rejects_non_iso_counter_time():
    # The LLM must emit an ISO-8601 instant; free text ("sometime Friday") is dropped so
    # the resolver never materialises a junk meeting from an unparseable string.
    v = parse_scheduling({"accepted_index": None, "counter_time": "sometime Friday"}, [])
    assert v.counter_time is None


def test_keeps_iso_counter_time_with_offset():
    v = parse_scheduling({"accepted_index": None, "counter_time": "2026-06-26T10:00:00+02:00"}, [])
    assert v.counter_time == "2026-06-26T10:00:00+02:00"
