import re
from typing import Tuple, List

# Simple heuristics for question type detection based on leading command words
COMMAND_PATTERNS = {
    "define": r"^\s*Define",
    "explain": r"^\s*Explain",
    "differentiate": r"^\s*Differentiate",
    "why": r"^\s*Why",
    "how": r"^\s*How",
    "discuss": r"^\s*Discuss",
    "enumerate": r"^\s*(Enumerate|List)",
    "derive": r"^\s*Derive",
    "calculate": r"^\s*Calculate",
    "solve": r"^\s*Solve",
}

def detect_question_type(question: str) -> str:
    """Return a keyword representing the question type.
    Falls back to "generic" if no pattern matches."""
    for key, pattern in COMMAND_PATTERNS.items():
        if re.search(pattern, question, re.IGNORECASE):
            return key
    return "generic"

def estimate_marks(question: str) -> int:
    """Very rough estimation of marks based on length and detected type.
    - 1‑2 sentences → 1‑2 marks
    - Presence of words like "explain", "discuss" → 3‑4 marks
    - "differentiate", "derive", "calculate" → 4‑5 marks
    This can be overridden by user‑provided estimate.
    """
    qtype = detect_question_type(question)
    word_count = len(question.split())
    if qtype in {"define", "calculate", "solve"}:
        return 1 if word_count < 12 else 2
    if qtype in {"explain", "why", "how", "discuss"}:
        return 3 if word_count < 30 else 4
    if qtype in {"differentiate", "derive"}:
        return 5 if word_count > 25 else 4
    # default fallback
    if word_count < 10:
        return 1
    if word_count < 20:
        return 2
    return 3

def parse_question(question: str) -> Tuple[str, int]:
    """Return a tuple (question_type, estimated_marks)."""
    return detect_question_type(question), estimate_marks(question)
