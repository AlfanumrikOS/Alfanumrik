"""Static guard on the Phase-2 hard constraints.

Phase 2 is pure local file-in / file-out. If any of these fail, the tool has
grown a capability it was explicitly scoped not to have.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

PACKAGE = pathlib.Path(__file__).resolve().parent.parent / "extractor"
SOURCES = sorted(PACKAGE.glob("*.py"))

FORBIDDEN_MODULES = {
    # network
    "requests",
    "httpx",
    "urllib",
    "urllib3",
    "http",
    "socket",
    "aiohttp",
    "websockets",
    "ftplib",
    "smtplib",
    "telnetlib",
    # database
    "supabase",
    "postgrest",
    "psycopg",
    "psycopg2",
    "asyncpg",
    "sqlalchemy",
    "sqlite3",
    # LLM / embeddings — Phase 2 is heuristics-only
    "openai",
    "anthropic",
    "voyageai",
    "cohere",
    "mistralai",
    "transformers",
    "sentence_transformers",
    # OCR — deliberately never added; see CLAUDE.md
    "pytesseract",
    "tesserocr",
    "easyocr",
    "paddleocr",
    # AGPL PDF backend — licensing call not made
    "fitz",
    "pymupdf",
}


def _imported_roots(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
    return roots


def test_sources_are_discovered():
    assert {p.name for p in SOURCES} >= {
        "reader.py",
        "taxonomy.py",
        "units.py",
        "normalize.py",
        "emit.py",
        "cli.py",
    }


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_network_db_llm_or_ocr_imports(path):
    offenders = _imported_roots(path) & FORBIDDEN_MODULES
    assert not offenders, f"{path.name} imports forbidden module(s): {sorted(offenders)}"


@pytest.mark.parametrize("path", SOURCES, ids=lambda p: p.name)
def test_no_hardcoded_urls(path):
    text = path.read_text(encoding="utf-8")
    for scheme in ("https://api.", "http://", "postgres://", "postgresql://"):
        assert scheme not in text, f"{path.name} contains a {scheme} literal"


def test_pdfplumber_is_the_only_third_party_import_and_it_is_lazy():
    """The PDF library must stay behind the reader adapter, imported lazily."""
    reader = (PACKAGE / "reader.py").read_text(encoding="utf-8")
    assert "import pdfplumber" in reader
    module_level = [
        node
        for node in ast.parse(reader).body
        if isinstance(node, (ast.Import, ast.ImportFrom))
    ]
    names = {
        alias.name.split(".")[0]
        for node in module_level
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "pdfplumber" not in names, "pdfplumber must be imported lazily inside read()"

    for path in SOURCES:
        if path.name == "reader.py":
            continue
        assert "pdfplumber" not in _imported_roots(path), path.name


def test_dry_run_is_the_cli_default():
    from extractor.cli import build_parser

    args = build_parser().parse_args(["book.pdf"])
    assert args.write is False


def test_write_requires_an_explicit_flag():
    from extractor.cli import build_parser

    assert build_parser().parse_args(["book.pdf", "--write"]).write is True


def test_dry_run_and_write_together_are_rejected():
    from extractor.cli import main

    assert main(["book.pdf", "--dry-run", "--write"]) == 2


def test_cli_rejects_a_non_string_grade_choice():
    from extractor.cli import build_parser

    with pytest.raises(SystemExit):
        build_parser().parse_args(["book.pdf", "--grade", "13"])


def test_no_llm_fallback_is_wired():
    """The classify-only seam exists but must not be populated in Phase 2."""
    from extractor import units

    source = (PACKAGE / "units.py").read_text(encoding="utf-8")
    assert "fallback: ClassifierFallback | None = None" in source
    assert units.classify_unit("some prose here").unit_type == "concept_explanation"
