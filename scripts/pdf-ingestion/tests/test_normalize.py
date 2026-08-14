"""NFC, dehyphenation, ligature repair, boilerplate stripping, scanned pages."""

from __future__ import annotations

import unicodedata

import pytest

from extractor.normalize import (
    dehyphenate,
    estimate_tokens,
    join_lines,
    normalize_pages,
    normalize_text,
    split_sentences,
    strip_boilerplate,
)
from extractor.reader import DEFAULT_MIN_PAGE_CHARS, PageBlocks
from extractor.taxonomy import is_boilerplate_line

from _testsupport import BODY, line, page, stack_lines


# ---------------------------------------------------------------------------
# NFC -- must happen before anything else
# ---------------------------------------------------------------------------
# U+0958 DEVANAGARI LETTER QA is a Unicode *composition exclusion*: NFC maps it
# to the two-codepoint sequence U+0915 U+093C (KA + NUKTA). Both forms render
# identically and PDF text layers emit either one depending on the producer, so
# this is the exact case that silently splits FTS tokens and embeddings in two.
QA_PRECOMPOSED = "क़"
QA_NFC = "क़"


def test_precomposed_devanagari_is_normalized_to_nfc():
    source = QA_PRECOMPOSED + "िताब"
    assert not unicodedata.is_normalized("NFC", source)
    out = normalize_text(source)
    assert unicodedata.is_normalized("NFC", out)
    assert out == unicodedata.normalize("NFC", source)
    assert out.startswith(QA_NFC)


def test_nfc_makes_visually_identical_hindi_hash_identically():
    from extractor.emit import content_sha256
    from extractor.units import Unit

    def make(text):
        return Unit(
            unit_type="concept_explanation",
            content=normalize_text(text),
            title="t",
            heading_path="h",
            page_start=1,
            page_end=1,
            signal="weak",
            language="hi",
        )

    a = QA_PRECOMPOSED + "िताब"
    b = QA_NFC + "िताब"
    assert a != b, "the two forms must start out as different byte sequences"
    assert content_sha256(make(a)) == content_sha256(make(b))


def test_zwnj_and_zwj_survive_normalization():
    """Deleting them would corrupt Devanagari conjuncts."""
    text = "क‍ष और क‌ष"
    assert "‍" in normalize_text(text)
    assert "‌" in normalize_text(text)


def test_zero_width_space_and_bom_are_removed():
    assert normalize_text("a​b﻿c") == "abc"


# ---------------------------------------------------------------------------
# Ligatures + dehyphenation
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "source,expected",
    [("efﬁcient", "efficient"), ("inﬂammable", "inflammable"), ("diﬀer", "differ")],
)
def test_ligatures_are_repaired(source, expected):
    assert normalize_text(source) == expected


def test_dehyphenation_across_a_line_break():
    assert dehyphenate("respira-\ntion") == "respiration"


def test_dehyphenation_handles_chained_breaks():
    assert dehyphenate("pho-\ntosyn-\nthesis") == "photosynthesis"


def test_dehyphenation_does_not_eat_a_real_hyphenated_compound():
    assert dehyphenate("well-known fact") == "well-known fact"


def test_join_lines_dehyphenates_then_flattens():
    assert join_lines(["Anaerobic respira-", "tion releases energy."]) == (
        "Anaerobic respiration releases energy."
    )


def test_soft_hyphen_is_always_removed():
    assert normalize_text("respira­tion") == "respiration"


# ---------------------------------------------------------------------------
# Boilerplate -- the "202 BIOLOGY" defect
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "text",
    ["202 BIOLOGY", "126", "114 MATHEMATICS", "BIOLOGY 202", "Reprint 2025-26", "Page 12"],
)
def test_known_pollution_values_are_recognised_as_boilerplate(text):
    assert is_boilerplate_line(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "Respiration releases energy from glucose.",
        "6.2 Respiration",
        "Anaerobic respiration",
    ],
)
def test_real_content_is_not_boilerplate(text):
    assert is_boilerplate_line(text) is False


def test_page_furniture_is_stripped_from_the_line_stream():
    pages = [
        page(
            [
                line("202 BIOLOGY", top=10, height=10),
                line("Respiration releases energy from glucose.", top=300, height=12),
                line("Reprint 2025-26", top=770, height=10),
            ],
            number=n,
        )
        for n in (1, 2, 3)
    ]
    report = strip_boilerplate(pages)
    assert report.lines_stripped == 6
    assert all(len(p.lines) == 1 for p in pages)
    assert "202 BIOLOGY" in report.samples


def test_repeated_running_header_is_stripped_by_frequency_not_regex():
    """A book-specific header no regex could know about."""
    header = "Life Processes and You"
    assert is_boilerplate_line(header) is False
    pages = [
        page(
            [
                line(header, top=8, height=10),
                line(f"Body prose on page {n} about respiration.", top=300, height=12),
            ],
            number=n,
        )
        for n in range(1, 6)
    ]
    report = strip_boilerplate(pages)
    assert report.lines_stripped == 5
    assert all(header not in ln.text for p in pages for ln in p.lines)


def test_a_repeated_line_in_the_body_area_is_not_stripped():
    """Frequency alone must not delete real repeated prose mid-page."""
    repeated = "Note this carefully before proceeding further."
    pages = [
        page([line(repeated, top=380, height=12), line(f"Prose {n}.", top=400, height=12)], number=n)
        for n in range(1, 6)
    ]
    report = strip_boilerplate(pages)
    assert report.lines_stripped == 0


def test_boilerplate_stripping_skips_pages_already_marked_skipped():
    skipped = page([line("126", top=10, height=10)], number=1)
    skipped.skipped = True
    strip_boilerplate([skipped])
    assert len(skipped.lines) == 1


# ---------------------------------------------------------------------------
# Scanned-page guard -- PER PAGE, never per document
# ---------------------------------------------------------------------------
def test_scanned_page_guard_is_evaluated_per_page():
    """A 40-page doc with 3 scanned plates must report 3, not pass whole."""
    from extractor.reader import Document

    pages = []
    for n in range(1, 41):
        if n in (7, 19, 33):
            blocks = page([line("", top=100)], number=n)
        else:
            blocks = page(stack_lines([("x" * 400, BODY, False)], page=n), number=n)
        if blocks.char_count < DEFAULT_MIN_PAGE_CHARS:
            blocks.skipped = True
            blocks.skip_reason = "low_text_layer"
        pages.append(blocks)

    document = Document("book.pdf", "f" * 64, 40, pages)
    assert [p.page_number for p in document.skipped_pages] == [7, 19, 33]
    assert len(document.live_pages) == 37


def test_page_char_count_ignores_whitespace_only_lines():
    blocks = PageBlocks(page_number=1, lines=[line("   ", top=1), line("ab", top=20)])
    assert blocks.char_count == 2


# ---------------------------------------------------------------------------
# normalize_pages / sentences / tokens
# ---------------------------------------------------------------------------
def test_normalize_pages_drops_lines_that_normalize_to_empty():
    blocks = page([line("​", top=10), line("real prose", top=30)])
    normalize_pages([blocks])
    assert [ln.text for ln in blocks.lines] == ["real prose"]


def test_sentence_split_handles_the_hindi_danda():
    assert split_sentences("यह पहला वाक्य है। यह दूसरा है।") == [
        "यह पहला वाक्य है।",
        "यह दूसरा है।",
    ]


def test_token_estimate_charges_devanagari_more_per_char():
    hindi = "श्वसन एक जैविक प्रक्रिया है जिसमें ऊर्जा मुक्त होती है"
    english = "Respiration is a biological process in which energy is released ok"
    assert len(hindi) < len(english)
    assert estimate_tokens(hindi) > estimate_tokens(english) * 0.9


def test_token_estimate_is_zero_for_empty_text():
    assert estimate_tokens("") == 0
