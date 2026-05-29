import re
from typing import Tuple, List

# Simple heuristics for question type detection based on leading command words
COMMAND_PATTERNS = {
    "define": r"^\s*(Define|What\s+is|What\s+are)",
    "explain": r"^\s*Explain",
    "differentiate": r"^\s*(Differentiate|Compare)",
    "why": r"^\s*Why",
    "how": r"^\s*How",
    "discuss": r"^\s*Discuss",
    "enumerate": r"^\s*(Enumerate|List(\s+out)?)",
    "derive": r"^\s*Derive",
    "calculate": r"^\s*(Calculate|Solve)",
}

def detect_question_type(question: str) -> str:
    """Return a keyword representing the question type.
    Falls back to "generic" if no pattern matches."""
    for key, pattern in COMMAND_PATTERNS.items():
        if re.search(pattern, question, re.IGNORECASE):
            return key
    return "generic"

def extract_marks(question: str) -> int | None:
    """Extract explicit marks specified in the question text.
    Matches formats like [3 marks], (5 Marks), [2m], (2m), - 5 marks, etc.
    """
    patterns = [
        r"\[\s*(\d+)\s*(?:marks?|m)\s*\]",
        r"\(\s*(\d+)\s*(?:marks?|m)\s*\)",
        r"(?:-\s*|for\s+|worth\s+)?\b(\d+)\s*(?:marks?|m)\b"
    ]
    for pattern in patterns:
        m = re.search(pattern, question, re.IGNORECASE)
        if m:
            return int(m.group(1))
    return None

def estimate_marks(question: str) -> int:
    """Estimate marks based on explicit indicators or wording/length heuristics.
    - Define, What is -> 1 mark
    - Calculate, Solve -> 1-2 marks
    - Explain, Why, How, Discuss -> 3-4 marks
    - Differentiate, Derive -> 4-5 marks
    """
    explicit = extract_marks(question)
    if explicit is not None:
        return explicit

    qtype = detect_question_type(question)
    
    # Strip any explicit marks pattern to get clean word count
    clean_q = re.sub(
        r"\[\s*\d+\s*(?:marks?|m)\s*\]|\(\s*\d+\s*(?:marks?|m)\s*\)",
        "",
        question,
        flags=re.IGNORECASE
    )
    word_count = len(clean_q.split())
    
    if qtype in {"define"}:
        return 1
    if qtype in {"calculate", "solve"}:
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

