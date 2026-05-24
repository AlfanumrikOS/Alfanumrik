"""Feature-flag unit tests — envelope, cache, defensive defaults."""

from __future__ import annotations

import httpx
import pytest

from services.ai.mol.feature_flag import (
    _in_rollout_bucket,
    _reset_flag_cache,
    get_flag_envelope,
    is_flag_enabled,
)


def _flag_row(**overrides) -> dict:
    base = {
        "flag_name": "ff_test",
        "is_enabled": True,
        "target_environments": None,
        "rollout_percentage": None,
        "metadata": None,
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _flag_cache_isolation():
    """Every flag test starts with an empty cache."""
    _reset_flag_cache()
    yield
    _reset_flag_cache()


# ─── Envelope reader ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_flag_envelope_returns_metadata(monkeypatch, respx_mock):
    monkeypatch.setenv("SUPABASE_URL", "https://flags.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    from services.ai.config import get_settings

    get_settings.cache_clear()

    respx_mock.get("https://flags.test/rest/v1/feature_flags").mock(
        return_value=httpx.Response(
            200,
            json=[
                _flag_row(
                    flag_name="ff_envelope",
                    metadata={"kill_switch": False, "task_types": ["doubt_solving"]},
                )
            ],
        )
    )
    env = await get_flag_envelope("ff_envelope")
    assert env["is_enabled"] is True
    assert env["metadata"] == {"kill_switch": False, "task_types": ["doubt_solving"]}


@pytest.mark.asyncio
async def test_get_flag_envelope_returns_empty_when_missing(monkeypatch, respx_mock):
    monkeypatch.setenv("SUPABASE_URL", "https://flags.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    from services.ai.config import get_settings

    get_settings.cache_clear()

    respx_mock.get("https://flags.test/rest/v1/feature_flags").mock(
        return_value=httpx.Response(200, json=[])
    )
    env = await get_flag_envelope("ff_nonexistent")
    assert env == {"is_enabled": False, "metadata": {}}


# ─── is_flag_enabled ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_is_flag_enabled_false_when_disabled(monkeypatch, respx_mock):
    monkeypatch.setenv("SUPABASE_URL", "https://flags.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    from services.ai.config import get_settings

    get_settings.cache_clear()

    respx_mock.get("https://flags.test/rest/v1/feature_flags").mock(
        return_value=httpx.Response(
            200,
            json=[_flag_row(flag_name="ff_off", is_enabled=False)],
        )
    )
    assert await is_flag_enabled("ff_off") is False


@pytest.mark.asyncio
async def test_is_flag_enabled_environment_gate(monkeypatch, respx_mock):
    monkeypatch.setenv("SUPABASE_URL", "https://flags.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    from services.ai.config import get_settings

    get_settings.cache_clear()

    respx_mock.get("https://flags.test/rest/v1/feature_flags").mock(
        return_value=httpx.Response(
            200,
            json=[
                _flag_row(
                    flag_name="ff_envgate",
                    target_environments=["production"],
                )
            ],
        )
    )
    # Default env is 'local' (from conftest); flag should be OFF.
    assert await is_flag_enabled("ff_envgate") is False
    # Explicit override matches → ON.
    assert await is_flag_enabled("ff_envgate", environment="production") is True


@pytest.mark.asyncio
async def test_is_flag_enabled_requires_student_id_for_rollout(
    monkeypatch, respx_mock
):
    monkeypatch.setenv("SUPABASE_URL", "https://flags.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    from services.ai.config import get_settings

    get_settings.cache_clear()

    respx_mock.get("https://flags.test/rest/v1/feature_flags").mock(
        return_value=httpx.Response(
            200,
            json=[
                _flag_row(flag_name="ff_rollout", rollout_percentage=50),
            ],
        )
    )
    # No student_id → off (matches TS behavior).
    assert await is_flag_enabled("ff_rollout") is False


# ─── Cache + defensive defaults ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_load_swallows_network_errors(monkeypatch, respx_mock):
    """A 5xx response must return [] (or cached) without raising."""
    monkeypatch.setenv("SUPABASE_URL", "https://flags.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    from services.ai.config import get_settings

    get_settings.cache_clear()

    respx_mock.get("https://flags.test/rest/v1/feature_flags").mock(
        return_value=httpx.Response(500)
    )
    assert await is_flag_enabled("ff_anything") is False


@pytest.mark.asyncio
async def test_load_returns_empty_when_no_supabase_configured():
    """No SUPABASE_URL → returns [] without attempting a fetch."""
    assert await is_flag_enabled("ff_anything") is False


# ─── Hash bucket parity ─────────────────────────────────────────────────────


def test_in_rollout_bucket_is_deterministic():
    """Same student_id + percent always returns the same answer."""
    a = _in_rollout_bucket("student-uuid-1", 50)
    b = _in_rollout_bucket("student-uuid-1", 50)
    assert a == b


def test_in_rollout_bucket_zero_percent_is_always_false():
    assert _in_rollout_bucket("any-student", 0) is False


def test_in_rollout_bucket_hundred_percent_is_always_true():
    assert _in_rollout_bucket("any-student", 100) is True
