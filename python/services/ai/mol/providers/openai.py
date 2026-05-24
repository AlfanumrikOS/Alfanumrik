"""OpenAI provider — async HTTP client for the Chat Completions API.

Mirrors :file:`supabase/functions/_shared/mol/providers/openai.ts`:
- POST to https://api.openai.com/v1/chat/completions
- ``Authorization: Bearer <key>`` header
- System prompt as the first ``role: system`` message
- Vision: ``image_url`` content part on the last user message
- Tokens read from ``usage.prompt_tokens`` / ``usage.completion_tokens``
- Finish reason from ``choices[0].finish_reason``
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from ...config import get_settings
from ..types import ChatTurn, ProviderResponse, TokenUsage
from .base import ModelProvider

OPENAI_URL = "https://api.openai.com/v1/chat/completions"


class OpenAIError(Exception):
    """Wraps OpenAI API failures with a status-encoded message string."""

    def __init__(self, status: int, typed_label: str = "") -> None:
        suffix = f" ({typed_label})" if typed_label else ""
        super().__init__(f"OpenAI {status}{suffix}")
        self.status = status


class OpenAIProvider(ModelProvider):
    id = "openai"
    default_model = "gpt-4o-mini"

    def _api_key(self) -> str:
        return get_settings().openai_api_key

    def is_configured(self) -> bool:
        return bool(self._api_key())

    async def call(
        self,
        *,
        model: str,
        system_prompt: str,
        user_messages: list[ChatTurn],
        max_tokens: int,
        temperature: float = 0.7,
        timeout_seconds: int = 20,
        image_url: str | None = None,
    ) -> ProviderResponse:
        if not self.is_configured():
            raise RuntimeError("OpenAIProvider not configured (OPENAI_API_KEY missing)")

        chat_messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]
        for i, m in enumerate(user_messages):
            is_last = i == len(user_messages) - 1
            if is_last and image_url:
                chat_messages.append(
                    {
                        "role": m.role,
                        "content": [
                            {"type": "image_url", "image_url": {"url": image_url}},
                            {"type": "text", "text": m.content},
                        ],
                    }
                )
            else:
                chat_messages.append({"role": m.role, "content": m.content})

        body = {
            "model": model,
            "messages": chat_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        headers = {
            "Authorization": f"Bearer {self._api_key()}",
            "Content-Type": "application/json",
        }

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            res = await client.post(OPENAI_URL, json=body, headers=headers)

        if res.status_code >= 400:
            typed = ""
            try:
                j = res.json()
                err = j.get("error") if isinstance(j, dict) else None
                if isinstance(err, dict):
                    tag = err.get("code") or err.get("type")
                    if tag:
                        typed = str(tag)
            except Exception:  # noqa: BLE001 — defensive parity with TS
                pass
            raise OpenAIError(res.status_code, typed)

        data = res.json()
        choices = data.get("choices") or []
        first = choices[0] if choices else {}
        message = (first.get("message") or {}) if isinstance(first, dict) else {}
        text = (message.get("content") or "").strip()
        usage = data.get("usage") or {}

        latency_ms = int((time.monotonic() - start) * 1000)
        return ProviderResponse(
            text=text,
            provider="openai",
            model=str(data.get("model") or model),
            tokens=TokenUsage(
                prompt=int(usage.get("prompt_tokens", 0)),
                completion=int(usage.get("completion_tokens", 0)),
            ),
            finish_reason=str(first.get("finish_reason") or "stop"),
            raw={"latency_ms": latency_ms, **(data if isinstance(data, dict) else {})},
        )
