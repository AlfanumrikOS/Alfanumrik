"""Prompt strings — ported VERBATIM from TS.

DO NOT EDIT without coordinating with the assessment agent. The CBSE marking-
scheme conventions + NCERT-grounding rails live in these strings; rewriting
them would diverge answer quality from the TS Edge Function path.

Sources:
- :func:`build_system_prompt` ← generate-answers/index.ts lines 210-243.
- :func:`build_user_prompt`   ← generate-answers/index.ts lines 245-293.
"""

from __future__ import annotations

from typing import Any


def build_system_prompt(grade: str, subject: str, rag_context: str | None) -> str:
    """System prompt for board-exam-style answer generation.

    Port of TS ``buildSystemPrompt`` (generate-answers/index.ts:210-243).

    Two branches:
    - rag_context present: instruct the LLM to ground in NCERT material.
    - rag_context absent: warn LLM to use standard curriculum and note
      that the answer needs textbook verification.
    """
    prompt = (
        f"You are a CBSE exam answer writer for Class {grade} {subject}.\n"
        f"Write answers that students can directly use in board exams.\n"
        f"\n"
        f"Rules:\n"
        f"- Use ONLY NCERT content provided below\n"
        f"- Follow CBSE marking scheme conventions\n"
        f"- Be concise but complete\n"
        f"- For 1 mark: 1-2 sentences\n"
        f"- For 2-3 marks: paragraph with key points\n"
        f"- For 5 marks: structured answer with introduction, points, conclusion\n"
        f"- Use bullet points for clarity where appropriate\n"
        f"- Include formulas in proper notation for math/science\n"
        f"- Always output valid JSON\n"
        f"- Keep language student-friendly and appropriate for Class {grade}"
    )

    if rag_context:
        prompt += (
            f"\n"
            f"\n"
            f"=== NCERT REFERENCE MATERIAL (Class {grade}, {subject}) ===\n"
            f"{rag_context}\n"
            f"=== END REFERENCE ===\n"
            f"\n"
            f"You MUST ground your answer in the NCERT content above. Do NOT invent facts not present in the reference material."
        )
    else:
        prompt += (
            f"\n"
            f"\n"
            f"WARNING: No NCERT reference material was retrieved for this question.\n"
            f"Use only standard CBSE Class {grade} {subject} curriculum knowledge.\n"
            f'Add a note: "Answer should be verified against NCERT textbook."'
        )

    return prompt


def build_user_prompt(question: dict[str, Any]) -> str:
    """User message for one question's answer-generation call.

    Port of TS ``buildUserPrompt`` (generate-answers/index.ts:245-293).

    ``question`` is the slim ``question_bank`` row with the fields listed
    below. Mirrors TS ``QuestionRow`` (index.ts:94-107).

    Required keys (None values handled as 'unknown' to mirror TS template):
      - id, question_text, subject, grade
      - chapter_number, difficulty, bloom_level, question_type_v2
      - options, correct_answer_index, explanation
    """
    is_mcq = question.get("question_type_v2") == "mcq"
    options = question.get("options")
    correct_index = question.get("correct_answer_index")

    prompt = (
        f"Generate a CBSE board exam answer for this question.\n"
        f"\n"
        f"QUESTION: {question.get('question_text', '')}\n"
        f"GRADE: {question.get('grade', '')}\n"
        f"SUBJECT: {question.get('subject', '')}\n"
        f"TYPE: {question.get('question_type_v2') or 'unknown'}\n"
        f"DIFFICULTY: {question.get('difficulty') if question.get('difficulty') is not None else 'unknown'} (1=easy, 2=medium, 3=hard)\n"
        f"BLOOM LEVEL: {question.get('bloom_level') or 'unknown'}"
    )

    # MCQ branch — include options + correct answer letter.
    if (
        is_mcq
        and isinstance(options, list)
        and isinstance(correct_index, int)
        and 0 <= correct_index < len(options)
    ):
        correct_option = options[correct_index]
        options_block = " | ".join(
            f"{chr(65 + i)}) {o}" for i, o in enumerate(options)
        )
        prompt += (
            f"\nOPTIONS: {options_block}\n"
            f"CORRECT ANSWER: {chr(65 + correct_index)}) {correct_option}"
        )

    if question.get("explanation"):
        prompt += f"\nEXISTING EXPLANATION: {question['explanation']}"

    if is_mcq:
        prompt += (
            "\n"
            "\n"
            "For this MCQ:\n"
            "- Explain WHY the correct option is right (3-5 sentences)\n"
            "- Briefly mention what is wrong with 1-2 common distractor options\n"
            "- Keep concise — this is a 1-mark question\n"
            "- Set marks_expected to 1"
        )
    else:
        prompt += (
            "\n"
            "\n"
            "Estimate appropriate marks_expected based on question depth and type."
        )

    prompt += (
        "\n"
        "\n"
        "Determine the answer_methodology from EXACTLY one of: definition, stepwise, diagram, derivation, essay, numerical, comparison, analysis\n"
        "\n"
        "Output ONLY valid JSON (no markdown, no code fences):\n"
        '{"answer_text": "...", "answer_methodology": "...", "marks_expected": N}'
    )

    return prompt
