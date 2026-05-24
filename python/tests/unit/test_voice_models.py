"""Tests for ``services.ai.business.voice.models``.

Coverage targets:
- TranscribeResponse field constraints (extra=forbid, value ranges).
- TranscribeError envelope shape.
- map_whisper_language heuristic (en / hi / hinglish / unknown branches).
- Romanized-vs-Devanagari script detector edge cases.
- SUPPORTED_AUDIO_FORMATS membership matches the Literal.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.voice.models import (
    SUPPORTED_AUDIO_FORMATS,
    TranscribeError,
    TranscribeResponse,
    _looks_romanized_latin,
    map_whisper_language,
)

# ── TranscribeResponse ──────────────────────────────────────────────────────


def test_transcribe_response_happy_path():
    r = TranscribeResponse(
        transcript="Hello world",
        detected_language="en",
        duration_seconds=2.5,
        audio_format="mp3",
        cost_inr=0.025,
        request_id="00000000-0000-0000-0000-000000000000",
    )
    assert r.transcript == "Hello world"
    assert r.detected_language == "en"
    assert r.duration_seconds == 2.5
    assert r.audio_format == "mp3"
    assert r.cost_inr == 0.025
    assert r.confidence is None


def test_transcribe_response_rejects_extra_fields():
    with pytest.raises(ValidationError):
        TranscribeResponse(
            transcript="hi",
            detected_language="en",
            duration_seconds=1.0,
            audio_format="mp3",
            cost_inr=0.0,
            request_id="r-1",
            bogus_field="x",  # extra='forbid'
        )


def test_transcribe_response_rejects_negative_duration():
    with pytest.raises(ValidationError):
        TranscribeResponse(
            transcript="hi",
            detected_language="en",
            duration_seconds=-1.0,
            audio_format="mp3",
            cost_inr=0.0,
            request_id="r-1",
        )


def test_transcribe_response_rejects_negative_cost():
    with pytest.raises(ValidationError):
        TranscribeResponse(
            transcript="hi",
            detected_language="en",
            duration_seconds=1.0,
            audio_format="mp3",
            cost_inr=-0.1,
            request_id="r-1",
        )


def test_transcribe_response_rejects_confidence_out_of_range():
    with pytest.raises(ValidationError):
        TranscribeResponse(
            transcript="hi",
            detected_language="en",
            duration_seconds=1.0,
            audio_format="mp3",
            cost_inr=0.0,
            request_id="r-1",
            confidence=1.5,
        )


def test_transcribe_response_rejects_invalid_audio_format():
    with pytest.raises(ValidationError):
        TranscribeResponse(
            transcript="hi",
            detected_language="en",
            duration_seconds=1.0,
            audio_format="aac",  # not in Literal
            cost_inr=0.0,
            request_id="r-1",
        )


def test_transcribe_response_rejects_invalid_detected_language():
    with pytest.raises(ValidationError):
        TranscribeResponse(
            transcript="hi",
            detected_language="fr",  # not in DetectedLanguage
            duration_seconds=1.0,
            audio_format="mp3",
            cost_inr=0.0,
            request_id="r-1",
        )


# ── TranscribeError ─────────────────────────────────────────────────────────


def test_transcribe_error_happy_path():
    e = TranscribeError(error="WHISPER_ERROR", detail="upstream 502", request_id="r-1")
    assert e.error == "WHISPER_ERROR"
    assert e.detail == "upstream 502"
    assert e.request_id == "r-1"


def test_transcribe_error_rejects_extras():
    with pytest.raises(ValidationError):
        TranscribeError(error="X", detail="y", request_id="r", debug_info="oops")


# ── map_whisper_language ────────────────────────────────────────────────────


def test_map_whisper_language_returns_en_for_english():
    assert map_whisper_language("en", "Hello there") == "en"


def test_map_whisper_language_returns_hi_for_devanagari():
    # Devanagari "namaste" — Whisper would return 'hi' for this audio.
    assert map_whisper_language("hi", "नमस्ते आप कैसे हैं") == "hi"


def test_map_whisper_language_returns_hinglish_for_romanized_hindi():
    # Whisper said 'hi' but transcript is Latin script → romanized Hindi
    # (Hinglish-style).
    assert map_whisper_language("hi", "namaste aap kaise hain") == "hinglish"


def test_map_whisper_language_returns_hi_for_mixed_but_devanagari_dominant():
    # Mostly Devanagari with one English word → 'hi'.
    assert map_whisper_language("hi", "मैं school जा रहा हूँ") == "hi"


def test_map_whisper_language_returns_unknown_for_other_languages():
    assert map_whisper_language("fr", "Bonjour le monde") == "unknown"
    assert map_whisper_language("zh", "你好") == "unknown"


def test_map_whisper_language_returns_unknown_for_none():
    assert map_whisper_language(None, "anything") == "unknown"
    assert map_whisper_language("", "anything") == "unknown"


def test_map_whisper_language_is_case_insensitive_and_strips():
    assert map_whisper_language("  EN  ", "hello") == "en"
    assert map_whisper_language("HI", "नमस्ते") == "hi"


# ── _looks_romanized_latin ─────────────────────────────────────────────────


def test_looks_romanized_latin_pure_english():
    assert _looks_romanized_latin("Hello world how are you") is True


def test_looks_romanized_latin_pure_devanagari():
    assert _looks_romanized_latin("नमस्ते आप कैसे हैं") is False


def test_looks_romanized_latin_majority_latin():
    # ≥3x more Latin than Devanagari → Latin dominant.
    # "namaste aap kaise hain" has only Latin script.
    assert _looks_romanized_latin("namaste aap kaise hain dost") is True


def test_looks_romanized_latin_mostly_latin_one_devanagari_token():
    # Multiple Latin words with one short Devanagari token. Ratio is well above 3x.
    assert _looks_romanized_latin("hello hello hello hello हाँ") is True


def test_looks_romanized_latin_close_to_threshold_returns_false():
    """Latin-to-Devanagari ratio < 3 → conservative 'not Latin dominant'."""
    # "aap kaise हैं" — 8 Latin chars vs 3 Devanagari (हैं = 3 codepoints)
    # → 2.67x, below the 3x threshold. We deliberately err toward 'hi' to
    # avoid mis-routing pure Hindi as Hinglish.
    assert _looks_romanized_latin("aap kaise हैं") is False


def test_looks_romanized_latin_majority_devanagari():
    assert _looks_romanized_latin("मैं school जा रहा हूँ") is False


def test_looks_romanized_latin_empty_string_returns_false():
    """No letters means we can't tell — be conservative and say 'not Latin'."""
    assert _looks_romanized_latin("") is False
    assert _looks_romanized_latin("123 !@#") is False


def test_looks_romanized_latin_accented_latin_counts_as_latin():
    # 'isalpha' picks up accented forms; this is intentional so French/
    # Spanish-styled romanizations are also detected as Latin.
    assert _looks_romanized_latin("café résumé") is True


# ── SUPPORTED_AUDIO_FORMATS ────────────────────────────────────────────────


def test_supported_audio_formats_matches_whisper_documented_list():
    """The set MUST stay aligned with OpenAI Whisper's accepted formats."""
    expected = {"webm", "mp3", "wav", "m4a", "ogg", "mpga", "flac"}
    # Compare via set semantics (frozenset == set holds when contents match)
    # — wrapped in set() to satisfy ruff's SIM300 Yoda-condition check
    # while staying readable.
    assert set(SUPPORTED_AUDIO_FORMATS) == expected
