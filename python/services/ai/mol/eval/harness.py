"""Quality eval harness — the golden-set cutover gate (Phase 6, spec A5).

Wires the EXISTING grader (:func:`services.ai.mol.grader.grade_shadow_pair`)
into a pass/fail launch gate. For each golden item the gate:

1. Produces a candidate (shadow) answer via the caller-supplied
   ``produce_answer`` callback (so the gate is decoupled from how answers are
   generated — tests pass a fake, the real cutdown harness passes the
   orchestrator).
2. Grades the (baseline, shadow) pair via ``grade_shadow_pair`` against the
   real grader rubric.
3. Treats a ``None`` grader result (missing key / empty text / non-200 / parse
   error / exception — every branch in :func:`grade_shadow_pair`) as a FAILURE.
   The gate NEVER silently passes an ungradeable item.
4. Flags a failure when the graded shadow ``overall`` falls below the item's
   ``min_overall`` floor.

A cutover is blocked when ``GateVerdict.passed`` is ``False``.

``grade_shadow_pair`` is referenced as a module-level name so tests can
``monkeypatch.setattr(harness, "grade_shadow_pair", fake)`` — no real Anthropic
network call ever fires under test.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import structlog

from ..grader import GraderInput, grade_shadow_pair
from .golden_set import GOLDEN_SET, GoldenItem

logger = structlog.get_logger(__name__)

ProduceAnswer = Callable[[GoldenItem], Awaitable[str]]


@dataclass
class GateVerdict:
    """Result of the golden-set gate.

    Attributes:
        passed: True only when every golden item was graded at or above its
            floor (and none was ungradeable).
        graded: How many golden items were processed (always == len(GOLDEN_SET)).
        failures: One human-readable string per failing item; empty when passed.
    """

    passed: bool
    graded: int = 0
    failures: list[str] = field(default_factory=list)


async def run_quality_gate(*, produce_answer: ProduceAnswer) -> GateVerdict:
    """Run the golden-set quality gate.

    Args:
        produce_answer: async callback that returns the candidate (shadow)
            answer text for a given :class:`GoldenItem`. The harness does NOT
            call any provider directly — generation is the caller's concern.

    Returns:
        A :class:`GateVerdict`. ``passed`` is True iff there are zero failures.
    """
    failures: list[str] = []
    graded = 0

    for item in GOLDEN_SET:
        graded += 1
        task = item.task_type

        shadow_text = await produce_answer(item)

        result = await grade_shadow_pair(
            GraderInput(
                question=item.question,
                baseline_text=item.baseline_answer,
                shadow_text=shadow_text,
                grade=item.grade,
            )
        )

        if result is None:
            # Defensive: an ungradeable item is a hard failure, never a pass.
            failures.append(f"{task}:ungradeable")
            continue

        if result.shadow.overall < item.min_overall:
            failures.append(
                f"{task}: shadow overall {result.shadow.overall:.2f} "
                f"< floor {item.min_overall:.2f}"
            )

    verdict = GateVerdict(passed=len(failures) == 0, graded=graded, failures=failures)

    logger.info(
        "mol.eval.gate",
        passed=verdict.passed,
        graded=verdict.graded,
        failure_count=len(verdict.failures),
    )

    return verdict
