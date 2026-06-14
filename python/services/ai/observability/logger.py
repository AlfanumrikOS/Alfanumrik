"""structlog configuration with PII redaction.

Mirrors :file:`src/lib/logger.ts` (TS) at the value level:
- JSON output to stdout (Cloud Run captures stdout natively).
- Bound ``service='ai-services'`` + ``env=<environment>`` on every line.
- Sensitive keys (password / token / email / phone / api_key / etc.) are
  recursively replaced with ``[REDACTED]``.
- Free-form text redaction (email / Indian-phone / Razorpay-ID) ALSO fires
  on the ``message`` field, mirroring the TS ``redactPIIInText`` helper
  used by the MoL shadow text buffer.

Call :func:`configure_logging` once at app startup. Subsequent calls are
no-ops (idempotent by module-level guard).
"""

from __future__ import annotations

import logging
import re
import sys
from collections.abc import Mapping, MutableMapping
from typing import Any

import structlog

from ..config import get_settings

# ─── Sensitive-key set — mirrors supabase/functions/_shared/redact-pii.ts ───
# Adding entries is always safe. Removing requires an audit trail (P13).
_SENSITIVE_KEYS: frozenset[str] = frozenset(
    {
        # Auth / credentials
        "password",
        "token",
        "secret",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "service_role_key",
        "authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        # Identity (D7 follow-up #4 alignment)
        "email",
        "phone",
        "parent_phone",
        "mobile_number",
        "full_name",
        "first_name",
        "last_name",
        "school_name",
        "school_address",
        # Payment surface
        "razorpay_signature",
        "razorpay_webhook_signature",
        "card_number",
        "card_cvv",
        "card_expiry",
        "card_holder",
        "upi_id",
        "vpa",
        "upi_pin",
    }
)

_REDACTED = "[REDACTED]"

# Free-form text patterns. Mirror redactPIIInText():
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{9}\b")
_RZP_ID_RE = re.compile(r"\b(pay|order|rzp|cust|sub|inv)_[A-Za-z0-9]{14,}\b")


def _redact_text(s: str) -> str:
    """Strip email / Indian-phone / Razorpay-ID patterns from free-form text."""
    if not isinstance(s, str) or not s:
        return s
    out = _EMAIL_RE.sub("[REDACTED_EMAIL]", s)
    out = _PHONE_RE.sub("[REDACTED_PHONE]", out)
    out = _RZP_ID_RE.sub("[REDACTED_PAYMENT_ID]", out)
    return out


def _redact_value(v: Any, _seen: set[int] | None = None) -> Any:
    """Recursively redact sensitive keys + free-form text PII."""
    if _seen is None:
        _seen = set()
    if v is None or isinstance(v, bool | int | float):
        return v
    if isinstance(v, str):
        return _redact_text(v)
    obj_id = id(v)
    if obj_id in _seen:
        return "[Circular]"
    _seen.add(obj_id)
    if isinstance(v, dict):
        return {
            k: (_REDACTED if str(k).lower() in _SENSITIVE_KEYS else _redact_value(val, _seen))
            for k, val in v.items()
        }
    if isinstance(v, list | tuple):
        return [_redact_value(item, _seen) for item in v]
    return v  # Unknown type — pass through


def redact_pii_processor(
    logger: Any,
    method_name: str,
    event_dict: MutableMapping[str, Any],
) -> Mapping[str, Any]:
    """structlog processor that redacts PII across the whole event dict.

    Runs late in the chain so any binder-added fields are also scrubbed.
    Safe to compose with the standard structlog stack — does not mutate
    the input dict (returns a new one). The MutableMapping/Mapping
    signature satisfies the structlog ``Processor`` protocol.
    """
    del logger, method_name
    redacted = _redact_value(dict(event_dict))
    return redacted if isinstance(redacted, dict) else dict(event_dict)


# Module-level guard so multiple imports don't re-configure logging.
_configured = False


def configure_logging() -> None:
    """One-shot logging setup. Safe to call multiple times."""
    global _configured
    if _configured:
        return

    s = get_settings()
    log_level_name = (s.log_level or "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    # stdlib root logger → stdout, plain text. structlog handles JSON
    # rendering so the underlying stdlib handler is intentionally minimal.
    logging.basicConfig(
        level=log_level,
        format="%(message)s",
        stream=sys.stdout,
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            # Bind constant service/env tags on every line.
            _add_service_context,
            redact_pii_processor,
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
    _configured = True


def _add_service_context(
    logger: Any,
    method_name: str,
    event_dict: MutableMapping[str, Any],
) -> Mapping[str, Any]:
    """Bind constant ``service`` + ``env`` tags so dashboards can filter."""
    del logger, method_name
    s = get_settings()
    event_dict.setdefault("service", "ai-services")
    event_dict.setdefault("env", s.environment)
    return event_dict


def get_logger(name: str | None = None):
    """Wrapper so callers don't have to import structlog directly."""
    return structlog.get_logger(name) if name else structlog.get_logger()
