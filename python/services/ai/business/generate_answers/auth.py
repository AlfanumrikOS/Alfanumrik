"""``x-admin-key`` constant-time admin authentication.

Port of TS ``authenticateAdmin`` (generate-answers/index.ts lines 83-89).

The TS Edge Function uses a SIMPLER auth posture than bulk-question-gen:
instead of a Supabase user JWT + admin_users lookup, generate-answers compares
the ``x-admin-key`` header against the ``ADMIN_API_KEY`` environment variable
using constant-time comparison.

Why simpler? generate-answers is invoked from admin CLI tools / curl, not from
a logged-in admin in the browser. The shared-secret model matches the caller
posture. Other admin functions with the same posture in the TS codebase:
``generate-concepts``, ``extract-ncert-questions``, ``bulk-non-mcq-gen``.

Security:
- Constant-time comparison prevents timing-side-channel recovery of the key
  (see ``_shared/auth.ts:constantTimeEqual`` for the TS twin).
- The key is read from env at process start via :mod:`services.ai.config`,
  not from a request header or DB row — rotation requires a deploy.
- Failures return :class:`AuthFailed` with status=401 (mirrors TS line 681).

PII safety: never log the provided key, never log the expected key.
"""

from __future__ import annotations

import os

import structlog

logger = structlog.get_logger(__name__)


class AuthFailed(Exception):
    """Raised on any auth failure. Carries an HTTP status hint for the route."""

    def __init__(self, message: str, *, status: int) -> None:
        super().__init__(message)
        self.status = status


def _constant_time_equal(a: str, b: str) -> bool:
    """Constant-time string comparison.

    Mirrors :file:`supabase/functions/_shared/auth.ts:constantTimeEqual`. We
    do NOT use ``hmac.compare_digest`` because (a) it requires ``bytes`` and
    (b) it has a length-leak via the first-byte length check that we want to
    avoid. The xor-accumulation pattern matches the TS twin byte-for-byte.

    Returns False immediately on length mismatch — same as the TS twin.
    Both ``a`` and ``b`` are expected to be ASCII admin keys; non-ASCII chars
    fall through to ``ord()`` which still works (per-codepoint).
    """
    if len(a) != len(b):
        return False
    diff = 0
    for ch_a, ch_b in zip(a, b, strict=True):
        diff |= ord(ch_a) ^ ord(ch_b)
    return diff == 0


def verify_admin_key(provided_key: str | None) -> None:
    """Verify the ``x-admin-key`` header matches the configured admin key.

    Args:
        provided_key: value of the ``x-admin-key`` request header, or None
            when the header was absent.

    Raises:
        :class:`AuthFailed` with status=401 on missing or mismatched key.
        :class:`AuthFailed` with status=503 when ``ADMIN_API_KEY`` env var is
            empty (service is misconfigured — fail closed).

    Why fail-closed on missing env: a deploy that doesn't set ``ADMIN_API_KEY``
    must NOT silently admit every caller. The TS path returns 401 in this
    case (index.ts:85-86 returns false → 401 at the handler level); we
    differentiate 503 here so ops can tell "misconfig" from "bad key".
    """
    admin_key = os.environ.get("ADMIN_API_KEY", "").strip()
    if not admin_key:
        logger.warning("generate_answers.auth.no_admin_key_configured")
        raise AuthFailed("ADMIN_API_KEY not configured", status=503)

    provided = provided_key or ""
    if not _constant_time_equal(provided, admin_key):
        # Log only the lengths — never the provided or expected key.
        logger.info(
            "generate_answers.auth.bad_key",
            provided_length=len(provided),
            expected_length=len(admin_key),
        )
        raise AuthFailed("Unauthorized: invalid or missing x-admin-key", status=401)
