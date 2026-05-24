"""MoL error types + classification helpers.

Mirrors the TS ``MolError`` discriminated-union codes. Keeping the code
strings identical means error rows in mol_request_logs / Sentry tags stay
queryable across the TS→Python cutover.
"""

from __future__ import annotations

from typing import Any, Literal

MolErrorCode = Literal[
    "NO_PROVIDER_AVAILABLE",
    "INVALID_INPUT",
    "TIMEOUT",
    "COST_CAP_EXCEEDED",
    "PROVIDER_CONFIG_MISSING",
]


class MolError(Exception):
    """Typed error surface for MoL flows.

    Attributes:
        code: one of the MolErrorCode literals (matches TS).
        details: free-form metadata; e.g. ``{"failures": [...]}`` for
            NO_PROVIDER_AVAILABLE so the orchestrator can serialize the
            full failure chain into the telemetry row.
    """

    def __init__(
        self,
        code: MolErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code: MolErrorCode = code
        self.message: str = message
        self.details: dict[str, Any] = details or {}

    def __repr__(self) -> str:  # pragma: no cover — diagnostics only
        return f"MolError(code={self.code!r}, message={self.message!r})"


def classify_error(err: BaseException) -> MolErrorCode:
    """Best-effort mapping of an arbitrary exception to a MolErrorCode.

    Used by the orchestrator when it needs to record a failure row before
    re-raising. Unknown errors map to ``NO_PROVIDER_AVAILABLE`` so they
    show up in the dashboards as "something we can't classify yet".
    """
    if isinstance(err, MolError):
        return err.code
    name = type(err).__name__
    msg = str(err).lower()
    if "timeout" in msg or name in {"TimeoutError", "ReadTimeout", "ConnectTimeout"}:
        return "TIMEOUT"
    if "config" in msg or "missing" in msg and "key" in msg:
        return "PROVIDER_CONFIG_MISSING"
    return "NO_PROVIDER_AVAILABLE"
