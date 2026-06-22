"""Make MAIN's standalone REACH agents importable from inside Kobe's monolith.

The ADAPTER strategy: the three REACH workflows here are thin wrappers that call
main's already-improved standalone agents under ``erp-agents/workflows/<agent>/``
(their scraper, FORGE prompt, send pipeline, and the "never auto-verify
LLM-guessed emails" safety fix run VERBATIM). Each of those agents is its own
top-level package (``satellite``, ``ammoforge``, ``bazooka``) living one level
below its repo dir:

    erp-agents/workflows/satellite/satellite/   -> package ``satellite``
    erp-agents/workflows/ammoforge/ammoforge/   -> package ``ammoforge``
    erp-agents/workflows/bazooka/bazooka/       -> package ``bazooka``

The monolith installs only ``src`` (see ``pyproject.monolith.toml``), so those
package roots are NOT on ``sys.path``. This module appends each agent's
*parent* directory (the one that CONTAINS the package) to ``sys.path`` so

    from satellite.pipeline import run as satellite_run
    from ammoforge.pipeline import run as ammoforge_run
    from bazooka.pipeline import run as bazooka_run

resolve at runtime. The agents use only relative imports internally
(``from .clients import llm`` etc.), so their ``clients`` / ``domain`` /
``settings`` / ``pipeline`` modules stay namespaced under the package name and
never collide with each other or with the monolith.

Import this module for its side effect BEFORE importing any agent package::

    from erp_agents.workflows.reach import _agents_path  # noqa: F401

``ensure_on_path()`` is idempotent and is run once on import.
"""
from __future__ import annotations

import sys
from pathlib import Path

# erp-agents/src/erp_agents/workflows/reach/_agents_path.py
#   parents[0] = .../workflows/reach
#   parents[1] = .../workflows         (monolith package tree)
#   parents[2] = .../erp_agents
#   parents[3] = .../src
#   parents[4] = .../erp-agents        (repo dir; holds the `workflows/` agent dir)
_ERP_AGENTS_ROOT = Path(__file__).resolve().parents[4]
_WORKFLOWS_DIR = _ERP_AGENTS_ROOT / "workflows"

# package name -> the directory that CONTAINS that package (its import root).
_AGENT_PACKAGE_ROOTS = {
    "satellite": _WORKFLOWS_DIR / "satellite",
    "ammoforge": _WORKFLOWS_DIR / "ammoforge",
    "bazooka": _WORKFLOWS_DIR / "bazooka",
}


def ensure_on_path() -> None:
    """Idempotently add each agent package root to ``sys.path`` (front of the
    list so the vendored agents win over any same-named site package). Missing
    dirs are skipped silently — the adapter raises a clear ImportError instead."""
    for root in _AGENT_PACKAGE_ROOTS.values():
        p = str(root)
        if root.is_dir() and p not in sys.path:
            sys.path.insert(0, p)


ensure_on_path()
