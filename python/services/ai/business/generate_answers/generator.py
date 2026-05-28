"""Single-question answer generation via the MoL router.

Replaces the direct Anthropic call (legacy) / MoL ``task_type='explanation'``
call (Phase 1A TS) with an equivalent Python MoL call.

Source: :file:`supabase/functions/generate-answers/index.ts` lines 119-165
(the ``callClaude`` wrapper) plus the per-question call site at lines 567-573.

Routing:
- ``task_type='explanation'`` — answer-writing is structured factual
  explanation; matches MoL router matrix (gpt-4o-mini primary, Haiku fallback).
- ``preferred_provider='openai'`` — forces OpenAI primary for admin-only
  cost posture. TS path does the same (index.ts:143).
- ``system_prompt_override`` — preserves the NCERT-grounded system prompt
  built upstream (the RAG context is baked in BEFORE this call). Bypasses
  the MoL Phase-0 stub builder.

Retry:
- :func:`retry_with_backoff` wraps the MoL call so transient provider
  failures (rate-limit, 5xx, timeout) get up to 3 attempts with 0.5-8s
  exponential backoff + jitter. Same posture as bulk-question-gen.
- Non-retryable errors (auth, validation) bubble immediately.

Budget guard:
- The handler checks :func:`check_daily_budget` BEFORE the generator
  fires — same posture as bulk-question-gen and voice/transcribe.
"""

from __future__ import annotations

from typing import Any

import structlog

from ...mol import (
    GenerateConfig,
    GenerateRequest,
    StudentContext,
    generate_response,
)
from ...mol.errors import MolError
from ...mol.types import GenerateInput
from ...shared.retry import retry_with_backoff

logger = structlog.get_logger(__name__)

# Token budget for one answer call. TS uses 800 (index.ts:570).
# Rationale: long-form answers cap at 5-mark essays ~ 500-700 tokens output;
# 800 leaves headroom for occasional 6-7 mark questions.
_GENERATION_MAX_TOKENS = 800


class GenerationError(RuntimeError):
    """Raised when the generator fails after MoL retries are exhausted."""

    def __init__(self, message: str, *, mol_code: str | None = None) -> None:
        super().__init__(message)
        self.mol_code = mol_code


@retry_with_backoff()
async def _call_mol(req: GenerateRequest) -> Any:
    """Internal: thin wrapper around generate_response for the retry decorator.

    Kept as a separate function so the decorator applies only to the network
    call — the prompt building and request construction in
    :func:`generate_answer_for_question` are NOT retried (they're pure
    computation and re-running them is wasted CPU).
    """
    return await generate_response(req)


async def generate_answer_for_question(
    *,
    system_prompt: str,
    user_prompt: str,
    grade: str,
    subject: str,
    request_id: str,
) -> str:
    """Run one MoL call and return the raw text response.

    Args:
        system_prompt: composed NCERT-grounded prompt from
            :func:`prompts.build_system_prompt`. Passed verbatim via
            ``config.system_prompt_override``.
        user_prompt: per-question prompt from
            :func:`prompts.build_user_prompt`.
        grade: P5 string grade. Stamped into the synthetic student_id
            so MoL routing buckets are stable per-grade.
        subject: CBSE subject code. Same usage as grade.
        request_id: trace id propagated to mol_request_logs.

    Returns:
        The raw LLM response text. Caller is responsible for parsing
        (see :func:`validator.parse_answer_response`). Returns empty
        string on MoL errors — same posture as TS line 156 / line 163
        which logs and returns ``''``.

    Raises:
        :class:`GenerationError` only when retries are exhausted AND the
        error is not a soft MoL error (e.g. NO_PROVIDER_AVAILABLE — all
        providers down). MolError-as-soft-empty mirrors the TS posture.
    """
    # student_id is a synthetic admin-namespaced UUID — the generator has no
    # student. Required by MoL's INVALID_INPUT validator (orchestrator.py
    # checks student_context.student_id is non-empty). The TS path uses the
    # same pattern (index.ts:142-149: `admin-generate-answers-{grade}-{subject}`).
    student_ctx = StudentContext(
        student_id=f"admin-generate-answers-{grade}-{subject}",
        grade=grade,
        language="en",
        subject=subject,
    )

    mol_request = GenerateRequest(
        task_type="explanation",
        input=GenerateInput(instruction=user_prompt),
        student_context=student_ctx,
        config=GenerateConfig(
            preferred_provider="openai",
            temperature_override=0.3,
            request_id=request_id,
            max_tokens_override=_GENERATION_MAX_TOKENS,
            system_prompt_override=system_prompt,
        ),
    )

    try:
        mol_result = await _call_mol(mol_request)
    except MolError as err:
        # Match TS posture (index.ts:157-162): log + return empty string so
        # the parser produces an empty-answer rejection that becomes a
        # per-question failure (NOT a 5xx for the whole batch).
        logger.warning(
            "generate_answers.generator.mol_error",
            code=err.code,
            message=err.message,
            request_id=request_id,
        )
        return ""
    except Exception as err:  # noqa: BLE001 — mirror TS catch-all
        logger.warning(
            "generate_answers.generator.exception",
            error=str(err),
            request_id=request_id,
        )
        return ""

    text = getattr(mol_result, "text", "") or ""
    return text
