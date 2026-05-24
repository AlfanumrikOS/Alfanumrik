"""Tests for ``x-admin-key`` constant-time admin auth.

Covers the shared-secret auth posture inherited from TS
``generate-answers/index.ts:83-89``.
"""

from __future__ import annotations

import pytest

from services.ai.business.generate_answers.auth import (
    AuthFailed,
    _constant_time_equal,
    verify_admin_key,
)

# ── Constant-time comparison ───────────────────────────────────────────────


def test_constant_time_equal_matches_identical():
    assert _constant_time_equal("hello", "hello") is True


def test_constant_time_equal_rejects_different_length():
    assert _constant_time_equal("abc", "abcd") is False


def test_constant_time_equal_rejects_different_content_same_length():
    assert _constant_time_equal("abcd", "abce") is False


def test_constant_time_equal_empty_strings():
    assert _constant_time_equal("", "") is True


def test_constant_time_equal_one_empty():
    assert _constant_time_equal("", "x") is False
    assert _constant_time_equal("x", "") is False


# ── verify_admin_key ────────────────────────────────────────────────────────


def test_verify_admin_key_accepts_match(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin-key-abc123")
    # Should not raise.
    verify_admin_key("test-admin-key-abc123")


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


def test_verify_admin_key_rejects_empty_header(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ADMIN_API_KEY", "real-key")
    with pytest.raises(AuthFailed) as exc:
        verify_admin_key("")
    assert exc.value.status == 401


def test_verify_admin_key_fails_closed_when_env_missing(
    monkeypatch: pytest.MonkeyPatch,
):
    """No ADMIN_API_KEY env → 503 (service misconfigured)."""
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    with pytest.raises(AuthFailed) as exc:
        verify_admin_key("anything")
    assert exc.value.status == 503


def test_verify_admin_key_fails_closed_on_whitespace_env(
    monkeypatch: pytest.MonkeyPatch,
):
    """Whitespace-only ADMIN_API_KEY is treated as empty → 503."""
    monkeypatch.setenv("ADMIN_API_KEY", "   ")
    with pytest.raises(AuthFailed) as exc:
        verify_admin_key("anything")
    assert exc.value.status == 503


def test_verify_admin_key_rejects_substring_match(
    monkeypatch: pytest.MonkeyPatch,
):
    """Provided key that is a prefix/substring of the real key must fail."""
    monkeypatch.setenv("ADMIN_API_KEY", "longer-admin-key")
    with pytest.raises(AuthFailed) as exc:
        verify_admin_key("longer")
    assert exc.value.status == 401


def test_verify_admin_key_with_unicode_chars(monkeypatch: pytest.MonkeyPatch):
    """Constant-time comparison must work for non-ASCII codepoints."""
    monkeypatch.setenv("ADMIN_API_KEY", "key-with-emoji")
    verify_admin_key("key-with-emoji")
    with pytest.raises(AuthFailed):
        verify_admin_key("key-with-other")


def test_auth_failed_carries_status_hint():
    err = AuthFailed("test", status=401)
    assert err.status == 401
    assert str(err) == "test"
