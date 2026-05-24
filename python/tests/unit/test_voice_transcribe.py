"""Tests for ``services.ai.business.voice.transcribe``.

Coverage targets:
- Whisper API URL / model / multipart shape (assertions on the captured
  respx request).
- 200 happy path returns the parsed dict.
- 4xx short-circuits the retry decorator on first attempt.
- 5xx triggers retry; persistent 5xx → WhisperError(status=5xx).
- Network failure (httpx.ConnectError) → WhisperError(status=0).
- Missing API key → WhisperError(status=0) before any HTTP call.
- Language hint mapping (en/hi/hinglish → en/hi; unknown → omitted).
- estimate_cost_inr pure-function math.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from services.ai.business.voice.transcribe import (
    COST_USD_PER_MINUTE,
    WhisperError,
    call_whisper,
    estimate_cost_inr,
)

WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"


# ── Happy path ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_call_whisper_returns_parsed_response(respx_mock: respx.MockRouter):
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "text": "Hello world",
                "language": "en",
                "duration": 2.5,
                "segments": [],
                "task": "transcribe",
            },
        )
    )
    res = await call_whisper(b"fake-audio-bytes", "mp3", language_hint=None)
    assert res["text"] == "Hello world"
    assert res["language"] == "en"
    assert res["duration"] == 2.5
    assert route.called


@pytest.mark.asyncio
async def test_call_whisper_sends_authorization_header(respx_mock: respx.MockRouter):
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(
            200,
            json={"text": "x", "language": "en", "duration": 1.0},
        )
    )
    await call_whisper(b"audio", "mp3")
    assert route.call_count == 1
    req = route.calls[0].request
    auth = req.headers.get("authorization", "")
    # conftest seeds OPENAI_API_KEY=sk-test-openai-key
    assert auth.startswith("Bearer ")
    assert "sk-test-openai-key" in auth


@pytest.mark.asyncio
async def test_call_whisper_includes_language_hint_when_provided(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(
            200, json={"text": "namaste", "language": "hi", "duration": 1.0}
        )
    )
    await call_whisper(b"audio", "webm", language_hint="hi")
    body = route.calls[0].request.content.decode("utf-8", errors="replace")
    assert "language" in body
    # multipart form: look for the field name (not strict — multipart
    # encoding varies — but the literal 'language' AND 'hi' should both
    # appear in the body).
    assert "hi" in body


@pytest.mark.asyncio
async def test_call_whisper_maps_hinglish_to_hi_language_hint(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(
            200, json={"text": "x", "language": "hi", "duration": 1.0}
        )
    )
    await call_whisper(b"audio", "mp3", language_hint="hinglish")
    body = route.calls[0].request.content.decode("utf-8", errors="replace")
    # 'hinglish' is folded to 'hi' — the multipart body must NOT carry the literal.
    assert "hinglish" not in body


@pytest.mark.asyncio
async def test_call_whisper_omits_language_when_hint_is_none(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(
            200, json={"text": "x", "language": "en", "duration": 1.0}
        )
    )
    await call_whisper(b"audio", "mp3", language_hint=None)
    body = route.calls[0].request.content.decode("utf-8", errors="replace")
    # Multipart form fields delimit field names with `name="..."`. When the
    # caller passes no language, our code must not emit a "language" form
    # field. (We assert on the multipart name attribute to avoid false
    # positives where "language" appears in random base64-ish audio bytes.)
    assert 'name="language"' not in body


@pytest.mark.asyncio
async def test_call_whisper_omits_language_when_hint_is_unknown_token(
    respx_mock: respx.MockRouter,
):
    """An alias outside {en, hi, hinglish} → omit the language form field."""
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(
            200, json={"text": "x", "language": "en", "duration": 1.0}
        )
    )
    await call_whisper(b"audio", "mp3", language_hint="fr")
    body = route.calls[0].request.content.decode("utf-8", errors="replace")
    assert 'name="language"' not in body


# ── Defensive parsing ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_call_whisper_fills_defaults_on_quirky_200(respx_mock: respx.MockRouter):
    """A 200 missing fields gets defensive defaults (the handler relies on this)."""
    respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(200, json={})
    )
    res = await call_whisper(b"audio", "mp3")
    assert res["text"] == ""
    assert res["language"] == ""
    assert res["duration"] == 0.0


@pytest.mark.asyncio
async def test_call_whisper_raises_on_non_dict_200(respx_mock: respx.MockRouter):
    respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(200, json=["not a dict"])
    )
    with pytest.raises(WhisperError) as exc:
        await call_whisper(b"audio", "mp3")
    assert exc.value.status == 200


@pytest.mark.asyncio
async def test_call_whisper_raises_on_non_json_200(respx_mock: respx.MockRouter):
    respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(200, text="<html>500</html>")
    )
    with pytest.raises(WhisperError) as exc:
        await call_whisper(b"audio", "mp3")
    assert exc.value.status == 200


# ── 4xx / 5xx handling ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_call_whisper_raises_whisper_error_on_400(respx_mock: respx.MockRouter):
    """400s short-circuit (the default retry predicate doesn't retry 4xx)."""
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(400, json={"error": "bad request"})
    )
    with pytest.raises(WhisperError) as exc:
        await call_whisper(b"audio", "mp3")
    assert exc.value.status == 400
    assert route.call_count == 1  # no retries


@pytest.mark.asyncio
async def test_call_whisper_retries_on_503_then_succeeds(respx_mock: respx.MockRouter):
    route = respx_mock.post(WHISPER_URL).mock(
        side_effect=[
            httpx.Response(503, json={"error": "overloaded"}),
            httpx.Response(
                200,
                json={"text": "x", "language": "en", "duration": 1.0},
            ),
        ]
    )
    res = await call_whisper(b"audio", "mp3")
    assert res["text"] == "x"
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_call_whisper_raises_when_503_persists(respx_mock: respx.MockRouter):
    """Three consecutive 503s exhaust retries → WhisperError(status=503)."""
    route = respx_mock.post(WHISPER_URL).mock(
        return_value=httpx.Response(503, json={"error": "down"})
    )
    with pytest.raises(WhisperError) as exc:
        await call_whisper(b"audio", "mp3")
    assert exc.value.status == 503
    assert route.call_count == 3


@pytest.mark.asyncio
async def test_call_whisper_raises_when_network_fails(respx_mock: respx.MockRouter):
    respx_mock.post(WHISPER_URL).mock(side_effect=httpx.ConnectError("offline"))
    with pytest.raises(WhisperError) as exc:
        await call_whisper(b"audio", "mp3")
    assert exc.value.status == 0


@pytest.mark.asyncio
async def test_call_whisper_raises_when_api_key_missing(monkeypatch: pytest.MonkeyPatch):
    """No OPENAI_API_KEY → fail-CLOSED before any HTTP."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from services.ai.config import get_settings

    get_settings.cache_clear()
    with pytest.raises(WhisperError) as exc:
        await call_whisper(b"audio", "mp3")
    assert exc.value.status == 0


# ── estimate_cost_inr ──────────────────────────────────────────────────────


def test_estimate_cost_inr_zero_duration():
    assert estimate_cost_inr(0.0, 83.0) == 0.0


def test_estimate_cost_inr_negative_duration_returns_zero():
    """Defensive — Whisper hasn't reported negative durations."""
    assert estimate_cost_inr(-5.0, 83.0) == 0.0


def test_estimate_cost_inr_one_minute_at_83():
    """1 min × $0.006 × 83 = ₹0.498."""
    assert estimate_cost_inr(60.0, 83.0) == pytest.approx(0.498, rel=1e-3)


def test_estimate_cost_inr_two_minutes_at_83():
    assert estimate_cost_inr(120.0, 83.0) == pytest.approx(0.996, rel=1e-3)


def test_estimate_cost_inr_fractional_seconds():
    # 30 s = 0.5 min × 0.006 × 83 = 0.249
    assert estimate_cost_inr(30.0, 83.0) == pytest.approx(0.249, rel=1e-3)


def test_estimate_cost_inr_uses_passed_usd_to_inr():
    """The conversion rate is plumbed via Settings.usd_to_inr — pure-fn confirms."""
    assert estimate_cost_inr(60.0, 100.0) == pytest.approx(0.6, rel=1e-3)


def test_cost_per_minute_constant_matches_openai_pricing():
    """Sanity check — guard against an accidental edit to the rate."""
    assert pytest.approx(0.006, rel=1e-9) == COST_USD_PER_MINUTE
