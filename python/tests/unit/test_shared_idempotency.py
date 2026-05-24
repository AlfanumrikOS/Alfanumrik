"""Tests for ``services.ai.shared.idempotency``.

Coverage targets:
- compute_idempotency_namespace: hash determinism, tenant scoping, empty
  key rejection
- record_key + is_replay: first call is not a replay, second call IS
- TTL expiry: replay returns False after the TTL window passes
- Per-tenant isolation: same raw key with different tenants → different
  namespaces → no replay
"""

from __future__ import annotations

import pytest

from services.ai.shared import idempotency
from services.ai.shared.idempotency import (
    compute_idempotency_namespace,
    is_replay,
    record_key,
    reset_store,
)


@pytest.fixture(autouse=True)
def _reset() -> None:
    """Wipe the shared in-memory store between tests."""
    reset_store()


# ── compute_idempotency_namespace ─────────────────────────────────────────────


def test_same_key_and_tenant_produces_same_namespace() -> None:
    a = compute_idempotency_namespace("req-123", tenant_id="tenant-A")
    b = compute_idempotency_namespace("req-123", tenant_id="tenant-A")
    assert a == b


def test_different_tenants_produce_different_namespaces() -> None:
    a = compute_idempotency_namespace("req-123", tenant_id="tenant-A")
    b = compute_idempotency_namespace("req-123", tenant_id="tenant-B")
    assert a != b


def test_different_keys_same_tenant_produce_different_namespaces() -> None:
    a = compute_idempotency_namespace("req-123", tenant_id="tenant-A")
    b = compute_idempotency_namespace("req-999", tenant_id="tenant-A")
    assert a != b


def test_namespace_is_sha256_hex_length() -> None:
    ns = compute_idempotency_namespace("k", tenant_id="t")
    assert len(ns) == 64
    int(ns, 16)  # raises if non-hex


def test_empty_key_raises() -> None:
    with pytest.raises(ValueError):
        compute_idempotency_namespace("")


def test_no_tenant_falls_back_to_system_namespace() -> None:
    a = compute_idempotency_namespace("req-123")
    b = compute_idempotency_namespace("req-123", tenant_id="_system")
    assert a == b


# ── is_replay + record_key ────────────────────────────────────────────────────


def test_first_check_is_not_replay() -> None:
    ns = compute_idempotency_namespace("req-new", tenant_id="t")
    assert is_replay(ns) is False


def test_after_record_is_replay() -> None:
    ns = compute_idempotency_namespace("req-record", tenant_id="t")
    assert is_replay(ns) is False
    record_key(ns)
    assert is_replay(ns) is True


def test_replay_isolation_across_tenants() -> None:
    """A recorded key for tenant A is NOT a replay for tenant B."""
    a = compute_idempotency_namespace("req-x", tenant_id="A")
    b = compute_idempotency_namespace("req-x", tenant_id="B")
    record_key(a)
    assert is_replay(a) is True
    assert is_replay(b) is False


def test_record_key_is_idempotent() -> None:
    """Re-recording an already-recorded key does not reset the timestamp."""
    ns = compute_idempotency_namespace("req-rec-twice", tenant_id="t")
    record_key(ns)
    first_ts = idempotency._store.keys[ns]
    record_key(ns)
    second_ts = idempotency._store.keys[ns]
    assert first_ts == second_ts


# ── TTL expiry ────────────────────────────────────────────────────────────────


def test_expired_key_is_pruned_and_not_replay(monkeypatch: pytest.MonkeyPatch) -> None:
    """A key older than the TTL is pruned by ``is_replay`` and no longer counts."""
    ns = compute_idempotency_namespace("req-old", tenant_id="t")
    record_key(ns)
    # Lower TTL to 0.01s and shift the recorded timestamp far into the past.
    idempotency._store.ttl_seconds = 1
    idempotency._store.keys[ns] = 0.0  # epoch 0 — far before any sensible "now"
    assert is_replay(ns) is False
    assert ns not in idempotency._store.keys, "expired key should be pruned"


# ── reset_store ───────────────────────────────────────────────────────────────


def test_reset_store_clears_keys() -> None:
    ns = compute_idempotency_namespace("req-reset", tenant_id="t")
    record_key(ns)
    assert is_replay(ns) is True
    reset_store()
    assert is_replay(ns) is False
