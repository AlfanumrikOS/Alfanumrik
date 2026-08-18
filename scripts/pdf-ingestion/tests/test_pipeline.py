"""End-to-end pipeline over a synthetic document, plus the run report."""

from __future__ import annotations

import json

from extractor.cli import extract_from_document
from extractor.reader import ImageBlock, TableBlock
from extractor.emit import build_extract

from _testsupport import BODY, H1, H2, document, line, page, stack_lines

META = {
    "grade": "10",
    "subject": "Science",
    "chapter_number": 6,
    "chapter_title": "Life Processes",
}


def build_synthetic_document():
    page1_lines = (
        [line("202 BIOLOGY", top=8, height=10)]
        + stack_lines(
            [
                ("6.2 Respiration", H1, True),
                (
                    "Respiration is the process of releasing energy from glucose "
                    "inside living cells. It happens in every living organism at "
                    "all times without exception.",
                    BODY,
                    False,
                ),
                ("Anaerobic", H2, True),
                (
                    "In anaerobic respiration glucose breaks down without oxygen. "
                    "The products are ethanol and carbon dioxide in yeast cells.",
                    BODY,
                    False,
                ),
                ("Example 1: Yeast ferments glucose. Name the products.", BODY, False),
                ("Solution: Ethanol and carbon dioxide are produced.", BODY, False),
            ],
            start_top=60,
            gap_before={4: 40.0, 5: 40.0},
        )
        + [line("Reprint 2025-26", top=770, height=10)]
    )

    page2_lines = [line("202 BIOLOGY", top=8, height=10)] + stack_lines(
        [
            ("EXERCISES", H1, True),
            ("Q1. Define anaerobic respiration in your own words.", BODY, False),
            ("Answer: Energy release from glucose without oxygen.", BODY, False),
            (
                "Q2. Which of the following is produced in yeast? "
                "(a) lactic acid (b) ethanol (c) water (d) starch",
                BODY,
                False,
            ),
        ],
        page=2,
        start_top=60,
        gap_before={3: 40.0},
    )
    table = TableBlock(
        rows=[["Organism", "Product"], ["Yeast", "Ethanol"], ["Muscle", "Lactic acid"]],
        page_number=2,
    )
    image = ImageBlock(page_number=2, x0=72, x1=400, top=500, bottom=600)
    caption = line("Fig. 6.2 Breakdown of glucose", page=2, top=605, height=12)

    scanned = page([line("", page=3, top=100)], number=3)
    scanned.skipped = True
    scanned.skip_reason = "low_text_layer: 0 chars < 200; probable scanned page"

    return document(
        [
            page(page1_lines, number=1),
            page(page2_lines + [caption], number=2, tables=[table], images=[image]),
            scanned,
        ],
        name="ncert-x-science-ch6.pdf",
    )


def run():
    return extract_from_document(build_synthetic_document(), META)


def test_pipeline_emits_the_expected_unit_types():
    items, report = run()
    assert set(report.units_by_type) >= {
        "concept_explanation",
        "worked_example",
        "qa_pair",
        "mcq",
        "table",
        "diagram_caption",
    }
    assert report.units_emitted == len(items)


def test_pipeline_pairs_the_worked_example_with_its_solution():
    items, _ = run()
    example = next(item for item in items if item.unit_type == "worked_example")
    assert example.answer == "Ethanol and carbon dioxide are produced."
    assert example.question_type == "example"
    assert example.content_type == "content"


def test_pipeline_marks_exercise_questions_as_exercise_not_intext():
    items, _ = run()
    qa = next(item for item in items if item.unit_type == "qa_pair")
    assert qa.heading_path == "Chapter 6 > EXERCISES"
    assert (qa.content_type, qa.question_type) == ("qa", "exercise")


def test_pipeline_maps_mcq_to_the_qa_mcq_pair():
    items, _ = run()
    mcq = next(item for item in items if item.unit_type == "mcq")
    assert (mcq.content_type, mcq.question_type) == ("qa", "mcq")


def test_pipeline_strips_running_headers_and_reprint_footers():
    items, report = run()
    assert report.boilerplate_lines_stripped >= 3
    joined = " ".join(item.content for item in items)
    assert "202 BIOLOGY" not in joined
    assert "Reprint 2025-26" not in joined


def test_report_records_every_skipped_page_with_a_reason():
    _, report = run()
    assert len(report.pages_skipped) == 1
    skipped = report.pages_skipped[0]
    assert skipped["page_number"] == 3
    assert "low_text_layer" in skipped["reason"]
    assert skipped["action"] == "manual_review"
    assert any("OCR is deliberately not applied" in w for w in report.warnings)


def test_report_counts_pages_processed_versus_total():
    _, report = run()
    assert (report.pages_processed, report.page_count) == (2, 3)


def test_report_carries_dedupe_and_quality_histogram():
    _, report = run()
    assert report.dedupe_hits >= 0
    assert report.quality_histogram
    assert set(report.quality_histogram) <= {"0.3", "0.6", "0.8"}


def test_every_emitted_item_has_a_terse_two_line_embedding_header():
    items, _ = run()
    for item in items:
        head = item.embedding_text.split("\n")[0]
        assert head == "Grade 10 Science — Chapter 6: Life Processes"
        assert "Board" not in item.embedding_text


def test_no_duplicate_content_reaches_the_output():
    items, report = run()
    shas = [item.content_sha256 for item in items]
    assert len(shas) == len(set(shas))
    captions = [item for item in items if item.content.startswith("Fig. 6.2")]
    assert len(captions) == 1
    assert captions[0].unit_type == "diagram_caption"


def test_table_keeps_its_row_structure_end_to_end():
    items, _ = run()
    table = next(item for item in items if item.unit_type == "table")
    assert table.content.splitlines() == [
        "Organism | Product",
        "Yeast | Ethanol",
        "Muscle | Lactic acid",
    ]


def test_top_quality_tier_is_reachable_end_to_end():
    """quality_score must be a working lever, not a near-constant."""
    from extractor.cli import extract_from_document

    long_prose = " ".join(
        f"Sentence {n} explains one distinct idea about respiration clearly."
        for n in range(1, 12)
    )
    doc = document(
        [page(stack_lines([("6.2 Respiration", H1, True), (long_prose, BODY, False)]))]
    )
    items, report = extract_from_document(doc, META)
    assert items[0].word_count >= 40
    assert items[0].quality_score == 0.8
    assert "0.8" in report.quality_histogram


def test_no_orphan_answer_units_survive():
    items, _ = run()
    from extractor.taxonomy import is_answer_start

    assert not [item for item in items if is_answer_start(item.content)]


def test_extract_payload_round_trips_through_json():
    items, report = run()
    payload = build_extract(items, report)
    restored = json.loads(json.dumps(payload, ensure_ascii=False))
    assert restored["extraction_version"] == "pdf_ingest/1.0.0"
    assert len(restored["units"]) == report.units_emitted


def test_dry_run_writes_nothing(tmp_path, monkeypatch, capsys):
    from extractor import cli

    monkeypatch.setattr(
        cli, "extract", lambda *a, **k: extract_from_document(build_synthetic_document(), META)
    )
    out = tmp_path / "extract.json"
    assert cli.main(["fake.pdf", "--out", str(out)]) == 0
    assert not out.exists()
    assert "DRY RUN" in capsys.readouterr().out


def test_write_flag_persists_both_files(tmp_path, monkeypatch, capsys):
    from extractor import cli

    monkeypatch.setattr(
        cli, "extract", lambda *a, **k: extract_from_document(build_synthetic_document(), META)
    )
    out = tmp_path / "extract.json"
    assert cli.main(["fake.pdf", "--out", str(out), "--write"]) == 0
    assert out.exists()
    assert (tmp_path / "extract.report.json").exists()
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["extraction_version"] == "pdf_ingest/1.0.0"
    assert "WROTE" in capsys.readouterr().out
