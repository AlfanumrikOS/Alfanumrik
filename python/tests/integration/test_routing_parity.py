"""TS↔Python contract-parity cassettes (A9).

This is a CONTRACT PIN, not a behavioral test. It exists to fail loudly the
moment the TS↔Python routing decision or the ``mol_request_logs`` telemetry
column-set drifts apart. On a correct tree it is GREEN and changes nothing.

Two golden cassettes are pinned here:

1. ``ROUTING_CASSETTE`` — the head-of-chain ``(provider, model)`` the TS router
   produces for each task under the LIVE deterministic policy
   (``shadow_priority=False`` ⇒ OpenAI is always the primary rung; this shipped
   in Phase 1 / A2). The TS expectations are hand-derived golden values; the
   Python side runs live via :func:`select_provider_chain` and MUST match.
   If the parametrized routing test goes RED, Phase 1's deterministic flip has
   regressed in router.py — STOP and review (do NOT edit this cassette to
   paper over it).

2. ``TELEMETRY_COLUMNS`` — the exact key-set the Python telemetry writer
   (``telemetry._row_from_payload``) inserts into ``public.mol_request_logs``.
   This MUST stay column-for-column identical to the TS writer
   (``telemetry.ts:recordMolRequest``) so the super-admin dashboard, the
   ``mol_request_health_24h`` view, and ``mol_shadow_pairs_v1`` keep working
   after traffic cuts TS → Python. The set was confirmed against the real
   ``_row_from_payload`` projection at pin time (20 columns, flat
   prompt_tokens/completion_tokens, no created_at). If this test goes RED
   because the real insert shape changed, the column-set drifted — that is a
   real review event, not a test-only fix.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from services.ai.api.auth import require_active_student
from services.ai.api.main import create_app
from services.ai.mol.router import (
    GPT_FULL,
    GPT_MINI,
    RouterOptions,
    select_provider_chain,
)


@pytest.fixture()
def client(matching_student_dependency) -> TestClient:
    """Fresh app + TestClient per test (clean lifespan state)."""
    app = create_app()
    app.dependency_overrides[require_active_student] = matching_student_dependency
    return TestClient(app)


# ─── Cassette 1: routing decision (TS golden ↔ Python live) ──────────────────
#
# Hand-derived from the TS router's deterministic policy: with
# shadow_priority=False, OpenAI is the primary rung for every task. For the
# teaching tasks (explanation/step_by_step/quiz_generation) the OpenAI rung is
# gpt-4o-mini; for reasoning the only OpenAI rung is gpt-4o.
ROUTING_CASSETTE: dict[str, tuple[str, str]] = {
    "explanation": ("openai", GPT_MINI),
    "step_by_step": ("openai", GPT_MINI),
    "quiz_generation": ("openai", GPT_MINI),
    "reasoning": ("openai", GPT_FULL),
}


@pytest.mark.parametrize(("task", "expected"), list(ROUTING_CASSETTE.items()))
def test_routing_decision_matches_ts_cassette(task: str, expected: tuple[str, str]):
    """Python live routing head == TS golden cassette under deterministic policy.

    RED here means Phase 1's deterministic OpenAI-primary flip regressed in
    router.py. STOP and review — do NOT edit the cassette.
    """
    chain = select_provider_chain(task, RouterOptions(shadow_priority=False))
    head = chain.passes[0].chain[0]
    assert (head.provider, head.model) == expected


# ─── Cassette 2: telemetry row shape (TS golden ↔ Python live) ───────────────
#
# Confirmed against telemetry._row_from_payload at pin time. 20 columns, flat
# token counts (prompt_tokens / completion_tokens), no created_at. MUST match
# the TS writer (telemetry.ts:recordMolRequest) column-for-column.
TELEMETRY_COLUMNS: set[str] = {
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


@pytest.fixture()
def openai_default_route(respx_mock):
    """Pre-loaded 200 for the deterministic explanation chain's OpenAI head."""
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-parity",
                "model": "gpt-4o-mini",
                "choices": [
                    {
                        "message": {"role": "assistant", "content": "Parity reply."},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 6},
            },
        )
    )


def test_telemetry_row_shape_matches_ts_cassette(
    client: TestClient, openai_default_route, mock_supabase_client
):
    """Exactly one mol_request_logs row is written and its key-set is pinned.

    RED here means the real ``_row_from_payload`` insert shape drifted from the
    TS writer's column-set. That is a real contract-review event — fix the
    writer (and the TS twin) to re-converge, NOT this cassette.
    """
    payload = {
        "task_type": "explanation",
        "input": {"question": "What is photosynthesis?"},
        "student_context": {
            "student_id": "55555555-5555-5555-5555-555555555555",
            "grade": "8",
            "language": "en",
            "subject": "biology",
        },
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text

    # Exactly one telemetry row captured by the fake Supabase sink.
    assert len(mock_supabase_client.inserts) == 1
    row = mock_supabase_client.inserts[0]
    assert set(row.keys()) == TELEMETRY_COLUMNS
