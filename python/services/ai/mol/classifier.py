import re
from typing import Literal

from .types import GenerateRequest, TaskType

KEYWORDS = {
    "step_by_step": re.compile(
        r"\b(step[\s-]?by[\s-]?step|solve.*step|derive|show your work|show the steps|prove)\b",
        re.IGNORECASE,
    ),
    "reasoning": re.compile(
        r"\b(why .* and why|prove that|derive|justify|compare and contrast|critically)\b",
        re.IGNORECASE,
    ),
    "evaluation": re.compile(
        r"\b(grade (my|this)|evaluate (my|this)|is this correct|check my (answer|work)|mark this)\b",
        re.IGNORECASE,
    ),
    "explanation": re.compile(
        r"\b(explain|what is|define|describe|tell me about|kya hai|कैसे|क्या है)\b",
        re.IGNORECASE | re.UNICODE,
    ),
    "doubt_solving": re.compile(
        r"\b(i don'?t understand|i'm confused|why does|how do i|samajh nahi|समझ नहीं)\b",
        re.IGNORECASE | re.UNICODE,
    ),
    "quiz_generation": re.compile(
        r"\b(generate|create|make).*(quiz|questions?|mcqs?|test)\b", re.IGNORECASE
    ),
}


def classify(req: GenerateRequest) -> TaskType:
    if req.task_type:
        return req.task_type

    if req.input.image_url:
        return "ocr_extraction"

    surface = req.config.surface if req.config else None
    if surface == "quiz":
        return "quiz_generation"
    if surface == "ocr":
        return "ocr_extraction"

    text = (req.input.question or req.input.instruction or req.input.topic or "").strip()

    has_why = bool(re.search(r"\bwhy\b", text, re.IGNORECASE))
    has_how = bool(re.search(r"\bhow\b", text, re.IGNORECASE))
    if has_why and has_how and len(text) > 40:
        return "doubt_solving"

    if KEYWORDS["evaluation"].search(text):
        return "evaluation"
    if KEYWORDS["quiz_generation"].search(text):
        return "quiz_generation"
    if KEYWORDS["step_by_step"].search(text):
        return "step_by_step"
    if KEYWORDS["doubt_solving"].search(text):
        return "doubt_solving"
    if KEYWORDS["reasoning"].search(text):
        return "reasoning"
    if KEYWORDS["explanation"].search(text):
        return "explanation"

    # Default — student-facing surfaces are usually teaching
    return "explanation"


def grade_tier(grade: str) -> Literal["junior", "middle", "senior"]:
    try:
        g = int(grade)
    except (ValueError, TypeError):
        g = 0
    if g <= 8:
        return "junior"
    if g <= 10:
        return "middle"
    return "senior"
