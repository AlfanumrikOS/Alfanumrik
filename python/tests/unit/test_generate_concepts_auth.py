"""Tests for ``x-admin-key`` constant-time admin auth in generate-concepts.

Auth is re-exported from generate_answers — these tests confirm the
re-export path is intact AND that the same constant-time semantics
apply (defense in depth so a future fork would be caught immediately).
"""

from __future__ import annotations

import pytest

from services.ai.business.generate_concepts.auth import (
    AuthFailed,
    _constant_time_equal,
    verify_admin_key,
)


def test_auth_failed_is_reexported():
    """The class identity is shared with generate_answers — fork would break this."""
    from services.ai.business.generate_answers.auth import AuthFailed as Original

    assert AuthFailed is Original


def test_verify_admin_key_accepts_match(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_API_KEY", "secret-key-123")
    verify_admin_key("secret-key-123")  # no raise


def test_verify_admin_key_rejects_mismatch(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_API_KEY", "real-key")
    with pytest.raises(AuthFailed) as exc:
        verify_admin_key("wrong-key")
    assert exc.value.status == 401


def test_verify_admin_key_rejects_missing_header(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_API_KEY", "real-key")
    with pytest.raises(AuthFailed) as exc:
        verify_admin_key(None)
    assert exc.value.status == 401


def test_verify_admin_key_fails_closed_when_env_missing(
    monkeypatch: pytest.MonkeyPatch,
):
    """No ADMIN_API_KEY env → 503 (service misconfigured)."""
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    with pytest.raises(AuthFailed) as exc:
        verify_admin_key("anything")
    assert exc.value.status == 503


def test_constant_time_equal_works_from_reexport():
    """The constant-time helper is accessible via the re-export, too."""
    assert _constant_time_equal("hello", "hello") is True
    assert _constant_time_equal("abc", "abcd") is False
