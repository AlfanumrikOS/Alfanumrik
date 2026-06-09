"""Cron-secret verification (constant-time compare against CRON_SECRET env)."""

from __future__ import annotations

import hmac

import structlog

from ...config import get_settings

logger = structlog.get_logger(__name__)


class AuthFailed(Exception):
    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


def verify_cron_secret(provided: str | None) -> None:
    s = get_settings()
    expected = getattr(s, "cron_secret", "") or ""
    if not expected:
        logger.warning("verify_qb.auth.misconfigured")
        raise AuthFailed("server_misconfigured", status=503)
    if not hmac.compare_digest(provided or "", expected):
        logger.info("verify_qb.auth.rejected")
        raise AuthFailed("unauthorized", status=401)
