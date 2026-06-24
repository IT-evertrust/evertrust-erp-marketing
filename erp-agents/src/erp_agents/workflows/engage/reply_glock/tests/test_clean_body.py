from erp_agents.workflows.engage.reply_glock.tools import clean_email_body


def test_strips_vietnamese_gmail_quote_footer():
    """A Gmail quote footer in Vietnamese ("Vào ... đã viết:") carries the timestamp of
    OUR original mail ("vào lúc 00:20"). Left in, the scheduler parsed that 00:20 instead
    of the client's actual request. The cleaner must strip it (no preceding signature
    here, so only the quote pattern can do it)."""
    body = (
        "Hi EVERTRUST team,\r\n\r\n"
        "Friday this week at 10:00 CET would work well for us for a quick 15-minute call.\r\n\r\n"
        "Vào Thứ 5, 25 thg 6, 2026 vào lúc 00:20 <hanna@evertrust-germany.de> đã viết:\r\n"
        "> Hi Ryug, here is our intro...\r\n"
    )
    cleaned, meta = clean_email_body(body)
    assert meta["removed_quoted_text"] is True
    assert "đã viết" not in cleaned
    assert "00:20" not in cleaned  # the quoted timestamp that polluted the parse
    assert "10:00 CET" in cleaned  # the real request is preserved
