"""Idempotency-key handling for write operations.

Reads the ``Idempotency-Key`` HTTP header, namespaces it per-tenant via
SHA-256(`key:tenant_id`), and tracks seen keys in an in-memory dict.
The :func:`is_replay` check returns True when a request with the same
namespaced key has been recorded in the lookback window.

Scope (Phase 2): per-instance, in-memory. A second Cloud Run instance
will not see keys recorded on the first instance. This is acceptable
at current scale (max-instances=10, retry windows are seconds) but
will be replaced with a Redis-backed implementation in Phase 4 when
distributed-cache infrastructure lands (see
``docs/PYTHON_AI_LONG_TERM_VISION.md`` section 3, item 6).

Adoption pattern in a FastAPI route:

    from services.ai.shared.idempotency import (
        compute_idempotency_namespace,
        is_replay,
        record_key,
    )

    @router.post("/v1/bulk-question-gen")
    async def bulk_question_gen(req: Request, body: BulkQuestionGenRequest):
        idem_key = req.headers.get("Idempotency-Key")
        if idem_key:
            ns = compute_idempotency_namespace(idem_key, body.tenant_id)
            if is_replay(ns):
                # Return the cached response if available; else 409 Conflict.
                return get_cached_response(ns) or Response(status_code=409)
            record_key(ns)
        ...

Header semantics follow draft IETF spec
(https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/):
client generates a unique key per logical operation; server caches the
response and returns the same payload on retry within the TTL window.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from typing import Final

import structlog

logger = structlog.get_logger(__name__)

# Window in seconds. 24h matches the IETF draft default. Phase 4 Redis
# implementation will use an explicit TTL key; the in-memory dict prunes
# eagerly during ``is_replay``.
DEFAULT_TTL_SECONDS: Final[int] = 24 * 60 * 60


@dataclass
class _SeenStore:
    """In-memory namespace → first-seen-at-epoch-seconds map.

    Tracks ALL keys we have seen and when. ``is_replay`` prunes entries
    older than the TTL before answering.
    """

    keys: dict[str, float] = field(default_factory=dict)
    ttl_seconds: int = DEFAULT_TTL_SECONDS


_store = _SeenStore()


def reset_store() -> None:
    """Test-only: wipe the in-memory seen-key set."""
    _store.keys.clear()


def compute_idempotency_namespace(
    idempotency_key: str,
    tenant_id: str | None = None,
) -> str:
    """Hash the key with the tenant_id to namespace per-tenant.

    Tenant scoping prevents key collisions across tenants — without it,
    a malicious client could replay another tenant's request. The hash
    also drops the raw key from in-memory state so an attacker who can
    read the process memory cannot recover client-generated keys.

    Args:
        idempotency_key: caller-supplied unique key (typically UUIDv4).
        tenant_id: tenant scope. ``None`` is allowed for system-wide
            calls (admin endpoints) but logged as a warning so we can
            audit unscoped usage.

    Returns:
        64-char hex digest of SHA-256(``{tenant}:{key}``).
    """
    if not idempotency_key:
        raise ValueError("idempotency_key must be non-empty")
    scope = tenant_id or "_system"
    if tenant_id is None:
        logger.debug(
            "idempotency.unscoped",
            hint="No tenant_id provided; falling back to _system namespace.",
        )
    payload = f"{scope}:{idempotency_key}".encode()
    return hashlib.sha256(payload).hexdigest()


def is_replay(namespace: str) -> bool:
    """Return True iff we have recorded this namespace within the TTL.

    Side effect: prunes expired keys before answering. This is O(n) in
    the store size, which is fine at the current scale (max 10 instances
    × ~few-thousand keys/instance/day). Phase 4 Redis swap removes this.

    Args:
        namespace: SHA-256 hex digest from
            :func:`compute_idempotency_namespace`.

    Returns:
        True if the namespace is in the active TTL window; False otherwise.
    """
    now = time.time()
    cutoff = now - _store.ttl_seconds

    # Prune expired keys.
    expired = [k for k, t in _store.keys.items() if t < cutoff]
    for k in expired:
        del _store.keys[k]

    return namespace in _store.keys


def record_key(namespace: str) -> None:
    """Mark ``namespace`` as seen at the current time.

    Idempotent: re-recording an already-recorded key does not reset its
    timestamp (we keep the FIRST-seen timestamp so retries within the
    original TTL window are correctly classified as replays even at the
    edge of expiry).
    """
    if namespace not in _store.keys:
        _store.keys[namespace] = time.time()
