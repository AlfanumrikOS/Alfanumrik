"""Prompt strings — ported VERBATIM from TS.

DO NOT EDIT without coordinating with the assessment agent. The CBSE
curriculum-designer rails (3-6 concepts per chapter, NCERT grounding,
4-tier Bloom's mapping, 3-band difficulty) live in these strings;
rewriting them would diverge generated-concept quality from the TS
Edge Function path.

Sources:
- :func:`build_system_prompt` ← generate-concepts/index.ts:413-428.
- :func:`build_user_prompt`   ← generate-concepts/index.ts:430-475.

Module constants (mirror TS index.ts:47-48):
- ``MIN_RAG_CHUNKS``: minimum chunks needed to attempt generation.
- ``MAX_RAG_CHARS``: hard cap on total RAG content character budget.
"""

from __future__ import annotations

from typing import Any

from .models import ChapterInfo

MIN_RAG_CHUNKS = 3
MAX_RAG_CHARS = 5000


def build_system_prompt(grade: str, subject: str) -> str:
    """System prompt for concept extraction.

    Port of TS ``buildSystemPrompt`` (generate-concepts/index.ts:413-428).
    Returns the exact same string for the same (grade, subject) inputs.
    """
    return (
        f"You are a CBSE curriculum designer for Class {grade} {subject}. "
        f"Extract 3-6 key concepts from this NCERT chapter content.\n"
        f"\n"
        f"For each concept output:\n"
        f"- title: short concept name\n"
        f"- learning_objective: one sentence starting with a verb\n"
        f"- explanation: 3-5 simple sentences for Class {grade}. NOT a text dump.\n"
        f"- key_formula: formula if math/science, null otherwise\n"
        f"- example_title: brief example title\n"
        f"- example_content: one worked example (2-4 steps)\n"
        f"- common_mistakes: array of 2-3 student errors\n"
        f"- difficulty: 1/2/3\n"
        f"- bloom_level: remember/understand/apply/analyze\n"
        f"\n"
        f"Output ONLY valid JSON array. No markdown."
    )


def build_user_prompt(
    chapter: ChapterInfo,
    rag_chunks: list[str],
    diagram_refs: list[dict[str, Any]],
    sample_question: dict[str, Any] | None,
) -> str:
    """User message for one chapter's concept-generation call.

    Port of TS ``buildUserPrompt`` (index.ts:430-475). Includes:
      - chapter header (title, number, grade, subject)
      - NCERT content section (RAG chunks joined with ``\\n\\n---\\n\\n``
        and truncated to ``MAX_RAG_CHARS``)
      - DIAGRAMS section (only when ``diagram_refs`` is non-empty)
      - SAMPLE QUESTION section (only when ``sample_question`` is provided)
    """
    # Build RAG content, truncated to MAX_RAG_CHARS (mirrors TS index.ts:437-440).
    rag_content = "\n\n---\n\n".join(rag_chunks)
    if len(rag_content) > MAX_RAG_CHARS:
        rag_content = rag_content[:MAX_RAG_CHARS]

    prompt = (
        f"CHAPTER: {chapter.chapter_title} (Chapter {chapter.chapter_number})\n"
        f"GRADE: {chapter.grade}\n"
        f"SUBJECT: {chapter.subject}\n"
        f"\n"
        f"=== NCERT CONTENT ===\n"
        f"{rag_content}\n"
        f"=== END CONTENT ==="
    )

    if diagram_refs:
        diagram_lines = []
        for d in diagram_refs:
            media_type = d.get("media_type", "unknown")
            caption = d.get("caption") or "Untitled"
            diagram_lines.append(f"- [{media_type}] {caption}")
        diagram_block = "\n".join(diagram_lines)
        prompt += (
            f"\n"
            f"\n"
            f"=== DIAGRAMS IN THIS CHAPTER ===\n"
            f"{diagram_block}\n"
            f"=== END DIAGRAMS ==="
        )

    if sample_question is not None:
        options = sample_question.get("options")
        options_text = ""
        if isinstance(options, list) and options:
            options_text = " | ".join(
                f"{chr(65 + i)}) {o}" for i, o in enumerate(options)
            )
        question_text = sample_question.get("question_text", "")
        prompt += (
            f"\n"
            f"\n"
            f"=== SAMPLE QUESTION ===\n"
            f"{question_text}\n"
            f"{'Options: ' + options_text if options_text else ''}\n"
            f"=== END SAMPLE ==="
        )

    return prompt
