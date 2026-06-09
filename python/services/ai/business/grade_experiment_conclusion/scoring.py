"""Pure rule-based rubric scoring (Phase 2 fallback; Claude variant deferred).

The TS Edge function calls Claude for nuanced rubric grading. This port uses
deterministic heuristics on the conclusion text length + keyword density. The
TS already has a short-conclusion bypass (< 20 chars -> tier=weak); we
extend that pattern to cover all inputs with a longer/keyword-richer text
mapping to higher tiers.

Constants match TS:
- 4 criteria (R1 Question / R2 Method / R3 Evidence / R4 Conclusion)
- Each score 0..3, total 0..12
- Tier boundaries: weak 0-4, developing 5-7, proficient 8-10, strong 11-12
- Coin tiers: weak +0, developing +5, proficient +15, strong +30
"""

from __future__ import annotations

from typing import Any

WEAK_MAX = 4
DEVELOPING_MAX = 7
PROFICIENT_MAX = 10

COIN_REWARDS: dict[str, int] = {
    "weak": 0,
    "developing": 5,
    "proficient": 15,
    "strong": 30,
}

SHORT_THRESHOLD = 20
DEVELOPING_THRESHOLD = 80
PROFICIENT_THRESHOLD = 200
STRONG_THRESHOLD = 400

EVIDENCE_KEYWORDS = (
    "because", "since", "therefore", "data", "result", "measure", "observ",
    "trial", "hypothesis", "predict",
    "क्योंकि",
    "इसलिए",
    "परिणाम",
    "अवलोक",
    "प्रयोग",
)
METHOD_KEYWORDS = (
    "first", "then", "next", "step", "procedure", "set up",
    "पहले",
    "फिर",
    "चरण",
    "विधि",
)


def total_to_tier(total: int) -> str:
    if total <= WEAK_MAX:
        return "weak"
    if total <= DEVELOPING_MAX:
        return "developing"
    if total <= PROFICIENT_MAX:
        return "proficient"
    return "strong"


def coin_award_for_tier(tier: str) -> int:
    return COIN_REWARDS.get(tier, 0)


def _keyword_score(text: str, keywords: tuple[str, ...]) -> int:
    lower = text.lower()
    hits = sum(1 for kw in keywords if kw in lower)
    return min(3, hits)


def _length_score(length: int) -> int:
    if length < SHORT_THRESHOLD:
        return 0
    if length < DEVELOPING_THRESHOLD:
        return 1
    if length < PROFICIENT_THRESHOLD:
        return 2
    return 3


def score_conclusion(conclusion_text: str) -> dict[str, Any]:
    text = conclusion_text or ""
    length = len(text)
    r1 = 1 if length >= SHORT_THRESHOLD else 0
    if "?" in text or any(
        kw in text.lower()
        for kw in ("question", "ask", "why", "how", "क्यों", "कैसे")
    ):
        r1 = min(3, r1 + 1)
    if length >= DEVELOPING_THRESHOLD and r1 < 3:
        r1 += 1
    r2 = _keyword_score(text, METHOD_KEYWORDS)
    r3 = _keyword_score(text, EVIDENCE_KEYWORDS)
    if length >= PROFICIENT_THRESHOLD and r3 < 3:
        r3 = min(3, r3 + 1)
    r4 = _length_score(length)
    total = r1 + r2 + r3 + r4
    tier = total_to_tier(total)
    return {
        "r1_question": {"score": r1, "rationale": ""},
        "r2_method": {"score": r2, "rationale": ""},
        "r3_evidence": {"score": r3, "rationale": ""},
        "r4_conclusion": {"score": r4, "rationale": ""},
        "total": total,
        "tier": tier,
        "feedback_en": _feedback_en(tier),
        "feedback_hi": _feedback_hi(tier),
    }


def _feedback_en(tier: str) -> str:
    if tier == "weak":
        return "Try writing a longer conclusion that describes what you did and what you found."
    if tier == "developing":
        return "Good start - now add more detail about your method and the evidence you gathered."
    if tier == "proficient":
        return "Strong work! Sharpening your reasoning with explicit evidence will make this excellent."
    return "Excellent conclusion - well-structured with clear method, evidence, and reasoning."


def _feedback_hi(tier: str) -> str:
    if tier == "weak":
        return "लंबा निष्कर्ष लिखने का प्रयास करें।"
    if tier == "developing":
        return "अच्छी शुरुआत - अपनी विधि के बारे में अधिक विवरण जोड़ें।"
    if tier == "proficient":
        return "अच्छा काम!"
    return "उत्कृष्ट निष्कर्ष।"
