"""Anthropic provider — async HTTP client for the Claude Messages API.

Mirrors :file:`supabase/functions/_shared/mol/providers/anthropic.ts`:
- POST to https://api.anthropic.com/v1/messages
- ``x-api-key`` + ``anthropic-version: 2023-06-01`` headers
- System-prompt caching (``cache_control: ephemeral``) when prompt ≥ 1024 chars
- Vision: when ``image_url`` is provided, attach to the latest user message
- Tokens read from ``usage.input_tokens`` / ``usage.output_tokens``
- Stop reason from ``stop_reason``
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from ...config import get_settings
from ..types import ChatTurn, ProviderResponse, TokenUsage
from .base import ModelProvider

ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


class AnthropicError(Exception):
    """Wraps Anthropic API failures with the same status-encoded message
    format the orchestrator's retry/circuit-breaker logic expects."""

    def __init__(self, status: int, typed_label: str = "") -> None:
        suffix = f" ({typed_label})" if typed_label else ""
        super().__init__(f"Anthropic {status}{suffix}")
        self.status = status


class AnthropicProvider(ModelProvider):
    id = "anthropic"
    default_model = "claude-haiku-4-5-20251001"

    def _api_key(self) -> str:
        return get_settings().anthropic_api_key

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
            raise RuntimeError("AnthropicProvider not configured (ANTHROPIC_API_KEY missing)")

        # Enable prompt caching when the system block crosses the cache cutoff.
        sys_block: Any
        if len(system_prompt) >= 1024:
            sys_block = [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        else:
            sys_block = system_prompt

        # Build messages — attach image to the LAST user message when provided.
        messages: list[dict[str, Any]] = []
        for i, m in enumerate(user_messages):
            is_last = i == len(user_messages) - 1
            if is_last and image_url:
                messages.append(
                    {
                        "role": m.role,
                        "content": [
                            {
                                "type": "image",
                                "source": {"type": "url", "url": image_url},
                            },
                            {"type": "text", "text": m.content},
                        ],
                    }
                )
            else:
                messages.append({"role": m.role, "content": m.content})

        body = {
            "model": model,
            "max_tokens": max_tokens,
            "system": sys_block,
            "messages": messages,
            "temperature": temperature,
        }

        headers = {
            "x-api-key": self._api_key(),
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            res = await client.post(ANTHROPIC_URL, json=body, headers=headers)

        if res.status_code >= 400:
            typed = ""
            try:
                j = res.json()
                err = j.get("error") if isinstance(j, dict) else None
                if isinstance(err, dict) and err.get("type"):
                    typed = str(err["type"])
            except Exception:  # noqa: BLE001 — defensive parity with TS
                pass
            raise AnthropicError(res.status_code, typed)

        data = res.json()
        text_parts = [
            b.get("text", "")
            for b in data.get("content", [])
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text")
        ]
        text = "\n".join(text_parts).strip()
        usage = data.get("usage") or {}

        latency_ms = int((time.monotonic() - start) * 1000)
        return ProviderResponse(
            text=text,
            provider="anthropic",
            model=model,
            tokens=TokenUsage(
                prompt=int(usage.get("input_tokens", 0)),
                completion=int(usage.get("output_tokens", 0)),
            ),
            finish_reason=str(data.get("stop_reason", "stop")),
            raw={"latency_ms": latency_ms, **(data if isinstance(data, dict) else {})},
        )
