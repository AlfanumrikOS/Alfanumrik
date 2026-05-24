"""Logging + Sentry init.

Call :func:`configure_logging` once at startup before any log calls so
structlog and stdlib logging agree on a single JSON-to-stdout configuration.
"""

from .logger import configure_logging, get_logger, redact_pii_processor
from .sentry import configure_sentry

__all__ = [
    "configure_logging",
    "configure_sentry",
    "get_logger",
    "redact_pii_processor",
]
