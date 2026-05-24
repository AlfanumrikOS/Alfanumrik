"""Single-chapter concept generation via the MoL router.

Replaces the direct Anthropic call (legacy) / MoL ``task_type=
'concept_explanation'`` call (Phase 1A TS) with an equivalent Python MoL
call.

Source: :file:`supabase/functions/generate-concepts/index.ts` lines 320-368
(the ``callClaude`` wrapper) plus the per-chapter call site at lines 754-761.

Routing:
- ``task_type='concept_explanation'`` — concept extraction matches the
  MoL router matrix entry at :mod:`services.ai.mol.router.BASE_MATRIX`
  (gpt-4o-mini primary, Haiku fallback). Same routing as TS.
- ``preferred_provider='openai'`` — forces OpenAI primary for admin-only
  cost posture. TS path does the same (index.ts:351).
- ``system_prompt_override`` — preserves the prompt built upstream
  byte-for-byte. Bypasses the MoL Phase-0 stub builder.
- ``max_tokens_override=4096`` — concept extraction produces structured
  JSON for 3-6 concepts; the TS path uses 4096 (index.ts:758) and we
  match.

Retry:
- :func:`retry_with_backoff` wraps the MoL call so transient provider
  failures (rate-limit, 5xx, timeout) get up to 3 attempts with 0.5-8s
  exponential backoff + jitter. Same posture as generate-answers.
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

# Token budget for one concept-extraction call. TS uses 4096 (index.ts:758).
# Rationale: 6 concepts × ~500 tokens/concept + JSON overhead ~ 3.5k tokens
# of completion, plus the system prompt is repeated for cache-busting on
# some providers. 4096 leaves ~10% headroom.
GENERATION_MAX_TOKENS = 4096


class GenerationError(RuntimeError):
    """Raised when the generator fails after MoL retries are exhausted."""

    def __init__(self, message: str, *, mol_code: str | None = None) -> None:
        super().__init__(message)
        self.mol_code = mol_code


@retry_with_backoff()
async def _call_mol(req: GenerateRequest) -> Any:
    """Internal: thin wrapper around generate_response for the retry decorator.

    Kept as a separate function so the decorator applies only to the
    network call — the prompt building and request construction in
    :func:`call_mol_for_concepts` are NOT retried (they're pure
    computation and re-running them is wasted CPU).
    """
    return await generate_response(req)


async def call_mol_for_concepts(
    *,
    system_prompt: str,
    user_prompt: str,
    grade: str,
    subject: str,
    request_id: str,
    max_tokens: int = GENERATION_MAX_TOKENS,
) -> str:
    """Run one MoL call and return the raw text response.

    Args:
        system_prompt: composed concept-extraction prompt from
            :func:`prompts.build_system_prompt`. Passed verbatim via
            ``config.system_prompt_override``.
        user_prompt: per-chapter prompt from
            :func:`prompts.build_user_prompt`.
        grade: P5 string grade. Stamped into the synthetic student_id
            so MoL routing buckets are stable per-grade.
        subject: CBSE subject code. Same usage as grade.
        request_id: trace id propagated to mol_request_logs.
        max_tokens: override the default 4096 token budget. Useful in
            tests; production callers should pass the default.

    Returns:
        The raw LLM response text. Caller is responsible for parsing
        (see :func:`validator.parse_concepts_response`). Returns empty
        string on MoL errors — same posture as TS lines 358-366 which
        logs and returns ``''``.

    Raises:
        Nothing — MoL errors are caught + returned as empty string so
        per-chapter failures don't abort the batch.
    """
    # student_id is a synthetic admin-namespaced UUID. Required by MoL's
    # INVALID_INPUT validator. Mirrors TS index.ts:346 pattern:
    # `admin-generate-concepts-{grade}-{subject}`.
    student_ctx = StudentContext(
        student_id=f"admin-generate-concepts-{grade}-{subject}",
        grade=grade,
        language="en",
        subject=subject,
    )

    mol_request = GenerateRequest(
        task_type="concept_explanation",
        input=GenerateInput(instruction=user_prompt),
        student_context=student_ctx,
        config=GenerateConfig(
            preferred_provider="openai",
            request_id=request_id,
            max_tokens_override=max_tokens,
            system_prompt_override=system_prompt,
        ),
    )

    try:
        mol_result = await _call_mol(mol_request)
    except MolError as err:
        # Match TS posture (index.ts:361-365): log + return empty string
        # so the parser produces a None-rejection that becomes a
        # per-chapter failure (NOT a 5xx for the whole batch).
        logger.warning(
            "generate_concepts.generator.mol_error",
            code=err.code,
            message=err.message,
            request_id=request_id,
            grade=grade,
            subject=subject,
        )
        return ""
    except Exception as err:  # noqa: BLE001 — mirror TS catch-all
        logger.warning(
            "generate_concepts.generator.exception",
            error=str(err),
            request_id=request_id,
            grade=grade,
            subject=subject,
        )
        return ""

    text = getattr(mol_result, "text", "") or ""
    return text
