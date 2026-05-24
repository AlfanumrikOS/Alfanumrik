"""Prompt strings — ported VERBATIM from TS.

DO NOT EDIT without coordinating with the assessment agent. The CBSE scope +
age-appropriateness rails live in these strings; rewriting them would diverge
content quality from the TS Edge Function path.

Sources:
- :func:`build_system_prompt` ← bulk-question-gen/index.ts lines 238-249.
- :func:`build_user_prompt`   ← bulk-question-gen/index.ts lines 205-236.
- :data:`QUIZ_ORACLE_GRADER_SYSTEM_PROMPT` ← _shared/quiz-oracle-prompts.ts lines 17-67.
- :func:`build_oracle_grader_user_prompt`  ← _shared/quiz-oracle-prompts.ts lines 69-91.
"""

from __future__ import annotations


def build_system_prompt(grade: str, subject: str) -> str:
    """System prompt for MCQ generation. Port of TS ``buildSystemPrompt``.

    Source: ``supabase/functions/bulk-question-gen/index.ts:238-249``.
    """
    age_low = str(10 + int(grade) - 6)
    age_high = str(11 + int(grade) - 6)
    return (
        f"You are a CBSE curriculum question-generation assistant for an Indian K-12 EdTech platform.\n"
        f"You produce exam-quality multiple-choice questions for Grade {grade} {subject}.\n"
        f"\n"
        f"RULES:\n"
        f"- Follow the NCERT/CBSE syllabus strictly. Do not go beyond the grade-level curriculum.\n"
        f"- All content must be age-appropriate for Grade {grade} students "
        f"(approx. ages {age_low}–{age_high}).\n"
        f"- No violence, adult content, political opinions, religion-based bias, or off-topic material.\n"
        f"- Questions must be factually accurate; incorrect options must be plausible but clearly wrong on reflection.\n"
        f"- Explanations must be clear and educational — 2-3 sentences maximum.\n"
        f"- Return ONLY the JSON array as instructed. No commentary."
    )


def build_user_prompt(
    grade: str,
    subject: str,
    chapter: str,
    count: int,
    difficulty: int,
    bloom_level: str,
) -> str:
    """User message for MCQ generation. Port of TS ``buildPrompt``.

    Source: ``supabase/functions/bulk-question-gen/index.ts:205-236``.
    """
    return (
        f"Generate {count} CBSE Grade {grade} {subject} multiple-choice questions for chapter: \"{chapter}\".\n"
        f"\n"
        f"Requirements:\n"
        f"- Each question must test a specific concept from this chapter\n"
        f"- 4 answer options, exactly one correct\n"
        f"- Include a clear explanation (2-3 sentences)\n"
        f"- Include a hint (one helpful clue without giving away the answer)\n"
        f"- Difficulty: {difficulty} (1=easy, 3=medium, 5=hard)\n"
        f"- Bloom's level: {bloom_level}\n"
        f"- Age-appropriate for Grade {grade} students\n"
        f"- Stay strictly within the CBSE curriculum scope for this chapter\n"
        f"- Do not include any violent, adult, or off-topic content\n"
        f"\n"
        f"Return ONLY a valid JSON array — no markdown fences, no extra text — with this exact structure:\n"
        f"[{{\n"
        f'  "question_text": "...",\n'
        f'  "options": ["A", "B", "C", "D"],\n'
        f'  "correct_answer_index": 0,\n'
        f'  "explanation": "...",\n'
        f'  "hint": "...",\n'
        f'  "difficulty": {difficulty},\n'
        f'  "bloom_level": "{bloom_level}"\n'
        f"}}]"
    )


# ── Oracle grader prompts (ported VERBATIM from quiz-oracle-prompts.ts) ─────

# Source: supabase/functions/_shared/quiz-oracle-prompts.ts lines 17-67.
# Few-shot examples (FEWSHOT-1..3) appended at the end maximise prompt-cache
# reuse across grading calls — DO NOT reorder or rewrite without re-running
# the oracle calibration suite (REG-54 A5 follow-up).
QUIZ_ORACLE_GRADER_SYSTEM_PROMPT = """You are a strict, factual content auditor for a CBSE K-12 EdTech platform.
Your ONLY job is to decide whether a multiple-choice question's marked correct option is consistent with its explanation.

Decision rule:
- Read the explanation as the authority on what the correct answer should be.
- Compare it to the option at the marked correct_answer_index.
- If the explanation logically and unambiguously supports that option → "consistent".
- If the explanation supports a DIFFERENT option → "mismatch" (and identify which option in suggested_correct_index).
- If the explanation is too vague, contradicts itself, or could justify multiple options → "ambiguous".

Output STRICT JSON only — no prose, no markdown fences:
{"verdict": "consistent" | "mismatch" | "ambiguous", "reasoning": "<one sentence>", "suggested_correct_index": 0 | 1 | 2 | 3}

Rules:
- "reasoning" must be ONE short sentence, max 200 characters.
- "suggested_correct_index" is OPTIONAL. Include it ONLY when verdict is "mismatch" and the explanation clearly points to a specific other option. Omit otherwise.
- Do NOT explain your decision in prose outside the JSON. Do NOT include any text before or after the JSON object.
- Do NOT comment on the difficulty, age-appropriateness, or curriculum scope. That is a different audit.
- Do NOT correct the explanation. Audit it as-is.

Examples (CBSE-realistic, calibration only — do not echo back):

[FEWSHOT-1] Grade 9 Physics, mismatch:
Question: "A car accelerates from rest at 2 m/s². What is its velocity after 5 s?"
Options:
  0: 5 m/s (MARKED CORRECT)
  1: 10 m/s
  2: 15 m/s
  3: 20 m/s
Explanation: "Using v = u + at, v = 0 + 2×5 = 10 m/s."
Output: {"verdict":"mismatch","reasoning":"Explanation derives 10 m/s but option 0 is 5 m/s; option 1 matches.","suggested_correct_index":1}

[FEWSHOT-2] Grade 7 Hindi-medium science, consistent:
Question: "पादप कोशिका में 'पावरहाउस' किसे कहा जाता है?"
Options:
  0: केन्द्रक
  1: माइटोकॉन्ड्रिया (MARKED CORRECT)
  2: रिक्तिका
  3: हरितलवक
Explanation: "माइटोकॉन्ड्रिया ATP बनाती है, इसलिए इसे कोशिका का पावरहाउस कहा जाता है।"
Output: {"verdict":"consistent","reasoning":"Explanation directly identifies माइटोकॉन्ड्रिया as the powerhouse, matching option 1."}

[FEWSHOT-3] Grade 10 Math, ambiguous:
Question: "Factor x² + 5x + 6."
Options:
  0: (x+2)(x+3) (MARKED CORRECT)
  1: (x+3)(x+2)
  2: (x+1)(x+6)
  3: (x-2)(x-3)
Explanation: "Splitting middle term: x²+2x+3x+6 = (x+2)(x+3)."
Output: {"verdict":"ambiguous","reasoning":"Options 0 and 1 are mathematically identical; explanation supports both."}"""


def build_oracle_grader_user_prompt(
    *,
    question_text: str,
    options: list[str],
    correct_answer_index: int,
    explanation: str,
) -> str:
    """User-message text for the oracle grader. Port of TS ``buildQuizOracleGraderUserPrompt``.

    Source: ``supabase/functions/_shared/quiz-oracle-prompts.ts:69-91``.
    """
    lines = []
    for i, opt in enumerate(options):
        marker = " (MARKED CORRECT)" if i == correct_answer_index else ""
        lines.append(f"  {i}: {opt}{marker}")
    options_block = "\n".join(lines)
    return (
        f"Question:\n{question_text}\n\n"
        f"Options:\n{options_block}\n\n"
        f"Marked correct_answer_index: {correct_answer_index}\n\n"
        f"Explanation:\n{explanation}\n\n"
        f"Audit: does the explanation support the marked correct option?"
    )
