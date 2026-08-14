"""Compiled regex taxonomy for typed-learning-unit classification.

The six English patterns below are ported VERBATIM from a prior working run
against real CBSE PDFs. Do not re-derive them -- they were tuned against actual
NCERT/CBSE typography (numbered stems, "Ans.", "Solution:", "(a)"/"[A]" option
markers).

Devanagari siblings are added alongside for P7 (bilingual). Without them every
Hindi / Sanskrit unit falls through to ``concept_explanation`` and the entire
Hindi corpus is silently untyped.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# English -- VERBATIM, do not edit without an assessment review (P14 chain:
# ai-engineer -> assessment, testing).
# ---------------------------------------------------------------------------
QUESTION_RE = r"^(?:q(?:uestion)?\s*\d*|\d+[.)])\s*[:.-]?\s*"
ANSWER_RE = r"^(?:answer|ans(?:wer)?|solution)\s*\d*\s*[:.-]\s*"
EXAMPLE_RE = r"^(?:worked\s+)?example\s*\d*\s*[:.-]?\s*"
QUIZ_RE = r"(?:choose the correct|multiple choice|mcq|quiz|which of the following)"
OPTION_RE = r"(?:^|\s)[(\[]?[A-Da-d][)\].:]\s+"
HEADING_RE = r"^(?:concept|definition|theorem|rule|property|remember|note)\s*[:.-]?"

# ---------------------------------------------------------------------------
# Devanagari siblings (P7). The numeric alternative (``\d+[.)]``) is already
# covered by the English QUESTION_RE, so the Hindi stem pattern only carries the
# word forms. ``।`` (danda) is accepted as a terminator everywhere ``.`` is.
# ---------------------------------------------------------------------------
QUESTION_HI_RE = r"^(?:प्रश्न|प्र\.)\s*\d*\s*[:.।\-]?\s*"
ANSWER_HI_RE = r"^(?:उत्तर|उत्\.|हल|समाधान)\s*\d*\s*[:.।\-]\s*"
EXAMPLE_HI_RE = r"^(?:सोदाहरण\s+)?उदाहरण\s*\d*\s*[:.।\-]?\s*"
QUIZ_HI_RE = r"(?:सही\s*विकल्प|बहुविकल्पीय|निम्नलिखित\s*में\s*से)"
OPTION_HI_RE = r"(?:^|\s)[(\[]?[कखगघ][)\].:।]\s+"
HEADING_HI_RE = (
    r"^(?:संकल्पना|परिभाषा|प्रमेय|नियम|गुणधर्म|गुण|स्मरण|ध्यान\s*दें|टिप्पणी)\s*[:.।\-]?"
)

_FLAGS = re.IGNORECASE | re.MULTILINE

QUESTION = re.compile(QUESTION_RE, _FLAGS)
ANSWER = re.compile(ANSWER_RE, _FLAGS)
EXAMPLE = re.compile(EXAMPLE_RE, _FLAGS)
QUIZ = re.compile(QUIZ_RE, _FLAGS)
OPTION = re.compile(OPTION_RE, _FLAGS)
HEADING = re.compile(HEADING_RE, _FLAGS)

QUESTION_HI = re.compile(QUESTION_HI_RE, _FLAGS)
ANSWER_HI = re.compile(ANSWER_HI_RE, _FLAGS)

# Unanchored answer matchers, DERIVED from the verbatim patterns above by
# dropping the leading ``^`` and requiring a preceding word boundary. Needed
# because a PDF frequently sets "Q1. ... Ans: ..." on ONE physical line, which
# the anchored form can never see. Deriving rather than re-writing keeps the
# verbatim constants the single source of truth.
_LOOKBEHIND = r"(?<=[\s.?!।])"
ANSWER_INLINE = re.compile(_LOOKBEHIND + ANSWER_RE.lstrip("^"), _FLAGS)
ANSWER_HI_INLINE = re.compile(_LOOKBEHIND + ANSWER_HI_RE.lstrip("^"), _FLAGS)
EXAMPLE_HI = re.compile(EXAMPLE_HI_RE, _FLAGS)
QUIZ_HI = re.compile(QUIZ_HI_RE, _FLAGS)
OPTION_HI = re.compile(OPTION_HI_RE, _FLAGS)
HEADING_HI = re.compile(HEADING_HI_RE, _FLAGS)

#: >= this many option markers in one unit forces the ``mcq`` type.
MIN_OPTION_HITS_FOR_MCQ = 4

DEVANAGARI = re.compile("[ऀ-ॿ꣠-ꣿ]")

#: Units living under one of these headings are exercise questions, not
#: in-text questions. Drives the ``exercise`` vs ``intext`` question_type split.
EXERCISE_MARKER = re.compile(
    r"(?:exercis|question\s*bank|assignment|अभ्यास|प्रश्नावली)", re.IGNORECASE
)

#: Figure/table caption openers -- used to attach a caption to an image region.
CAPTION = re.compile(
    r"^\s*(?:fig(?:ure)?|चित्र|आकृति)\s*\.?\s*[\d.]+", re.IGNORECASE
)
TABLE_CAPTION = re.compile(
    r"^\s*(?:table|तालिका|सारणी)\s*\.?\s*[\d.]+", re.IGNORECASE
)

# ---------------------------------------------------------------------------
# Boilerplate. A prior heuristic backfill polluted rag_content_chunks.concept
# with page-header noise -- literal values "202 BIOLOGY", "126",
# "114 MATHEMATICS". These patterns exist so that never happens again.
# ---------------------------------------------------------------------------
BOILERPLATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*\d{1,4}\s*$"),                                   # "126"
    re.compile(r"^\s*(?:page|पृष्ठ)\s*\d{1,4}\s*$", re.IGNORECASE),
    re.compile(r"^\s*\d{1,4}\s*/\s*\d{1,4}\s*$"),                     # "12/240"
    re.compile(r"reprint\s*20\d\d\s*[-–—]\s*\d\d", re.IGNORECASE),    # "Reprint 2025-26"
    re.compile(r"^\s*\d{1,4}\s+[A-Z][A-Z\s&'()-]{3,}\s*$"),           # "202 BIOLOGY"
    re.compile(r"^\s*[A-Z][A-Z\s&'()-]{3,}\s+\d{1,4}\s*$"),           # "BIOLOGY 202"
    re.compile(r"^\s*\d{1,4}\s+[ऀ-ॿ][ऀ-ॿ\s]{2,}\s*$"),  # "२०२ जीव विज्ञान"
    re.compile(r"^\s*[ऀ-ॿ][ऀ-ॿ\s]{2,}\s+\d{1,4}\s*$"),
    re.compile(r"^\s*©.*$"),
    re.compile(r"^\s*(?:ncert|एन\s*सी\s*ई\s*आर\s*टी)\s*$", re.IGNORECASE),
)


def is_boilerplate_line(text: str) -> bool:
    """True if a line is a running header / page number / reprint footer."""
    stripped = text.strip()
    if not stripped:
        return True
    return any(pattern.search(stripped) for pattern in BOILERPLATE_PATTERNS)


def devanagari_ratio(text: str) -> float:
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for ch in letters if DEVANAGARI.match(ch)) / len(letters)


def detect_language(text: str) -> str:
    """``'hi'`` when the unit is predominantly Devanagari, else ``'en'``.

    Matches ``rag_content_chunks.language`` (text, default 'en').
    """
    return "hi" if devanagari_ratio(text) >= 0.2 else "en"


def is_question_start(text: str) -> bool:
    return bool(QUESTION.match(text) or QUESTION_HI.match(text))


def is_answer_start(text: str) -> bool:
    return bool(ANSWER.match(text) or ANSWER_HI.match(text))


def is_example_start(text: str) -> bool:
    return bool(EXAMPLE.match(text) or EXAMPLE_HI.match(text))


def is_inline_heading(text: str) -> bool:
    """HEADING_RE-style lead-in ("Definition:", "परिभाषा:") -- not a font heading."""
    return bool(HEADING.match(text) or HEADING_HI.match(text))


def has_quiz_phrase(text: str) -> bool:
    return bool(QUIZ.search(text) or QUIZ_HI.search(text))


def count_options(text: str) -> int:
    return len(OPTION.findall(text)) + len(OPTION_HI.findall(text))


def strip_answer_prefix(text: str) -> str:
    for pattern in (ANSWER, ANSWER_HI):
        match = pattern.match(text)
        if match:
            return text[match.end() :].lstrip()
    return text
