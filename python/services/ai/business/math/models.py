"""Pydantic request/response models for ``POST /v1/math/verify``.

Part 1D (VERIFIER) of the Foxy 3-Agent Math Pipeline. The endpoint is a
deterministic SymPy-backed checker: given the originating problem expression
and the answer Foxy's solver claimed, it independently computes a canonical
result and returns a fail-closed verdict. NO LLM, ~100ms typical.

The TS contract MUST stay in lock-step with ``src/lib/math-python-client.ts``
(VerifyMathRequest / VerifyMathResult). Any field rename here breaks the
Next.js client wiring.

Product invariants enforced at the model layer:
- P5: ``grade`` is a string ('6'..'12') when present — we never coerce to int.
  The verifier doesn't branch on grade today; it is carried for telemetry only.
- P12 (AI safety, FAIL-CLOSED): ``is_correct`` is a TRISTATE
  (``True`` | ``False`` | ``None``). ``None`` means "could not verify"
  (unparseable / out-of-scope / non-arithmetic / timeout / exception) — the
  caller treats ``None`` as "unavailable, not wrong" and shows the answer
  WITHOUT escalation. A confident ``False`` is what triggers the route's
  single Sonnet escalation. The handler NEVER raises — every failure maps to
  ``is_correct=None``.
- P13 (privacy): responses carry no PII. ``problem_expression`` /
  ``claimed_answer`` are math strings, never student identifiers; ``reason``
  is a short machine/diagnostic string and never echoes auth context.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# The kind of verification to perform. Mirrors the three deterministic checks
# the solver's answer shapes map onto:
#   - 'evaluate'        — the problem reduces to a single canonical value
#                         (arithmetic / simplifiable numeric expression), and
#                         we compare it to the claimed value.
#   - 'solve_equation'  — the problem is an equation (or system) with one or
#                         more roots; we verify the claimed root(s) SATISFY it.
#   - 'simplify'        — symbolic equality between the problem expression and
#                         the claimed simplified form.
VerifyKind = Literal["evaluate", "solve_equation", "simplify"]


class VerifyMathRequest(BaseModel):
    """Request body for ``POST /v1/math/verify``.

    Field shape is wire-stable — ``src/lib/math-python-client.ts`` POSTs these
    names directly. Any rename breaks the client.
    """

    model_config = ConfigDict(extra="forbid")

    problem_expression: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description=(
            "The originating problem in a SymPy-parseable form. For 'evaluate' "
            "this is the expression to compute (e.g. '1/2 + 3/4'); for "
            "'solve_equation' it is the equation (e.g. 'x^2 - 5*x + 6 = 0'); "
            "for 'simplify' it is the LHS to simplify."
        ),
    )
    claimed_answer: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description=(
            "The answer Foxy's solver claimed. For 'evaluate'/'simplify' a "
            "value/expression (e.g. '5/4'); for 'solve_equation' the root(s), "
            "comma- or 'or'-separated (e.g. 'x = 2 or x = 3' or '2, 3')."
        ),
    )
    kind: VerifyKind = Field(
        ...,
        description="Which deterministic check to run.",
    )
    grade: str | None = Field(
        default=None,
        max_length=8,
        description="P5: CBSE grade as a string ('6'..'12'). Telemetry only.",
    )


class VerifyMathResponse(BaseModel):
    """Success envelope for ``POST /v1/math/verify``.

    Always HTTP 200 on a parseable request; the VERDICT lives in
    ``is_correct``. A 4xx is reserved for auth / malformed-body failures
    (handled by the route), NOT for "could not verify" — that is a 200 with
    ``is_correct=None`` so the caller's fail-closed display mapping can run.

    Field names MUST match ``VerifyMathResult`` in math-python-client.ts.
    """

    model_config = ConfigDict(extra="forbid")

    is_correct: bool | None = Field(
        ...,
        description=(
            "TRISTATE verdict (P12 fail-closed): True = verified correct; "
            "False = confidently wrong (triggers the route's single Sonnet "
            "escalation); None = could not verify (unparseable / out-of-scope "
            "/ non-arithmetic / timeout). None means 'unavailable, NOT wrong'."
        ),
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description=(
            "How sure the deterministic check is. 1.0 for an exact symbolic "
            "match/mismatch; lower for numeric-tolerance comparisons; 0.0 when "
            "is_correct is None (could not verify)."
        ),
    )
    computed: str | None = Field(
        default=None,
        description=(
            "The canonical value/result SymPy derived (e.g. '5/4'), for "
            "diagnostics. None when nothing could be computed."
        ),
    )
    reason: str | None = Field(
        default=None,
        description=(
            "Short machine/diagnostic string (e.g. 'parse_error', "
            "'value_mismatch', 'root_does_not_satisfy', 'symbolic_equal'). "
            "Never contains PII."
        ),
    )


class VerifyMathError(BaseModel):
    """Error envelope returned via FastAPI ``HTTPException.detail``.

    Reserved for AUTH / request-shape failures only. A "could not verify"
    result is a 200 + ``is_correct=None`` (see :class:`VerifyMathResponse`),
    NOT an error — that distinction is the fail-closed contract.
    """

    model_config = ConfigDict(extra="forbid")

    error: str = Field(
        ...,
        description="Machine-readable error code (e.g. 'AUTH_FAILED', 'BAD_REQUEST').",
    )
    detail: str = Field(
        ...,
        description="Human-readable explanation. Safe to log; never PII.",
    )
    request_id: str = Field(
        ...,
        description="UUIDv4 echoed for log correlation.",
    )
