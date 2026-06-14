import json
import re
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

import httpx
import structlog

from ..config import get_settings

logger = structlog.get_logger(__name__)

ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
GRADER_MODEL = "claude-sonnet-4-6-20251022"
GRADER_TIMEOUT_MS = 30000
GRADER_MAX_TOKENS = 1024

TIE_THRESHOLD = 0.03


class GraderRubric(TypedDict):
    accuracy: float
    cbse_scope: float
    age_appropriateness: float
    scaffold_fidelity: float
    helpfulness: float
    citation_accuracy: float


DEFAULT_RUBRIC: GraderRubric = {
    "accuracy": 0.30,
    "cbse_scope": 0.25,
    "age_appropriateness": 0.20,
    "scaffold_fidelity": 0.10,
    "helpfulness": 0.05,
    "citation_accuracy": 0.10,
}


@dataclass
class CandidateScores:
    accuracy: float
    cbse_scope: float
    age_appropriateness: float
    scaffold_fidelity: float
    helpfulness: float
    citation_accuracy: float | None
    overall: float


@dataclass
class GraderResult:
    baseline: CandidateScores
    shadow: CandidateScores
    agreement: float
    winner: Literal["baseline", "shadow", "tie"]
    notes: str
    rubric_version: str
    model: str
    prompt_tokens: int
    completion_tokens: int


RUBRIC_VERSION = "mol-grader-v2"


@dataclass
class GraderInput:
    question: str
    baseline_text: str
    shadow_text: str
    grade: str
    coach_mode: Literal["socratic", "answer", "review"] | None = None
    rubric: GraderRubric | None = None
    api_key: str | None = None


def build_grader_system_prompt(rubric: GraderRubric) -> str:
    return f"""You are an impartial educational-content evaluator for a CBSE (Indian school board) tutoring platform serving grades 6-12. You will be shown a student question, the student's grade, an optional coach mode directive, and two candidate answers (A = baseline, B = shadow). Score each candidate on the following SIX dimensions in the range 0.0 to 1.0:

1. accuracy (weight {rubric['accuracy']:.2f}): Are the underlying claims true? 1.0 = all factually correct, 0.0 = contains substantive factual errors. This is the most heavily weighted dimension.

2. cbse_scope (weight {rubric['cbse_scope']:.2f}): Does the answer stay inside the CBSE curriculum boundary for the stated grade and (where inferable) subject? 1.0 = on-syllabus and aligned with NCERT / CBSE expectations, 0.0 = off-syllabus tangent or out-of-grade content. Broader than literal NCERT-quotation alignment — concepts that match the CBSE curriculum but are explained in plain language still score 1.0.

3. age_appropriateness (weight {rubric['age_appropriateness']:.2f}): Is the language, vocabulary, and depth appropriate for a CBSE student in the stated grade? 1.0 = perfectly pitched, 0.0 = too advanced (uses jargon a grade-N student would not understand) or too simplistic (talks down to the audience).

4. scaffold_fidelity (weight {rubric['scaffold_fidelity']:.2f}): Does the response build understanding step-by-step, or just deliver the answer? For doubt_solving tasks scaffolding IS the pedagogical contract — guide the student through reasoning rather than dropping the answer. If a coach mode is specified:
   - "socratic": 1.0 = asks 2-3 guided sub-questions and does NOT deliver the full answer up front. 0.0 = ignores Socratic frame and dumps the answer.
   - "answer": 1.0 = concise 3-5 sentence answer plus ONE stretch question one Bloom level higher. 0.0 = no scaffolding follow-up.
   - "review": 1.0 = invites the student to state the key idea first, then confirms. 0.0 = lecture mode.
   If coach mode is null, score on whether ANY recognisable scaffolding pattern is used (worked example, partial reveal, follow-up nudge).

5. helpfulness (weight {rubric['helpfulness']:.2f}): Does the answer actually address the question the student asked? 1.0 = directly relevant and useful, 0.0 = off-topic or evasive.

6. citation_accuracy (weight {rubric['citation_accuracy']:.2f}, OPTIONAL): When citations or chapter references appear, do they correctly match the cited content? 1.0 = all citations accurate, 0.0 = fabricated or wrong citations. If the candidate does NOT cite anything and the question did NOT require a citation (e.g. an abstain turn, a simple recall question with no NCERT reference expected), set this dimension to null. When null, the overall is computed against the remaining five weights renormalized to sum to 1.0.

ANTI-BIAS INSTRUCTIONS (binding for every grade):
- Do NOT penalize a response purely for being shorter or longer than the other. Length is not quality.
- Ignore stylistic preambles like "As an AI assistant", "Great question!", or "Let me help you". These are model-specific tells, not pedagogy signals.
- Score on substance: factual correctness, CBSE / NCERT alignment, age-appropriate language, scaffolding for the student's question, helpfulness, and citation accuracy where citations are expected.
- Do NOT favour one candidate because it sounds more confident or uses formal academic prose. Quality is measured against the rubric only.

Compute overall = Σ score_i × weight_i for each candidate, treating null citation_accuracy as "drop the dimension and renormalize the remaining weights to 1.0". Pick a winner: "baseline" if A.overall > B.overall + {TIE_THRESHOLD:.2f}, "shadow" if B.overall > A.overall + {TIE_THRESHOLD:.2f}, otherwise "tie". Provide a 1-2 sentence note explaining the comparative judgment. Output STRICT JSON only — no markdown fences, no commentary outside the JSON object.

Output shape (citation_accuracy may be the literal JSON value null):
{{
  "baseline": {{ "accuracy": number, "cbse_scope": number, "age_appropriateness": number, "scaffold_fidelity": number, "helpfulness": number, "citation_accuracy": number | null, "overall": number }},
  "shadow":   {{ "accuracy": number, "cbse_scope": number, "age_appropriateness": number, "scaffold_fidelity": number, "helpfulness": number, "citation_accuracy": number | null, "overall": number }},
  "agreement": number,
  "winner": "baseline" | "shadow" | "tie",
  "notes": string
}}"""


def build_grader_user_message(
    question: str, baseline_text: str, shadow_text: str, grade: str, coach_mode: str | None
) -> str:
    grade_line = (
        f"Grade: {grade}"
        if grade
        else "Grade: (not recorded — score age_appropriateness against the 6-12 default band)"
    )
    coach_line = (
        f"Coach mode: {coach_mode}"
        if coach_mode
        else "Coach mode: (not recorded — score scaffold_fidelity against any recognisable scaffolding pattern)"
    )

    return f"""{grade_line}
{coach_line}

Student question:
{question}

Candidate A (baseline):
{baseline_text}

Candidate B (shadow):
{shadow_text}

Evaluate both candidates per the rubric and return strict JSON."""


def compute_overall(
    scores: dict[str, float | None], rubric: GraderRubric = DEFAULT_RUBRIC
) -> float:
    if scores.get("citation_accuracy") is None:
        remainder = 1.0 - rubric["citation_accuracy"]
        if remainder <= 0:
            return 0.0
        raw = (
            scores["accuracy"] * rubric["accuracy"]
            + scores["cbse_scope"] * rubric["cbse_scope"]
            + scores["age_appropriateness"] * rubric["age_appropriateness"]
            + scores["scaffold_fidelity"] * rubric["scaffold_fidelity"]
            + scores["helpfulness"] * rubric["helpfulness"]
        )
        return max(0.0, min(1.0, raw / remainder))

    raw = (
        scores["accuracy"] * rubric["accuracy"]
        + scores["cbse_scope"] * rubric["cbse_scope"]
        + scores["age_appropriateness"] * rubric["age_appropriateness"]
        + scores["scaffold_fidelity"] * rubric["scaffold_fidelity"]
        + scores["helpfulness"] * rubric["helpfulness"]
        + scores["citation_accuracy"] * rubric["citation_accuracy"]
    )
    return max(0.0, min(1.0, raw))


def validate_candidate(raw: Any, rubric: GraderRubric) -> CandidateScores | None:
    if not raw or not isinstance(raw, dict):
        return None
    required_fields = [
        "accuracy",
        "cbse_scope",
        "age_appropriateness",
        "scaffold_fidelity",
        "helpfulness",
    ]
    out = {}
    for f in required_fields:
        v = raw.get(f)
        if not isinstance(v, int | float):
            return None
        out[f] = max(0.0, min(1.0, float(v)))

    raw_citation = raw.get("citation_accuracy")
    if raw_citation is None:
        citation = None
    elif isinstance(raw_citation, int | float):
        citation = max(0.0, min(1.0, float(raw_citation)))
    else:
        return None

    partial = {
        "accuracy": out["accuracy"],
        "cbse_scope": out["cbse_scope"],
        "age_appropriateness": out["age_appropriateness"],
        "scaffold_fidelity": out["scaffold_fidelity"],
        "helpfulness": out["helpfulness"],
        "citation_accuracy": citation,
    }
    overall = compute_overall(partial, rubric)
    return CandidateScores(**partial, overall=overall)


def pick_winner(baseline_overall: float, shadow_overall: float) -> str:
    delta = shadow_overall - baseline_overall
    if delta > TIE_THRESHOLD:
        return "shadow"
    if delta < -TIE_THRESHOLD:
        return "baseline"
    return "tie"


def validate_grader_shape(
    raw: Any, model: str, prompt_tokens: int, completion_tokens: int, rubric: GraderRubric
) -> GraderResult | None:
    if not raw or not isinstance(raw, dict):
        return None

    baseline = validate_candidate(raw.get("baseline"), rubric)
    shadow = validate_candidate(raw.get("shadow"), rubric)

    if not baseline or not shadow:
        return None

    agreement = raw.get("agreement")
    if isinstance(agreement, int | float):
        agreement = max(0.0, min(1.0, float(agreement)))
    else:
        agreement = max(0.0, 1.0 - abs(baseline.overall - shadow.overall))

    raw_winner = raw.get("winner", "")
    if raw_winner in ("baseline", "shadow", "tie"):
        winner = raw_winner
    else:
        winner = pick_winner(baseline.overall, shadow.overall)

    notes = raw.get("notes", "")
    notes = notes[:500] if isinstance(notes, str) else ""

    return GraderResult(
        baseline=baseline,
        shadow=shadow,
        agreement=agreement,
        winner=winner,
        notes=notes,
        rubric_version=RUBRIC_VERSION,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


async def grade_shadow_pair(args: GraderInput) -> GraderResult | None:
    rubric = args.rubric if args.rubric else DEFAULT_RUBRIC
    api_key = args.api_key or get_settings().anthropic_api_key

    if not api_key:
        logger.warning("mol-grader: ANTHROPIC_API_KEY missing — cannot grade")
        return None

    if not args.baseline_text or not args.shadow_text or not args.question:
        return None

    body = {
        "model": GRADER_MODEL,
        "max_tokens": GRADER_MAX_TOKENS,
        "temperature": 0.1,
        "system": build_grader_system_prompt(rubric),
        "messages": [
            {
                "role": "user",
                "content": build_grader_user_message(
                    args.question, args.baseline_text, args.shadow_text, args.grade, args.coach_mode
                ),
            }
        ],
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=GRADER_TIMEOUT_MS / 1000.0) as client:
            res = await client.post(ANTHROPIC_URL, json=body, headers=headers)

        if res.status_code != 200:
            logger.warning(f"mol-grader: Anthropic {res.status_code} — skipping pair")
            return None

        data = res.json()
        content_blocks = data.get("content", [])
        text = "\n".join(
            b.get("text", "") for b in content_blocks if b.get("type") == "text"
        ).strip()

        if not text:
            logger.warning("mol-grader: empty Sonnet response — skipping pair")
            return None

        cleaned = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.IGNORECASE).strip()

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as err:
            logger.warning(f"mol-grader: JSON parse failed: {err}")
            return None

        usage = data.get("usage", {})
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        return validate_grader_shape(parsed, GRADER_MODEL, input_tokens, output_tokens, rubric)

    except Exception as err:
        logger.warning(f"mol-grader: fetch failed: {err}")
        return None


def grader_sample_bucket(request_id: str) -> int:
    h = 0
    for char in request_id:
        h = ((h << 5) - h + ord(char)) & 0xFFFFFFFF
        if h > 0x7FFFFFFF:
            h -= 0x100000000
    return abs(h) % 100


GRADER_SAMPLING_RATES: dict[str, int] = {
    "doubt_solving": 15,
    "step_by_step": 15,
    "concept_explanation": 8,
    "explanation": 5,
}

GRADER_DAILY_COST_CAP_INR = 10000
GRADER_DAILY_CAP_INR = 5000
