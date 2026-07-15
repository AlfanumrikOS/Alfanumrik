"""The orchestrator surfaces the winning provider's RAW finish_reason on MolResult.

Phase 2.2 (Foxy MOL-on-Python seam): the TS grounded-answer seam
(``foxy-python-generation.ts::mapMolResultToClaudeResponse``) maps
``MolResult.finish_reason`` onto its normalized ``ClaudeStopReason`` so a
truncated Python answer triggers the SAME flag-gated bounded
max_tokens-continuation the Claude path does. Before this, ``MolResult`` dropped
the provider stop reason and the seam hardcoded ``'end_turn'`` — so a Python
answer that hit the token budget mid-JSON could never continue.

These tests pin that ``generate_response`` now surfaces the RAW provider
finish_reason from the response whose text the result carries (``responses[-1]``).
The value is deliberately left UN-normalized (raw provider vocabulary):
normalization to the small ClaudeStopReason union lives on the TS seam, mirroring
``claude.ts``'s two provider normalizers.
"""

from __future__ import annotations

import httpx
import pytest

from services.ai.mol.orchestrator import generate_response
from services.ai.mol.types import (
    GenerateConfig,
    GenerateInput,
    GenerateRequest,
    StudentContext,
)


def _req() -> GenerateRequest:
    return GenerateRequest(
        task_type="explanation",
        input=GenerateInput(question="Explain refraction of light."),
        student_context=StudentContext(
            student_id="11111111-1111-1111-1111-111111111111",
            grade="10",
            subject="science",
        ),
    )


@pytest.mark.asyncio
async def test_finish_reason_surfaced_from_completed_answer(openai_success, mock_supabase_client):
    """A complete answer (OpenAI finish_reason='stop') surfaces raw on MolResult.
    The TS seam maps 'stop' → 'end_turn' (no continuation)."""
    result = await generate_response(_req())
    assert result.provider == "openai"
    assert result.finish_reason == "stop"


@pytest.mark.asyncio
async def test_finish_reason_surfaced_when_truncated(respx_mock, mock_supabase_client):
    """OpenAI 'length' (its max_tokens signal) passes through RAW so the TS seam
    can map it to 'max_tokens' and fire the bounded continuation. This is the
    exact path the hardcoded-'end_turn' bug used to break."""
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-trunc",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        # A truncated structured payload — cut off mid-JSON.
                        "message": {"role": "assistant", "content": '{"title":"Refr'},
                        "finish_reason": "length",
                    }
                ],
                "usage": {"prompt_tokens": 14, "completion_tokens": 9},
            },
        )
    )
    result = await generate_response(_req())
    assert result.provider == "openai"
    assert result.finish_reason == "length"


@pytest.mark.asyncio
async def test_finish_reason_surfaced_from_anthropic_max_tokens(respx_mock, mock_supabase_client):
    """Anthropic 'max_tokens' passes through RAW (preferred_provider forces the
    Anthropic rung primary). The TS seam maps 'max_tokens' → 'max_tokens'."""
    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": '{"title":"Refr'}],
                "usage": {"input_tokens": 11, "output_tokens": 7},
                "stop_reason": "max_tokens",
            },
        )
    )
    req = _req()
    req.config = GenerateConfig(preferred_provider="anthropic")
    result = await generate_response(req)
    assert result.provider == "anthropic"
    assert result.finish_reason == "max_tokens"


@pytest.mark.asyncio
async def test_finish_reason_none_on_cache_hit(monkeypatch, mock_supabase_client):
    """A semantic-cache hit makes no provider call → finish_reason stays None,
    which the TS seam maps to the safe 'end_turn' default (no continuation)."""

    async def _flag(name, **kwargs):
        return name == "ff_mol_semantic_cache"

    async def _get_cached(_key):
        return "Cached answer."

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)
    monkeypatch.setattr("services.ai.mol.orchestrator.get_cached", _get_cached)

    result = await generate_response(_req())
    assert result.provider == "cache"
    assert result.finish_reason is None
