import logging

from erp_agents.settings import settings

_CONFIGURED = False


def get_logger(name: str = "erp_agents") -> logging.Logger:
    """Return a process-wide logger configured from settings.log_level."""
    global _CONFIGURED
    if not _CONFIGURED:
        logging.basicConfig(
            level=settings.log_level.upper(),
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
        _CONFIGURED = True
    return logging.getLogger(name)
