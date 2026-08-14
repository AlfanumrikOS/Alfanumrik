"""ContentItem construction, validation and versioned ``extract.json`` emission.

Two things here are load-bearing and easy to get wrong:

**1. The DB allowlists.** ``content_type`` and ``question_type`` are
CHECK-constrained on ``public.rag_content_chunks``
(``chk_rag_content_type`` / ``chk_rag_question_type``). Emitting anything
outside these sets fails at load time, potentially thousands of rows in. They
are validated HERE, before the file is written, so a bad run fails offline.

**2. ``embedding_text`` is deliberately terse.** The downstream retrieval floor
is an ABSOLUTE cosine (0.22), not a relative one. Every token of shared
boilerplate prefixed onto every chunk pulls all new vectors toward a common
direction and inflates their cosine uniformly -- which lets weak chunks clear a
floor that existing rows meet honestly. So: no ``Board:`` (always CBSE), no
``Grade: / Subject: / Chapter: / Type: / Title:`` label scaffolding. Grade,
subject, chapter, title and type are kept because they are genuinely
discriminative; the labels around them are not.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from typing import Any

from . import EXTRACTION_VERSION
from .units import STRONG_WORD_FLOOR, Unit

# --- DB CHECK-constraint allowlists -- keep in sync with the migration -------
# supabase/migrations/00000000000000_baseline_from_prod.sql
#   CONSTRAINT chk_rag_content_type  CHECK (content_type = ANY (...))
#   CONSTRAINT chk_rag_question_type CHECK (question_type IS NULL OR = ANY (...))
ALLOWED_CONTENT_TYPES = frozenset({"content", "diagram", "qa"})
ALLOWED_QUESTION_TYPES = frozenset(
    {
        "mcq",
        "short_answer",
        "long_answer",
        "numerical",
        "intext",
        "exercise",
        "example",
        "hots",
    }
)

#: unit_type -> (content_type, question_type). question_type None => SQL NULL.
UNIT_TYPE_MAP: dict[str, tuple[str, str | None]] = {
    "concept_explanation": ("content", None),
    "definition": ("content", None),
    "worked_example": ("content", "example"),
    "qa_pair": ("qa", "intext"),  # overridden to 'exercise' under an exercise heading
    "mcq": ("qa", "mcq"),
    "diagram_caption": ("diagram", None),
    "table": ("content", None),
}

#: Terse human labels for embedding_text line 2. Not the raw enum -- "qa pair"
#: is noise, "question" is signal.
UNIT_TYPE_LABEL = {
    "concept_explanation": "concept",
    "definition": "definition",
    "worked_example": "worked example",
    "qa_pair": "question",
    "mcq": "MCQ",
    "diagram_caption": "diagram",
    "table": "table",
}

#: Hard cap on embedding_text length. Atomic units are never budget-split, so a
#: pathological multi-page worked example could otherwise exceed the embedding
#: model's context. ``content`` is NEVER truncated -- only the vectorized copy.
EMBED_MAX_CHARS = 8000


class EmitValidationError(ValueError):
    """Raised when a unit would violate a DB CHECK constraint."""


@dataclass
class SourceMeta:
    """Per-run provenance and the discriminative fields for embedding_text."""

    source_document: str
    source_hash: str
    grade: str | None = None  # P5: grades are STRINGS, "6".."12" -- never int
    subject: str | None = None
    chapter_number: int | None = None
    chapter_title: str | None = None


@dataclass
class ContentItem:
    unit_type: str
    content: str
    embedding_text: str
    answer: str | None
    title: str
    heading_path: str
    page_start: int
    page_end: int
    content_sha256: str
    source_document: str
    source_hash: str
    language: str
    content_type: str
    question_type: str | None
    needs_review: bool
    quality_score: float
    # --- context carried through for the later loader phase -----------------
    grade: str | None = None
    subject: str | None = None
    chapter_number: int | None = None
    chapter_title: str | None = None
    heading: str | None = None
    review_reason: str | None = None
    signal: str = "weak"
    word_count: int = 0
    part_index: int = 0
    part_total: int = 1


def resolve_types(unit: Unit) -> tuple[str, str | None]:
    """unit_type -> (content_type, question_type), validated against the DB sets."""
    try:
        content_type, question_type = UNIT_TYPE_MAP[unit.unit_type]
    except KeyError as exc:  # pragma: no cover - guarded by UNIT_TYPES
        raise EmitValidationError(f"unknown unit_type {unit.unit_type!r}") from exc

    if unit.unit_type == "qa_pair":
        question_type = "exercise" if unit.in_exercise else "intext"

    if content_type not in ALLOWED_CONTENT_TYPES:
        raise EmitValidationError(
            f"content_type {content_type!r} violates chk_rag_content_type"
        )
    if question_type is not None and question_type not in ALLOWED_QUESTION_TYPES:
        raise EmitValidationError(
            f"question_type {question_type!r} violates chk_rag_question_type"
        )
    return content_type, question_type


def compose_embedding_text(unit: Unit, meta: SourceMeta) -> str:
    """Build the SHORT composite that gets vectorized.

    Shape (labels deliberately absent -- see module docstring)::

        Grade 10 Science - Chapter 6: Life Processes
        Anaerobic respiration - worked example
        <content>
        Answer: <answer>

    Every header component is omitted when unknown rather than emitted empty,
    so a chapter-less run does not ship a dangling separator into the vector.
    """
    header_bits: list[str] = []
    if meta.grade:
        header_bits.append(f"Grade {meta.grade}")
    if meta.subject:
        header_bits.append(meta.subject)
    scope = " ".join(header_bits)

    chapter = ""
    if meta.chapter_number is not None:
        chapter = f"Chapter {meta.chapter_number}"
        if meta.chapter_title:
            chapter = f"{chapter}: {meta.chapter_title}"
    elif meta.chapter_title:
        chapter = meta.chapter_title

    line1 = " — ".join(part for part in (scope, chapter) if part)

    label = UNIT_TYPE_LABEL.get(unit.unit_type, unit.unit_type.replace("_", " "))
    title = (unit.title or "").strip()
    line2 = f"{title} — {label}" if title else label

    lines = [line for line in (line1, line2) if line]
    lines.append(unit.content.strip())
    if unit.answer:
        lines.append(f"Answer: {unit.answer.strip()}")

    text = "\n".join(lines)
    return text if len(text) <= EMBED_MAX_CHARS else text[:EMBED_MAX_CHARS].rstrip()


def content_sha256(unit: Unit) -> str:
    """Dedupe key.

    Covers unit_type + content + answer, NOT the surrounding metadata: two
    genuinely identical passages under different headings are the same chunk and
    should collapse, while the same question stem with two different answers
    must not. Nothing prevents duplicate chunks in the current corpus; this is
    the fix.
    """
    payload = f"{unit.unit_type}\n{unit.content.strip()}\n{(unit.answer or '').strip()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def quality_score(unit: Unit) -> float:
    """Deterministic quality tier.

    ``quality_score`` is inert in production today (68% NULL, every non-null
    value exactly 0.7), which means the existing 0.4 retrieval gate is a no-op.
    Populating it honestly turns that gate into a working lever -- so these
    tiers must stay conservative and must never all collapse to one value.

      0.8  strongly classified + resolved heading + >= 40 words
      0.6  heuristic with a weak signal
      0.3  unreviewed diagram caption
    """
    if unit.unit_type == "diagram_caption":
        return 0.3
    words = len(unit.content.split())
    strong = unit.signal in ("strong", "structural")
    if strong and unit.heading_path and words >= STRONG_WORD_FLOOR:
        return 0.8
    return 0.6


def build_item(unit: Unit, meta: SourceMeta) -> ContentItem:
    content_type, question_type = resolve_types(unit)
    return ContentItem(
        unit_type=unit.unit_type,
        content=unit.content,
        embedding_text=compose_embedding_text(unit, meta),
        answer=unit.answer,
        title=unit.title,
        heading_path=unit.heading_path,
        page_start=unit.page_start,
        page_end=unit.page_end,
        content_sha256=content_sha256(unit),
        source_document=meta.source_document,
        source_hash=meta.source_hash,
        language=unit.language,
        content_type=content_type,
        question_type=question_type,
        needs_review=unit.needs_review,
        quality_score=quality_score(unit),
        grade=meta.grade,
        subject=meta.subject,
        chapter_number=meta.chapter_number,
        chapter_title=meta.chapter_title,
        heading=unit.heading_path.split(" > ")[-1] if unit.heading_path else None,
        review_reason=unit.review_reason,
        signal=unit.signal,
        word_count=len(unit.content.split()),
        part_index=unit.part_index,
        part_total=unit.part_total,
    )


@dataclass
class RunReport:
    """Emitted alongside the units. Answers 'what did this run actually do?'."""

    source_document: str
    source_hash: str
    extraction_version: str = EXTRACTION_VERSION
    page_count: int = 0
    pages_processed: int = 0
    pages_skipped: list[dict[str, Any]] = field(default_factory=list)
    units_by_type: dict[str, int] = field(default_factory=dict)
    units_emitted: int = 0
    dedupe_hits: int = 0
    boilerplate_lines_stripped: int = 0
    boilerplate_samples: list[str] = field(default_factory=list)
    repeated_header_patterns: list[str] = field(default_factory=list)
    needs_review_count: int = 0
    quality_histogram: dict[str, int] = field(default_factory=dict)
    budget_split_units: int = 0
    warnings: list[str] = field(default_factory=list)


def dedupe(items: list[ContentItem]) -> tuple[list[ContentItem], int]:
    """Drop exact ``content_sha256`` repeats, keeping the first occurrence."""
    seen: set[str] = set()
    kept: list[ContentItem] = []
    hits = 0
    for item in items:
        if item.content_sha256 in seen:
            hits += 1
            continue
        seen.add(item.content_sha256)
        kept.append(item)
    return kept, hits


def validate_items(items: list[ContentItem]) -> None:
    """Fail the whole run offline rather than half-load a corpus."""
    for index, item in enumerate(items):
        if item.content_type not in ALLOWED_CONTENT_TYPES:
            raise EmitValidationError(
                f"item {index}: content_type={item.content_type!r} violates "
                "chk_rag_content_type"
            )
        if (
            item.question_type is not None
            and item.question_type not in ALLOWED_QUESTION_TYPES
        ):
            raise EmitValidationError(
                f"item {index}: question_type={item.question_type!r} violates "
                "chk_rag_question_type"
            )
        if not item.content.strip():
            raise EmitValidationError(f"item {index}: empty content")
        if not item.embedding_text.strip():
            raise EmitValidationError(f"item {index}: empty embedding_text")
        if item.grade is not None and not isinstance(item.grade, str):
            # P5: grades are strings "6".."12", never integers.
            raise EmitValidationError(f"item {index}: grade must be a string")


def build_extract(items: list[ContentItem], report: RunReport) -> dict[str, Any]:
    return {
        "extraction_version": EXTRACTION_VERSION,
        "report": asdict(report),
        "units": [asdict(item) for item in items],
    }


def write_extract(payload: dict[str, Any], path: str) -> str:
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def summarize(items: list[ContentItem], report: RunReport) -> RunReport:
    report.units_emitted = len(items)
    by_type: dict[str, int] = {}
    quality: dict[str, int] = {}
    for item in items:
        by_type[item.unit_type] = by_type.get(item.unit_type, 0) + 1
        key = f"{item.quality_score:.1f}"
        quality[key] = quality.get(key, 0) + 1
        if item.needs_review:
            report.needs_review_count += 1
        if item.part_total > 1 and item.part_index == 0:
            report.budget_split_units += 1
    report.units_by_type = dict(sorted(by_type.items()))
    report.quality_histogram = dict(sorted(quality.items()))
    return report
