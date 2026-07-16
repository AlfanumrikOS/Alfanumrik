"""Prompt builders for the Foxy per-turn perception classifier.

The classifier is a SILENT observer: it reads one turn (the student's message +
Foxy's reply) and emits ONLY a compact JSON classification. It never addresses
the student and never produces student-facing prose (P12 — no unfiltered LLM
output reaches a student; the output is machine JSON consumed server-side).

Scope is pinned to CBSE Class {grade} {subject} so the Bloom / topic / intent
labels stay curriculum-anchored (assessment reviews this scope).
"""

from __future__ import annotations

# CBSE-aligned Bloom rubric. The classifier scores the level of the STUDENT'S
# cognitive move this turn — what the student is DOING / ATTEMPTING in their
# message — NOT the level of Foxy's reply. Anchored to the canonical lowercase
# taxonomy so a label maps 1:1 onto bloom_progression / question_bank.bloom_level
# with zero conversion. Order is the fixed CBSE progression remember → create.
_BLOOM_RUBRIC = (
    'For "bloom_level", score the STUDENT\'S cognitive move this turn (judge '
    "the STUDENT MESSAGE; use FOXY REPLY only as context). Pick exactly one:\n"
    '    - "remember": recalls or states a fact, term, definition, or name '
    '("What is...", "Name the...", "Define...").\n'
    '    - "understand": explains, describes, or paraphrases a concept in their '
    'own words ("Why does...", "Explain...", "What happens when...").\n'
    '    - "apply": uses a rule, formula, or procedure to solve or compute a '
    'concrete case ("Calculate...", "Solve...", "Find the value of...").\n'
    '    - "analyze": compares, contrasts, breaks apart, or relates '
    'causes/parts ("Compare...", "How are X and Y related...", "Why did...").\n'
    '    - "evaluate": judges, justifies, or defends a choice with reasons '
    '("Which is better and why...", "Is this correct...").\n'
    '    - "create": designs, constructs, or proposes something new ("Design...", '
    '"Propose...", "Write your own...").\n'
    "    Use null when the student's turn is NOT a graded-cognition moment "
    '(a greeting, thanks, or pure logistics such as "which chapter is this?").'
)

# The JSON schema the model must emit. Keep in lock-step with
# TurnClassificationResponse (models.py) + the Node coercer (perception.ts).
_OUTPUT_CONTRACT = (
    "Output ONLY a single minified JSON object, no prose, no code fences, with "
    "EXACTLY these keys:\n"
    '  "topic_label": a short CBSE topic name for THIS turn within the subject '
    'and grade (e.g. "Linear Equations"), or null if no single topic is clear. '
    "Never name a topic from another subject or grade.\n"
    '  "bloom_level": one of "remember","understand","apply","analyze",'
    '"evaluate","create" (lowercase), scored per the Bloom rubric above, or '
    "null for a non-graded-cognition moment.\n"
    '  "misconception_code": a short, stable, lowercase snake_case/kebab code '
    "naming the SPECIFIC, subject-appropriate wrong idea the student's message "
    'reveals (e.g. "sign_error", "confuses_area_perimeter"), matching '
    "^[a-z][a-z0-9_-]{2,63}$. Emit null unless the student actually shows a "
    "wrong idea — a plain question, a correct answer, or simply not knowing is "
    "NOT a misconception. Never invent one.\n"
    '  "struggle_signal": one of "none","repeated_hint","repeated_wrong",'
    '"explicit_confusion","long_idle","give_up". Use "none" for a clean turn.\n'
    '  "intent": a short, reusable, lowercase snake_case label for what the '
    'student wants (e.g. "ask_concept","request_hint","check_answer",'
    '"request_example","off_topic").'
)


def build_system_prompt(*, grade: str, subject: str) -> str:
    """Compose the perception system prompt for a Class {grade} {subject} turn."""
    return (
        f"You are a silent PERCEPTION classifier for Foxy, a CBSE Class {grade} "
        f"{subject} tutor for Indian school students (grades 6-12). You do NOT "
        "talk to the student and you do NOT answer the question. You READ one "
        "tutoring turn and CLASSIFY it.\n\n"
        f"Stay strictly within CBSE Class {grade} {subject} scope. Base every "
        "label only on the turn you are given. If a field is not clearly "
        'supported by the turn, use null (or "none"/"unknown" where the '
        "field is not nullable). Never invent a misconception that is not "
        "evident.\n\n"
        f"{_BLOOM_RUBRIC}\n\n"
        f"{_OUTPUT_CONTRACT}"
    )


def build_user_prompt(
    *,
    student_message: str,
    foxy_answer: str,
    chapter_number: int | None,
) -> str:
    """Compose the per-turn evidence block the classifier reads."""
    chapter_line = (
        f"Chapter: {chapter_number}\n"
        if isinstance(chapter_number, int) and chapter_number > 0
        else ""
    )
    return (
        f"{chapter_line}"
        "Classify the following tutoring turn. Score bloom_level from the "
        "STUDENT MESSAGE (Foxy's reply is context only).\n\n"
        f"STUDENT MESSAGE:\n{student_message}\n\n"
        f"FOXY REPLY:\n{foxy_answer}\n\n"
        "Return ONLY the JSON object described in your instructions."
    )
