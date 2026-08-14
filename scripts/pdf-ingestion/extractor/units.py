"""Typed-learning-unit segmentation, classification and answer pairing.

This module is where teaching quality is won or lost. Four rules dominate:

1. ``worked_example`` and ``qa_pair`` are ATOMIC. They are NEVER split by token
   budget at any size. Splitting a solution away from its problem is the single
   biggest defect in the current corpus.
2. Only ``concept_explanation`` is budget-split, at ~500 tokens, with ONE
   SENTENCE OF OVERLAP (the existing pipeline has zero overlap -- a known
   defect) and the owning heading prefixed onto every sub-chunk, so a
   mid-section chunk is still self-describing.
3. ``heading_path`` is carried as real metadata, not merely prefixed. It feeds
   topic/concept, which are NULL for the entire current corpus.
4. Headings are detected by font-size percentile within the document plus the
   bold flag -- NOT by a regex on ALL-CAPS.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from . import taxonomy as tx
from .normalize import estimate_tokens, join_lines, split_sentences
from .reader import Document, ImageBlock, LineBlock, PageBlocks, TableBlock

DEFAULT_TOKEN_BUDGET = 500
#: A heading candidate longer than this is prose in a large font, not a heading.
MAX_HEADING_CHARS = 120
#: Vertical distance (pt) within which a line may caption an image.
CAPTION_MAX_DISTANCE = 90.0
#: Word count at or above which a strongly-typed unit earns the top quality tier.
STRONG_WORD_FLOOR = 40

UNIT_TYPES = (
    "concept_explanation",
    "definition",
    "worked_example",
    "qa_pair",
    "mcq",
    "diagram_caption",
    "table",
)


# ---------------------------------------------------------------------------
# LLM seam -- Phase 3, flagged, default OFF. NOT implemented here.
# ---------------------------------------------------------------------------
class ClassifierFallback(Protocol):
    """Classify-only fallback for weak-signal units.

    Deliberately unimplemented in this phase: Phase 2 is heuristics-only and
    makes zero network calls. A future narrow, flagged, default-off LLM
    classifier plugs in here and NOWHERE else -- it may return a unit_type and
    nothing more. It must never rewrite ``content``.
    """

    def __call__(self, text: str) -> str | None: ...


@dataclass
class Classification:
    unit_type: str
    #: ``strong``  -- a taxonomy regex or structural extractor fired
    #: ``weak``    -- fell through to concept_explanation prose
    #: ``structural`` -- came from extract_tables()/page.images, not from text
    signal: str
    option_hits: int = 0


@dataclass
class RawUnit:
    """A contiguous run of lines under one heading, before classification."""

    lines: list[LineBlock]
    heading_path: list[str] = field(default_factory=list)
    heading: str | None = None
    source: str = "text"  # 'text' | 'table' | 'image'
    table: TableBlock | None = None
    image: ImageBlock | None = None
    caption: str | None = None
    #: Pre-rendered text that must NOT go through prose flattening. Tables need
    #: this: join_lines() collapses newlines, which would mash every row into
    #: one line and destroy the row/column structure that makes a table useful.
    raw_text: str | None = None

    @property
    def text(self) -> str:
        if self.raw_text is not None:
            return self.raw_text
        return join_lines([line.text for line in self.lines])

    @property
    def page_start(self) -> int:
        return min((line.page_number for line in self.lines), default=0)

    @property
    def page_end(self) -> int:
        return max((line.page_number for line in self.lines), default=0)


@dataclass
class Unit:
    """A classified, answer-paired, budget-resolved learning unit."""

    unit_type: str
    content: str
    title: str
    heading_path: str
    page_start: int
    page_end: int
    signal: str
    language: str
    answer: str | None = None
    in_exercise: bool = False
    option_hits: int = 0
    part_index: int = 0
    part_total: int = 1
    needs_review: bool = False
    review_reason: str | None = None


# ---------------------------------------------------------------------------
# Heading detection -- font size percentile + bold, never ALL-CAPS regex
# ---------------------------------------------------------------------------
def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * pct
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    frac = position - low
    return ordered[low] * (1 - frac) + ordered[high] * frac


def _body_font_size(lines: list[LineBlock]) -> float:
    """Char-weighted modal font size -- the body-text size of the document."""
    weights: dict[float, int] = {}
    for line in lines:
        size = round(line.font_size, 1)
        weights[size] = weights.get(size, 0) + len(line.text)
    if not weights:
        return 10.0
    return max(weights.items(), key=lambda kv: (kv[1], kv[0]))[0]


def detect_headings(pages: list[PageBlocks]) -> list[float]:
    """Mark headings on every line IN PLACE. Returns the heading size ladder.

    A line is a heading when it is short and either
      * its font size clears both the 85th size percentile and the body size, or
      * it is bold and meaningfully larger than body text.
    Heading *level* is the rank of its size in the descending ladder of distinct
    heading sizes, so ``6.2 Respiration`` nests under ``Chapter 6``.
    """
    lines = [line for page in pages if not page.skipped for line in page.lines]
    if not lines:
        return []

    body = _body_font_size(lines)
    sizes = [line.font_size for line in lines]
    p85 = _percentile(sizes, 0.85)
    size_gate = max(p85, body + 0.4)

    for line in lines:
        if len(line.text) > MAX_HEADING_CHARS:
            line.is_heading = False
            continue
        big = line.font_size >= size_gate and line.font_size > body
        bold_big = line.is_bold and line.font_size >= body + 0.2
        line.is_heading = bool(big or bold_big)

    ladder = sorted(
        {round(line.font_size, 1) for line in lines if line.is_heading}, reverse=True
    )
    for line in lines:
        if line.is_heading:
            line.heading_level = ladder.index(round(line.font_size, 1)) + 1
    return ladder


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------
def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _page_gap_threshold(page: PageBlocks) -> float:
    gaps = [
        page.lines[i].top - page.lines[i - 1].bottom for i in range(1, len(page.lines))
    ]
    positive = [gap for gap in gaps if gap > 0]
    if not positive:
        return float("inf")  # no usable geometry -> rely on regex boundaries only
    return _median(positive) * 1.8 + 2.0


def _starts_new_unit(line: LineBlock, previous: LineBlock | None, gap: float) -> bool:
    text = line.text
    if tx.is_question_start(text) or tx.is_answer_start(text):
        return True
    if tx.is_example_start(text) or tx.is_inline_heading(text):
        return True
    if previous is None:
        return False
    if previous.page_number != line.page_number:
        return False  # prose continuing across a page break stays one unit
    return (line.top - previous.bottom) > gap


def _root_path(chapter_number: int | None) -> list[str]:
    """Seed the heading stack with ``Chapter N`` so heading_path is absolute.

    Chapter *title* is deliberately excluded here -- it already rides in
    ``embedding_text`` line 1, and repeating it in every heading_path segment
    adds shared boilerplate to the vector without adding discrimination.
    """
    return [] if chapter_number is None else [f"Chapter {chapter_number}"]


def split_units(
    document: Document,
    *,
    chapter_number: int | None = None,
    chapter_title: str | None = None,
) -> list[RawUnit]:
    """Segment a document into :class:`RawUnit` runs under a heading stack."""
    detect_headings(document.pages)

    del chapter_title  # not part of heading_path; see _root_path docstring
    units: list[RawUnit] = []
    stack: list[tuple[int, str]] = []
    root = _root_path(chapter_number)
    current: RawUnit | None = None
    previous: LineBlock | None = None

    def path() -> list[str]:
        return root + [text for _, text in stack]

    def flush() -> None:
        nonlocal current
        if current is not None and current.lines:
            units.append(current)
        current = None

    for page in document.pages:
        if page.skipped:
            continue
        gap = _page_gap_threshold(page)

        # Resolve figure captions FIRST and claim those lines, so a caption is
        # never emitted twice -- once as a diagram_caption and again as prose.
        # Duplicate content is precisely the corpus defect being fixed here.
        captions = _claim_captions(page)
        claimed = {id(line) for _, line in captions}

        for line in page.lines:
            if id(line) in claimed:
                continue
            if line.is_heading:
                flush()
                while stack and stack[-1][0] >= line.heading_level:
                    stack.pop()
                stack.append((line.heading_level, line.text))
                previous = line
                continue

            if current is None or _starts_new_unit(line, previous, gap):
                flush()
                current = RawUnit(
                    lines=[],
                    heading_path=path(),
                    heading=stack[-1][1] if stack else None,
                )
            current.lines.append(line)
            previous = line

        # tables and images are structural units anchored to the page
        for table in page.tables:
            rendered = _render_table(table)
            if not rendered.strip():
                continue
            units.append(
                RawUnit(
                    lines=[LineBlock(text=rendered, page_number=page.page_number)],
                    heading_path=path(),
                    heading=stack[-1][1] if stack else None,
                    source="table",
                    table=table,
                    raw_text=rendered,  # keep row structure; do not flatten
                )
            )
        for image, caption_line in captions:
            units.append(
                RawUnit(
                    lines=[caption_line],
                    heading_path=path(),
                    heading=stack[-1][1] if stack else None,
                    source="image",
                    image=image,
                    caption=caption_line.text,
                )
            )

    flush()
    return units


def _render_table(table: TableBlock) -> str:
    rows = [
        " | ".join((cell or "").strip() for cell in row)
        for row in table.rows
        if any((cell or "").strip() for cell in row)
    ]
    return "\n".join(rows)


def _claim_captions(page: PageBlocks) -> list[tuple[ImageBlock, LineBlock]]:
    """Pair each image with a caption-SHAPED line, at most one line per image.

    Only a line matching :data:`taxonomy.CAPTION` / :data:`taxonomy.TABLE_CAPTION`
    ("Fig. 6.2 ...", "चित्र 6.2 ...") is accepted. An arbitrary nearest line is
    deliberately NOT used as a fallback: it would both invent a caption the book
    never wrote and duplicate real prose into a second chunk. An uncaptioned
    image simply yields no unit -- we cannot read the image (no OCR), so there is
    nothing honest to ground on.
    """
    claimed: set[int] = set()
    out: list[tuple[ImageBlock, LineBlock]] = []
    for image in page.images:
        below = [
            line
            for line in page.lines
            if line.top >= image.bottom - 2
            and (line.top - image.bottom) <= CAPTION_MAX_DISTANCE
        ]
        above = [
            line
            for line in page.lines
            if line.bottom <= image.top + 2
            and (image.top - line.bottom) <= CAPTION_MAX_DISTANCE
        ]
        for pool in (below, above):
            match = next(
                (
                    line
                    for line in sorted(pool, key=lambda ln: abs(ln.top - image.bottom))
                    if id(line) not in claimed
                    and (tx.CAPTION.match(line.text) or tx.TABLE_CAPTION.match(line.text))
                ),
                None,
            )
            if match is not None:
                claimed.add(id(match))
                out.append((image, match))
                break
    return out


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------
def classify_unit(
    text: str,
    *,
    source: str = "text",
    fallback: ClassifierFallback | None = None,
) -> Classification:
    """Assign a ``unit_type`` from typography-independent text signals.

    ``fallback`` is the Phase-3 LLM seam. It is consulted ONLY when the
    heuristics produce a weak signal, and only for the unit type. It is never
    supplied in this phase.
    """
    if source == "table":
        return Classification("table", "structural")
    if source == "image":
        return Classification("diagram_caption", "structural")

    stripped = (text or "").strip()
    if not stripped:
        return Classification("concept_explanation", "weak")

    options = tx.count_options(stripped)
    quiz = tx.has_quiz_phrase(stripped)

    if tx.is_example_start(stripped):
        return Classification("worked_example", "strong", options)

    if tx.is_question_start(stripped):
        if quiz or options >= tx.MIN_OPTION_HITS_FOR_MCQ:
            return Classification("mcq", "strong", options)
        return Classification("qa_pair", "strong", options)

    if quiz or options >= tx.MIN_OPTION_HITS_FOR_MCQ:
        return Classification("mcq", "strong", options)

    if tx.is_inline_heading(stripped):
        return Classification("definition", "strong", options)

    if fallback is not None:  # pragma: no cover - Phase 3 seam, never wired here
        guess = fallback(stripped)
        if guess in UNIT_TYPES:
            return Classification(guess, "weak", options)

    return Classification("concept_explanation", "weak", options)


# ---------------------------------------------------------------------------
# Answer pairing
# ---------------------------------------------------------------------------
_PAIRABLE = {"qa_pair", "mcq", "worked_example"}


@dataclass
class PairedUnit:
    """A RawUnit after inline / next-segment answer extraction."""

    text: str
    answer: str | None
    classification: Classification
    heading_path: list[str]
    heading: str | None
    source: str
    page_start: int
    page_end: int


def _split_inline_answer(text: str) -> tuple[str, str | None]:
    """Split ``Q ... Answer: ...`` that landed inside a single segment.

    Only a marker at a non-zero offset counts -- a segment that *begins* with
    "Answer:" is an orphan answer block, handled by the pairing loop instead.
    Callers restrict this to question/example types, so a stray "solution:" in
    ordinary prose is never treated as an answer boundary.
    """
    match = None
    for pattern in (tx.ANSWER_INLINE, tx.ANSWER_HI_INLINE):
        for candidate in pattern.finditer(text):
            if candidate.start() == 0:
                continue
            if match is None or candidate.start() < match.start():
                match = candidate
    if match is None:
        return text, None
    question = text[: match.start()].strip()
    answer = text[match.end() :].strip()
    if not question or not answer:
        return text, None
    return question, answer


def pair_answers(
    raw_units: list[RawUnit],
    classifications: list[Classification],
) -> list[PairedUnit]:
    """Attach each answer/solution block to the question it belongs to.

    Two shapes are handled:
      * the answer is its own segment following the question -- merged, and that
        segment is consumed (never emitted as an orphan unit);
      * the answer is inline in the same segment -- split at the marker.

    An answer with no preceding question is kept as a standalone unit rather
    than dropped, so no source text is lost silently.
    """
    out: list[PairedUnit] = []
    consumed: set[int] = set()

    for index, (unit, classification) in enumerate(zip(raw_units, classifications)):
        if index in consumed:
            continue

        text = unit.text
        answer: str | None = None
        page_end = unit.page_end

        if classification.unit_type in _PAIRABLE:
            text, answer = _split_inline_answer(text)

            if answer is None:
                nxt = index + 1
                if nxt < len(raw_units) and tx.is_answer_start(raw_units[nxt].text):
                    answer = tx.strip_answer_prefix(raw_units[nxt].text)
                    page_end = max(page_end, raw_units[nxt].page_end)
                    consumed.add(nxt)

        out.append(
            PairedUnit(
                text=text,
                answer=answer,
                classification=classification,
                heading_path=unit.heading_path,
                heading=unit.heading,
                source=unit.source,
                page_start=unit.page_start,
                page_end=page_end,
            )
        )

    return out


# ---------------------------------------------------------------------------
# Budget splitting -- concept_explanation ONLY
# ---------------------------------------------------------------------------
ATOMIC_UNIT_TYPES = frozenset(
    {"worked_example", "qa_pair", "mcq", "diagram_caption", "table", "definition"}
)


def budget_split(
    text: str,
    unit_type: str,
    heading: str | None,
    *,
    budget: int = DEFAULT_TOKEN_BUDGET,
) -> list[str]:
    """Split prose at ~``budget`` tokens with one sentence of overlap.

    Returns ``[text]`` unchanged for every atomic type. A single sentence longer
    than the budget becomes its own oversized chunk -- we never cut mid-sentence.
    """
    if unit_type in ATOMIC_UNIT_TYPES:
        return [text]

    sentences = split_sentences(text)
    if not sentences:
        return [text]

    chunks: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        cost = estimate_tokens(sentence)
        if current and current_tokens + cost > budget:
            chunks.append(current)
            overlap = current[-1]  # ONE-SENTENCE OVERLAP
            current = [overlap]
            current_tokens = estimate_tokens(overlap)
        current.append(sentence)
        current_tokens += cost

    if current:
        chunks.append(current)

    parts = [" ".join(chunk) for chunk in chunks]
    if len(parts) <= 1:
        return parts or [text]

    # Prefix the owning heading onto EVERY sub-chunk so a mid-section chunk is
    # self-describing on its own.
    if heading:
        parts = [
            part if part.startswith(heading) else f"{heading}. {part}" for part in parts
        ]
    return parts


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------
def _title_for(heading: str | None, text: str) -> str:
    if heading:
        return heading
    first = text.strip().split("\n", 1)[0]
    return (first[:77] + "...") if len(first) > 80 else first


def build_units(
    document: Document,
    *,
    chapter_number: int | None = None,
    chapter_title: str | None = None,
    budget: int = DEFAULT_TOKEN_BUDGET,
    fallback: ClassifierFallback | None = None,
) -> list[Unit]:
    """Full pipeline: segment -> classify -> pair answers -> budget split."""
    raw_units = split_units(
        document, chapter_number=chapter_number, chapter_title=chapter_title
    )
    classifications = [
        classify_unit(unit.text, source=unit.source, fallback=fallback)
        for unit in raw_units
    ]
    paired = pair_answers(raw_units, classifications)

    out: list[Unit] = []
    for pair in paired:
        text = pair.text
        if not text.strip():
            continue
        classification = pair.classification
        heading_path = " > ".join(pair.heading_path)
        # Prose whose owning heading was RESOLVED by the font-size detector was
        # heuristically classified by a real signal -- the heading detector
        # fired. Without this promotion concept_explanation (the bulk of any
        # textbook) could never reach the 0.8 tier and quality_score would stay
        # a near-constant, i.e. the same inert column we are trying to fix.
        if classification.unit_type == "concept_explanation" and pair.heading:
            classification = Classification(
                classification.unit_type, "strong", classification.option_hits
            )
        in_exercise = bool(tx.EXERCISE_MARKER.search(heading_path))
        parts = budget_split(
            text, classification.unit_type, pair.heading, budget=budget
        )
        for part_index, part in enumerate(parts):
            needs_review, reason = _review_flag(classification, pair.answer, part)
            out.append(
                Unit(
                    unit_type=classification.unit_type,
                    content=part,
                    title=_title_for(pair.heading, part),
                    heading_path=heading_path,
                    page_start=pair.page_start,
                    page_end=pair.page_end,
                    signal=classification.signal,
                    language=tx.detect_language(part),
                    # An answer belongs to the WHOLE unit. Atomic types are never
                    # split, so this only ever attaches once.
                    answer=pair.answer,
                    in_exercise=in_exercise,
                    option_hits=classification.option_hits,
                    part_index=part_index,
                    part_total=len(parts),
                    needs_review=needs_review,
                    review_reason=reason,
                )
            )
    return out


def _review_flag(
    classification: Classification, answer: str | None, text: str
) -> tuple[bool, str | None]:
    if classification.unit_type == "diagram_caption":
        return True, "diagram caption unreviewed -- image content not read (no OCR)"
    if classification.unit_type in {"qa_pair", "mcq"} and not answer:
        return True, "question has no paired answer"
    if classification.unit_type == "worked_example" and not answer:
        return True, "worked example has no paired solution"
    if len(text.split()) < 8:
        return True, "unit shorter than 8 words -- probable fragment"
    return False, None
