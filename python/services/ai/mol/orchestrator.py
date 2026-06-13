"""MoL entry point — composes router + providers + telemetry.

Mirrors :file:`supabase/functions/_shared/mol/index.ts:generateResponse`.

Phase-0 scope:
- Real provider HTTP calls (via :mod:`.providers.anthropic` /
  :mod:`.providers.openai`).
- Real router selection (cloned from BASE_MATRIX, openai_default + weights
  flips applied).
- Real telemetry writes (single ``mol_request_logs`` row per call, matching
  TS LogPayload shape exactly).

Wired components:
- ``classify_task_type()`` — the real classifier (TS ``./classifier.ts``
  port): returns the caller-passed ``task_type`` when present, else infers
  the task from the input surface, keyword, and regex signals, defaulting to
  ``"explanation"`` for student-facing surfaces.
- ``build_system_prompt()`` — the real prompt-builder (TS
  ``./prompt-builder.ts`` port): full Foxy persona, grade-tier styling,
  language + exam-goal hints, and NCERT RAG-context injection. Bypassed
  entirely when the caller sets ``config.system_prompt_override``.
- ``post_process()`` — the response-shaper (TS ``./post-processor.ts``
  port).
- ``get_routing_weights()`` — reads the per-task weights from the
  ``mol_routing_weights`` table with a 5m cache; returns an empty dict when
  the table is unreadable (no weight overrides apply, matching default-OFF).
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Iterable

import structlog

from . import breaker as cb
from .classifier import classify as classify_task_type
from .cost import compute_cost
from .cost_cap import enforce_cost_cap
from .errors import MolError
from .feature_flag import is_flag_enabled
from .post_processor import post_process
from .prompt_builder import build_simplify_prompt, build_system_prompt
from .providers.anthropic import AnthropicProvider
from .providers.base import ModelProvider, is_retryable_status
from .providers.openai import OpenAIProvider
from .router import RouterOptions, get_max_tokens, get_simplify_max_tokens, select_provider_chain
from .telemetry import LogPayload, record_mol_request, sum_tokens
from .types import (
    ChatTurn,
    GenerateConfig,
    GenerateRequest,
    MolResult,
    ProviderResponse,
    ProviderTarget,
    TaskType,
    TokenUsage,
)

logger = structlog.get_logger(__name__)

# Module-level provider singletons — same as TS (one instance per worker).
_providers: dict[str, ModelProvider] = {
    "openai": OpenAIProvider(),
    "anthropic": AnthropicProvider(),
}




_weights_cache: dict[str, float] | None = None
_weights_cache_expiry: float = 0.0
_WEIGHTS_TTL_SEC: float = 300.0  # 5 minutes


async def get_routing_weights() -> dict[str, float]:
    """Phase-2 routing weights — reads ``mol_routing_weights`` with a 5m cache."""
    global _weights_cache, _weights_cache_expiry
    now = time.monotonic()
    
    if _weights_cache is not None and now < _weights_cache_expiry:
        return _weights_cache

    try:
        from ..db.supabase import get_service_client
        client = get_service_client()
        if not client:
            return _weights_cache or {}
            
        result = await client.table("mol_routing_weights").select("task_type, openai_weight").execute()
        
        data = getattr(result, "data", None)
        if data is None and isinstance(result, dict):
            data = result.get("data")
            
        if data is not None:
            new_cache = {}
            for row in data:
                task_type = row.get("task_type")
                weight = row.get("openai_weight")
                if task_type and weight is not None:
                    new_cache[task_type] = float(weight)
            _weights_cache = new_cache
            _weights_cache_expiry = now + _WEIGHTS_TTL_SEC
        
        return _weights_cache or {}
    except Exception as err:
        # Avoid crashing the orchestration loop; just fallback to empty/stale cache
        logger.warning("mol.get_routing_weights_failed", error=str(err))
        return _weights_cache or {}


# ─── Orchestrator helpers ────────────────────────────────────────────────────


def _new_request_id() -> str:
    return str(uuid.uuid4())


def _status_from_message(msg: str) -> int | None:
    """Extract a 3-digit HTTP status from an error message string.

    Mirrors the TS regex ``(\\d{3})`` used by executePass — we expose the
    raw extraction so the retry helper can decide on retryability.
    """
    import re

    m = re.search(r"(\d{3})", msg)
    if not m:
        return None
    return int(m.group(1))


async def _execute_pass(
    chain: Iterable[ProviderTarget],
    *,
    task_type: TaskType,
    breaker_on: bool,
    system_prompt: str,
    user_messages: list[ChatTurn],
    max_tokens: int,
    temperature: float,
    timeout_seconds: int,
    image_url: str | None = None,
) -> tuple[ProviderResponse, int, list[str]]:
    """Try each target in ``chain``; return on first success.

    Returns ``(response, fallback_count, failure_chain)``.

    Mirrors TS ``executePass`` retry semantics:
      - Each target gets 2 attempts (1 retry).
      - Only retryable HTTP statuses get the second attempt.
      - On all-fail, raise MolError('NO_PROVIDER_AVAILABLE').

    A3 (Phase 2): when ``breaker_on`` and the cross-instance breaker reports
    the ``(provider, task_type)`` circuit OPEN, the target is skipped WITHOUT
    an HTTP call (``{provider}:circuit_open`` failure entry). Provider
    outcomes feed ``record_success`` / ``record_failure`` so the shared
    (Upstash-backed) state machine tracks health across Cloud Run instances.
    The breaker FAILS OPEN — when its Redis store is unconfigured / unreachable
    ``can_request`` returns True, so this gate can never block a live request.
    """
    failures: list[str] = []
    fallback = 0

    targets = list(chain)
    for target in targets:
        provider = _providers[target.provider]
        if not provider.is_configured():
            failures.append(f"{target.provider}:not_configured")
            fallback += 1
            continue

        if breaker_on and not await cb.can_request(target.provider, task_type):
            failures.append(f"{target.provider}:circuit_open")
            fallback += 1
            continue

        last_error: str | None = None
        for attempt in range(2):
            try:
                response = await provider.call(
                    model=target.model,
                    system_prompt=system_prompt,
                    user_messages=user_messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    timeout_seconds=timeout_seconds,
                    image_url=image_url,
                )
                if breaker_on:
                    await cb.record_success(target.provider, task_type)
                return response, fallback, failures
            except Exception as err:  # noqa: BLE001 — boundary, classified below
                msg = str(err) or type(err).__name__
                status = _status_from_message(msg)
                failures.append(f"{target.provider}:{status if status else 'err'}")
                last_error = msg
                # A3: only PROVIDER-HEALTH failures count toward the breaker.
                # A network/timeout error (status is None) or a retryable status
                # (429/5xx) is a provider-health signal; a non-retryable 4xx is a
                # client/input error and must NOT trip the circuit (otherwise a
                # burst of bad requests would wrongly open the breaker on a
                # perfectly healthy provider).
                if breaker_on and (status is None or is_retryable_status(status)):
                    await cb.record_failure(target.provider, task_type)
                # Only retry if the status is retryable AND this is the first attempt.
                if status is None or not is_retryable_status(status):
                    break
                if attempt == 0:
                    # Quick backoff before the second attempt (mirrors TS 500ms).
                    await asyncio.sleep(0.5)
                    continue

        fallback += 1
        del last_error  # already captured in `failures`

    raise MolError(
        "NO_PROVIDER_AVAILABLE",
        "All providers in chain failed",
        details={"failures": failures},
    )


# ─── Public entry point ──────────────────────────────────────────────────────


async def generate_response(req: GenerateRequest) -> MolResult:
    """Run a full MoL call. Mirrors TS ``generateResponse``.

    Sequence:
      1. Validate input shape (student_id required; at least one of
         question/topic/instruction/image_url required).
      2. Resolve task_type (caller-passed or stub).
      3. Read feature flags + routing weights in parallel.
      4. Select provider chain via :func:`select_provider_chain`.
      5. Apply per-request ``preferred_provider`` override.
      6. Compose system prompt (or honor ``system_prompt_override``).
      7. Execute pass 1; for hybrid mode, execute pass 2 simplify.
      8. Compute cost (per-pass, summed), latency, token totals.
      9. Fire-and-forget telemetry row.
     10. Return MolResult.
    """
    start = time.monotonic()
    cfg: GenerateConfig = req.config or GenerateConfig()
    request_id = cfg.request_id or _new_request_id()

    # Step 1 — validate (defense in depth; Pydantic already covered shapes)
    inp = req.input
    if not (inp.question or inp.topic or inp.instruction or inp.image_url):
        raise MolError(
            "INVALID_INPUT",
            "input must contain question, topic, instruction, or image_url",
        )

    # Step 2 — classify (stub for Phase 0)
    task_type = classify_task_type(req)

    # Step 3 — flags + weights in parallel
    (
        hybrid_on,
        openai_default,
        deterministic_on,
        breaker_on,
        cost_cap_on,
        weights,
    ) = await asyncio.gather(
        is_flag_enabled(
            "ff_mol_hybrid_mode_v1",
            student_id=req.student_context.student_id,
        ),
        is_flag_enabled(
            "ff_mol_openai_default",
            student_id=req.student_context.student_id,
        ),
        is_flag_enabled(
            "ff_mol_deterministic_priority",
            student_id=req.student_context.student_id,
        ),
        is_flag_enabled(
            "ff_mol_circuit_breaker_v1",
            student_id=req.student_context.student_id,
        ),
        is_flag_enabled(
            "ff_mol_cost_cap_v1",
            student_id=req.student_context.student_id,
        ),
        get_routing_weights(),
    )

    # Step 4 — router
    selected = select_provider_chain(
        task_type,
        RouterOptions(
            hybrid_enabled=hybrid_on,
            openai_default=openai_default,
            weights=weights,
            # deterministic ON  ⇒ shadow_priority OFF (OpenAI always primary).
            # deterministic OFF ⇒ legacy probabilistic path (shadow/experiment).
            shadow_priority=not deterministic_on,
        ),
    )

    # Step 5 — admin-only per-request preferred_provider reorder
    if cfg.preferred_provider:
        for p in selected.passes:
            preferred = [t for t in p.chain if t.provider == cfg.preferred_provider]
            rest = [t for t in p.chain if t.provider != cfg.preferred_provider]
            p.chain = [*preferred, *rest]

    # Step 6 — system prompt (override path bypasses the real builder)
    system_prompt = cfg.system_prompt_override or build_system_prompt(
        task_type, req.student_context, req.rag_context
    )

    # Step 7 — user messages
    user_messages: list[ChatTurn] = []
    if inp.chat_history:
        user_messages.extend(inp.chat_history[-10:])
    user_text = inp.question or inp.instruction or inp.topic or ""
    user_messages.append(ChatTurn(role="user", content=user_text))

    max_tokens = cfg.max_tokens_override or get_max_tokens(task_type)
    temperature = cfg.temperature_override if cfg.temperature_override is not None else 0.7

    # A4 — cost-cap enforcement BEFORE any provider HTTP call. Gated behind
    # ff_mol_cost_cap_v1 (default OFF). Uses a conservative worst-case estimate
    # against the primary rung's provider/model. Raises MolError(
    # "COST_CAP_EXCEEDED") which the route maps to HTTP 429. Prompt tokens are a
    # ~4-chars-per-token approximation over the composed system prompt + the
    # user's text (both already in scope here).
    if cost_cap_on:
        primary = selected.passes[0].chain[0]
        prompt_estimate = (len(system_prompt) + len(user_text)) // 4
        enforce_cost_cap(
            task_type=task_type,
            provider=primary.provider,
            model=primary.model,
            prompt_tokens=prompt_estimate,
            max_tokens=max_tokens,
        )

    # Step 7 (cont.) — execute passes
    responses: list[ProviderResponse] = []
    all_failures: list[str] = []
    total_fallback = 0

    try:
        first_pass = selected.passes[0]
        response_1, fb_1, fail_1 = await _execute_pass(
            first_pass.chain,
            task_type=task_type,
            breaker_on=breaker_on,
            system_prompt=system_prompt,
            user_messages=user_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout_seconds=20,
            image_url=inp.image_url,
        )
        responses.append(response_1)
        total_fallback += fb_1
        all_failures.extend(fail_1)

        # Hybrid: 2-pass simplify
        if selected.mode == "hybrid" and len(selected.passes) >= 2:
            simplify_prompt = build_simplify_prompt(req.student_context, response_1.text)
            response_2, fb_2, fail_2 = await _execute_pass(
                selected.passes[1].chain,
                task_type=task_type,
                breaker_on=breaker_on,
                system_prompt=simplify_prompt,
                user_messages=[ChatTurn(role="user", content="Rewrite the answer above.")],
                max_tokens=get_simplify_max_tokens(),
                temperature=temperature,
                timeout_seconds=15,
            )
            responses.append(response_2)
            total_fallback += fb_2
            all_failures.extend(fail_2)
    except MolError as err:
        # Record a failure telemetry row before re-raising — same posture
        # as success rows, just with zeros for tokens / costs and the
        # failure_chain populated. Matches TS expectation that mol_request_logs
        # has one row per generateResponse() attempt, success or fail.
        # _execute_pass attaches its captured failure list to
        # err.details['failures']; pull it out so the telemetry row carries
        # the full chain even though the caller-level all_failures was
        # empty (the failure happened INSIDE _execute_pass before it
        # returned the captured list).
        nested = err.details.get("failures") if isinstance(err.details, dict) else None
        if isinstance(nested, list):
            all_failures.extend(str(x) for x in nested)
            # Each failure entry in the nested list represents one
            # exhausted rung in the chain.
            total_fallback += len(nested)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        await record_mol_request(
            LogPayload(
                request_id=request_id,
                student_id=req.student_context.student_id,
                task_type=task_type,
                surface=cfg.surface,
                provider="unknown",
                model="unknown",
                passes=0,
                fallback_count=total_fallback,
                failure_chain=",".join(all_failures) if all_failures else None,
                latency_ms=elapsed_ms,
                tokens=TokenUsage(),
                usd_cost=0.0,
                inr_cost=0.0,
                grade=req.student_context.grade,
                language=req.student_context.language,
                exam_goal=req.student_context.exam_goal,
                shadow_role=cfg.shadow_role,
                shadow_of_request_id=cfg.shadow_of_request_id,
                trace_id=cfg.trace_id,
            )
        )
        raise

    # Steps 8 + 9 — derive MolResult + write telemetry
    final_text = post_process(responses[-1].text, task_type)
    tokens = sum_tokens([r.tokens for r in responses])

    usd_total = 0.0
    inr_total = 0.0
    for r in responses:
        usd, inr = compute_cost(r.provider, r.model, r.tokens.prompt, r.tokens.completion)
        usd_total += usd
        inr_total += inr

    latency_ms = int((time.monotonic() - start) * 1000)

    provider_label = "hybrid" if len(responses) > 1 else responses[0].provider
    model_label = " + ".join(r.model for r in responses)

    await record_mol_request(
        LogPayload(
            request_id=request_id,
            student_id=req.student_context.student_id,
            task_type=task_type,
            surface=cfg.surface,
            provider=provider_label,
            model=model_label,
            passes=len(responses),
            fallback_count=total_fallback,
            failure_chain=",".join(all_failures) if all_failures else None,
            latency_ms=latency_ms,
            tokens=tokens,
            usd_cost=usd_total,
            inr_cost=inr_total,
            grade=req.student_context.grade,
            language=req.student_context.language,
            exam_goal=req.student_context.exam_goal,
            shadow_role=cfg.shadow_role,
            shadow_of_request_id=cfg.shadow_of_request_id,
            trace_id=cfg.trace_id,
        )
    )

    # 6-decimal precision on usd_cost matches TS rounding (Math.round * 1e6 / 1e6).
    return MolResult(
        text=final_text,
        provider=provider_label,
        model=model_label,
        task_type=task_type,
        latency_ms=latency_ms,
        tokens=tokens,
        usd_cost=round(usd_total * 1_000_000) / 1_000_000,
        inr_cost=round(inr_total * 10000) / 10000,
        fallback_count=total_fallback,
        passes=len(responses),
        request_id=request_id,
        failure_chain=all_failures,
    )
