"""Synthetic-block builders for the test suite.

There are NO source PDFs on disk in this repo (only previously-extracted images
under ``tools/pdf-content-ingestor/data/assets/``). Every test therefore builds
:class:`PageBlocks` by hand. That is a feature, not a workaround: it keeps the
whole suite runnable without ``pdfplumber`` installed and pins the reader
adapter as the only PDF-library-aware surface.

This lives at the tool root rather than in ``tests/`` on purpose. Making
``tests/`` a package would create a THIRD top-level module named ``tests`` in
this repo (alongside ``python/tests`` and the repo-root ``tests/``, both of
which have ``__init__.py``), which collides under any pytest run whose rootdir
spans them. ``conftest.py`` next to this file puts the directory on sys.path.
"""

from __future__ import annotations

from extractor.reader import Document, ImageBlock, LineBlock, PageBlocks, TableBlock

BODY = 10.0
H1 = 18.0
H2 = 14.0


def line(
    text: str,
    *,
    page: int = 1,
    size: float = BODY,
    bold: bool = False,
    top: float = 100.0,
    height: float = 12.0,
    x0: float = 72.0,
    x1: float = 500.0,
) -> LineBlock:
    """Build a LineBlock with sane geometry so gap detection behaves."""
    return LineBlock(
        text=text,
        page_number=page,
        font_size=size,
        is_bold=bold,
        x0=x0,
        x1=x1,
        top=top,
        bottom=top + height,
    )


def stack_lines(specs: list[tuple[str, float, bool]], *, page: int = 1,
                start_top: float = 100.0, leading: float = 14.0,
                gap_before: dict[int, float] | None = None) -> list[LineBlock]:
    """Lay out (text, size, bold) triples vertically.

    ``gap_before`` injects extra vertical space before the given index, which is
    how a paragraph break is expressed to the segmenter.
    """
    gap_before = gap_before or {}
    out: list[LineBlock] = []
    top = start_top
    for index, (text, size, bold) in enumerate(specs):
        top += gap_before.get(index, 0.0)
        out.append(line(text, page=page, size=size, bold=bold, top=top, height=size))
        top += leading
    return out


def page(lines: list[LineBlock], *, number: int = 1, tables=None, images=None,
         height: float = 792.0) -> PageBlocks:
    return PageBlocks(
        page_number=number,
        lines=lines,
        tables=list(tables or []),
        images=list(images or []),
        height=height,
    )


def document(pages: list[PageBlocks], *, name: str = "synthetic.pdf",
             source_hash: str = "0" * 64) -> Document:
    return Document(
        source_document=name,
        source_hash=source_hash,
        page_count=len(pages),
        pages=pages,
    )


__all__ = [
    "BODY",
    "H1",
    "H2",
    "Document",
    "ImageBlock",
    "LineBlock",
    "PageBlocks",
    "TableBlock",
    "document",
    "line",
    "page",
    "stack_lines",
]
