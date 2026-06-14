"""SymPy-backed deterministic math verifier (Part 1D — VERIFIER).

Given a problem expression + the answer Foxy's solver claimed, independently
compute a canonical result and return a fail-closed verdict. NO LLM, no
network — pure SymPy. Typical runtime ~10-100ms.

THE CONTRACT (P12 fail-closed):
  - is_correct=True  : verified correct (exact or within numeric tolerance).
  - is_correct=False : confidently wrong — the route escalates ONCE to Sonnet.
  - is_correct=None  : could NOT verify (parse error, out-of-scope, non-
                       arithmetic, timeout, any SymPy exception). The caller
                       treats None as "unavailable, NOT wrong" and shows the
                       answer without escalation.

This handler NEVER raises. Every exception is caught and mapped to a
``VerifyMathResponse`` with ``is_correct=None``. A verifier that throws would
either 500 (which the client fail-softs to None anyway) or, worse, leak a
stack — so we collapse everything to the tristate here.

Parsing is locked down: ``sympify`` is called with ``evaluate=True`` and the
default (safe) transformations; we do NOT pass ``locals`` that expose Python
builtins, and a hard alarm-free recursion/size budget is enforced by capping
the input length at the model layer (2000 chars) plus a node-count guard here.
"""

from __future__ import annotations

import re
from typing import Any

import structlog

from .models import VerifyKind, VerifyMathResponse

logger = structlog.get_logger(__name__)

# Lazy import guard: sympy is a heavy import. We import at module load (it is a
# declared dependency) but wrap the top-level import so a missing wheel in a
# half-provisioned environment degrades to is_correct=None rather than crashing
# app startup.
try:  # pragma: no cover - import-time guard
    import sympy
    from sympy import simplify
    from sympy.core.sympify import SympifyError
    from sympy.parsing.sympy_parser import (
        implicit_multiplication_application,
        parse_expr,
        standard_transformations,
    )

    _SYMPY_OK = True
    _TRANSFORMATIONS = standard_transformations + (
        implicit_multiplication_application,
    )
except Exception:  # pragma: no cover - import-time guard  # noqa: BLE001
    _SYMPY_OK = False
    _TRANSFORMATIONS = ()  # type: ignore[assignment]


# Numeric comparison tolerance for non-rational results (e.g. trig surds turned
# decimal). Exact rationals are compared symbolically (zero tolerance).
_NUMERIC_TOL = 1e-9

# Guard against a pathological expression that parses to an enormous tree.
_MAX_NODES = 5000

# Strip the common answer-prose wrappers the solver emits so the bare value
# survives: "x = 2 or x = 3", "Answer: 5/4", "= 5/4", trailing units words.
_ANSWER_LEAD_RE = re.compile(
    r"^\s*(?:the\s+)?(?:answer|result|value|roots?|x|y)\s*(?:is|=|:)\s*",
    re.IGNORECASE,
)


def verify_math(
    problem_expression: str,
    claimed_answer: str,
    kind: VerifyKind,
) -> VerifyMathResponse:
    """Run the deterministic verification. NEVER raises.

    Args:
        problem_expression: the originating problem (kind-specific shape).
        claimed_answer:     the value/root(s) Foxy claimed.
        kind:               'evaluate' | 'solve_equation' | 'simplify'.

    Returns:
        A :class:`VerifyMathResponse` whose ``is_correct`` is the tristate
        verdict. Unverifiable inputs return ``is_correct=None``.
    """
    if not _SYMPY_OK:  # pragma: no cover - environment guard
        return _unverifiable("sympy_unavailable")

    try:
        if kind == "evaluate":
            return _verify_evaluate(problem_expression, claimed_answer)
        if kind == "solve_equation":
            return _verify_solve_equation(problem_expression, claimed_answer)
        if kind == "simplify":
            return _verify_simplify(problem_expression, claimed_answer)
        # Unknown kind — fail-closed-to-None (NOT False). An unknown kind is an
        # "unavailable" condition, not a wrong answer.
        return _unverifiable("unknown_kind")
    except RecursionError:
        return _unverifiable("recursion_error")
    except Exception as err:  # noqa: BLE001 — fail-closed: NEVER raise.
        # P13: log the error CLASS only, never the expressions (math strings
        # aren't PII but we keep logs terse and avoid echoing potentially
        # large payloads).
        logger.info("math.verify.exception", error_type=type(err).__name__)
        return _unverifiable("exception")


# ── kind: evaluate ───────────────────────────────────────────────────────────


def _verify_evaluate(problem: str, claimed: str) -> VerifyMathResponse:
    """Compute the canonical value of ``problem`` and compare to ``claimed``.

    Used when the problem reduces to a single determinable value (arithmetic
    on numbers / fractions / surds). E.g. problem='1/2 + 3/4', claimed='5/4'.
    """
    prob_expr = _safe_parse(problem)
    claim_expr = _safe_parse(_strip_answer_prose(claimed))
    if prob_expr is None or claim_expr is None:
        return _unverifiable("parse_error")

    if _too_big(prob_expr) or _too_big(claim_expr):
        return _unverifiable("expression_too_large")

    # Free symbols on EITHER side mean this isn't a pure numeric evaluation —
    # route it through symbolic equality instead (so "2*x" vs "x + x" still
    # verifies) rather than declaring it unverifiable.
    if prob_expr.free_symbols or claim_expr.free_symbols:
        return _symbolic_equal(prob_expr, claim_expr)

    computed = simplify(prob_expr)
    diff = simplify(computed - claim_expr)
    computed_str = _to_str(computed)

    if diff == 0:
        return VerifyMathResponse(
            is_correct=True,
            confidence=1.0,
            computed=computed_str,
            reason="value_match",
        )

    # Fall back to a numeric comparison for irrational results that don't
    # cancel symbolically (e.g. decimal vs surd form of the same number).
    numeric = _numeric_close(computed, claim_expr)
    if numeric is True:
        return VerifyMathResponse(
            is_correct=True,
            confidence=0.95,
            computed=computed_str,
            reason="numeric_match",
        )
    if numeric is None:
        # Couldn't evaluate to a float — declare unverifiable, not wrong.
        return _unverifiable("non_numeric", computed=computed_str)

    return VerifyMathResponse(
        is_correct=False,
        confidence=1.0,
        computed=computed_str,
        reason="value_mismatch",
    )


# ── kind: solve_equation ──────────────────────────────────────────────────────


def _verify_solve_equation(problem: str, claimed: str) -> VerifyMathResponse:
    """Verify the claimed root(s) SATISFY the equation.

    We do NOT re-derive the roots and compare sets (that can disagree on form
    for the same root, and misses no-real-root cases). Instead we substitute
    each claimed root back into ``lhs - rhs`` and check it is zero — the exact
    self-check the solver was told to perform. E.g. problem='x^2 - 5x + 6 = 0',
    claimed='x = 2 or x = 3'.
    """
    eq = _parse_equation(problem)
    if eq is None:
        return _unverifiable("parse_error")

    lhs_minus_rhs, symbol = eq
    if symbol is None:
        return _unverifiable("no_unknown")

    roots = _parse_roots(claimed)
    if not roots:
        return _unverifiable("no_roots_parsed")

    computed_str = ", ".join(_to_str(r) for r in roots)

    for root in roots:
        try:
            residual = simplify(lhs_minus_rhs.subs(symbol, root))
        except Exception:  # noqa: BLE001
            return _unverifiable("subst_error", computed=computed_str)
        if residual == 0:
            continue
        numeric = _numeric_close(residual, _safe_parse("0") or root - root)
        if numeric is True:
            continue
        # A claimed root that does not satisfy the equation = confidently wrong.
        return VerifyMathResponse(
            is_correct=False,
            confidence=1.0,
            computed=computed_str,
            reason="root_does_not_satisfy",
        )

    return VerifyMathResponse(
        is_correct=True,
        confidence=1.0,
        computed=computed_str,
        reason="all_roots_satisfy",
    )


# ── kind: simplify ────────────────────────────────────────────────────────────


def _verify_simplify(problem: str, claimed: str) -> VerifyMathResponse:
    """Symbolic equality between ``problem`` and the claimed simplified form."""
    prob_expr = _safe_parse(problem)
    claim_expr = _safe_parse(_strip_answer_prose(claimed))
    if prob_expr is None or claim_expr is None:
        return _unverifiable("parse_error")
    if _too_big(prob_expr) or _too_big(claim_expr):
        return _unverifiable("expression_too_large")
    return _symbolic_equal(prob_expr, claim_expr)


def _symbolic_equal(a: Any, b: Any) -> VerifyMathResponse:
    """Decide a == b symbolically, with a numeric fallback.

    - diff simplifies to 0                         → True  (exact).
    - diff has free symbols and is non-zero        → False (a non-zero
      polynomial/expression difference means the two forms are NOT equal for
      all values of the variable — a confident mismatch, e.g. (x+1)^2 vs x^2+1
      gives 2*x ≠ 0).
    - no free symbols (pure numeric, possibly surd) → numeric fallback:
        close   → True
        not     → False
        can't evaluate → None (unverifiable, not wrong).
    """
    diff = simplify(a - b)
    computed_str = _to_str(simplify(a))
    if diff == 0:
        return VerifyMathResponse(
            is_correct=True,
            confidence=1.0,
            computed=computed_str,
            reason="symbolic_equal",
        )

    # Free symbols on either side → this is a SYMBOLIC comparison. A non-zero
    # symbolic difference is a confident inequality (False), not "unverifiable".
    if a.free_symbols or b.free_symbols or diff.free_symbols:
        return VerifyMathResponse(
            is_correct=False,
            confidence=1.0,
            computed=computed_str,
            reason="symbolic_mismatch",
        )

    # Pure numeric difference that didn't cancel symbolically (e.g. surd vs
    # decimal form). Use the numeric tolerance comparison.
    numeric = _numeric_close(a, b)
    if numeric is True:
        return VerifyMathResponse(
            is_correct=True,
            confidence=0.9,
            computed=computed_str,
            reason="numeric_equal",
        )
    if numeric is None:
        return _unverifiable("non_numeric", computed=computed_str)
    return VerifyMathResponse(
        is_correct=False,
        confidence=1.0,
        computed=computed_str,
        reason="value_mismatch",
    )


# ── Parsing helpers (all return None on failure — NEVER raise) ────────────────


def _safe_parse(text: str) -> Any | None:
    """Parse ``text`` into a SymPy expression with implicit multiplication.

    Returns None on any parse failure. Locked down: no custom ``locals`` so
    Python builtins are not exposed; ``^`` is treated as exponentiation (the
    way students write it) via the transformations.
    """
    s = (text or "").strip()
    if not s:
        return None
    # Students write '^' for power and '×' / '·' for multiply; normalise so the
    # SymPy parser accepts them.
    s = s.replace("^", "**").replace("×", "*").replace("·", "*").replace("÷", "/")
    try:
        return parse_expr(
            s,
            transformations=_TRANSFORMATIONS,
            evaluate=True,
        )
    except (SympifyError, SyntaxError, TypeError, ValueError, AttributeError):
        return None
    except Exception:  # noqa: BLE001 — any parser internal error → unverifiable
        return None


def _parse_equation(text: str) -> tuple[Any, Any | None] | None:
    """Parse an equation 'lhs = rhs' into (lhs - rhs, primary_symbol).

    A bare expression (no '=') is treated as '<expr> = 0'. Returns None on a
    parse failure; the symbol is None when the equation has no free symbol.
    """
    s = (text or "").strip()
    if not s:
        return None
    # Only split on the FIRST '=' that isn't part of '==' / '<=' / '>=' / '!='.
    parts = re.split(r"(?<![<>=!])=(?!=)", s, maxsplit=1)
    if len(parts) == 2:
        lhs = _safe_parse(parts[0])
        rhs = _safe_parse(parts[1])
        if lhs is None or rhs is None:
            return None
        expr = simplify(lhs - rhs)
    else:
        expr = _safe_parse(s)
        if expr is None:
            return None
    if _too_big(expr):
        return None
    symbols = sorted(expr.free_symbols, key=lambda x: x.name)
    primary = symbols[0] if symbols else None
    return expr, primary


def _parse_roots(text: str) -> list[Any]:
    """Parse claimed root(s) into a list of SymPy values.

    Accepts: 'x = 2 or x = 3', '2, 3', 'x = 2; x = 3', '2 or 3', '-1'.
    Strips 'x =' / 'y =' lead-ins per root. Returns [] when nothing parses.
    """
    s = (text or "").strip()
    if not s:
        return []
    # Split on ' or ', commas, semicolons.
    pieces = re.split(r"\s+or\s+|[,;]", s, flags=re.IGNORECASE)
    roots: list[Any] = []
    for piece in pieces:
        token = piece.strip()
        if not token:
            continue
        # Drop a leading 'x =' / 'y =' / 'answer:' so only the value remains.
        token = re.sub(r"^[A-Za-z]\w*\s*=\s*", "", token)
        token = _strip_answer_prose(token)
        val = _safe_parse(token)
        if val is None:
            continue
        # A ROOT must be a constant value (number / surd), not a free-symbol
        # expression. "no idea" parses (via implicit multiplication) to the
        # symbol product n*o*i*d*e*a — reject those so junk prose can't be
        # mistaken for roots. This keeps the verdict at None (unverifiable)
        # rather than substituting garbage and declaring False.
        try:
            if val.free_symbols:
                continue
        except AttributeError:
            continue
        roots.append(val)
    return roots


def _strip_answer_prose(text: str) -> str:
    """Strip 'Answer:' / 'the value is' / leading '=' prose around a value."""
    s = (text or "").strip()
    s = _ANSWER_LEAD_RE.sub("", s)
    s = s.lstrip("=").strip()
    return s


# ── Numeric + size helpers ────────────────────────────────────────────────────


def _numeric_close(a: Any, b: Any) -> bool | None:
    """Compare two expressions numerically.

    Returns True/False on a successful float comparison, or None when either
    side cannot be evaluated to a finite real (so the caller declares the
    result unverifiable rather than wrong).
    """
    try:
        diff = sympy.N(simplify(a - b))
    except Exception:  # noqa: BLE001
        return None
    try:
        if diff.is_number and diff.is_real is not False:
            return bool(abs(complex(diff)) <= _NUMERIC_TOL)
    except (TypeError, ValueError):
        return None
    return None


def _too_big(expr: Any) -> bool:
    """Guard against a pathological expression tree (DoS-ish input)."""
    try:
        return expr.count_ops(visual=False) > _MAX_NODES or len(str(expr)) > 20000
    except Exception:  # noqa: BLE001
        return True


def _to_str(expr: Any) -> str | None:
    """Render a SymPy value to a short string, or None on failure."""
    try:
        return str(expr)
    except Exception:  # noqa: BLE001
        return None


def _unverifiable(reason: str, *, computed: str | None = None) -> VerifyMathResponse:
    """Build the canonical 'could not verify' response (is_correct=None)."""
    return VerifyMathResponse(
        is_correct=None,
        confidence=0.0,
        computed=computed,
        reason=reason,
    )
