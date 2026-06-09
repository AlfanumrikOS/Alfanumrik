"""Cron-secret verification for ``POST /v1/monthly-synthesis-builder``.

Mirrors the TS ``constantTimeEqual`` check in the Edge Function. The endpoint
is invoked by pg_cron / daily-cron / internal Next.js — never by an end user.
Auth is a shared cron secret with constant-time comparison.

P13: never log the provided value or the configured secret.
"""

from __future__ import annotations

import hmac

import structlog

from ...config import get_settings

logger = structlog.get_logger(__name__)


class AuthFailed(Exception):
    """Raised on any auth failure. Carries a HTTP status hint."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


def verify_cron_secret(provided_header: str | None) -> None:
    """Constant-time compare provided ``x-cron-secret`` to ``CRON_SECRET`` env.

    Raises :class:`AuthFailed` with status=503 if CRON_SECRET missing
    (fail-CLOSED), status=401 if values don't match.
    """
    s = get_settings()
    expected = getattr(s, "cron_secret", "") or ""
    if not expected:
        logger.warning("monthly_synthesis.auth.misconfigured")
        raise AuthFailed("CRON_SECRET not configured", status=503)

    provided = provided_header or ""
    if not hmac.compare_digest(provided, expected):
        logger.info("monthly_synthesis.auth.rejected")
        raise AuthFailed("Unauthorized", status=401)
