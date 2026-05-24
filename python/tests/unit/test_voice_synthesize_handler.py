"""Tests for ``services.ai.business.voice.synthesize_handler``.

We mock ``call_azure_tts`` and ``check_daily_budget`` so these tests
cover the pipeline composition without making real HTTP / DB calls.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.voice.auth import StudentAuthResult
from services.ai.business.voice.synthesize_handler import (
    SynthesizeBudgetExceededError,
    SynthesizeResult,
    TextTooLongError,
    UpstreamAzureError,
    synthesize_speech,
)
from services.ai.business.voice.tts import MAX_TEXT_CHARS, AzureTTSError


def _student(**overrides: Any) -> StudentAuthResult:
    base: dict[str, Any] = {
        "ok": True,
        "student_id": "stu-1",
        "auth_user_id": "auth-1",
        "grade": "8",
        "preferred_language": "en",
    }
    base.update(overrides)
    return StudentAuthResult(**base)


@pytest.fixture(autouse=True)
def _patch_ops_events(monkeypatch: pytest.MonkeyPatch):
    """Capture every log_voice_synthesize_event call."""
    captured: list[dict[str, Any]] = []

    async def fake_log(**kwargs):
        captured.append(kwargs)

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.log_voice_synthesize_event",
        fake_log,
    )
    return captured


@pytest.fixture()
def _budget_ok(monkeypatch: pytest.MonkeyPatch):
    async def fake_budget(**kwargs):
        del kwargs
        return True

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.check_daily_budget",
        fake_budget,
    )


@pytest.fixture()
def _budget_exceeded(monkeypatch: pytest.MonkeyPatch):
    async def fake_budget(**kwargs):
        del kwargs
        return False

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.check_daily_budget",
        fake_budget,
    )


# ── Happy path ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_synthesize_speech_happy_path(
    _budget_ok, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    captured_args: dict[str, Any] = {}

    async def fake_azure(text, voice_name, *, gender="female", **_):
        captured_args["text"] = text
        captured_args["voice_name"] = voice_name
        captured_args["gender"] = gender
        return b"\xff\xfb\x90\x00FAKE_MP3"

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )

    result = await synthesize_speech(
        text="Hello there",
        language="en",
        gender="female",
        voice_override=None,
        student=_student(),
        request_id="r-test-1",
    )
    assert isinstance(result, SynthesizeResult)
    assert result.audio_bytes == b"\xff\xfb\x90\x00FAKE_MP3"
    assert result.voice_used == "en-IN-NeerjaNeural"
    assert result.char_count == len("Hello there")
    assert result.request_id == "r-test-1"
    assert result.cost_inr > 0
    # Cost: 11 chars × 16/1M × 83 = 0.0000146… ≈ ₹0.0146e-2 → 0.0000
    # Verify it's at least non-negative and rounds to 4 dp
    assert result.cost_inr == round(result.cost_inr, 4)

    # Azure called with the resolved voice.
    assert captured_args["voice_name"] == "en-IN-NeerjaNeural"
    assert captured_args["gender"] == "female"
    assert captured_args["text"] == "Hello there"

    # Telemetry: one success row.
    assert len(_patch_ops_events) == 1
    row = _patch_ops_events[0]
    assert row["success"] is True
    assert row["severity"] == "info"
    assert row["student_id"] == "stu-1"
    assert row["grade"] == "8"
    assert row["voice_used"] == "en-IN-NeerjaNeural"
    assert row["char_count"] == 11
    # PII safety — telemetry must not include raw text or audio bytes.
    assert "text" not in row
    assert "audio_bytes" not in row


@pytest.mark.asyncio
async def test_synthesize_speech_uses_hindi_voice_for_hi(
    _budget_ok, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    captured: dict[str, Any] = {}

    async def fake_azure(text, voice_name, **_):
        captured["voice_name"] = voice_name
        return b"audio"

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    result = await synthesize_speech(
        text="नमस्ते",
        language="hi",
        gender="female",
        voice_override=None,
        student=_student(),
        request_id="r-2",
    )
    assert captured["voice_name"] == "hi-IN-SwaraNeural"
    assert result.voice_used == "hi-IN-SwaraNeural"


@pytest.mark.asyncio
async def test_synthesize_speech_uses_hindi_voice_for_hinglish(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """Hinglish → Hindi voice (best phonemes for code-switch)."""
    captured: dict[str, Any] = {}

    async def fake_azure(text, voice_name, **_):
        captured["voice_name"] = voice_name
        return b"audio"

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    result = await synthesize_speech(
        text="namaste dost",
        language="hinglish",
        gender="male",
        voice_override=None,
        student=_student(),
    )
    assert captured["voice_name"] == "hi-IN-MadhurNeural"
    assert result.voice_used == "hi-IN-MadhurNeural"


@pytest.mark.asyncio
async def test_synthesize_speech_honors_voice_override(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    captured: dict[str, Any] = {}

    async def fake_azure(text, voice_name, **_):
        captured["voice_name"] = voice_name
        return b"audio"

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    result = await synthesize_speech(
        text="hello",
        language="en",  # would map to Neerja
        gender="female",
        voice_override="hi-IN-MadhurNeural",  # but override wins
        student=_student(),
    )
    assert captured["voice_name"] == "hi-IN-MadhurNeural"
    assert result.voice_used == "hi-IN-MadhurNeural"


@pytest.mark.asyncio
async def test_synthesize_speech_generates_request_id_when_missing(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    async def fake_azure(*a, **kw):
        del a, kw
        return b"audio"

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    result = await synthesize_speech(
        text="hello",
        language="en",
        gender="female",
        voice_override=None,
        student=_student(),
        request_id=None,
    )
    # UUID format check.
    assert len(result.request_id) == 36
    assert result.request_id.count("-") == 4


# ── Length guard ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_synthesize_speech_raises_when_text_too_long(
    _budget_ok, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    async def fake_azure(*a, **kw):
        raise AssertionError("Azure must NOT be called for too-long text")

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    oversize_text = "x" * (MAX_TEXT_CHARS + 1)
    with pytest.raises(TextTooLongError):
        await synthesize_speech(
            text=oversize_text,
            language="en",
            gender="female",
            voice_override=None,
            student=_student(),
        )
    # Telemetry: one warning row, text_too_long reason.
    assert len(_patch_ops_events) == 1
    assert _patch_ops_events[0]["success"] is False
    assert "text_too_long" in _patch_ops_events[0]["failure_reason"]


# ── Budget guard ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_synthesize_speech_raises_when_budget_exceeded(
    _budget_exceeded, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    async def fake_azure(*a, **kw):
        raise AssertionError("Azure must NOT be called when budget is exceeded")

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    with pytest.raises(SynthesizeBudgetExceededError):
        await synthesize_speech(
            text="hello",
            language="en",
            gender="female",
            voice_override=None,
            student=_student(),
        )
    assert len(_patch_ops_events) == 1
    assert _patch_ops_events[0]["success"] is False
    assert _patch_ops_events[0]["severity"] == "warning"
    assert "budget" in _patch_ops_events[0]["failure_reason"].lower()


# ── Azure failure mapping ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_synthesize_speech_maps_502_for_azure_5xx(
    _budget_ok, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    async def fake_azure(*a, **kw):
        raise AzureTTSError("Azure overloaded", status=503)

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    with pytest.raises(UpstreamAzureError) as exc:
        await synthesize_speech(
            text="hello",
            language="en",
            gender="female",
            voice_override=None,
            student=_student(),
        )
    assert exc.value.status == 502
    assert _patch_ops_events[0]["success"] is False
    assert _patch_ops_events[0]["severity"] == "error"


@pytest.mark.asyncio
async def test_synthesize_speech_maps_503_for_azure_401(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """Our Azure key invalid (401) → 503 (we're misconfigured)."""

    async def fake_azure(*a, **kw):
        raise AzureTTSError("bad subscription key", status=401)

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    with pytest.raises(UpstreamAzureError) as exc:
        await synthesize_speech(
            text="hello",
            language="en",
            gender="female",
            voice_override=None,
            student=_student(),
        )
    assert exc.value.status == 503


@pytest.mark.asyncio
async def test_synthesize_speech_maps_503_for_azure_403(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """Forbidden (403) → 503 (we're misconfigured / wrong region)."""

    async def fake_azure(*a, **kw):
        raise AzureTTSError("forbidden", status=403)

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    with pytest.raises(UpstreamAzureError) as exc:
        await synthesize_speech(
            text="hello",
            language="en",
            gender="female",
            voice_override=None,
            student=_student(),
        )
    assert exc.value.status == 503


@pytest.mark.asyncio
async def test_synthesize_speech_maps_503_for_network_failure(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """status=0 (network-level) → 503."""

    async def fake_azure(*a, **kw):
        raise AzureTTSError("net down", status=0)

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    with pytest.raises(UpstreamAzureError) as exc:
        await synthesize_speech(
            text="hello",
            language="en",
            gender="female",
            voice_override=None,
            student=_student(),
        )
    assert exc.value.status == 503


@pytest.mark.asyncio
async def test_synthesize_speech_maps_502_for_azure_429(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """Azure 429 (rate limit) → 502 (upstream, retry next time)."""

    async def fake_azure(*a, **kw):
        raise AzureTTSError("rate limited", status=429)

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    with pytest.raises(UpstreamAzureError) as exc:
        await synthesize_speech(
            text="hello",
            language="en",
            gender="female",
            voice_override=None,
            student=_student(),
        )
    assert exc.value.status == 502


# ── Cost computation ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_synthesize_speech_computes_cost_inr(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    async def fake_azure(*a, **kw):
        return b"audio"

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.call_azure_tts",
        fake_azure,
    )
    # 1M chars (max-ish payload) at USD_TO_INR=83 = ₹1328. Use a smaller
    # known input for a precise check.
    # 300 chars × 16/1M × 83 = 0.3984
    result = await synthesize_speech(
        text="a" * 300,
        language="en",
        gender="female",
        voice_override=None,
        student=_student(),
    )
    assert result.cost_inr == pytest.approx(0.3984, abs=1e-4)
