"""Tests for ``services.ai.business.voice.handler.transcribe_audio``.

We mock ``call_whisper`` and ``check_daily_budget`` so these tests cover
the pipeline composition without making real HTTP / DB calls.
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.voice.auth import StudentAuthResult
from services.ai.business.voice.handler import (
    BudgetExceededError,
    PayloadTooLargeError,
    UpstreamWhisperError,
    transcribe_audio,
)
from services.ai.business.voice.transcribe import WHISPER_MAX_BYTES, WhisperError


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
    """Capture every log_voice_event call so tests can assert on telemetry."""
    captured: list[dict[str, Any]] = []

    async def fake_log_voice_event(**kwargs):
        captured.append(kwargs)

    monkeypatch.setattr(
        "services.ai.business.voice.handler.log_voice_event",
        fake_log_voice_event,
    )
    return captured


@pytest.fixture()
def _budget_ok(monkeypatch: pytest.MonkeyPatch):
    async def fake_budget(**kwargs):
        del kwargs
        return True

    monkeypatch.setattr(
        "services.ai.business.voice.handler.check_daily_budget",
        fake_budget,
    )


@pytest.fixture()
def _budget_exceeded(monkeypatch: pytest.MonkeyPatch):
    async def fake_budget(**kwargs):
        del kwargs
        return False

    monkeypatch.setattr(
        "services.ai.business.voice.handler.check_daily_budget",
        fake_budget,
    )


# ── Happy path ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transcribe_audio_happy_path(
    _budget_ok, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    async def fake_whisper(audio_bytes, audio_format, *, language_hint=None, **_):
        del audio_bytes, audio_format, language_hint
        return {
            "text": "  Hello there  ",
            "language": "en",
            "duration": 2.5,
        }

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )

    result = await transcribe_audio(
        b"fake-bytes",
        "mp3",
        _student(),
        request_id="r-test-1",
    )
    assert result.transcript == "Hello there"  # trimmed
    assert result.detected_language == "en"
    assert result.duration_seconds == 2.5
    assert result.audio_format == "mp3"
    # 2.5 s × ($0.006/60s) × 83 INR ≈ 0.0208
    assert result.cost_inr == pytest.approx(0.0208, abs=1e-3)
    assert result.request_id == "r-test-1"

    # Telemetry: one success row.
    assert len(_patch_ops_events) == 1
    row = _patch_ops_events[0]
    assert row["success"] is True
    assert row["severity"] == "info"
    assert row["student_id"] == "stu-1"
    assert row["grade"] == "8"
    assert row["transcript_length"] == len("Hello there")
    # PII safety — telemetry row must not include the raw transcript / bytes.
    assert "transcript" not in row
    assert "audio_bytes" not in row


@pytest.mark.asyncio
async def test_transcribe_audio_generates_request_id_when_missing(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    async def fake_whisper(*a, **kw):
        del a, kw
        return {"text": "x", "language": "en", "duration": 1.0}

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    result = await transcribe_audio(b"abc", "mp3", _student())
    # UUID format check — 36 chars, version-4 layout.
    assert len(result.request_id) == 36
    assert result.request_id.count("-") == 4


# ── Language hint ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transcribe_audio_passes_language_hint_to_whisper(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    received: dict[str, Any] = {}

    async def fake_whisper(audio_bytes, audio_format, *, language_hint=None, **_):
        del audio_bytes, audio_format
        received["language_hint"] = language_hint
        return {"text": "नमस्ते", "language": "hi", "duration": 1.0}

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    await transcribe_audio(
        b"abc",
        "webm",
        _student(preferred_language="en"),
        language_hint="hi",  # caller override wins
    )
    assert received["language_hint"] == "hi"


@pytest.mark.asyncio
async def test_transcribe_audio_falls_back_to_student_preferred_language(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    received: dict[str, Any] = {}

    async def fake_whisper(audio_bytes, audio_format, *, language_hint=None, **_):
        del audio_bytes, audio_format
        received["language_hint"] = language_hint
        return {"text": "x", "language": "hi", "duration": 1.0}

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    await transcribe_audio(
        b"abc",
        "webm",
        _student(preferred_language="hinglish"),
        language_hint=None,
    )
    assert received["language_hint"] == "hinglish"


@pytest.mark.asyncio
async def test_transcribe_audio_classifies_hinglish_for_romanized_hi(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """Whisper says 'hi' + Latin-dominant transcript → 'hinglish' in response."""

    async def fake_whisper(*a, **kw):
        del a, kw
        return {
            "text": "namaste aap kaise hain",
            "language": "hi",
            "duration": 2.0,
        }

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    result = await transcribe_audio(b"abc", "mp3", _student())
    assert result.detected_language == "hinglish"


# ── Budget guard ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transcribe_audio_raises_when_budget_exceeded(
    _budget_exceeded, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    async def fake_whisper(*a, **kw):
        raise AssertionError("Whisper must NOT be called when budget is exceeded")

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    with pytest.raises(BudgetExceededError):
        await transcribe_audio(b"abc", "mp3", _student())
    # Telemetry: one warning row, success=False.
    assert len(_patch_ops_events) == 1
    assert _patch_ops_events[0]["success"] is False
    assert _patch_ops_events[0]["severity"] == "warning"
    assert "budget" in _patch_ops_events[0]["failure_reason"].lower()


# ── Payload size guard ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transcribe_audio_raises_when_payload_too_large(
    _budget_ok, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    async def fake_whisper(*a, **kw):
        raise AssertionError("Whisper must NOT be called for oversize payloads")

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    oversize = b"x" * (WHISPER_MAX_BYTES + 1)
    with pytest.raises(PayloadTooLargeError):
        await transcribe_audio(oversize, "mp3", _student())
    # Telemetry: one warning row, payload_too_large reason.
    assert len(_patch_ops_events) == 1
    assert _patch_ops_events[0]["success"] is False
    assert "payload_too_large" in _patch_ops_events[0]["failure_reason"].lower()


# ── Whisper failure mapping ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transcribe_audio_maps_502_for_whisper_5xx(
    _budget_ok, _patch_ops_events, monkeypatch: pytest.MonkeyPatch
):
    async def fake_whisper(*a, **kw):
        raise WhisperError("upstream down", status=503)

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    with pytest.raises(UpstreamWhisperError) as exc:
        await transcribe_audio(b"abc", "mp3", _student())
    # 5xx from Whisper → 502 from our route (upstream issue, not us).
    assert exc.value.status == 502
    assert _patch_ops_events[0]["success"] is False
    assert _patch_ops_events[0]["severity"] == "error"


@pytest.mark.asyncio
async def test_transcribe_audio_maps_503_for_whisper_auth_error(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """Our API key invalid (401 from Whisper) → 503 (we're misconfigured)."""

    async def fake_whisper(*a, **kw):
        raise WhisperError("bad key", status=401)

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    with pytest.raises(UpstreamWhisperError) as exc:
        await transcribe_audio(b"abc", "mp3", _student())
    assert exc.value.status == 503


@pytest.mark.asyncio
async def test_transcribe_audio_maps_503_for_network_failure(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    """status=0 (network-level) → 503."""

    async def fake_whisper(*a, **kw):
        raise WhisperError("net down", status=0)

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    with pytest.raises(UpstreamWhisperError) as exc:
        await transcribe_audio(b"abc", "mp3", _student())
    assert exc.value.status == 503


# ── Whisper response edge cases ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_transcribe_audio_clamps_negative_duration(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    async def fake_whisper(*a, **kw):
        return {"text": "x", "language": "en", "duration": -5.0}

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    result = await transcribe_audio(b"abc", "mp3", _student())
    assert result.duration_seconds == 0.0
    assert result.cost_inr == 0.0


@pytest.mark.asyncio
async def test_transcribe_audio_handles_non_numeric_duration(
    _budget_ok, monkeypatch: pytest.MonkeyPatch
):
    async def fake_whisper(*a, **kw):
        return {"text": "x", "language": "en", "duration": "garbage"}

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    result = await transcribe_audio(b"abc", "mp3", _student())
    assert result.duration_seconds == 0.0


@pytest.mark.asyncio
async def test_transcribe_audio_handles_empty_text(_budget_ok, monkeypatch: pytest.MonkeyPatch):
    """Whisper returned 200 but no speech detected."""

    async def fake_whisper(*a, **kw):
        return {"text": "", "language": "en", "duration": 1.0}

    monkeypatch.setattr(
        "services.ai.business.voice.handler.call_whisper",
        fake_whisper,
    )
    result = await transcribe_audio(b"abc", "mp3", _student())
    assert result.transcript == ""
    assert result.detected_language == "en"
