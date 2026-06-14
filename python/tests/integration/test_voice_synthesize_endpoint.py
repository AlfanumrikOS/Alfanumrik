"""Integration tests for ``POST /v1/voice/synthesize`` (Voice 1b).

Uses ``fastapi.testclient.TestClient`` so the full app pipeline fires
(middleware, CORS, request-id binding, error mapping, JSON body
validation). External calls (Supabase Auth, students table, Azure TTS,
ops_events) are mocked.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from services.ai.api.main import create_app
from services.ai.business.voice.tts import AZURE_TTS_PATH

_AZURE_REGION = "centralindia"
_AZURE_URL = f"https://{_AZURE_REGION}.tts.speech.microsoft.com{AZURE_TTS_PATH}"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Fresh app + TestClient with Supabase + Azure configured."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key-stub")
    monkeypatch.setenv("AZURE_SPEECH_KEY", "azure-test-key")
    monkeypatch.setenv("AZURE_SPEECH_REGION", _AZURE_REGION)
    from services.ai.config import get_settings

    get_settings.cache_clear()
    return TestClient(create_app())


# ── Fake DB client (mirrors the transcribe endpoint test pattern) ─────────


class _FakeDbClient:
    """Mimics enough of postgrest's chain for the voice endpoints."""

    def __init__(self, student_rows: list[dict[str, Any]]) -> None:
        self.student_rows = student_rows
        self.ops: list[dict[str, Any]] = []
        self._current_table: str | None = None
        self._pending: list[dict[str, Any]] | None = None

    def table(self, name: str) -> _FakeDbClient:
        self._current_table = name
        return self

    def select(self, _columns: str) -> _FakeDbClient:
        return self

    def eq(self, _k: str, _v: Any) -> _FakeDbClient:
        return self

    def lt(self, _col: str, _val: str) -> _FakeDbClient:
        return self

    def gte(self, _col: str, _val: str) -> _FakeDbClient:
        return self

    def limit(self, _n: int) -> _FakeDbClient:
        return self

    def insert(self, rows) -> _FakeDbClient:
        if isinstance(rows, dict):
            self._pending = [rows]
        else:
            self._pending = list(rows)
        return self

    async def execute(self) -> dict[str, Any]:
        table = self._current_table
        pending = self._pending
        self._pending = None

        if pending is not None and table == "ops_events":
            self.ops.extend(pending)
            return {"data": pending, "status_code": 201}
        if pending is not None and table == "mol_request_logs":
            return {"data": pending, "status_code": 201}
        if table == "students":
            return {"data": self.student_rows, "status_code": 200}
        if table == "mol_request_logs":
            return {"data": [], "status_code": 200}
        return {"data": [], "status_code": 200}


def _install_fake_db(
    monkeypatch: pytest.MonkeyPatch,
    student_rows: list[dict[str, Any]] | None,
) -> _FakeDbClient:
    fake = _FakeDbClient(student_rows or [])
    monkeypatch.setattr(
        "services.ai.business.voice.auth.get_service_client",
        lambda: fake,
    )
    monkeypatch.setattr(
        "services.ai.business.voice.repository.get_service_client",
        lambda: fake,
    )
    monkeypatch.setattr(
        "services.ai.shared.budget_guard.get_service_client",
        lambda: fake,
    )
    monkeypatch.setattr(
        "services.ai.db.supabase.get_service_client",
        lambda: fake,
    )
    return fake


def _mock_supabase_auth(respx_mock: respx.MockRouter, user_id: str = "user-uuid"):
    return respx_mock.get("https://test.supabase.co/auth/v1/user").mock(
        return_value=httpx.Response(200, json={"id": user_id})
    )


def _mock_azure_tts_success(
    respx_mock: respx.MockRouter,
    audio: bytes = b"\xff\xfb\x90\x00FAKE_MP3_AUDIO",
):
    return respx_mock.post(_AZURE_URL).mock(
        return_value=httpx.Response(200, content=audio, headers={"Content-Type": "audio/mpeg"})
    )


# ── Happy path ─────────────────────────────────────────────────────────────


def test_voice_synthesize_happy_path(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Student posts text → Azure synthesizes → response carries audio bytes + headers."""
    _mock_supabase_auth(respx_mock)
    _mock_azure_tts_success(respx_mock, audio=b"\xff\xfb\x90\x00MP3DATA")
    fake_db = _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "student-uuid-1", "grade": "8", "preferred_language": "en"}],
    )

    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer student-jwt"},
        json={"text": "Hello world", "language": "en", "gender": "female"},
    )
    assert res.status_code == 200, res.text
    # Body is raw MP3 bytes.
    assert res.content == b"\xff\xfb\x90\x00MP3DATA"
    assert res.headers["content-type"].startswith("audio/mpeg")
    # Metadata in headers.
    assert res.headers["X-Voice-Used"] == "en-IN-NeerjaNeural"
    assert res.headers["X-Char-Count"] == "11"  # len('Hello world')
    # X-Cost-Inr is 4-decimal string.
    assert "." in res.headers["X-Cost-Inr"]
    assert len(res.headers["X-Cost-Inr"].split(".")[-1]) == 4
    # X-Request-Id is a UUIDv4 (36 chars).
    assert len(res.headers["X-Request-Id"]) == 36

    # ops_events row written (success).
    voice_events = [e for e in fake_db.ops if e["category"] == "voice.synthesize.success"]
    assert len(voice_events) == 1
    ctx = voice_events[0]["context"]
    # PII safety — telemetry has char_count, never the raw text.
    assert ctx["char_count"] == 11
    assert "text" not in ctx
    assert ctx["voice_used"] == "en-IN-NeerjaNeural"
    assert ctx["grade"] == "8"
    assert ctx["language"] == "en"


def test_voice_synthesize_hindi_uses_swara(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    _mock_supabase_auth(respx_mock)
    azure_route = _mock_azure_tts_success(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "10", "preferred_language": "hi"}],
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "नमस्ते दोस्त", "language": "hi", "gender": "female"},
    )
    assert res.status_code == 200, res.text
    assert res.headers["X-Voice-Used"] == "hi-IN-SwaraNeural"
    # Azure body must include the Devanagari text + Swara voice.
    body = azure_route.calls[0].request.content.decode("utf-8")
    assert "name='hi-IN-SwaraNeural'" in body
    assert "नमस्ते दोस्त" in body


def test_voice_synthesize_voice_override_honored(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    _mock_supabase_auth(respx_mock)
    azure_route = _mock_azure_tts_success(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={
            "text": "hello",
            "language": "en",
            "gender": "female",
            "voice_override": "hi-IN-MadhurNeural",
        },
    )
    assert res.status_code == 200, res.text
    assert res.headers["X-Voice-Used"] == "hi-IN-MadhurNeural"
    body = azure_route.calls[0].request.content.decode("utf-8")
    assert "name='hi-IN-MadhurNeural'" in body


# ── Auth failures ──────────────────────────────────────────────────────────


def test_voice_synthesize_returns_401_when_no_authorization(client: TestClient):
    res = client.post(
        "/v1/voice/synthesize",
        json={"text": "hi", "language": "en"},
    )
    assert res.status_code == 401, res.text
    body = res.json()
    assert body["detail"]["error"] == "AUTH_FAILED"


def test_voice_synthesize_returns_401_on_invalid_token(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    respx_mock.get("https://test.supabase.co/auth/v1/user").mock(return_value=httpx.Response(401))
    _install_fake_db(monkeypatch, student_rows=[])
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer bad-jwt"},
        json={"text": "hi", "language": "en"},
    )
    assert res.status_code == 401
    body = res.json()
    assert body["detail"]["error"] == "AUTH_FAILED"


def test_voice_synthesize_returns_403_when_user_not_student(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Valid JWT but no row in students → 403."""
    _mock_supabase_auth(respx_mock)
    _install_fake_db(monkeypatch, student_rows=[])
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "hi", "language": "en"},
    )
    assert res.status_code == 403


# ── Body validation ────────────────────────────────────────────────────────


def test_voice_synthesize_returns_422_on_missing_text(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    _mock_supabase_auth(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"language": "en"},  # missing text
    )
    # FastAPI body validation returns 422.
    assert res.status_code == 422


def test_voice_synthesize_returns_422_on_invalid_voice_override(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """REG-75 — voice_override regex enforced at the body layer."""
    _mock_supabase_auth(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={
            "text": "hi",
            "language": "en",
            "voice_override": "<script>alert(1)</script>",
        },
    )
    assert res.status_code == 422


def test_voice_synthesize_returns_422_on_text_over_2000_chars(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Pydantic max_length=2000 fires at the body layer."""
    _mock_supabase_auth(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "x" * 2001, "language": "en"},
    )
    assert res.status_code == 422


# ── Azure upstream errors ──────────────────────────────────────────────────


def test_voice_synthesize_returns_502_when_azure_persistently_5xx(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    _mock_supabase_auth(respx_mock)
    respx_mock.post(_AZURE_URL).mock(return_value=httpx.Response(503, text="down"))
    fake_db = _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "Hello world", "language": "en"},
    )
    assert res.status_code == 502, res.text
    body = res.json()
    assert body["detail"]["error"] == "AZURE_TTS_ERROR"
    failure_events = [e for e in fake_db.ops if e["category"] == "voice.synthesize.failure"]
    assert len(failure_events) == 1
    assert failure_events[0]["severity"] == "error"


def test_voice_synthesize_returns_503_when_azure_key_missing(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """Empty AZURE_SPEECH_KEY → handler returns 503 per-request."""
    _mock_supabase_auth(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )
    monkeypatch.setenv("AZURE_SPEECH_KEY", "")
    from services.ai.config import get_settings

    get_settings.cache_clear()

    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "hi", "language": "en"},
    )
    assert res.status_code == 503, res.text
    body = res.json()
    # Handler maps empty-key to 503; route uses SERVICE_MISCONFIGURED code.
    assert body["detail"]["error"] == "SERVICE_MISCONFIGURED"


def test_voice_synthesize_returns_413_when_text_too_long(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """The Pydantic max_length=2000 fires first as a 422, but if a caller
    bypasses validation (e.g. mid-pipeline mutation), the handler's
    defense-in-depth length check fires 413. We exercise the 422 path
    above; here we verify the 413 mapping exists via direct handler
    invocation through a monkey-patched route.

    Approach: patch ``synthesize_speech`` itself to bypass Pydantic and
    force a 413 — verifying the route's exception mapper.
    """
    _mock_supabase_auth(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )

    from services.ai.business.voice.synthesize_handler import TextTooLongError

    async def fake_handler(*a, **kw):
        del a, kw
        raise TextTooLongError("Text exceeds 2000 chars (got 9999)")

    monkeypatch.setattr(
        "services.ai.api.v1.voice.synthesize_speech",
        fake_handler,
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "hello", "language": "en"},
    )
    assert res.status_code == 413, res.text
    body = res.json()
    assert body["detail"]["error"] == "TEXT_TOO_LONG"


def test_voice_synthesize_returns_429_when_budget_exceeded(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """A budget-exceeded check short-circuits before Azure is called."""
    _mock_supabase_auth(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )
    respx_mock.post(_AZURE_URL).mock(return_value=httpx.Response(500, content=b"must not hit"))

    async def fake_budget(**kwargs):
        del kwargs
        return False

    monkeypatch.setattr(
        "services.ai.business.voice.synthesize_handler.check_daily_budget",
        fake_budget,
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "hi", "language": "en"},
    )
    assert res.status_code == 429, res.text
    body = res.json()
    assert body["detail"]["error"] == "BUDGET_EXCEEDED"


def test_voice_synthesize_returns_500_on_unexpected_internal_error(
    client: TestClient,
    respx_mock: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
):
    """An unhandled exception in the handler → generic 500, no PII leak."""
    _mock_supabase_auth(respx_mock)
    _install_fake_db(
        monkeypatch,
        student_rows=[{"id": "s", "grade": "8", "preferred_language": "en"}],
    )

    async def explode(*a, **kw):
        del a, kw
        raise RuntimeError("kaboom — internal contract violated")

    monkeypatch.setattr(
        "services.ai.api.v1.voice.synthesize_speech",
        explode,
    )
    res = client.post(
        "/v1/voice/synthesize",
        headers={"Authorization": "Bearer s"},
        json={"text": "hi", "language": "en"},
    )
    assert res.status_code == 500, res.text
    body = res.json()
    assert body["detail"]["error"] == "INTERNAL_ERROR"
    # The detail string is generic — underlying message must not leak.
    assert "kaboom" not in body["detail"]["detail"]
