"""Unit tests for the SymPy math verifier handler (Part 1D — VERIFIER).

Covers the assessment binding cases:
  - 'evaluate' fraction arithmetic: 1/2 + 3/4 = 5/4 (the original regression).
  - 'evaluate' mismatch → is_correct=False.
  - 'solve_equation' roots that satisfy → True; a root that doesn't → False.
  - 'simplify' symbolic equality.
  - Unparseable / out-of-scope / unknown-kind → is_correct=None (fail-closed:
    unavailable is NOT wrong).
  - The handler NEVER raises.
"""

from __future__ import annotations

import pytest

from services.ai.business.math.handler import verify_math

# ── evaluate ─────────────────────────────────────────────────────────────────


def test_evaluate_fraction_add_correct() -> None:
    """The original regression: 1/2 + 3/4 must verify to 5/4."""
    r = verify_math("1/2 + 3/4", "5/4", "evaluate")
    assert r.is_correct is True
    assert r.confidence == 1.0


def test_evaluate_fraction_add_wrong_is_false() -> None:
    """A confidently wrong claimed value → False (triggers Sonnet escalation)."""
    r = verify_math("1/2 + 3/4", "1/4", "evaluate")
    assert r.is_correct is False
    assert r.confidence == 1.0
    assert r.reason == "value_mismatch"


def test_evaluate_strips_answer_prose() -> None:
    """'Answer: 5/4' / 'x = 5/4' prose lead-ins are stripped before parse."""
    r = verify_math("1/2 + 3/4", "answer: 5/4", "evaluate")
    assert r.is_correct is True


def test_evaluate_decimal_matches_fraction() -> None:
    r = verify_math("3/4", "0.75", "evaluate")
    assert r.is_correct is True


def test_evaluate_multiplication_unicode_operator() -> None:
    """'12 × 4' uses the unicode multiply sign; should still evaluate to 48."""
    r = verify_math("12 × 4", "48", "evaluate")
    assert r.is_correct is True


def test_evaluate_caret_power() -> None:
    """Students write '^' for power; 2^3 = 8."""
    r = verify_math("2^3", "8", "evaluate")
    assert r.is_correct is True


def test_evaluate_unparseable_problem_is_none() -> None:
    """Garbage problem → could not verify (None), NOT wrong."""
    r = verify_math("@@@ not math @@@", "5", "evaluate")
    assert r.is_correct is None
    assert r.confidence == 0.0


def test_evaluate_unparseable_answer_is_none() -> None:
    r = verify_math("1/2 + 3/4", "$$broken$$", "evaluate")
    assert r.is_correct is None


def test_evaluate_symbolic_identity_when_symbols_present() -> None:
    """2*x vs x + x is symbolically equal even though it's 'evaluate' kind."""
    r = verify_math("2*x", "x + x", "evaluate")
    assert r.is_correct is True


# ── solve_equation ────────────────────────────────────────────────────────────


def test_solve_equation_roots_satisfy() -> None:
    r = verify_math("x^2 - 5x + 6 = 0", "x = 2 or x = 3", "solve_equation")
    assert r.is_correct is True
    assert r.reason == "all_roots_satisfy"


def test_solve_equation_comma_roots() -> None:
    r = verify_math("x^2 - 5x + 6 = 0", "2, 3", "solve_equation")
    assert r.is_correct is True


def test_solve_equation_wrong_root_is_false() -> None:
    """A claimed root that doesn't satisfy → confidently wrong."""
    r = verify_math("x^2 - 5x + 6 = 0", "x = 2 or x = 5", "solve_equation")
    assert r.is_correct is False
    assert r.reason == "root_does_not_satisfy"


def test_solve_equation_linear() -> None:
    r = verify_math("2x + 3 = 7", "x = 2", "solve_equation")
    assert r.is_correct is True


def test_solve_equation_no_roots_parsed_is_none() -> None:
    r = verify_math("x^2 - 5x + 6 = 0", "no idea", "solve_equation")
    assert r.is_correct is None


def test_solve_equation_unparseable_is_none() -> None:
    r = verify_math("@@@ = ???", "x = 2", "solve_equation")
    assert r.is_correct is None


# ── simplify ──────────────────────────────────────────────────────────────────


def test_simplify_symbolic_equal() -> None:
    r = verify_math("(x+1)^2", "x^2 + 2x + 1", "simplify")
    assert r.is_correct is True
    assert r.reason in {"symbolic_equal", "numeric_equal"}


def test_simplify_mismatch_is_false() -> None:
    r = verify_math("(x+1)^2", "x^2 + 1", "simplify")
    assert r.is_correct is False


# ── fail-closed posture ───────────────────────────────────────────────────────


def test_unknown_kind_is_none_not_false() -> None:
    """An unknown kind is 'unavailable' (None), never a wrong verdict."""
    r = verify_math("1+1", "2", "totally_unknown")  # type: ignore[arg-type]
    assert r.is_correct is None
    assert r.reason == "unknown_kind"


@pytest.mark.parametrize(
    ("problem", "claimed", "kind"),
    [
        ("", "5", "evaluate"),
        ("1/2 + 3/4", "", "evaluate"),
        ("=====", "0", "solve_equation"),
    ],
)
def test_never_raises_on_degenerate_input(problem: str, claimed: str, kind: str) -> None:
    """No degenerate input may raise; everything maps to a tristate verdict."""
    r = verify_math(problem, claimed, kind)  # type: ignore[arg-type]
    assert r.is_correct in (True, False, None)
