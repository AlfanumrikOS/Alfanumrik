"""Golden set — the canonical eval fixture for the MoL cutover quality gate.

OWNERSHIP: the **assessment** agent owns the canonical content and the
``min_overall`` floors. The values below are the *launch seed* (2 items) so the
gate is wired and exercisable from day one; assessment is expected to expand the
set and tune the floors per CBSE pedagogy before a real cutover decision relies
on the verdict.

Each :class:`GoldenItem` carries a fixed ``baseline_answer`` so the grader has a
stable reference candidate to compare the freshly-produced shadow answer against
(the grader scores a baseline/shadow pair). ``grade`` is a string per product
invariant P5.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..types import TaskType


@dataclass(frozen=True)
class GoldenItem:
    """One golden-set probe.

    Attributes:
        task_type: MoL task type the probe exercises (e.g. ``"explanation"``).
        question: The student-facing prompt.
        grade: CBSE grade as a string ("6".."12") — P5.
        subject: CBSE subject (e.g. ``"science"``).
        baseline_answer: Stable reference answer for the grader's baseline slot.
        min_overall: Floor the produced shadow answer's graded ``overall`` must
            meet (inclusive). Owned by assessment.
    """

    task_type: TaskType
    question: str
    grade: str
    subject: str
    baseline_answer: str
    min_overall: float


# Launch seed — 2 items. Assessment owns the canonical content + floors.
GOLDEN_SET: list[GoldenItem] = [
    GoldenItem(
        task_type="explanation",
        question="What is force?",
        grade="8",
        subject="science",
        baseline_answer=(
            "A force is a push or a pull on an object. It can make a "
            "stationary object move, stop a moving object, change its speed, "
            "or change its direction. Force is measured in newtons (N)."
        ),
        min_overall=0.70,
    ),
    GoldenItem(
        task_type="step_by_step",
        question="Solve 2x+3=11",
        grade="7",
        subject="mathematics",
        baseline_answer=(
            "Step 1: Subtract 3 from both sides to get 2x = 8. "
            "Step 2: Divide both sides by 2 to get x = 4. "
            "So x = 4."
        ),
        min_overall=0.70,
    ),
]
