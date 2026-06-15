"""Inject synthetic replies against the demo campaign and run the routing loop offline,
so the full classify→route→status path can be exercised with no Gmail/LLM.

    python seed_replies_demo.py        # dry-run routing over 4 canned replies

Assumes the bazooka demo campaign + leads exist in the test DB (run bazooka's seed first)
and that glock/satellite schema_additions have been applied.
"""
from __future__ import annotations

from glock.domain.models import Reply
from glock.pipeline import RunOptions, run
from glock.settings import load_settings


def main() -> None:
    settings = load_settings()
    # Four replies mapped to demo leads, one per route. thread_id is synthetic; the
    # pipeline falls back to email match since these threads aren't in outreach_threads.
    replies = [
        Reply("m1", "t1", "info@asseco.pl", "Re: Partnership",
              "Yes, this sounds interesting — can we schedule a quick call?", "info"),
        Reply("m2", "t2", "contact@dagma.eu", "Re: Partnership",
              "Hmm, what exactly are you offering? Not sure this is relevant.", "info"),
        Reply("m3", "t3", "office@spyro-soft.com", "Re: Partnership",
              "Please remove us from your list and do not contact us again.", "info"),
        Reply("m4", "t4", "michal@cybernat.pl", "Re: Partnership",
              "Not right now, maybe circle back next quarter.", "info"),
    ]
    run(settings, RunOptions(live=False, use_llm=False, replies=replies))


if __name__ == "__main__":
    main()
