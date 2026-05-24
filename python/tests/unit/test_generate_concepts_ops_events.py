"""Tests for the generate-concepts ops_events writer.

Covers the fire-and-forget contract: insert failures must NOT propagate,
and the row shape must carry no PII (no NCERT text, no concept body).
"""

from __future__ import annotations

from typing import Any

import pytest

from services.ai.business.generate_concepts.ops_events import log_generate_concepts_event


class _FakeClient:
    """Captures every insert payload + optionally raises on insert."""

    def __init__(self, raise_on_insert: bool = False) -> None:
        self.inserts: list[dict[str, Any]] = []
        self._raise = raise_on_insert
        self._table: str | None = None
        self._payload: dict[str, Any] | None = None

    def table(self, name: str) -> _FakeClient:
        self._table = name
        return self

    def insert(self, payload: dict[str, Any]) -> _FakeClient:
        self._payload = payload
        return self

    async def execute(self) -> dict[str, Any]:
        if self._raise:
            raise RuntimeError("ops_events insert failed")
        if self._table == "ops_events" and self._payload is not None:
            self.inserts.append(self._payload)
        return {"data": [], "status_code": 201}


def _install(monkeypatch: pytest.MonkeyPatch, client: Any) -> Any:
    monkeypatch.setattr(
        "services.ai.business.generate_concepts.ops_events.get_service_client",
        lambda: client,
    )
    return client


# ── Happy path ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_log_event_writes_row(monkeypatch: pytest.MonkeyPatch):
    fake = _install(monkeypatch, _FakeClient())
    await log_generate_concepts_event(
        category="generate_concepts.batch.started",
        severity="info",
        success=True,
        message="Batch started",
        context={"grade": "10", "subject": "math", "batch_size": 5},
        request_id="rid-1",
    )
    assert len(fake.inserts) == 1
    row = fake.inserts[0]
    assert row["category"] == "generate_concepts.batch.started"
    assert row["severity"] == "info"
    assert row["source"] == "generate-concepts"
    assert row["subject_type"] == "admin"
    assert row["subject_id"] is None
    assert row["request_id"] == "rid-1"


@pytest.mark.asyncio
async def test_log_event_context_includes_success_flag(
    monkeypatch: pytest.MonkeyPatch,
):
    fake = _install(monkeypatch, _FakeClient())
    await log_generate_concepts_event(
        category="generate_concepts.chapter.success",
        severity="info",
        success=True,
        message="OK",
    )
    row = fake.inserts[0]
    assert row["context"]["success"] is True


@pytest.mark.asyncio
async def test_log_event_context_explicit_overrides_default(
    monkeypatch: pytest.MonkeyPatch,
):
    """When the caller passes `success=True` AND a context dict with `success=False`,
    the explicit `success=True` does NOT override an existing key — setdefault
    semantics preserve the caller's context value."""
    fake = _install(monkeypatch, _FakeClient())
    await log_generate_concepts_event(
        category="x",
        severity="info",
        success=True,
        message="m",
        context={"success": False, "other": 1},
    )
    row = fake.inserts[0]
    # setdefault: caller's context already had `success` so it wins.
    assert row["context"]["success"] is False
    assert row["context"]["other"] == 1


# ── Fire-and-forget on failure ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_log_event_swallows_insert_failure(monkeypatch: pytest.MonkeyPatch):
    """The writer MUST NOT raise even when Supabase write fails."""
    _install(monkeypatch, _FakeClient(raise_on_insert=True))
    # No assertion needed — the call simply must not raise.
    await log_generate_concepts_event(
        category="generate_concepts.batch.complete",
        severity="info",
        success=True,
        message="Should swallow this",
    )


@pytest.mark.asyncio
async def test_log_event_no_op_when_client_none(monkeypatch: pytest.MonkeyPatch):
    _install(monkeypatch, None)
    # No assertion needed — the call simply must not raise.
    await log_generate_concepts_event(
        category="x",
        severity="info",
        success=True,
        message="m",
    )


# ── PII safety ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_log_event_context_can_hold_only_safe_metadata(
    monkeypatch: pytest.MonkeyPatch,
):
    """Sanity check: the writer doesn't post-process / strip PII from context.

    This means the contract is on the CALLER side — the handler must only
    pass safe keys (grade/subject/chapter_number/counters). We assert here
    that the writer faithfully echoes whatever it gets so any caller bug
    is observable in dashboards.
    """
    fake = _install(monkeypatch, _FakeClient())
    await log_generate_concepts_event(
        category="generate_concepts.chapter.success",
        severity="info",
        success=True,
        message="ok",
        context={
            "grade": "10",
            "subject": "math",
            "chapter_number": 3,
            "concept_count": 5,
        },
    )
    row = fake.inserts[0]
    ctx = row["context"]
    # Counter + ids only — no concept text key in the payload.
    assert set(ctx.keys()) <= {"grade", "subject", "chapter_number", "concept_count", "success"}
