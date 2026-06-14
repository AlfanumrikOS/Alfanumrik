"""Single-pass MCQ generation via the MoL router.

Replaces the direct Anthropic call from TS bulk-question-gen with a call to
:func:`services.ai.mol.generate_response` routed through the same
``quiz_generation`` chain (OpenAI gpt-4o-mini primary, Claude Haiku fallback).

The TS source explicitly passes ``preferred_provider='openai'`` so the
admin-only generation posture defaults to the cheaper provider — we mirror
that. See TS comments at index.ts lines 360-396 for the routing rationale.
"""

from __future__ import annotations

import structlog

from ...mol import (
    GenerateConfig,
    GenerateRequest,
    StudentContext,
    generate_response,
)
from ...mol.errors import MolError
from ...mol.types import GenerateInput
from .models import BulkQuestionGenRequest, CandidateQuestion
from .prompts import build_system_prompt, build_user_prompt
from .validator import extract_json_array

logger = structlog.get_logger(__name__)

# Token budget for the bulk-gen call. TS uses 8192 (index.ts line 384).
# Rationale: up to 50 questions × ~150 tokens each = ~7500 tokens output.
_GENERATION_MAX_TOKENS = 8192


class GenerationError(RuntimeError):
    """Raised when the generator fails after MoL retries are exhausted."""

    def __init__(self, message: str, *, mol_code: str | None = None) -> None:
        super().__init__(message)
        self.mol_code = mol_code


async def generate_candidates(
    request: BulkQuestionGenRequest,
    *,
    request_id: str,
) -> list[CandidateQuestion]:
    """Run one MoL call and return parsed candidates.

    Routing:
        - task_type='quiz_generation'  → router selects the quiz chain
        - preferred_provider='openai'  → reorders to put gpt-4o-mini first
        - system_prompt_override       → bypasses the Phase-0 stub builder

    Raises:
        :class:`GenerationError` when MoL exhausts retries (all providers fail)
        or when the LLM response can't be parsed as a JSON array.
    """
    system_prompt = build_system_prompt(request.grade, request.subject)
    user_prompt = build_user_prompt(
        grade=request.grade,
        subject=request.subject,
        chapter=request.chapter,
        count=request.count,
        difficulty=request.difficulty,
        bloom_level=request.bloom_level,
    )

    # student_id is a synthetic admin-namespaced UUID — the generator has no
    # student. Required by MoL's INVALID_INPUT validator (orchestrator.py
    # checks ``student_context.student_id`` is non-empty). The TS path
    # does the same (index.ts lines 372-379).
    student_ctx = StudentContext(
        student_id=f"admin-bulk-question-gen-{request_id}",
        grade=request.grade,
        language="en",
        subject=request.subject,
    )

    mol_request = GenerateRequest(
        task_type="quiz_generation",
        input=GenerateInput(instruction=user_prompt),
        student_context=student_ctx,
        config=GenerateConfig(
            preferred_provider="openai",
            temperature_override=0.3,
            request_id=request_id,
            surface="quiz",
            max_tokens_override=_GENERATION_MAX_TOKENS,
            system_prompt_override=system_prompt,
        ),
    )

    try:
        mol_result = await generate_response(mol_request)
    except MolError as err:
        logger.warning(
            "bulk_question_gen.generator.mol_failed",
            code=err.code,
            message=err.message,
            request_id=request_id,
        )
        raise GenerationError(f"MoL {err.code}: {err.message}", mol_code=err.code) from err

    raw_array = extract_json_array(mol_result.text)
    if raw_array is None:
        logger.warning(
            "bulk_question_gen.generator.parse_failed",
            request_id=request_id,
            text_preview=mol_result.text[:200] if mol_result.text else "",
        )
        raise GenerationError("AI returned an unparseable response. Please retry.")

    candidates: list[CandidateQuestion] = []
    for raw_item in raw_array:
        # Permissive construction; the validator does the real shape check.
        # We catch ValidationError at this layer and skip — keeps the batch
        # going if one item has a missing field (the validator will reject
        # the rest of the batch's bad items by category).
        if not isinstance(raw_item, dict):
            continue
        try:
            candidate = CandidateQuestion.model_validate(raw_item)
        except Exception:  # noqa: BLE001 — validator surfaces the real reason
            continue
        candidates.append(candidate)

    return candidates
