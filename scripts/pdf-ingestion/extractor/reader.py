"""PDF reading adapter.

The rest of the extractor depends ONLY on the plain dataclasses declared here
(:class:`LineBlock`, :class:`TableBlock`, :class:`ImageBlock`, :class:`PageBlocks`,
:class:`Document`) and on the :class:`PdfReader` protocol -- never on a PDF
library directly. That is the swap seam:

    pdfplumber (MIT)  -- the only implementation today, see PdfPlumberReader
    PyMuPDF / fitz    -- AGPL-3.0-or-commercial; licensing call NOT made.
                         If legal signs off, add a PyMuPdfReader in THIS file
                         and change one line in cli.py. Nothing else moves.

``pdfplumber`` is imported lazily inside :meth:`PdfPlumberReader.read` so the
package (and its unit tests, which run on synthetic blocks) imports cleanly
without the dependency installed.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

# A page whose extracted text layer is shorter than this is treated as scanned /
# image-only and routed to manual review. Applied PER PAGE -- never per document.
# A 40-page PDF with 3 scanned plates must report those 3 pages, not pass whole.
DEFAULT_MIN_PAGE_CHARS = 200


@dataclass
class LineBlock:
    """One visual line of text with the typographic signals we classify on."""

    text: str
    page_number: int
    font_size: float = 10.0
    is_bold: bool = False
    x0: float = 0.0
    x1: float = 0.0
    top: float = 0.0
    bottom: float = 0.0
    # Filled in by units.detect_headings(); not read from the PDF.
    is_heading: bool = False
    heading_level: int = 0

    @property
    def height(self) -> float:
        return max(0.0, self.bottom - self.top)


@dataclass
class TableBlock:
    """A table region. ``rows`` is row-major, cells may be None (merged/empty)."""

    rows: list[list[str | None]]
    page_number: int
    x0: float = 0.0
    x1: float = 0.0
    top: float = 0.0
    bottom: float = 0.0


@dataclass
class ImageBlock:
    """An embedded raster/vector image region. We never OCR it (see CLAUDE.md)."""

    page_number: int
    x0: float = 0.0
    x1: float = 0.0
    top: float = 0.0
    bottom: float = 0.0
    name: str | None = None


@dataclass
class PageBlocks:
    page_number: int
    lines: list[LineBlock] = field(default_factory=list)
    tables: list[TableBlock] = field(default_factory=list)
    images: list[ImageBlock] = field(default_factory=list)
    width: float = 612.0
    height: float = 792.0
    skipped: bool = False
    skip_reason: str | None = None

    @property
    def char_count(self) -> int:
        return sum(len(line.text.strip()) for line in self.lines)


@dataclass
class Document:
    source_document: str
    source_hash: str
    page_count: int
    pages: list[PageBlocks] = field(default_factory=list)

    @property
    def skipped_pages(self) -> list[PageBlocks]:
        return [p for p in self.pages if p.skipped]

    @property
    def live_pages(self) -> list[PageBlocks]:
        return [p for p in self.pages if not p.skipped]


@runtime_checkable
class PdfReader(Protocol):
    """The one-method interface every PDF backend must satisfy."""

    def read(
        self,
        path: str,
        *,
        min_page_chars: int = DEFAULT_MIN_PAGE_CHARS,
        max_pages: int | None = None,
    ) -> Document: ...


def file_sha256(path: str) -> str:
    """SHA-256 of the source file bytes -- the provenance key for a run."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _mode_font_size(chars: list[dict[str, Any]]) -> float:
    sizes: dict[float, int] = {}
    for ch in chars:
        size = round(float(ch.get("size") or 0.0), 1)
        if size <= 0:
            continue
        sizes[size] = sizes.get(size, 0) + 1
    if not sizes:
        return 10.0
    return max(sizes.items(), key=lambda kv: (kv[1], kv[0]))[0]


def _is_bold(chars: list[dict[str, Any]]) -> bool:
    if not chars:
        return False
    bold = 0
    for ch in chars:
        name = str(ch.get("fontname") or "").lower()
        if "bold" in name or "black" in name or "heavy" in name or ",b" in name:
            bold += 1
    return bold * 2 > len(chars)


class PdfPlumberReader:
    """pdfplumber (MIT) backed :class:`PdfReader`.

    Uses ``page.extract_text_lines()`` when available (pdfplumber >= 0.10) and
    falls back to grouping ``extract_words()`` by baseline otherwise, so a
    slightly older wheel still works.
    """

    name = "pdfplumber"

    def read(
        self,
        path: str,
        *,
        min_page_chars: int = DEFAULT_MIN_PAGE_CHARS,
        max_pages: int | None = None,
    ) -> Document:
        import pdfplumber  # lazy: keeps the package importable without the dep

        source_document = os.path.basename(path)
        source_hash = file_sha256(path)
        pages: list[PageBlocks] = []

        with pdfplumber.open(path) as pdf:
            total = len(pdf.pages)
            selected = pdf.pages if max_pages is None else pdf.pages[:max_pages]
            for index, page in enumerate(selected, start=1):
                pages.append(
                    self._read_page(page, index, min_page_chars=min_page_chars)
                )

        return Document(
            source_document=source_document,
            source_hash=source_hash,
            page_count=total,
            pages=pages,
        )

    # -- internals ---------------------------------------------------------
    def _read_page(
        self, page: Any, page_number: int, *, min_page_chars: int
    ) -> PageBlocks:
        width = float(getattr(page, "width", 612.0) or 612.0)
        height = float(getattr(page, "height", 792.0) or 792.0)

        tables = self._read_tables(page, page_number)
        images = [
            ImageBlock(
                page_number=page_number,
                x0=float(im.get("x0", 0.0)),
                x1=float(im.get("x1", 0.0)),
                top=float(im.get("top", 0.0)),
                bottom=float(im.get("bottom", 0.0)),
                name=im.get("name"),
            )
            for im in (getattr(page, "images", None) or [])
        ]

        lines = self._read_lines(page, page_number)
        # Text physically inside a detected table is emitted as a TableBlock;
        # drop it from the line stream so it is not double-counted as prose.
        lines = [ln for ln in lines if not _inside_any(ln, tables)]

        blocks = PageBlocks(
            page_number=page_number,
            lines=lines,
            tables=tables,
            images=images,
            width=width,
            height=height,
        )

        if blocks.char_count < min_page_chars:
            blocks.skipped = True
            blocks.skip_reason = (
                f"low_text_layer: {blocks.char_count} chars < {min_page_chars} "
                f"({'image_only' if images else 'no_text'}); probable scanned "
                "page -- routed to manual review, NOT OCR'd"
            )
        return blocks

    def _read_lines(self, page: Any, page_number: int) -> list[LineBlock]:
        extract_text_lines = getattr(page, "extract_text_lines", None)
        if callable(extract_text_lines):
            try:
                raw = extract_text_lines(
                    layout=False, strip=True, return_chars=True
                )
            except TypeError:  # older signature
                raw = extract_text_lines()
            out: list[LineBlock] = []
            for item in raw or []:
                text = (item.get("text") or "").strip()
                if not text:
                    continue
                chars = item.get("chars") or []
                out.append(
                    LineBlock(
                        text=text,
                        page_number=page_number,
                        font_size=_mode_font_size(chars),
                        is_bold=_is_bold(chars),
                        x0=float(item.get("x0", 0.0)),
                        x1=float(item.get("x1", 0.0)),
                        top=float(item.get("top", 0.0)),
                        bottom=float(item.get("bottom", 0.0)),
                    )
                )
            return out
        return self._read_lines_from_words(page, page_number)

    def _read_lines_from_words(self, page: Any, page_number: int) -> list[LineBlock]:
        words = page.extract_words(extra_attrs=["size", "fontname"]) or []
        buckets: dict[int, list[dict[str, Any]]] = {}
        for word in words:
            key = int(round(float(word.get("top", 0.0)) / 3.0))
            buckets.setdefault(key, []).append(word)

        out: list[LineBlock] = []
        for key in sorted(buckets):
            group = sorted(buckets[key], key=lambda w: float(w.get("x0", 0.0)))
            text = " ".join(str(w.get("text", "")) for w in group).strip()
            if not text:
                continue
            pseudo_chars = [
                {"size": w.get("size"), "fontname": w.get("fontname")} for w in group
            ]
            out.append(
                LineBlock(
                    text=text,
                    page_number=page_number,
                    font_size=_mode_font_size(pseudo_chars),
                    is_bold=_is_bold(pseudo_chars),
                    x0=min(float(w.get("x0", 0.0)) for w in group),
                    x1=max(float(w.get("x1", 0.0)) for w in group),
                    top=min(float(w.get("top", 0.0)) for w in group),
                    bottom=max(float(w.get("bottom", 0.0)) for w in group),
                )
            )
        return out

    def _read_tables(self, page: Any, page_number: int) -> list[TableBlock]:
        find_tables = getattr(page, "find_tables", None)
        out: list[TableBlock] = []
        if callable(find_tables):
            for table in find_tables() or []:
                bbox = getattr(table, "bbox", (0.0, 0.0, 0.0, 0.0))
                try:
                    rows = table.extract()
                except Exception:  # noqa: BLE001 - malformed table region
                    continue
                if not rows:
                    continue
                out.append(
                    TableBlock(
                        rows=rows,
                        page_number=page_number,
                        x0=float(bbox[0]),
                        top=float(bbox[1]),
                        x1=float(bbox[2]),
                        bottom=float(bbox[3]),
                    )
                )
            return out

        for rows in page.extract_tables() or []:
            if rows:
                out.append(TableBlock(rows=rows, page_number=page_number))
        return out


def _inside_any(line: LineBlock, tables: list[TableBlock]) -> bool:
    for table in tables:
        if table.x1 <= table.x0 or table.bottom <= table.top:
            continue
        cx = (line.x0 + line.x1) / 2.0
        cy = (line.top + line.bottom) / 2.0
        if table.x0 <= cx <= table.x1 and table.top <= cy <= table.bottom:
            return True
    return False


def default_reader() -> PdfReader:
    """The single place the backend is chosen. Swap point for PyMuPDF."""
    return PdfPlumberReader()
