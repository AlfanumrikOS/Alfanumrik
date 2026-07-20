"""Phase 2.2 (MOL-unification) — Foxy structured-output prompt port + request wiring.

Covers deliverable #2 of the "MOL only on Python" serving migration for Foxy:
the Python prompt-builder can append the SAME strict FoxyResponse block-schema
instruction the TS Claude path appends, gated by the new ``structured="foxy"``
mode. VALIDATION deliberately stays on the TS side (the Deno grounded-answer
pipeline runs parseFoxyStructured -> wrapAsParagraph), so these tests assert the
PROMPT contract only, not a Python-side JSON validator.

Scope of THIS file: SUBSTRING SPOT-CHECKS + builder-wiring assertions. These
tests confirm the ported constant contains the marquee phrases of the contract
and that the builder appends it correctly — they do NOT prove the port is
byte-for-byte identical to the TS source of truth
(``packages/lib/src/foxy/schema.ts`` -> ``FOXY_STRUCTURED_OUTPUT_PROMPT``,
mirrored in ``supabase/functions/grounded-answer/structured-prompt.ts``).

Byte-equality across the language boundary is enforced by the authoritative
cross-stack parity test:
``apps/host/src/__tests__/lib/foxy/schema-parity-python.test.ts`` (vitest, runs
in per-PR CI). It imports the RENDERED TS constant and reads this file's raw
triple-quoted (r-prefixed) string literal, LF-normalizes both, and asserts exact
equality. When the TS constant changes, that test — not the spot-checks below —
is the guard that fails until the port here is regenerated.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.mol.foxy_structured_prompt import FOXY_STRUCTURED_OUTPUT_PROMPT
from services.ai.mol.prompt_builder import build_system_prompt
from services.ai.mol.types import GenerateInput, GenerateRequest, StudentContext


def _ctx() -> StudentContext:
    return StudentContext(
        student_id="11111111-1111-1111-1111-111111111111",
        grade="10",
        language="en",
        subject="science",
    )


# ── The ported constant ──────────────────────────────────────────────────────


def test_constant_carries_the_foxyresponse_block_schema():
    """SUBSTRING SPOT-CHECK: the ported addendum contains the marquee phrases of
    the strict FoxyResponse contract.

    This is NOT a byte-equality check — it only samples representative
    substrings. Byte-for-byte parity against the TS source of truth is enforced
    by ``apps/host/src/__tests__/lib/foxy/schema-parity-python.test.ts``.
    """
    p = FOXY_STRUCTURED_OUTPUT_PROMPT
    assert "# OUTPUT FORMAT (STRICT)" in p
    assert "Return ONLY valid JSON" in p
    assert "type FoxyResponse" in p
    # Block-type union present (a representative sample).
    for block_type in ("paragraph", "step", "math", "mcq", "diagram", "code"):
        assert f'"{block_type}"' in p
    # Subject union present.
    assert '"math" | "science" | "sst" | "english" | "general"' in p
    assert "# SUBJECT RULES" in p
    assert "# FEW-SHOT EXAMPLES" in p
    # Bilingual instruction (P7) survived the port.
    assert "English, Hindi, or Hinglish" in p
    # LaTeX inside the few-shot JSON string values is JSON-escaped with DOUBLED
    # backslashes (2026-07-20 LaTeX-in-JSON escaping fix) — the port must carry
    # the doubled form plus the explicit doubling rule. Conceptual delimiter
    # mentions in the constraints prose remain single-backslash.
    assert r"\\frac" in p
    assert r"\\( " in p
    assert "JSON ESCAPING FOR MATH (CRITICAL)" in p
    assert r"\( ... \)" in p
    assert p.strip().endswith("Return ONLY the JSON object. Nothing else.")


# ── Builder wiring ───────────────────────────────────────────────────────────


def test_structured_foxy_appends_schema_at_the_end():
    prompt = build_system_prompt("explanation", _ctx(), None, structured="foxy")
    assert FOXY_STRUCTURED_OUTPUT_PROMPT in prompt
    # Appended LAST so the "return ONLY valid JSON" contract wins over the
    # legacy markdown FORMATTING block.
    assert prompt.rstrip().endswith("Return ONLY the JSON object. Nothing else.")


def test_structured_none_is_byte_identical_to_no_structured():
    """Default (structured omitted / None) must not change today's output."""
    base = build_system_prompt("explanation", _ctx(), None)
    explicit_none = build_system_prompt("explanation", _ctx(), None, structured=None)
    assert base == explicit_none
    assert FOXY_STRUCTURED_OUTPUT_PROMPT not in base


def test_structured_foxy_is_superset_of_default_prompt():
    """The structured prompt is the default prompt plus the appended schema."""
    base = build_system_prompt("explanation", _ctx(), None)
    structured = build_system_prompt("explanation", _ctx(), None, structured="foxy")
    assert structured == base + "\n\n" + FOXY_STRUCTURED_OUTPUT_PROMPT


def test_structured_foxy_still_injects_rag_context():
    """RAG context is still injected before the schema addendum."""
    rag = "NCERT: Reflection of light obeys the laws of reflection."
    prompt = build_system_prompt("explanation", _ctx(), rag, structured="foxy")
    assert "Reflection of light obeys the laws of reflection" in prompt
    assert prompt.index(rag) < prompt.index(FOXY_STRUCTURED_OUTPUT_PROMPT)


# ── Request model ────────────────────────────────────────────────────────────


def test_generate_request_accepts_structured_foxy():
    req = GenerateRequest(
        task_type="explanation",
        input=GenerateInput(question="What is refraction?"),
        student_context=_ctx(),
        rag_context="NCERT reference material.",
        structured="foxy",
    )
    assert req.structured == "foxy"


def test_generate_request_defaults_structured_to_none():
    req = GenerateRequest(
        task_type="explanation",
        input=GenerateInput(question="What is refraction?"),
        student_context=_ctx(),
    )
    assert req.structured is None


def test_generate_request_rejects_unknown_structured_mode():
    with pytest.raises(ValidationError):
        GenerateRequest(
            task_type="explanation",
            input=GenerateInput(question="hi"),
            student_context=_ctx(),
            structured="markdown",  # not a valid StructuredMode
        )


# ── Cross-stack contract parity ──────────────────────────────────────────────
# These pin the EXACT JSON body the TS grounded-answer seam
# (foxy-python-generation.ts::buildGenerateBody) POSTs to /v1/generate. Because
# GenerateRequest/GenerateConfig/StudentContext all use extra="forbid", a TS
# field the Python model does not know about would 422 in production and force
# an unconditional fallback. This test fails the moment the two shapes drift.


def test_seam_request_body_validates_against_python_model():
    """The composed body the TS seam sends must validate on the Python side."""
    body = {
        "task_type": "explanation",
        "structured": "foxy",
        "input": {
            "question": "Explain refraction of light.",
            "chat_history": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ],
        },
        "student_context": {
            "student_id": "11111111-1111-1111-1111-111111111111",
            "grade": "10",
            "subject": "science",
        },
        "rag_context": "=== REFERENCE MATERIAL ===\n[1] Light bends...\n=== END ===",
        "config": {
            "preferred_provider": "anthropic",
            "max_tokens_override": 1600,
            "temperature_override": 0.1,
            "request_id": "req-parity-1",
            "surface": "foxy",
            "system_prompt_override": "SYSTEM PROMPT composed in TS (persona + refs + schema).",
        },
    }
    req = GenerateRequest.model_validate(body)
    assert req.structured == "foxy"
    assert req.config is not None
    assert req.config.system_prompt_override.startswith("SYSTEM PROMPT composed in TS")
    assert req.config.preferred_provider == "anthropic"
    assert req.config.surface == "foxy"


def test_seam_request_rejects_stray_top_level_field():
    """extra='forbid' must reject any field the seam does not send — this is the
    contract that caught the `_model_preference_hint` regression."""
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(
            {
                "input": {"question": "hi"},
                "student_context": {
                    "student_id": "11111111-1111-1111-1111-111111111111",
                    "grade": "10",
                },
                "_model_preference_hint": "haiku",  # forbidden extra
            }
        )
