import re
from typing import TypedDict, Optional
from .types import StudentContext, TaskType

class ProviderTarget(TypedDict):
    provider: str  # 'openai' | 'anthropic'
    model: str

class UseCaseConfig(TypedDict):
    name: str
    primary: ProviderTarget
    fallbacks: list[ProviderTarget]

USE_CASES: dict[str, UseCaseConfig] = {
    "hard_iit_math": {
        "name": "Hard IIT Math",
        "primary": {"provider": "openai", "model": "o3-mini"},
        "fallbacks": [
            {"provider": "openai", "model": "o1"},
            {"provider": "openai", "model": "gpt-4o"},
        ],
    },
    "physics_derivations": {
        "name": "Physics Derivations",
        "primary": {"provider": "openai", "model": "o3-mini"},
        "fallbacks": [
            {"provider": "openai", "model": "o1"},
            {"provider": "anthropic", "model": "claude-3-5-sonnet-20241022"},
        ],
    },
    "numerical_problem_solving": {
        "name": "Numerical Problem Solving",
        "primary": {"provider": "openai", "model": "o3-mini"},
        "fallbacks": [
            {"provider": "openai", "model": "o1"},
            {"provider": "openai", "model": "gpt-4o"},
        ],
    },
    "fast_practice_solving": {
        "name": "Fast Practice Solving",
        "primary": {"provider": "openai", "model": "gpt-4o-mini"},
        "fallbacks": [
            {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
        ],
    },
    "doubt_solving_students": {
        "name": "Doubt Solving for Students",
        "primary": {"provider": "openai", "model": "gpt-4o"},
        "fallbacks": [
            {"provider": "anthropic", "model": "claude-3-5-sonnet-20241022"},
            {"provider": "openai", "model": "gpt-4o-mini"},
        ],
    },
    "content_generation_coaching": {
        "name": "Content Generation for Coaching",
        "primary": {"provider": "openai", "model": "o1"},
        "fallbacks": [
            {"provider": "openai", "model": "gpt-4o"},
        ],
    },
    "deep_theory_explanation": {
        "name": "Deep Theory Explanation",
        "primary": {"provider": "openai", "model": "gpt-4o"},
        "fallbacks": [
            {"provider": "anthropic", "model": "claude-3-opus-20240229"},
            {"provider": "anthropic", "model": "claude-3-5-sonnet-20241022"},
        ],
    },
    "student_tutoring": {
        "name": "Student Tutoring",
        "primary": {"provider": "openai", "model": "gpt-4o"},
        "fallbacks": [
            {"provider": "anthropic", "model": "claude-3-5-sonnet-20241022"},
            {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
        ],
    },
    "creating_question_banks": {
        "name": "Creating Question Banks",
        "primary": {"provider": "openai", "model": "gpt-4o"},
        "fallbacks": [
            {"provider": "anthropic", "model": "claude-3-opus-20240229"},
            {"provider": "anthropic", "model": "claude-3-5-sonnet-20241022"},
        ],
    },
    "generating_hints": {
        "name": "Generating Hints",
        "primary": {"provider": "openai", "model": "gpt-4o-mini"},
        "fallbacks": [
            {"provider": "anthropic", "model": "claude-3-5-sonnet-20241022"},
            {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
        ],
    },
    "long_pdf_analysis": {
        "name": "Long PDF/Book Analysis",
        "primary": {"provider": "openai", "model": "gpt-4o"},
        "fallbacks": [
            {"provider": "anthropic", "model": "claude-3-opus-20240229"},
        ],
    },
}

def determine_use_case(
    task: TaskType,
    context: Optional[StudentContext] = None,
    query: Optional[str] = None,
) -> Optional[str]:
    if not context:
        return None

    subject = (context.subject or "").lower().strip()
    exam_goal = (context.exam_goal or "").lower().strip()
    q_text = (query or "").lower().strip()
    speed = context.learning_speed
    
    try:
        grade = int(context.grade) if context.grade else 0
    except (ValueError, TypeError):
        grade = 0

    # 1. Hard IIT Math
    if (
        subject in ("math", "mathematics")
        and exam_goal == "jee"
        and task in ("step_by_step", "reasoning", "explanation")
    ):
        return "hard_iit_math"

    # 2. Physics derivations
    if (
        subject == "physics"
        and task in ("reasoning", "step_by_step")
        and ("derive" in q_text or "derivation" in q_text or "prove" in q_text or grade >= 11)
    ):
        return "physics_derivations"

    # 3. Numerical problem solving
    is_sci_math = subject in ("physics", "chemistry", "math", "mathematics")
    is_numerical_query = (
        "solve" in q_text
        or "calculate" in q_text
        or "value" in q_text
        or "find the" in q_text
        or bool(re.search(r"\b\d+\b", q_text))
    )
    if task == "step_by_step" and is_sci_math and is_numerical_query:
        return "numerical_problem_solving"

    # 4. Fast practice solving
    if task == "quiz_generation" and speed == "fast":
        return "fast_practice_solving"

    # 5. Creating question banks
    if task == "quiz_generation":
        is_coaching = not context.student_id or context.student_id.startswith("anon")
        if is_coaching:
            return "creating_question_banks"

    # 6. Generating hints
    if task == "concept_explanation" and "hint" in q_text:
        return "generating_hints"

    # 7. Deep theory explanation
    if (
        task in ("concept_explanation", "explanation")
        and (speed == "slow" or "detailed" in q_text or "deeply" in q_text or "theory" in q_text)
    ):
        return "deep_theory_explanation"

    # 8. Student tutoring
    if task == "explanation" and context.student_id and not context.student_id.startswith("anon"):
        return "student_tutoring"

    # 9. Long PDF/book analysis
    if task == "ocr_extraction" or "pdf" in q_text or "book" in q_text:
        return "long_pdf_analysis"

    # 10. Doubt solving for students
    if task == "doubt_solving":
        return "doubt_solving_students"

    # 11. Content generation for coaching
    is_coaching_context = not context.student_id or context.student_id.startswith("anon")
    if is_coaching_context and task in ("explanation", "concept_explanation", "step_by_step"):
        return "content_generation_coaching"

    return None
