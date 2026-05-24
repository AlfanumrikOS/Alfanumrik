"""Tests for ``services.ai.business.voice.models``.

Coverage targets:
- TranscribeResponse field constraints (extra=forbid, value ranges).
- TranscribeError envelope shape.
- map_whisper_language heuristic (en / hi / hinglish / unknown branches).
- Romanized-vs-Devanagari script detector edge cases.
- SUPPORTED_AUDIO_FORMATS membership matches the Literal.
- SynthesizeRequest field constraints (extra=forbid, length caps).
- SynthesizeRequest.voice_override regex enforcement (REG-75).
- SynthesizeError envelope shape.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.voice.models import (
    SUPPORTED_AUDIO_FORMATS,
    SynthesizeError,
    SynthesizeRequest,
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


# ── SynthesizeRequest (Voice 1b) ────────────────────────────────────────────


def test_synthesize_request_happy_path():
    r = SynthesizeRequest(
        text="Hello there",
        language="en",
        gender="female",
        voice_override=None,
    )
    assert r.text == "Hello there"
    assert r.language == "en"
    assert r.gender == "female"
    assert r.voice_override is None


def test_synthesize_request_gender_defaults_to_female():
    r = SynthesizeRequest(text="hi", language="hi")
    assert r.gender == "female"


def test_synthesize_request_rejects_extra_fields():
    with pytest.raises(ValidationError):
        SynthesizeRequest(text="hi", language="en", bogus="x")


def test_synthesize_request_rejects_empty_text():
    with pytest.raises(ValidationError):
        SynthesizeRequest(text="", language="en")


def test_synthesize_request_rejects_text_over_2000_chars():
    with pytest.raises(ValidationError):
        SynthesizeRequest(text="x" * 2001, language="en")


def test_synthesize_request_accepts_2000_char_text():
    """The cap is INCLUSIVE — exactly 2000 chars is allowed."""
    r = SynthesizeRequest(text="x" * 2000, language="en")
    assert len(r.text) == 2000


def test_synthesize_request_rejects_invalid_language():
    with pytest.raises(ValidationError):
        SynthesizeRequest(text="hi", language="fr")  # type: ignore[arg-type]


def test_synthesize_request_rejects_invalid_gender():
    with pytest.raises(ValidationError):
        SynthesizeRequest(
            text="hi", language="en", gender="neutral"  # type: ignore[arg-type]
        )


def test_synthesize_request_accepts_valid_voice_override():
    """REG-75 — voice_override matching the Azure regex passes."""
    r = SynthesizeRequest(
        text="hi", language="en", voice_override="hi-IN-SwaraNeural"
    )
    assert r.voice_override == "hi-IN-SwaraNeural"


def test_voice_override_must_match_neural_regex():
    """REG-75 — pinned regression test.

    Reject arbitrary strings so they cannot reach Azure's SSML body.
    """
    bad_overrides = [
        "evil",
        "en-IN-NeerjaStandard",  # not Neural
        "EN-IN-NeerjaNeural",  # caps wrong
        "en_IN_NeerjaNeural",  # underscore
        "en-IN-Neerja",  # no Neural suffix
        "<script>alert(1)</script>",
        "../etc/passwd",
        "en-IN-Neerja Neural",  # space
        "en-IN-NeerjaNeural; DROP TABLE",
        "en-IN--Neural",  # missing name segment
    ]
    for bad in bad_overrides:
        with pytest.raises(ValidationError):
            SynthesizeRequest(text="hi", language="en", voice_override=bad)


def test_voice_override_empty_string_normalizes_to_none():
    """Empty / whitespace voice_override → None (falls through to catalog)."""
    r = SynthesizeRequest(text="hi", language="en", voice_override="")
    assert r.voice_override is None
    r = SynthesizeRequest(text="hi", language="en", voice_override="   ")
    assert r.voice_override is None


def test_voice_override_max_length_64():
    """A truly massive voice_override is rejected even if it matches the regex shape."""
    # Construct a string longer than 64 chars that still vaguely looks
    # like the pattern — the max_length check fires before the regex.
    too_long = "en-IN-" + ("a" * 60) + "Neural"  # >> 64 chars
    with pytest.raises(ValidationError):
        SynthesizeRequest(
            text="hi", language="en", voice_override=too_long
        )


# ── SynthesizeError envelope ────────────────────────────────────────────────


def test_synthesize_error_happy_path():
    e = SynthesizeError(
        error="AZURE_TTS_ERROR",
        detail="upstream 503",
        request_id="r-1",
    )
    assert e.error == "AZURE_TTS_ERROR"
    assert e.detail == "upstream 503"
    assert e.request_id == "r-1"


def test_synthesize_error_rejects_extras():
    with pytest.raises(ValidationError):
        SynthesizeError(
            error="X", detail="y", request_id="r", debug_info="oops"
        )
