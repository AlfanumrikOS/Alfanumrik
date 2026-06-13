"""Phase 6 (A5) — golden-set quality eval harness gate.

Wires the EXISTING MoL grader (:func:`services.ai.mol.grader.grade_shadow_pair`)
into a launch gate: every golden item's graded shadow answer must meet its
``min_overall`` floor, otherwise the gate FAILS (blocking a cutover).

The two gate tests monkeypatch ``harness_mod.grade_shadow_pair`` with a fake so
NO real Anthropic/network call happens, and pass a ``produce_answer`` async
callback so NO real provider call happens either.
"""

from __future__ import annotations

import pytest

from services.ai.mol import grader as grader_mod
from services.ai.mol.eval import golden_set as golden_mod
from services.ai.mol.eval import harness as harness_mod


def _candidate(overall: float) -> grader_mod.CandidateScores:
    """Build a real :class:`CandidateScores` with the given ``overall``.

    Real dataclass fields (confirmed against grader.py): accuracy, cbse_scope,
    age_appropriateness, scaffold_fidelity, helpfulness, citation_accuracy
    (Optional), overall.
    """
    return grader_mod.CandidateScores(
        accuracy=1.0,
        cbse_scope=1.0,
        age_appropriateness=1.0,
        scaffold_fidelity=1.0,
        helpfulness=1.0,
        citation_accuracy=1.0,
        overall=overall,
    )


def _grader_result(shadow_overall: float) -> grader_mod.GraderResult:
    """Build a real :class:`GraderResult` whose shadow candidate scores
    ``shadow_overall``. Matches the real dataclass kwargs exactly."""
    return grader_mod.GraderResult(
        baseline=_candidate(0.95),
        shadow=_candidate(shadow_overall),
        agreement=1.0,
        winner="tie",
        notes="fake grader result for harness test",
        rubric_version="mol-grader-v2",
        model="claude-sonnet-4-6-20251022",
        prompt_tokens=10,
        completion_tokens=5,
    )


# ── Test 1: golden set is nonempty + correctly typed ──────────────────────────


def test_golden_set_nonempty_and_typed() -> None:
    assert len(golden_mod.GOLDEN_SET) >= 1
    for item in golden_mod.GOLDEN_SET:
        assert isinstance(item, golden_mod.GoldenItem)
        assert isinstance(item.question, str) and item.question
        assert isinstance(item.grade, str) and item.grade  # P5: grade is a string
        assert isinstance(item.subject, str) and item.subject
        assert isinstance(item.baseline_answer, str) and item.baseline_answer
        assert isinstance(item.min_overall, float)
        assert 0.0 <= item.min_overall <= 1.0


# ── Test 2: gate PASSES when every item meets its floor ───────────────────────


async def test_gate_passes_when_all_items_meet_floor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_grade(_args: object) -> grader_mod.GraderResult:
        # Every shadow answer scores well above any item floor.
        return _grader_result(0.95)

    monkeypatch.setattr(harness_mod, "grade_shadow_pair", _fake_grade)

    async def _produce(item: golden_mod.GoldenItem) -> str:
        return f"A good answer to: {item.question}"

    verdict = await harness_mod.run_quality_gate(produce_answer=_produce)

    assert verdict.passed is True
    assert verdict.graded == len(golden_mod.GOLDEN_SET)
    assert verdict.failures == []


# ── Test 3: gate FAILS when any item falls below its floor ────────────────────


async def test_gate_fails_when_any_item_below_floor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_grade(_args: object) -> grader_mod.GraderResult:
        # Every shadow answer scores below the 0.70 floors in the golden set.
        return _grader_result(0.40)

    monkeypatch.setattr(harness_mod, "grade_shadow_pair", _fake_grade)

    async def _produce(item: golden_mod.GoldenItem) -> str:
        return f"A weak answer to: {item.question}"

    verdict = await harness_mod.run_quality_gate(produce_answer=_produce)

    assert verdict.passed is False
    assert verdict.graded == len(golden_mod.GOLDEN_SET)
    assert len(verdict.failures) == len(golden_mod.GOLDEN_SET)


# ── Test 4: an ungradeable item (grader returns None) is a FAILURE ────────────
# grade_shadow_pair really can return None (missing key / empty text / non-200 /
# parse error / exception). The gate MUST treat None as a failure, never a
# silent pass.


async def test_gate_treats_ungradeable_as_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_grade(_args: object) -> None:
        return None

    monkeypatch.setattr(harness_mod, "grade_shadow_pair", _fake_grade)

    async def _produce(item: golden_mod.GoldenItem) -> str:
        return f"An answer to: {item.question}"

    verdict = await harness_mod.run_quality_gate(produce_answer=_produce)

    assert verdict.passed is False
    assert verdict.graded == len(golden_mod.GOLDEN_SET)
    assert any("ungradeable" in f for f in verdict.failures)
