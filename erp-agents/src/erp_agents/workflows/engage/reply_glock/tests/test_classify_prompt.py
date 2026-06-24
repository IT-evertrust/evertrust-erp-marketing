from erp_agents.workflows.engage.reply_glock.prompts import (
    CLASSIFY_SYSTEM_PROMPT,
    CLASSIFY_USER_PROMPT_TEMPLATE,
)


def test_scheduling_prompt_grounds_relative_and_zoned_times():
    """The scheduler must resolve "Friday this week at 10:00 CET" against the current date
    + org timezone, and ignore quoted footers — otherwise it invents times."""
    s = CLASSIFY_SYSTEM_PROMPT.lower()
    assert "current date" in s
    assert "timezone" in s or "time zone" in s
    assert "ignore" in s and ("quoted" in s or "wrote" in s or "footer" in s)


def test_user_template_carries_now_and_timezone():
    assert "{now}" in CLASSIFY_USER_PROMPT_TEMPLATE
    assert "{timezone}" in CLASSIFY_USER_PROMPT_TEMPLATE
