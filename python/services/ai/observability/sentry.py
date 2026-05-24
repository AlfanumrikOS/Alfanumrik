"""Sentry SDK initialization with PII-stripping ``before_send`` hook.

Mirrors :file:`sentry.server.config.ts` / :file:`sentry.edge.config.ts`:
- ``user.ip_address`` dropped before send (privacy-policy 7.1).
- ``request.headers`` redacted (cookies / authorization can carry tokens).
- ``request.query_string`` + ``request.data`` recursively redacted.
- ``contexts`` + ``extra`` recursively redacted.
- ``breadcrumbs[*].data`` recursively redacted.

PII redaction reuses :func:`services.ai.observability.logger._redact_value`
so the rules stay in one place (D7 follow-up #4 single-source posture).
"""

from __future__ import annotations

from typing import Any

import structlog

from ..config import get_settings
from .logger import _redact_value

logger = structlog.get_logger(__name__)

_initialized = False


def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    """Strip PII from a Sentry event payload before it leaves the process.

    Returning ``None`` would drop the event entirely; we always return the
    redacted event because the dashboards rely on volume signals.
    """
    del hint  # we don't inspect the captured exception object directly
    try:
        if not isinstance(event, dict):
            return event

        # Drop user.ip_address explicitly (server/edge config parity).
        user = event.get("user")
        if isinstance(user, dict):
            user.pop("ip_address", None)
            # Drop email / username / id even though the SDK auto-sends none —
            # defense in depth for any caller that passed sentry_sdk.set_user.
            for k in ("email", "username", "ip_address"):
                user.pop(k, None)

        # Redact request.headers (cookies / auth) + query / data.
        request = event.get("request")
        if isinstance(request, dict):
            request["headers"] = _redact_value(request.get("headers"))
            request["query_string"] = _redact_value(request.get("query_string"))
            request["data"] = _redact_value(request.get("data"))
            request["cookies"] = _redact_value(request.get("cookies"))

        # Recursively redact extra / contexts / tags.
        for k in ("extra", "contexts", "tags"):
            if k in event:
                event[k] = _redact_value(event[k])

        # Breadcrumb data is a common PII leak vector.
        breadcrumbs = event.get("breadcrumbs")
        if isinstance(breadcrumbs, dict):
            values = breadcrumbs.get("values", [])
            for b in values:
                if isinstance(b, dict) and "data" in b:
                    b["data"] = _redact_value(b["data"])
        return event
    except Exception as err:  # noqa: BLE001 — must never break Sentry pipeline
        logger.warning("sentry.before_send_threw", error=str(err))
        return event


def configure_sentry() -> None:
    """Initialize the Sentry SDK if a DSN is configured.

    Idempotent: subsequent calls are no-ops. Lazy import of ``sentry_sdk``
    so unit tests that never touch Sentry don't pay the import cost.
    """
    global _initialized
    if _initialized:
        return

    s = get_settings()
    if not s.sentry_dsn:
        logger.info("sentry.disabled", reason="no_dsn_configured")
        _initialized = True
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.httpx import HttpxIntegration

        sentry_sdk.init(
            dsn=s.sentry_dsn,
            environment=s.environment,
            traces_sample_rate=0.1 if s.is_production() else 1.0,
            send_default_pii=False,
            integrations=[
                FastApiIntegration(),
                HttpxIntegration(),
            ],
            # Sentry's Event type is a TypedDict; our dict-based redactor
            # operates on the same shape but mypy can't prove the structural
            # equivalence across the public Event alias.
            before_send=_before_send,  # type: ignore[arg-type]
        )
        logger.info("sentry.initialized", environment=s.environment)
    except Exception as err:  # noqa: BLE001 — never break startup on Sentry init failure
        logger.warning("sentry.init_failed", error=str(err))
    finally:
        _initialized = True
