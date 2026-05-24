"""AnthropicProvider unit tests — HTTP layer mocked via respx."""

from __future__ import annotations

import httpx
import pytest

from services.ai.mol.providers.anthropic import AnthropicError, AnthropicProvider
from services.ai.mol.types import ChatTurn


@pytest.mark.asyncio
async def test_call_success_path(anthropic_success):
    p = AnthropicProvider()
    assert p.is_configured() is True

    resp = await p.call(
        model="claude-haiku-4-5-20251001",
        system_prompt="You are an AI tutor.",
        user_messages=[ChatTurn(role="user", content="Hello?")],
        max_tokens=128,
    )
    assert resp.text == "Pass-1 reply."
    assert resp.provider == "anthropic"
    assert resp.model == "claude-haiku-4-5-20251001"
    assert resp.tokens.prompt == 11
    assert resp.tokens.completion == 7
    assert resp.finish_reason == "end_turn"


@pytest.mark.asyncio
async def test_call_uses_cache_control_for_long_prompts(respx_mock):
    """System prompts ≥ 1024 chars get the ephemeral cache_control wrapper."""
    captured = {}

    def _capture(request):
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "stop_reason": "end_turn",
            },
        )

    respx_mock.post("https://api.anthropic.com/v1/messages").mock(side_effect=_capture)

    long_prompt = "x" * 1100
    p = AnthropicProvider()
    await p.call(
        model="claude-haiku-4-5-20251001",
        system_prompt=long_prompt,
        user_messages=[ChatTurn(role="user", content="?")],
        max_tokens=64,
    )
    body = captured["body"].decode("utf-8")
    assert "cache_control" in body
    assert "ephemeral" in body


@pytest.mark.asyncio
async def test_call_skips_cache_control_for_short_prompts(respx_mock):
    captured = {}

    def _capture(request):
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "stop_reason": "end_turn",
            },
        )

    respx_mock.post("https://api.anthropic.com/v1/messages").mock(side_effect=_capture)

    p = AnthropicProvider()
    await p.call(
        model="claude-haiku-4-5-20251001",
        system_prompt="Short prompt.",
        user_messages=[ChatTurn(role="user", content="?")],
        max_tokens=64,
    )
    body = captured["body"].decode("utf-8")
    assert "cache_control" not in body


@pytest.mark.asyncio
async def test_call_raises_anthropic_error_on_429(respx_mock):
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            429,
            json={"error": {"type": "rate_limit_error", "message": "slow down"}},
        )
    )
    p = AnthropicProvider()
    with pytest.raises(AnthropicError) as exc_info:
        await p.call(
            model="claude-haiku-4-5-20251001",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )
    assert exc_info.value.status == 429
    assert "rate_limit_error" in str(exc_info.value)


@pytest.mark.asyncio
async def test_call_raises_on_500(respx_mock):
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(500)
    )
    p = AnthropicProvider()
    with pytest.raises(AnthropicError) as exc_info:
        await p.call(
            model="claude-haiku-4-5-20251001",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )
    assert exc_info.value.status == 500


@pytest.mark.asyncio
async def test_call_raises_on_malformed_body(respx_mock):
    """Non-JSON body on a 4xx should still produce an error with the status."""
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(403, text="forbidden")
    )
    p = AnthropicProvider()
    with pytest.raises(AnthropicError) as exc_info:
        await p.call(
            model="claude-haiku-4-5-20251001",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )
    assert exc_info.value.status == 403


@pytest.mark.asyncio
async def test_call_when_key_missing_raises(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    from services.ai.config import get_settings

    get_settings.cache_clear()
    p = AnthropicProvider()
    assert p.is_configured() is False
    with pytest.raises(RuntimeError, match="not configured"):
        await p.call(
            model="claude-haiku-4-5-20251001",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )


@pytest.mark.asyncio
async def test_call_with_image_url_attaches_to_last_user_message(respx_mock):
    captured = {}

    def _capture(request):
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "vision"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "stop_reason": "end_turn",
            },
        )

    respx_mock.post("https://api.anthropic.com/v1/messages").mock(side_effect=_capture)
    p = AnthropicProvider()
    await p.call(
        model="claude-sonnet-4-6-20251022",
        system_prompt="sys",
        user_messages=[ChatTurn(role="user", content="What is in this image?")],
        max_tokens=64,
        image_url="https://example.com/img.png",
    )
    body = captured["body"].decode("utf-8")
    assert "https://example.com/img.png" in body
    assert "image" in body


@pytest.mark.asyncio
async def test_call_temperature_is_first_class_param(respx_mock):
    """Calling with temperature=0 must be forwarded to the Anthropic body."""
    captured = {}

    def _capture(request):
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "stop_reason": "end_turn",
            },
        )

    respx_mock.post("https://api.anthropic.com/v1/messages").mock(side_effect=_capture)
    p = AnthropicProvider()
    await p.call(
        model="claude-haiku-4-5-20251001",
        system_prompt="sys",
        user_messages=[ChatTurn(role="user", content="?")],
        max_tokens=16,
        temperature=0.0,
    )
    body = captured["body"].decode("utf-8")
    assert '"temperature":0' in body or '"temperature": 0' in body
