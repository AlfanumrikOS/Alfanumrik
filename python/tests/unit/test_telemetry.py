"""Telemetry unit tests — row shape + fire-and-forget posture."""

from __future__ import annotations

import pytest

from services.ai.mol.telemetry import (
    LogPayload,
    _row_from_payload,
    record_mol_request,
    sum_tokens,
)
from services.ai.mol.types import TokenUsage


def _make_payload(**overrides) -> LogPayload:
    defaults = {
        "request_id": "rid-1",
        "student_id": "00000000-0000-0000-0000-000000000001",
        "task_type": "explanation",
        "surface": "foxy",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "passes": 1,
        "fallback_count": 0,
        "failure_chain": None,
        "latency_ms": 123,
        "tokens": TokenUsage(prompt=10, completion=20),
        "usd_cost": 0.000035,
        "inr_cost": 0.0029,
        "grade": "8",
        "language": "en",
        "exam_goal": "cbse",
    }
    defaults.update(overrides)
    return LogPayload(**defaults)


def test_row_from_payload_matches_mol_request_logs_columns():
    """Inserted row must contain every column expected by the migration."""
    row = _row_from_payload(_make_payload())
    expected_columns = {
        "request_id",
        "student_id",
        "task_type",
        "surface",
        "provider",
        "model",
        "passes",
        "fallback_count",
        "failure_chain",
        "latency_ms",
        "prompt_tokens",
        "completion_tokens",
        "usd_cost",
        "inr_cost",
        "grade",
        "language",
        "exam_goal",
        "shadow_of_request_id",
        "shadow_role",
        "trace_id",
    }
    assert set(row.keys()) == expected_columns


def test_row_explodes_tokens_into_prompt_completion_columns():
    """The TokenUsage object must become prompt_tokens + completion_tokens."""
    row = _row_from_payload(_make_payload(tokens=TokenUsage(prompt=11, completion=22)))
    assert row["prompt_tokens"] == 11
    assert row["completion_tokens"] == 22
    assert "tokens" not in row


def test_row_writes_explicit_nulls_for_shadow_columns_when_absent():
    """Legacy callers leave shadow_* unset; row must carry explicit Nones."""
    row = _row_from_payload(_make_payload())
    assert row["shadow_of_request_id"] is None
    assert row["shadow_role"] is None
    assert row["trace_id"] is None


def test_row_passes_through_shadow_columns_when_set():
    row = _row_from_payload(
        _make_payload(
            shadow_role="shadow",
            shadow_of_request_id="baseline-rid",
            trace_id="trace-xyz",
        )
    )
    assert row["shadow_role"] == "shadow"
    assert row["shadow_of_request_id"] == "baseline-rid"
    assert row["trace_id"] == "trace-xyz"


@pytest.mark.asyncio
async def test_record_mol_request_inserts_into_sink(mock_supabase_client):
    """Happy path: row lands in the fake telemetry sink."""
    payload = _make_payload()
    await record_mol_request(payload)
    assert len(mock_supabase_client.inserts) == 1
    inserted = mock_supabase_client.inserts[0]
    assert inserted["request_id"] == "rid-1"
    assert inserted["prompt_tokens"] == 10
    assert inserted["completion_tokens"] == 20


@pytest.mark.asyncio
async def test_record_mol_request_swallows_dirty_clients(monkeypatch):
    """When Supabase raises, the writer must NOT propagate the error."""

    class _BrokenClient:
        def table(self, _name):
            raise RuntimeError("simulated PostgREST outage")

    monkeypatch.setattr(
        "services.ai.db.supabase.get_service_client",
        lambda: _BrokenClient(),
    )

    # Must not raise.
    await record_mol_request(_make_payload())


@pytest.mark.asyncio
async def test_record_mol_request_skips_when_no_client(monkeypatch):
    """No Supabase configured → no insert attempt, no exception."""
    monkeypatch.setattr(
        "services.ai.db.supabase.get_service_client",
        lambda: None,
    )
    await record_mol_request(_make_payload())


def test_sum_tokens_combines_multiple_passes():
    total = sum_tokens(
        [
            TokenUsage(prompt=10, completion=5),
            TokenUsage(prompt=3, completion=7),
            TokenUsage(prompt=1, completion=2),
        ]
    )
    assert total.prompt == 14
    assert total.completion == 14


def test_sum_tokens_empty_list_returns_zeros():
    total = sum_tokens([])
    assert total.prompt == 0
    assert total.completion == 0
