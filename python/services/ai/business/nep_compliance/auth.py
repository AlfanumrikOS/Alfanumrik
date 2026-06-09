"""Auth for POST /v1/nep-compliance.

The TS path validates `apikey` header (Supabase anon key) — we mirror by
checking the configured anon key constant-time. The endpoint is invoked
by parent/teacher portal pages with the public anon key (RLS enforces row
visibility downstream).
"""

from __future__ import annotations

import hmac

import structlog

from ...config import get_settings

logger = structlog.get_logger(__name__)


class AuthFailed(Exception):
    """Raised on any auth failure."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


def verify_apikey(provided: str | None) -> None:
    """Constant-time compare provided apikey header to SUPABASE_ANON_KEY.

    Raises AuthFailed(503) if anon key not configured, AuthFailed(401) on
    missing/mismatched header.
    """
    s = get_settings()
    expected = getattr(s, "supabase_anon_key", "") or ""
    if not expected:
        logger.warning("nep_compliance.auth.misconfigured")
        raise AuthFailed("anon_key_not_configured", status=503)
    if not hmac.compare_digest(provided or "", expected):
        logger.info("nep_compliance.auth.rejected")
        raise AuthFailed("unauthorized", status=401)
