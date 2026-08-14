"""Text normalisation and boilerplate stripping.

Order is load-bearing:

  1. ``unicodedata.normalize('NFC', ...)`` FIRST. PDF text layers routinely emit
     decomposed Devanagari; NFD vs NFC silently degrades both Postgres FTS and
     embedding quality because the two forms tokenize differently.
  2. Ligature repair + control-character scrub.
  3. Dehyphenation across line breaks (done when lines are joined into a unit).
  4. Boilerplate stripping (running headers, page numbers, "Reprint 2025-26").

Explicitly NOT done here:
  * Mojibake detection. The TypeScript loader in the later phase reuses
    ``scripts/ncert-ingestion/mojibake.ts``; a second implementation of that
    heuristic would drift from the first.
  * OCR. See CLAUDE.md.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from .reader import LineBlock, PageBlocks
from .taxonomy import is_boilerplate_line

# Presentation-form ligatures that PDF producers emit as single codepoints.
_LIGATURES = {
    "ﬀ": "ff",
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "ﬅ": "st",
    "ﬆ": "st",
    "Œ": "OE",
    "œ": "oe",
}

# Invisible characters that are safe to delete: ZWSP, word-joiner, BOM.
# NOTE: ZWNJ (U+200C) and ZWJ (U+200D) are deliberately NOT in this set -- they
# are semantically meaningful in Devanagari conjunct formation and deleting them
# corrupts Hindi text.
_ZERO_WIDTH = re.compile("[​⁠﻿]")
_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# space, tab, NBSP, narrow-NBSP, en-quad-family, ideographic space
_SPACES = re.compile("[ \t   - 　]+")

# line-end hyphen (ASCII / U+2010 / U+2011) followed by a lowercase Latin or
# Devanagari continuation -- a word broken across a line break.
_HYPHEN_BREAK = re.compile("(\\w)[-‐‑]\\s*\n\\s*([a-zऀ-ॿ])")
# a soft hyphen (U+00AD) anywhere is always removable
_SOFT_HYPHEN = re.compile("­")


def normalize_text(text: str) -> str:
    """NFC + ligature repair + invisible-character scrub + space collapse."""
    if not text:
        return ""
    out = unicodedata.normalize("NFC", text)
    for src, dst in _LIGATURES.items():
        if src in out:
            out = out.replace(src, dst)
    out = _SOFT_HYPHEN.sub("", out)
    out = _ZERO_WIDTH.sub("", out)
    out = _CONTROL.sub(" ", out)
    out = _SPACES.sub(" ", out)
    out = re.sub(" *\n *", "\n", out)
    return out.strip()


def dehyphenate(text: str) -> str:
    """Repair words split across a line break: ``respira-\\ntion`` -> ``respiration``."""
    previous = None
    out = text
    while previous != out:  # chained breaks, e.g. tri-\nsyl-\nlable
        previous = out
        out = _HYPHEN_BREAK.sub(r"\1\2", out)
    return out


def join_lines(lines: list[str]) -> str:
    """Join a unit's lines into prose: dehyphenate first, then flatten breaks."""
    raw = "\n".join(line.strip() for line in lines if line and line.strip())
    raw = dehyphenate(raw)
    raw = re.sub(r"\n+", " ", raw)
    return _SPACES.sub(" ", raw).strip()


@dataclass
class BoilerplateReport:
    lines_stripped: int = 0
    #: representative stripped values, capped -- structural page furniture only,
    #: never student data (P13).
    samples: list[str] = field(default_factory=list)
    #: repeated running headers/footers found by frequency, not by regex
    repeated_patterns: list[str] = field(default_factory=list)


_DIGITS = re.compile(r"\d+")

#: fraction of pages a line must appear on to count as a running header/footer
_REPEAT_PAGE_FRACTION = 0.6
#: how far from the page edge a repeated line must sit (fraction of page height)
_EDGE_BAND = 0.12
_MAX_SAMPLES = 12


def _signature(text: str) -> str:
    return _DIGITS.sub("#", text.strip().lower())


def _in_edge_band(line: LineBlock, page: PageBlocks) -> bool:
    height = page.height or 0.0
    if height <= 0:
        return False
    band = height * _EDGE_BAND
    return line.top <= band or line.bottom >= (height - band)


def strip_boilerplate(pages: list[PageBlocks]) -> BoilerplateReport:
    """Remove page furniture from ``pages`` IN PLACE. Returns what was removed.

    Two mechanisms, both required:

    * regex -- catches bare page numbers, "Reprint 2025-26", "202 BIOLOGY".
    * frequency -- catches book-specific running headers a regex cannot know
      about, by requiring the digit-masked line to recur near a page edge on
      >= 60% of pages. This is the half that stops the ``concept`` column from
      being backfilled with header noise again.
    """
    report = BoilerplateReport()
    live = [page for page in pages if not page.skipped]
    if not live:
        return report

    counts: dict[str, int] = {}
    for page in live:
        seen_on_page: set[str] = set()
        for line in page.lines:
            if not _in_edge_band(line, page):
                continue
            signature = _signature(line.text)
            if not signature or signature in seen_on_page:
                continue
            seen_on_page.add(signature)
            counts[signature] = counts.get(signature, 0) + 1

    threshold = max(2, int(len(live) * _REPEAT_PAGE_FRACTION))
    repeated = {sig for sig, n in counts.items() if n >= threshold and len(sig) <= 120}
    report.repeated_patterns = sorted(repeated)[:_MAX_SAMPLES]

    for page in live:
        kept: list[LineBlock] = []
        for line in page.lines:
            drop_regex = is_boilerplate_line(line.text)
            drop_repeat = (
                _signature(line.text) in repeated and _in_edge_band(line, page)
            )
            if drop_regex or drop_repeat:
                report.lines_stripped += 1
                if len(report.samples) < _MAX_SAMPLES:
                    report.samples.append(line.text.strip()[:80])
                continue
            kept.append(line)
        page.lines = kept

    return report


def normalize_pages(pages: list[PageBlocks]) -> None:
    """NFC-normalise every line and table cell IN PLACE, before anything else."""
    for page in pages:
        for line in page.lines:
            line.text = normalize_text(line.text)
        page.lines = [line for line in page.lines if line.text]
        for table in page.tables:
            table.rows = [
                [normalize_text(cell) if cell else cell for cell in row]
                for row in table.rows
            ]


_SENTENCE_END = re.compile("(?<=[.!?।])\\s+")


def split_sentences(text: str) -> list[str]:
    """Sentence split on ``. ! ?`` and U+0964 danda (Hindi full stop)."""
    parts = [part.strip() for part in _SENTENCE_END.split(text) if part.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def estimate_tokens(text: str) -> int:
    """Deterministic, tokenizer-free token estimate.

    Latin script tokenizes at roughly 4 chars/token; Devanagari at roughly
    2 chars/token on the same BPE vocabularies, so a script-blind ``len/4``
    under-counts Hindi by ~2x and produces oversized Hindi chunks.
    """
    if not text:
        return 0
    from .taxonomy import devanagari_ratio

    divisor = 2 if devanagari_ratio(text) >= 0.2 else 4
    return max(len(text.split()), (len(text) + divisor - 1) // divisor)
