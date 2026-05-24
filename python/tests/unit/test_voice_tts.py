"""Tests for ``services.ai.business.voice.tts``.

Coverage targets:
- ``VOICE_CATALOG`` maps every (language, gender) pair to an Indian-accent voice.
- ``resolve_voice`` precedence: override > catalog > fallback.
- ``build_ssml`` escaping (XML entities + injection attempts) + xml:lang
  derivation from voice prefix.
- ``estimate_cost_inr`` pure-function math.
- ``call_azure_tts`` happy + 4xx + 5xx + retry + network failure + empty
  body + missing key + missing region.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from services.ai.business.voice.tts import (
    AZURE_TTS_OUTPUT_FORMAT,
    AZURE_TTS_PATH,
    COST_USD_PER_MILLION_CHARS,
    VOICE_CATALOG,
    AzureTTSError,
    build_ssml,
    call_azure_tts,
    estimate_cost_inr,
    resolve_voice,
)

# The Azure URL the call_azure_tts function targets. ``conftest`` does not
# seed Azure env, so we set them in a fixture below — the URL host comes
# from the region we set there.
_AZURE_REGION = "centralindia"
_AZURE_URL = (
    f"https://{_AZURE_REGION}.tts.speech.microsoft.com{AZURE_TTS_PATH}"
)


@pytest.fixture(autouse=True)
def _seed_azure_env(monkeypatch: pytest.MonkeyPatch):
    """Seed AZURE_SPEECH_KEY + AZURE_SPEECH_REGION for every test.

    Tests that exercise the "missing key" branch override this with
    explicit ``monkeypatch.delenv``.
    """
    monkeypatch.setenv("AZURE_SPEECH_KEY", "azure-test-key")
    monkeypatch.setenv("AZURE_SPEECH_REGION", _AZURE_REGION)
    from services.ai.config import get_settings

    get_settings.cache_clear()


# ── VOICE_CATALOG ──────────────────────────────────────────────────────────


def test_voice_catalog_covers_all_lang_gender_combos():
    """REG-75 — every (language, gender) tuple maps to a voice."""
    expected_keys = {
        ("en", "female"),
        ("en", "male"),
        ("hi", "female"),
        ("hi", "male"),
        ("hinglish", "female"),
        ("hinglish", "male"),
    }
    assert set(VOICE_CATALOG.keys()) == expected_keys


def test_voice_catalog_uses_only_indian_voices():
    """REG-75 — direct CEO ask: Indian accent. Catch en-US, en-GB regressions."""
    for key, voice in VOICE_CATALOG.items():
        assert voice.startswith(("en-IN-", "hi-IN-")), (
            f"Voice {voice!r} for {key} is not an Indian voice (en-IN- or hi-IN- prefix)"
        )
        assert voice.endswith("Neural"), (
            f"Voice {voice!r} must be a neural voice (ends with 'Neural')"
        )


def test_voice_catalog_uses_neerja_for_english_female():
    """Pin the specific female English voice (Foxy default)."""
    assert VOICE_CATALOG[("en", "female")] == "en-IN-NeerjaNeural"


def test_voice_catalog_hinglish_uses_hindi_voices():
    """REG-75 — Hinglish handled by Hindi voices (Latin loanwords sound
    natural with Indian-English phonemes via Swara/Madhur)."""
    assert VOICE_CATALOG[("hinglish", "female")] == "hi-IN-SwaraNeural"
    assert VOICE_CATALOG[("hinglish", "male")] == "hi-IN-MadhurNeural"


# ── resolve_voice ──────────────────────────────────────────────────────────


def test_resolve_voice_returns_indian_voices_for_all_lang_gender_combos():
    """REG-75 — pinned regression test."""
    assert resolve_voice("en", "female", None) == "en-IN-NeerjaNeural"
    assert resolve_voice("en", "male", None) == "en-IN-PrabhatNeural"
    assert resolve_voice("hi", "female", None) == "hi-IN-SwaraNeural"
    assert resolve_voice("hi", "male", None) == "hi-IN-MadhurNeural"
    assert resolve_voice("hinglish", "female", None) == "hi-IN-SwaraNeural"
    assert resolve_voice("hinglish", "male", None) == "hi-IN-MadhurNeural"


def test_resolve_voice_honors_override():
    """voice_override wins over the catalog lookup."""
    assert (
        resolve_voice("en", "female", "hi-IN-MadhurNeural") == "hi-IN-MadhurNeural"
    )


def test_resolve_voice_falls_back_when_catalog_misses():
    """Defense in depth — bypass Pydantic and pass an unknown combo.

    Real callers come through Pydantic Literal enums, but the function
    is exposed as a module-level helper so we test the fallback path.
    """
    voice = resolve_voice("klingon", "neutral", None)  # type: ignore[arg-type]
    # Fallback is en-IN-NeerjaNeural per the implementation.
    assert voice == "en-IN-NeerjaNeural"


def test_resolve_voice_ignores_empty_override():
    """Empty / None / whitespace overrides fall through to catalog."""
    assert resolve_voice("en", "female", None) == "en-IN-NeerjaNeural"
    # Empty string falls through to catalog (Pydantic normalizes to None
    # but we test the raw helper too).
    # Note: the helper itself trusts the regex check from the validator;
    # an empty string is falsy so the override branch is skipped.
    assert resolve_voice("en", "female", "") == "en-IN-NeerjaNeural"


# ── build_ssml ─────────────────────────────────────────────────────────────


def test_build_ssml_includes_voice_name():
    ssml = build_ssml("Hello", "en-IN-NeerjaNeural", "female")
    assert "name='en-IN-NeerjaNeural'" in ssml


def test_build_ssml_uses_correct_xml_lang_for_voice_prefix():
    """REG-75 — voice id prefix drives xml:lang."""
    en_ssml = build_ssml("Hello", "en-IN-NeerjaNeural", "female")
    assert "xml:lang='en-IN'" in en_ssml

    hi_ssml = build_ssml("नमस्ते", "hi-IN-SwaraNeural", "female")
    assert "xml:lang='hi-IN'" in hi_ssml


def test_build_ssml_uses_title_case_gender_for_azure():
    """Azure SSML attribute uses ``Female``/``Male`` (Title-case)."""
    female_ssml = build_ssml("hi", "en-IN-NeerjaNeural", "female")
    assert "xml:gender='Female'" in female_ssml

    male_ssml = build_ssml("hi", "en-IN-PrabhatNeural", "male")
    assert "xml:gender='Male'" in male_ssml


def test_build_ssml_escapes_xml_entities():
    """REG-75 — SSML escaping is non-negotiable.

    If we don't escape ``</voice>``, a student could prematurely close
    the voice tag and inject neighbouring audio segments. Same for ``&``,
    ``<``, ``>``, ``"``, ``'``.
    """
    payload = "</voice><voice name='evil'>injected</voice>"
    ssml = build_ssml(payload, "en-IN-NeerjaNeural", "female")
    # The literal ``</voice>`` must appear EXACTLY ONCE — the closing
    # tag of our own outer voice element. Any second occurrence is an
    # injection.
    assert ssml.count("</voice>") == 1
    # The injected open-tag must be escaped (& → &amp;, < → &lt;).
    assert "&lt;voice" in ssml
    assert "<voice name='evil'>" not in ssml


def test_build_ssml_escapes_all_five_xml_special_chars():
    """``html.escape(quote=True)`` escapes & < > " ' — all 5 chars."""
    text = """5 < 10 & 7 > 3 "quote" 'apos'"""
    ssml = build_ssml(text, "en-IN-NeerjaNeural", "female")
    assert "&amp;" in ssml
    assert "&lt;" in ssml
    assert "&gt;" in ssml
    assert "&quot;" in ssml
    assert "&#x27;" in ssml  # apostrophe escape
    # The raw payload chars MUST NOT survive into the SSML. We check by
    # extracting only the inner text region (between <voice ...> and
    # </voice>) and asserting no raw special characters remain.
    inner_start = ssml.index("Neural'>") + len("Neural'>")
    inner_end = ssml.index("</voice>")
    inner = ssml[inner_start:inner_end]
    # Raw `<` would close the tag prematurely. Raw `&` would break SSML
    # parsing. Raw `"` and `'` would break the attribute values. Raw `>`
    # is technically OK in #PCDATA but Azure documentation recommends
    # escaping it for safety; html.escape does.
    assert "<" not in inner
    assert ">" not in inner
    assert '"' not in inner
    assert "'" not in inner
    # The raw `&` should only appear as the start of an entity (e.g.
    # &amp;, &lt;). Find every `&` and confirm each is followed by an
    # entity name + `;`.
    i = 0
    while i < len(inner):
        if inner[i] == "&":
            # Look ahead for an entity terminator (;) within the next ~6 chars.
            terminator = inner.find(";", i, i + 8)
            assert terminator != -1, (
                f"Raw '&' at index {i} is not part of an entity: {inner[i : i + 10]!r}"
            )
            i = terminator + 1
        else:
            i += 1


def test_build_ssml_preserves_unicode_text():
    """Devanagari + emoji must pass through unmodified."""
    text = "नमस्ते दोस्त 🚀"
    ssml = build_ssml(text, "hi-IN-SwaraNeural", "female")
    assert "नमस्ते दोस्त 🚀" in ssml


def test_build_ssml_includes_speak_root_element():
    """Sanity — the SSML must start with <speak version='1.0' ...>."""
    ssml = build_ssml("hi", "en-IN-NeerjaNeural", "female")
    assert ssml.startswith("<speak version='1.0' xml:lang='en-IN'>")
    assert ssml.endswith("</speak>")


# ── estimate_cost_inr ─────────────────────────────────────────────────────


def test_estimate_cost_inr_zero_chars():
    assert estimate_cost_inr(0, 83.0) == 0.0


def test_estimate_cost_inr_negative_chars_returns_zero():
    """Defensive — never seen but guard against it."""
    assert estimate_cost_inr(-5, 83.0) == 0.0


def test_estimate_cost_inr_one_million_chars_at_83():
    """1M chars × $16 × 83 = ₹1328."""
    assert estimate_cost_inr(1_000_000, 83.0) == pytest.approx(1328.0, rel=1e-3)


def test_estimate_cost_inr_typical_tutor_reply():
    """~300 chars (a typical Foxy reply): 300 × 16/1M × 83 = ₹0.3984."""
    assert estimate_cost_inr(300, 83.0) == pytest.approx(0.3984, abs=1e-4)


def test_estimate_cost_inr_uses_passed_usd_to_inr():
    """Conversion rate is plumbed via Settings — pure-fn confirms."""
    assert estimate_cost_inr(1_000_000, 100.0) == pytest.approx(1600.0, rel=1e-3)


def test_cost_per_million_chars_constant_matches_azure_pricing():
    """Sanity check — guard against an accidental edit to the rate."""
    assert pytest.approx(16.0, rel=1e-9) == COST_USD_PER_MILLION_CHARS


# ── call_azure_tts — happy + auth ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_call_azure_tts_returns_audio_bytes(respx_mock: respx.MockRouter):
    route = respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(
            200,
            content=b"\xff\xfb\x90\x00FAKE_MP3_AUDIO_BYTES",
            headers={"Content-Type": "audio/mpeg"},
        )
    )
    audio = await call_azure_tts("Hello world", "en-IN-NeerjaNeural")
    assert audio == b"\xff\xfb\x90\x00FAKE_MP3_AUDIO_BYTES"
    assert route.called


@pytest.mark.asyncio
async def test_call_azure_tts_sends_subscription_key_header(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(200, content=b"audio")
    )
    await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    req = route.calls[0].request
    assert req.headers["Ocp-Apim-Subscription-Key"] == "azure-test-key"


@pytest.mark.asyncio
async def test_call_azure_tts_sends_output_format_header(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(200, content=b"audio")
    )
    await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    req = route.calls[0].request
    assert req.headers["X-Microsoft-OutputFormat"] == AZURE_TTS_OUTPUT_FORMAT


@pytest.mark.asyncio
async def test_call_azure_tts_sends_ssml_content_type(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(200, content=b"audio")
    )
    await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    req = route.calls[0].request
    assert req.headers["Content-Type"] == "application/ssml+xml"


@pytest.mark.asyncio
async def test_call_azure_tts_sends_ssml_body(respx_mock: respx.MockRouter):
    route = respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(200, content=b"audio")
    )
    await call_azure_tts("Hello world", "hi-IN-SwaraNeural", gender="female")
    body = route.calls[0].request.content.decode("utf-8")
    assert body.startswith("<speak version='1.0'")
    assert "name='hi-IN-SwaraNeural'" in body
    assert "Hello world" in body
    assert "xml:gender='Female'" in body


# ── call_azure_tts — failure modes ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_call_azure_tts_raises_on_400(respx_mock: respx.MockRouter):
    """4xx short-circuits — no retries."""
    route = respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(400, text="Bad SSML")
    )
    with pytest.raises(AzureTTSError) as exc:
        await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    assert exc.value.status == 400
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_call_azure_tts_retries_on_503_then_succeeds(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(_AZURE_URL).mock(
        side_effect=[
            httpx.Response(503, text="overloaded"),
            httpx.Response(200, content=b"audio-bytes"),
        ]
    )
    audio = await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    assert audio == b"audio-bytes"
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_call_azure_tts_raises_when_503_persists(
    respx_mock: respx.MockRouter,
):
    route = respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(503, text="down")
    )
    with pytest.raises(AzureTTSError) as exc:
        await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    assert exc.value.status == 503
    assert route.call_count == 3


@pytest.mark.asyncio
async def test_call_azure_tts_raises_on_network_error(
    respx_mock: respx.MockRouter,
):
    respx_mock.post(_AZURE_URL).mock(side_effect=httpx.ConnectError("offline"))
    with pytest.raises(AzureTTSError) as exc:
        await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    assert exc.value.status == 0


@pytest.mark.asyncio
async def test_call_azure_tts_raises_when_200_with_empty_body(
    respx_mock: respx.MockRouter,
):
    """200 + empty body = Azure contract violation."""
    respx_mock.post(_AZURE_URL).mock(return_value=httpx.Response(200, content=b""))
    with pytest.raises(AzureTTSError) as exc:
        await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    assert exc.value.status == 200


@pytest.mark.asyncio
async def test_call_azure_tts_raises_when_key_missing(monkeypatch: pytest.MonkeyPatch):
    """No AZURE_SPEECH_KEY → fail-CLOSED before any HTTP."""
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False)
    from services.ai.config import get_settings

    get_settings.cache_clear()
    with pytest.raises(AzureTTSError) as exc:
        await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    assert exc.value.status == 0


@pytest.mark.asyncio
async def test_call_azure_tts_raises_when_region_missing(
    monkeypatch: pytest.MonkeyPatch,
):
    """Empty AZURE_SPEECH_REGION → fail-CLOSED."""
    monkeypatch.setenv("AZURE_SPEECH_REGION", "")
    from services.ai.config import get_settings

    get_settings.cache_clear()
    with pytest.raises(AzureTTSError) as exc:
        await call_azure_tts("Hello", "en-IN-NeerjaNeural")
    assert exc.value.status == 0
