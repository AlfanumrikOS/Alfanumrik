"""Direct unit test for the orchestrator ↔ prompt-builder call-site wiring.

Regression guard for the Phase-0.5 runtime bug: ``generate_response`` called
``build_system_prompt(task_type, req)`` / ``build_simplify_prompt(req, ...)``
while the real prompt-builder is defined as
``build_system_prompt(task, ctx, rag_context)`` /
``build_simplify_prompt(ctx, prior_answer)``. The mismatched arity + wrong
object types raised ``TypeError`` / ``AttributeError`` the moment the call
reached the builder — i.e. on every real generate. The integration suite
could not even collect (a separate cbse_parser import bug), so this defect
shipped silently.

This test exercises ``generate_response`` end-to-end with the REAL
prompt_builder (deliberately NOT shimmed), providers mocked at the HTTP layer
via the shared ``openai_success`` respx fixture, ``is_flag_enabled`` forced
False by the autouse ``_disable_flag_network`` fixture, and telemetry captured
by ``mock_supabase_client``. It asserts a ``MolResult`` comes back without the
call-site signature mismatch raising.
"""

from __future__ import annotations

import pytest

from services.ai.mol.orchestrator import generate_response
from services.ai.mol.types import (
    GenerateInput,
    GenerateRequest,
    MolResult,
    StudentContext,
)


@pytest.mark.asyncio
async def test_generate_response_wires_real_system_prompt_builder(
    openai_success, mock_supabase_client
):
    """A standard single-pass generate must build the system prompt via the
    real ``build_system_prompt(task, ctx, rag_context)`` without raising."""
    req = GenerateRequest(
        task_type="explanation",
        input=GenerateInput(question="What is photosynthesis?"),
        student_context=StudentContext(
            student_id="11111111-1111-1111-1111-111111111111",
            grade="8",
            language="en",
            subject="biology",
        ),
        rag_context="Photosynthesis converts light energy into chemical energy.",
    )

    result = await generate_response(req)

    # The core assertion: the real prompt-builder was called with the correct
    # objects (task, ctx, rag_context) and did NOT raise TypeError/AttributeError.
    # (The mocked provider text "OpenAI reply." is intentionally not asserted
    # verbatim — post_process() redacts the vendor token "OpenAI" per P12, which
    # is correct behavior and orthogonal to the call-site wiring under test.)
    assert isinstance(result, MolResult)
    assert isinstance(result.text, str)
    assert result.text  # non-empty
    assert result.provider == "openai"
    assert result.task_type == "explanation"
    assert result.passes == 1


@pytest.mark.asyncio
async def test_generate_response_handles_absent_rag_context(
    openai_success, mock_supabase_client
):
    """``rag_context`` is optional (defaults to None); passing it straight
    through to the builder must not raise on the None branch."""
    req = GenerateRequest(
        task_type="explanation",
        input=GenerateInput(question="Define velocity."),
        student_context=StudentContext(
            student_id="22222222-2222-2222-2222-222222222222",
            grade="9",
        ),
        # rag_context omitted → None
    )

    result = await generate_response(req)

    assert isinstance(result, MolResult)
    assert result.provider == "openai"
