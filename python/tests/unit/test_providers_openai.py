"""OpenAIProvider unit tests — HTTP layer mocked via respx."""

from __future__ import annotations

import httpx
import pytest

from services.ai.mol.providers.openai import OpenAIError, OpenAIProvider
from services.ai.mol.types import ChatTurn


@pytest.mark.asyncio
async def test_call_success_path(openai_success):
    p = OpenAIProvider()
    assert p.is_configured() is True

    resp = await p.call(
        model="gpt-4o-mini",
        system_prompt="You are an AI tutor.",
        user_messages=[ChatTurn(role="user", content="Hello?")],
        max_tokens=128,
    )
    assert resp.text == "OpenAI reply."
    assert resp.provider == "openai"
    assert resp.model == "gpt-4o-mini"
    assert resp.tokens.prompt == 14
    assert resp.tokens.completion == 9
    assert resp.finish_reason == "stop"


@pytest.mark.asyncio
async def test_call_includes_system_role_first(respx_mock):
    """OpenAI requires the system prompt as the first role: system message."""
    captured = {}

    def _capture(request):
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "id": "x",
                "model": "gpt-4o-mini",
                "choices": [
                    {"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(side_effect=_capture)
    p = OpenAIProvider()
    await p.call(
        model="gpt-4o-mini",
        system_prompt="SYS-MARKER",
        user_messages=[ChatTurn(role="user", content="?")],
        max_tokens=16,
    )
    body = captured["body"].decode("utf-8")
    # System message must precede user message in payload.
    sys_idx = body.find("SYS-MARKER")
    user_idx = body.find('"?"')
    assert sys_idx >= 0
    assert user_idx > sys_idx


@pytest.mark.asyncio
async def test_call_with_image_url_attaches_to_last_user_message(respx_mock):
    captured = {}

    def _capture(request):
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "id": "x",
                "model": "gpt-4o",
                "choices": [
                    {"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(side_effect=_capture)
    p = OpenAIProvider()
    await p.call(
        model="gpt-4o",
        system_prompt="sys",
        user_messages=[ChatTurn(role="user", content="What is in this image?")],
        max_tokens=64,
        image_url="https://example.com/foo.png",
    )
    body = captured["body"].decode("utf-8")
    assert "image_url" in body
    assert "https://example.com/foo.png" in body


@pytest.mark.asyncio
async def test_call_raises_openai_error_on_429(respx_mock):
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            429,
            json={"error": {"code": "rate_limit_exceeded", "message": "slow down"}},
        )
    )
    p = OpenAIProvider()
    with pytest.raises(OpenAIError) as exc_info:
        await p.call(
            model="gpt-4o-mini",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )
    assert exc_info.value.status == 429
    assert "rate_limit_exceeded" in str(exc_info.value)


@pytest.mark.asyncio
async def test_call_raises_on_503(respx_mock):
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(503)
    )
    p = OpenAIProvider()
    with pytest.raises(OpenAIError) as exc_info:
        await p.call(
            model="gpt-4o-mini",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )
    assert exc_info.value.status == 503


@pytest.mark.asyncio
async def test_call_raises_on_malformed_body(respx_mock):
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(403, text="forbidden")
    )
    p = OpenAIProvider()
    with pytest.raises(OpenAIError) as exc_info:
        await p.call(
            model="gpt-4o-mini",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )
    assert exc_info.value.status == 403


@pytest.mark.asyncio
async def test_call_when_key_missing_raises(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from services.ai.config import get_settings

    get_settings.cache_clear()
    p = OpenAIProvider()
    assert p.is_configured() is False
    with pytest.raises(RuntimeError, match="not configured"):
        await p.call(
            model="gpt-4o-mini",
            system_prompt="sys",
            user_messages=[ChatTurn(role="user", content="?")],
            max_tokens=16,
        )


@pytest.mark.asyncio
async def test_call_uses_response_model_when_present(respx_mock):
    """OpenAI sometimes returns a more precise model name; we surface that."""
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "x",
                "model": "gpt-4o-mini-2024-07-18",
                "choices": [
                    {"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )
    )
    p = OpenAIProvider()
    resp = await p.call(
        model="gpt-4o-mini",
        system_prompt="sys",
        user_messages=[ChatTurn(role="user", content="?")],
        max_tokens=16,
    )
    assert resp.model == "gpt-4o-mini-2024-07-18"


@pytest.mark.asyncio
async def test_call_temperature_is_first_class_param(respx_mock):
    """temperature=0 must be forwarded in the OpenAI body."""
    captured = {}

    def _capture(request):
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "id": "x",
                "model": "gpt-4o-mini",
                "choices": [
                    {"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(side_effect=_capture)
    p = OpenAIProvider()
    await p.call(
        model="gpt-4o-mini",
        system_prompt="sys",
        user_messages=[ChatTurn(role="user", content="?")],
        max_tokens=16,
        temperature=0.0,
    )
    body = captured["body"].decode("utf-8")
    assert '"temperature":0' in body or '"temperature": 0' in body
