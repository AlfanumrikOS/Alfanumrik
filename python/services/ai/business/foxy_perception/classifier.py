"""MOL-routed per-turn perception classifier.

Runs a CHEAP MOL call (``task_type='evaluation'``, gpt-4o-mini primary) to
classify one Foxy turn, then coerces the raw model output into a clean, bounded
:class:`TurnClassificationResponse`.

Fail posture (so the Node caller can fail-safe to null):
  * ``MolError`` propagates unchanged — the router maps it to a 5xx, which the
    Node client (``callPythonMol``) treats as null → no event published.
  * An unparseable / non-JSON model output raises :class:`ClassificationError`,
    which the router maps to 502 → again null on the Node side. A "bad
    classification" is therefore a SILENT no-op end to end, never a degraded
    student turn.

The coercion here is defence-in-depth: the Node side re-validates every field
too. Both layers are fail-safe.
"""

from __future__ import annotations

import json
import re

import structlog

from ...mol import (
    GenerateConfig,
    GenerateRequest,
    StudentContext,
    generate_response,
)
from ...mol.types import GenerateInput
from .models import (
    MISCONCEPTION_CODE_PATTERN,
    TurnClassificationResponse,
)
from .prompts import build_system_prompt, build_user_prompt

logger = structlog.get_logger(__name__)

# Small token budget — the classifier emits a single compact JSON object.
CLASSIFY_MAX_TOKENS = 256
# Deterministic classification: temperature 0.0 (factual, not generative).
CLASSIFY_TEMPERATURE = 0.0

_BLOOM_LEVELS = frozenset(
    {"remember", "understand", "apply", "analyze", "evaluate", "create"}
)
_STRUGGLE_SIGNALS = frozenset(
    {
        "none",
        "repeated_hint",
        "repeated_wrong",
        "explicit_confusion",
        "long_idle",
        "give_up",
    }
)
_MISCONCEPTION_RE = re.compile(MISCONCEPTION_CODE_PATTERN)
_MAX_INTENT_LEN = 64
_DEFAULT_INTENT = "unknown"


class ClassificationError(RuntimeError):
    """Raised when the model output cannot be parsed into a classification."""


def _extract_json_object(text: str) -> dict:
    """Best-effort extraction of the first JSON object from a model response.

    Tolerates ```json fences and leading/trailing prose. Raises
    :class:`ClassificationError` when no JSON object can be recovered.
    """
    stripped = text.strip()
    # Strip a ```json ... ``` (or bare ```) fence if present.
    if stripped.startswith("```"):
        stripped = stripped.split("```", 2)
        # ['', 'json\n{...}\n', ''] or ['', '{...}\n', '']
        stripped = stripped[1] if len(stripped) > 1 else ""
        if stripped.lower().startswith("json"):
            stripped = stripped[4:]
        stripped = stripped.strip()
    # Slice from the first '{' to the last '}' — cheap and robust to prose.
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ClassificationError("no JSON object in model output")
    candidate = stripped[start : end + 1]
    try:
        obj = json.loads(candidate)
    except (json.JSONDecodeError, ValueError) as err:
        raise ClassificationError("model output is not valid JSON") from err
    if not isinstance(obj, dict):
        raise ClassificationError("model output JSON is not an object")
    return obj


def _coerce(raw: dict) -> TurnClassificationResponse:
    """Coerce a raw model dict into a clean, bounded classification.

    Never raises: every field falls back to a safe default. (The absence of a
    parseable JSON object is what raises upstream in :func:`_extract_json_object`.)
    """
    # topic_label
    topic = raw.get("topic_label")
    topic_label = topic.strip()[:200] if isinstance(topic, str) and topic.strip() else None

    # bloom_level — lowercase, must be a canonical verb else None.
    bloom = raw.get("bloom_level")
    bloom_level = None
    if isinstance(bloom, str):
        b = bloom.strip().lower()
        bloom_level = b if b in _BLOOM_LEVELS else None

    # misconception_code — ontology-regex validated else None.
    mis = raw.get("misconception_code")
    misconception_code = None
    if isinstance(mis, str):
        m = mis.strip()
        if m and m.lower() not in ("none", "null") and _MISCONCEPTION_RE.match(m):
            misconception_code = m

    # struggle_signal — must be in the enum else 'none'.
    struggle = raw.get("struggle_signal")
    struggle_signal = "none"
    if isinstance(struggle, str):
        s = struggle.strip().lower()
        struggle_signal = s if s in _STRUGGLE_SIGNALS else "none"

    # intent — lowercase bounded label else 'unknown'.
    intent_raw = raw.get("intent")
    intent = _DEFAULT_INTENT
    if isinstance(intent_raw, str):
        t = re.sub(r"\s+", "_", intent_raw.strip().lower())
        intent = t[:_MAX_INTENT_LEN] if t else _DEFAULT_INTENT

    return TurnClassificationResponse(
        topic_label=topic_label,
        bloom_level=bloom_level,  # type: ignore[arg-type]  # validated against the enum
        misconception_code=misconception_code,
        struggle_signal=struggle_signal,  # type: ignore[arg-type]
        intent=intent,
    )


async def classify_turn(
    *,
    student_id: str,
    grade: str,
    subject: str,
    chapter_number: int | None,
    student_message: str,
    foxy_answer: str,
    request_id: str,
) -> TurnClassificationResponse:
    """Run one MOL classification call and return the coerced classification.

    Raises:
        MolError: propagated from the orchestrator (router → 5xx → Node null).
        ClassificationError: model output could not be parsed (router → 502 →
            Node null).
    """
    system_prompt = build_system_prompt(grade=grade, subject=subject)
    user_prompt = build_user_prompt(
        student_message=student_message,
        foxy_answer=foxy_answer,
        chapter_number=chapter_number,
    )

    mol_request = GenerateRequest(
        task_type="evaluation",
        input=GenerateInput(instruction=user_prompt),
        student_context=StudentContext(
            student_id=student_id,
            grade=grade,
            language="en",
            subject=subject,
        ),
        config=GenerateConfig(
            preferred_provider="openai",  # gpt-4o-mini primary — cheap classify
            temperature_override=CLASSIFY_TEMPERATURE,
            max_tokens_override=CLASSIFY_MAX_TOKENS,
            request_id=request_id,
            system_prompt_override=system_prompt,
        ),
    )

    # MolError intentionally propagates — the router maps it to a 5xx and the
    # Node client fail-safes to null (no event).
    mol_result = await generate_response(mol_request)
    text = getattr(mol_result, "text", "") or ""

    raw = _extract_json_object(text)  # raises ClassificationError on bad output
    classification = _coerce(raw)

    # P13: log labels/enums only — NEVER the turn text.
    logger.info(
        "foxy_perception.classified",
        request_id=request_id,
        grade=grade,
        bloom_level=classification.bloom_level,
        struggle_signal=classification.struggle_signal,
        has_misconception=classification.misconception_code is not None,
        intent=classification.intent,
    )
    return classification
