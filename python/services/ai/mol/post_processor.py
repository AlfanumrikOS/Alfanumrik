import re
from .types import TaskType

MAX_LEN = 8000

VENDOR_PATTERNS = [
    re.compile(r"\bas an ai (language )?model[,.]?", re.IGNORECASE),
    re.compile(r"\bi am an ai\b[^.]*\.", re.IGNORECASE),
    re.compile(r"\b(openai|anthropic|claude|gpt-\d+\w*|chatgpt|gpt|gemini)\b", re.IGNORECASE),
]

EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"\+?\d[\d\s().-]{8,}\d")

def post_process(text: str, task: TaskType) -> str:
    if not text:
        return ""
    
    out = text.strip()

    if task not in ("quiz_generation", "evaluation", "ocr_extraction"):
        for p in VENDOR_PATTERNS:
            out = p.sub("", out)
        out = EMAIL_PATTERN.sub("[email]", out)
        out = PHONE_PATTERN.sub("[number]", out)
        out = re.sub(r"\n{3,}", "\n\n", out)
        
        if len(out) > MAX_LEN:
            out = out[: MAX_LEN - 3] + "\n\n…"

    return out.strip()
