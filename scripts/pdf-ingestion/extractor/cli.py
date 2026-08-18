"""Command-line entry point for the curated-PDF extractor.

    python -m extractor.cli book.pdf --grade 10 --subject Science --chapter 6
    python -m extractor.cli book.pdf ... --out extract.json --write

``--dry-run`` is the DEFAULT. Nothing is written to disk without an explicit
``--write``. Nothing is EVER written to a database, and no network call is made
from anywhere in this package.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from . import EXTRACTION_VERSION
from .emit import (
    RunReport,
    SourceMeta,
    build_extract,
    build_item,
    dedupe,
    summarize,
    validate_items,
    write_extract,
)
from .normalize import normalize_pages, strip_boilerplate
from .reader import DEFAULT_MIN_PAGE_CHARS, Document, PdfReader, default_reader
from .units import DEFAULT_TOKEN_BUDGET, build_units

VALID_GRADES = tuple(str(n) for n in range(6, 13))  # P5: strings, never ints


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="extractor",
        description=(
            "Extract typed learning units from a curated PDF. Offline, "
            "file-in/file-out. No DB, no network, no LLM, no OCR."
        ),
    )
    parser.add_argument("pdf", help="Path to the source PDF")
    parser.add_argument(
        "--grade",
        choices=VALID_GRADES,
        help='CBSE grade as a STRING, "6".."12" (P5)',
    )
    parser.add_argument("--subject", help='e.g. "Science", "Mathematics"')
    parser.add_argument(
        "--chapter", type=int, dest="chapter_number", help="Chapter number"
    )
    parser.add_argument("--chapter-title", help='e.g. "Life Processes"')
    parser.add_argument(
        "--out", default="extract.json", help="Output path (default: extract.json)"
    )
    parser.add_argument(
        "--report",
        help="Run-report path (default: <out stem>.report.json)",
    )
    parser.add_argument(
        "--token-budget",
        type=int,
        default=DEFAULT_TOKEN_BUDGET,
        help=(
            f"Split budget for concept_explanation only (default "
            f"{DEFAULT_TOKEN_BUDGET}). worked_example and qa_pair are ATOMIC "
            "and are never split at any size."
        ),
    )
    parser.add_argument(
        "--min-page-chars",
        type=int,
        default=DEFAULT_MIN_PAGE_CHARS,
        help=(
            f"Per-PAGE text-layer floor (default {DEFAULT_MIN_PAGE_CHARS}). "
            "Pages below it are recorded as skipped and routed to manual "
            "review. Never OCR'd."
        ),
    )
    parser.add_argument("--max-pages", type=int, help="Read only the first N pages")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Actually write the output files. Without it the run is a dry run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicit no-op: dry run is already the default. Rejects --write.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_report",
        help="Print the run report as JSON instead of a human summary",
    )
    return parser


def extract(
    pdf_path: str,
    meta_args: dict[str, Any],
    *,
    reader: PdfReader | None = None,
    token_budget: int = DEFAULT_TOKEN_BUDGET,
    min_page_chars: int = DEFAULT_MIN_PAGE_CHARS,
    max_pages: int | None = None,
) -> tuple[list[Any], RunReport]:
    """Read -> normalise -> strip -> unitise -> emit-ready items + report."""
    reader = reader or default_reader()
    document: Document = reader.read(
        pdf_path, min_page_chars=min_page_chars, max_pages=max_pages
    )
    return extract_from_document(
        document, meta_args, token_budget=token_budget
    )


def extract_from_document(
    document: Document,
    meta_args: dict[str, Any],
    *,
    token_budget: int = DEFAULT_TOKEN_BUDGET,
) -> tuple[list[Any], RunReport]:
    """The reader-independent half of the pipeline (unit-testable directly)."""
    # 1. NFC first -- before boilerplate matching, before anything.
    normalize_pages(document.pages)
    # 2. Page furniture out, so it can never reach topic/concept.
    boilerplate = strip_boilerplate(document.pages)

    meta = SourceMeta(
        source_document=document.source_document,
        source_hash=document.source_hash,
        grade=meta_args.get("grade"),
        subject=meta_args.get("subject"),
        chapter_number=meta_args.get("chapter_number"),
        chapter_title=meta_args.get("chapter_title"),
    )

    units = build_units(
        document,
        chapter_number=meta.chapter_number,
        chapter_title=meta.chapter_title,
        budget=token_budget,
    )
    items = [build_item(unit, meta) for unit in units]
    items, dedupe_hits = dedupe(items)
    validate_items(items)

    report = RunReport(
        source_document=document.source_document,
        source_hash=document.source_hash,
        extraction_version=EXTRACTION_VERSION,
        page_count=document.page_count,
        pages_processed=len(document.live_pages),
        pages_skipped=[
            {
                "page_number": page.page_number,
                "reason": page.skip_reason,
                "char_count": page.char_count,
                "image_count": len(page.images),
                "action": "manual_review",
            }
            for page in document.skipped_pages
        ],
        dedupe_hits=dedupe_hits,
        boilerplate_lines_stripped=boilerplate.lines_stripped,
        boilerplate_samples=boilerplate.samples,
        repeated_header_patterns=boilerplate.repeated_patterns,
    )
    report = summarize(items, report)

    if report.pages_skipped:
        report.warnings.append(
            f"{len(report.pages_skipped)} page(s) had no usable text layer and "
            "were NOT extracted. They are listed in pages_skipped for manual "
            "review. OCR is deliberately not applied (confidently-wrong text in "
            "a grounding corpus is worse than absent text)."
        )
    if not report.units_emitted:
        report.warnings.append("No units emitted -- check the source PDF.")
    return items, report


def _default_report_path(out_path: str) -> str:
    stem = out_path[:-5] if out_path.endswith(".json") else out_path
    return f"{stem}.report.json"


def _human_summary(report: RunReport, wrote: bool, out: str, report_path: str) -> str:
    lines = [
        f"extraction_version : {report.extraction_version}",
        f"source             : {report.source_document}",
        f"source_hash        : {report.source_hash[:16]}...",
        f"pages              : {report.pages_processed}/{report.page_count} "
        f"processed, {len(report.pages_skipped)} skipped",
        f"units emitted      : {report.units_emitted}",
    ]
    for unit_type, count in report.units_by_type.items():
        lines.append(f"  - {unit_type:<20} {count}")
    lines += [
        f"budget-split units : {report.budget_split_units}",
        f"dedupe hits        : {report.dedupe_hits}",
        f"boilerplate lines  : {report.boilerplate_lines_stripped}",
        f"needs_review       : {report.needs_review_count}",
        f"quality histogram  : {report.quality_histogram}",
    ]
    for page in report.pages_skipped:
        lines.append(f"  ! page {page['page_number']}: {page['reason']}")
    for warning in report.warnings:
        lines.append(f"  ! {warning}")
    if wrote:
        lines.append(f"WROTE {out}")
        lines.append(f"WROTE {report_path}")
    else:
        lines.append(
            f"DRY RUN -- nothing written. Would write {out} and {report_path}. "
            "Pass --write to persist."
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.dry_run and args.write:
        print("error: --dry-run and --write are mutually exclusive", file=sys.stderr)
        return 2

    items, report = extract(
        args.pdf,
        {
            "grade": args.grade,
            "subject": args.subject,
            "chapter_number": args.chapter_number,
            "chapter_title": args.chapter_title,
        },
        token_budget=args.token_budget,
        min_page_chars=args.min_page_chars,
        max_pages=args.max_pages,
    )

    report_path = args.report or _default_report_path(args.out)
    payload = build_extract(items, report)

    if args.write:
        write_extract(payload, args.out)
        write_extract({"report": payload["report"]}, report_path)

    if args.json_report:
        print(json.dumps(payload["report"], ensure_ascii=False, indent=2))
    else:
        print(_human_summary(report, args.write, args.out, report_path))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
