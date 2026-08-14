"""Taxonomy classification, atomicity, budget splitting and heading detection."""

from __future__ import annotations

import pytest

from extractor import units as U
from extractor.reader import ImageBlock, TableBlock
from extractor.units import (
    budget_split,
    build_units,
    classify_unit,
    detect_headings,
    pair_answers,
    split_units,
)

from _testsupport import BODY, H1, H2, document, line, page, stack_lines


# ---------------------------------------------------------------------------
# classify_unit -- English taxonomy
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "text,expected",
    [
        ("Q1. What is respiration?", "qa_pair"),
        ("Question 3: Define osmosis.", "qa_pair"),
        ("1. Name the process of energy release in cells.", "qa_pair"),
        ("7) State Ohm's law.", "qa_pair"),
        ("Example 2: Find the value of x when 2x + 3 = 11.", "worked_example"),
        ("Worked Example 5 - A body falls freely from rest.", "worked_example"),
        ("Definition: Osmosis is the movement of solvent molecules.", "definition"),
        ("Theorem: The sum of angles of a triangle is 180 degrees.", "definition"),
        ("Note - always balance the chemical equation first.", "definition"),
        ("Remember: mass is conserved in every chemical reaction.", "definition"),
        (
            "Photosynthesis is the process by which green plants make food using "
            "sunlight, water and carbon dioxide.",
            "concept_explanation",
        ),
    ],
)
def test_classify_english(text, expected):
    assert classify_unit(text).unit_type == expected


@pytest.mark.parametrize(
    "text",
    [
        "Q4. Which of the following is a plant hormone?",
        "Choose the correct option: the powerhouse of the cell is",
        "2. The SI unit of force is (a) joule (b) newton (c) watt (d) pascal",
    ],
)
def test_classify_mcq(text):
    assert classify_unit(text).unit_type == "mcq"


def test_four_option_markers_force_mcq_even_without_quiz_phrase():
    text = "5. The value of g on earth is (a) 9.8 (b) 8.9 (c) 10.8 (d) 1.6"
    result = classify_unit(text)
    assert result.unit_type == "mcq"
    assert result.option_hits >= U.tx.MIN_OPTION_HITS_FOR_MCQ


def test_three_option_markers_stay_qa_pair():
    text = "5. Give three examples: (a) one (b) two (c) three"
    result = classify_unit(text)
    assert result.unit_type == "qa_pair"
    assert result.option_hits < U.tx.MIN_OPTION_HITS_FOR_MCQ


# ---------------------------------------------------------------------------
# classify_unit -- Devanagari siblings (P7). Without these every Hindi unit
# silently falls through to concept_explanation.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "text,expected",
    [
        ("प्रश्न 1: श्वसन किसे कहते हैं?", "qa_pair"),
        ("उदाहरण 2: x का मान ज्ञात कीजिए।", "worked_example"),
        ("परिभाषा: परासरण विलायक अणुओं की गति है।", "definition"),
        ("प्रमेय: त्रिभुज के कोणों का योग 180 अंश होता है।", "definition"),
        ("निम्नलिखित में से कौन सा पादप हार्मोन है?", "mcq"),
        (
            "प्रकाश संश्लेषण वह प्रक्रिया है जिसके द्वारा हरे पौधे भोजन बनाते हैं।",
            "concept_explanation",
        ),
    ],
)
def test_classify_devanagari(text, expected):
    assert classify_unit(text).unit_type == expected


def test_hindi_question_is_not_misclassified_as_unknown_prose():
    """Regression guard for the English-only taxonomy defect."""
    assert classify_unit("प्रश्न 4: उत्तर दीजिए।").signal == "strong"


def test_language_detection_marks_hindi_units():
    doc = document([page(stack_lines([("प्रश्न 1: श्वसन किसे कहते हैं?", BODY, False)]))])
    out = build_units(doc)
    assert out[0].language == "hi"


def test_language_detection_marks_english_units():
    doc = document([page(stack_lines([("Q1. What is respiration?", BODY, False)]))])
    assert build_units(doc)[0].language == "en"


# ---------------------------------------------------------------------------
# Structural sources bypass the text taxonomy
# ---------------------------------------------------------------------------
def test_table_source_classifies_structurally():
    result = classify_unit("Metal | Reactivity", source="table")
    assert (result.unit_type, result.signal) == ("table", "structural")


def test_image_source_classifies_structurally():
    result = classify_unit("Fig. 6.2 Human respiratory system", source="image")
    assert (result.unit_type, result.signal) == ("diagram_caption", "structural")


# ---------------------------------------------------------------------------
# Heading detection -- font size percentile + bold, NOT an ALL-CAPS regex
# ---------------------------------------------------------------------------
def test_headings_detected_by_font_size_not_caps():
    lines = stack_lines(
        [
            ("Life Processes", H1, True),
            ("6.2 Respiration", H2, True),
            (
                "Respiration is the process of releasing energy from food inside "
                "the living cells of an organism.",
                BODY,
                False,
            ),
        ]
    )
    detect_headings([page(lines)])
    assert [ln.is_heading for ln in lines] == [True, True, False]
    assert lines[0].heading_level < lines[1].heading_level


def test_all_caps_body_text_is_not_a_heading():
    """ALL-CAPS at body size must NOT be promoted -- that heuristic is banned."""
    lines = stack_lines(
        [
            ("Life Processes", H1, True),
            ("NOTE THAT ATP IS THE ENERGY CURRENCY OF THE CELL", BODY, False),
        ]
    )
    detect_headings([page(lines)])
    assert lines[1].is_heading is False


def test_long_large_font_line_is_not_a_heading():
    lines = stack_lines([("x" * 200, H1, True), ("body text here", BODY, False)])
    detect_headings([page(lines)])
    assert lines[0].is_heading is False


# ---------------------------------------------------------------------------
# heading_path
# ---------------------------------------------------------------------------
def test_heading_path_is_carried_as_metadata():
    lines = stack_lines(
        [
            ("6.2 Respiration", H1, True),
            ("Anaerobic", H2, True),
            (
                "In anaerobic respiration glucose breaks down without oxygen to "
                "form ethanol and carbon dioxide.",
                BODY,
                False,
            ),
        ]
    )
    out = build_units(document([page(lines)]), chapter_number=6)
    assert out[0].heading_path == "Chapter 6 > 6.2 Respiration > Anaerobic"
    assert out[0].title == "Anaerobic"


def test_heading_path_pops_siblings_at_same_level():
    lines = stack_lines(
        [
            ("6.2 Respiration", H2, True),
            ("Aerobic respiration uses oxygen to release energy.", BODY, False),
            ("6.3 Transportation", H2, True),
            ("Blood carries oxygen around the body of the organism.", BODY, False),
        ],
        gap_before={2: 40.0},
    )
    out = build_units(document([page(lines)]), chapter_number=6)
    paths = [unit.heading_path for unit in out]
    assert paths == ["Chapter 6 > 6.2 Respiration", "Chapter 6 > 6.3 Transportation"]


# ---------------------------------------------------------------------------
# Answer pairing
# ---------------------------------------------------------------------------
def test_answer_in_following_segment_is_paired_and_not_orphaned():
    lines = stack_lines(
        [
            ("Q1. What is respiration?", BODY, False),
            ("Answer: Respiration is the release of energy from glucose.", BODY, False),
        ]
    )
    out = build_units(document([page(lines)]))
    assert len(out) == 1
    assert out[0].unit_type == "qa_pair"
    assert out[0].answer == "Respiration is the release of energy from glucose."


def test_inline_answer_is_split_from_the_question():
    text = "Q1. What is respiration? Ans: energy release from glucose."
    out = build_units(document([page(stack_lines([(text, BODY, False)]))]))
    assert out[0].content == "Q1. What is respiration?"
    assert out[0].answer == "energy release from glucose."


def test_worked_example_pairs_with_solution_block():
    lines = stack_lines(
        [
            ("Example 2: Solve 2x + 3 = 11.", BODY, False),
            ("Solution: 2x = 8, therefore x = 4.", BODY, False),
        ]
    )
    out = build_units(document([page(lines)]))
    assert len(out) == 1
    assert out[0].unit_type == "worked_example"
    assert out[0].answer == "2x = 8, therefore x = 4."


def test_hindi_answer_marker_pairs():
    lines = stack_lines(
        [
            ("प्रश्न 1: श्वसन किसे कहते हैं?", BODY, False),
            ("उत्तर: ग्लूकोज़ से ऊर्जा मुक्त होने की प्रक्रिया।", BODY, False),
        ]
    )
    out = build_units(document([page(lines)]))
    assert len(out) == 1
    assert out[0].answer == "ग्लूकोज़ से ऊर्जा मुक्त होने की प्रक्रिया।"


def test_orphan_answer_is_kept_not_dropped():
    lines = stack_lines([("Answer: 42 is the value of x.", BODY, False)])
    raw = split_units(document([page(lines)]))
    paired = pair_answers(raw, [classify_unit(u.text) for u in raw])
    assert len(paired) == 1
    assert "42" in paired[0].text


def test_unpaired_question_is_flagged_for_review():
    out = build_units(
        document([page(stack_lines([("Q9. Explain the nitrogen cycle in detail.", BODY, False)]))])
    )
    assert out[0].needs_review is True
    assert "no paired answer" in (out[0].review_reason or "")


# ---------------------------------------------------------------------------
# ATOMICITY -- the single most important rule in this file
# ---------------------------------------------------------------------------
LONG_SOLUTION = " ".join(
    [f"Step {n}: substitute the value and simplify the expression carefully." for n in range(1, 60)]
)


@pytest.mark.parametrize(
    "unit_type", ["worked_example", "qa_pair", "mcq", "definition", "table", "diagram_caption"]
)
def test_atomic_types_are_never_budget_split(unit_type):
    assert budget_split(LONG_SOLUTION, unit_type, "Heading", budget=50) == [LONG_SOLUTION]


def test_worked_example_stays_atomic_end_to_end_at_a_tiny_budget():
    lines = stack_lines(
        [
            (f"Example 4: {LONG_SOLUTION}", BODY, False),
            ("Solution: x equals four.", BODY, False),
        ]
    )
    out = build_units(document([page(lines)]), budget=20)
    assert len(out) == 1
    assert out[0].part_total == 1
    assert out[0].answer == "x equals four."


# ---------------------------------------------------------------------------
# Budget splitting -- concept_explanation only, with ONE-SENTENCE OVERLAP
# ---------------------------------------------------------------------------
def _sentences(n: int) -> str:
    return " ".join(f"Sentence number {i} explains a distinct idea clearly." for i in range(n))


def test_concept_explanation_is_budget_split():
    parts = budget_split(_sentences(40), "concept_explanation", None, budget=40)
    assert len(parts) > 1


def test_budget_split_has_one_sentence_overlap():
    parts = budget_split(_sentences(40), "concept_explanation", None, budget=40)
    for earlier, later in zip(parts, parts[1:]):
        last_sentence = earlier.rstrip().rsplit(".", 2)[-2].strip() + "."
        assert later.startswith(last_sentence), (last_sentence, later[:80])


def test_every_sub_chunk_is_prefixed_with_the_owning_heading():
    parts = budget_split(_sentences(40), "concept_explanation", "Anaerobic respiration", budget=40)
    assert len(parts) > 1
    assert all(part.startswith("Anaerobic respiration") for part in parts)


def test_unsplit_concept_is_not_heading_prefixed():
    text = "Respiration releases energy from glucose."
    assert budget_split(text, "concept_explanation", "Respiration", budget=500) == [text]


def test_single_oversized_sentence_is_not_cut_mid_sentence():
    sentence = "word " * 400 + "end."
    parts = budget_split(sentence.strip(), "concept_explanation", None, budget=50)
    assert len(parts) == 1


def test_part_index_and_total_are_recorded():
    lines = stack_lines([("6.2 Respiration", H1, True), (_sentences(40), BODY, False)])
    out = build_units(document([page(lines)]), budget=40)
    assert out[0].part_total > 1
    assert [unit.part_index for unit in out] == list(range(len(out)))


# ---------------------------------------------------------------------------
# Exercise vs in-text question_type driver
# ---------------------------------------------------------------------------
def test_question_under_exercises_heading_is_marked_in_exercise():
    lines = stack_lines(
        [("EXERCISES", H1, True), ("Q1. Define transpiration clearly.", BODY, False)]
    )
    out = build_units(document([page(lines)]))
    assert out[0].in_exercise is True


def test_question_outside_exercises_is_not_marked():
    lines = stack_lines(
        [("6.2 Respiration", H1, True), ("Q1. Define transpiration clearly.", BODY, False)]
    )
    assert build_units(document([page(lines)]))[0].in_exercise is False


# ---------------------------------------------------------------------------
# Tables and diagram captions
# ---------------------------------------------------------------------------
def test_table_becomes_a_table_unit():
    table = TableBlock(rows=[["Metal", "Reactivity"], ["K", "High"]], page_number=1)
    doc = document([page(stack_lines([("Reactivity series", H1, True)]), tables=[table])])
    out = build_units(doc)
    assert any(unit.unit_type == "table" for unit in out)
    table_unit = next(unit for unit in out if unit.unit_type == "table")
    assert "Metal | Reactivity" in table_unit.content


def test_image_with_caption_becomes_a_diagram_caption():
    image = ImageBlock(page_number=1, x0=72, x1=400, top=100, bottom=200)
    caption = line("Fig. 6.2 Human respiratory system", top=205, height=12)
    doc = document([page([caption], images=[image])])
    out = build_units(doc)
    diagram = [unit for unit in out if unit.unit_type == "diagram_caption"]
    assert diagram and diagram[0].content.startswith("Fig. 6.2")
    assert diagram[0].needs_review is True


def test_image_with_no_nearby_text_emits_no_unit():
    image = ImageBlock(page_number=1, x0=72, x1=400, top=100, bottom=200)
    far = line("unrelated body prose far below the figure", top=600, height=12)
    doc = document([page([far], images=[image])])
    out = build_units(doc)
    assert not [unit for unit in out if unit.unit_type == "diagram_caption"]


def test_table_rows_are_not_flattened_into_one_line():
    """Regression: join_lines() collapsed every row into a single mashed line."""
    table = TableBlock(
        rows=[["Organism", "Product"], ["Yeast", "Ethanol"], ["Muscle", "Lactic acid"]],
        page_number=1,
    )
    out = build_units(document([page([], tables=[table])]))
    content = next(unit for unit in out if unit.unit_type == "table").content
    assert content == "Organism | Product\nYeast | Ethanol\nMuscle | Lactic acid"


def test_caption_is_claimed_and_never_emitted_twice():
    """Regression: the caption appeared as BOTH a diagram_caption and prose."""
    image = ImageBlock(page_number=1, x0=72, x1=400, top=100, bottom=200)
    caption = line("Fig. 6.2 Human respiratory system", top=205, height=12)
    out = build_units(document([page([caption], images=[image])]))
    assert len(out) == 1
    assert out[0].unit_type == "diagram_caption"


def test_uncaptioned_image_does_not_swallow_adjacent_prose():
    """An arbitrary nearby line must not be invented as a caption."""
    image = ImageBlock(page_number=1, x0=72, x1=400, top=100, bottom=200)
    prose = line("Glucose is broken down inside the mitochondria of the cell.", top=210, height=12)
    out = build_units(document([page([prose], images=[image])]))
    assert [unit.unit_type for unit in out] == ["concept_explanation"]
    assert out[0].content.startswith("Glucose is broken down")


def test_empty_table_emits_no_unit():
    table = TableBlock(rows=[[None, ""], ["", None]], page_number=1)
    out = build_units(document([page([], tables=[table])]))
    assert not [unit for unit in out if unit.unit_type == "table"]


def test_prose_under_a_resolved_heading_is_promoted_to_a_strong_signal():
    """Otherwise concept_explanation could never reach the 0.8 quality tier."""
    lines = stack_lines(
        [("6.2 Respiration", H1, True), ("Respiration releases energy from glucose.", BODY, False)]
    )
    assert build_units(document([page(lines)]))[0].signal == "strong"


def test_prose_with_no_resolved_heading_stays_weak():
    lines = stack_lines([("Respiration releases energy from glucose in cells.", BODY, False)])
    assert build_units(document([page(lines)]))[0].signal == "weak"


# ---------------------------------------------------------------------------
# Skipped pages contribute nothing
# ---------------------------------------------------------------------------
def test_skipped_pages_are_not_unitised():
    live = page(stack_lines([("Respiration releases energy from glucose in cells.", BODY, False)]), number=1)
    scanned = page(stack_lines([("garbled", BODY, False)], page=2), number=2)
    scanned.skipped = True
    scanned.skip_reason = "low_text_layer"
    out = build_units(document([live, scanned]))
    assert all(unit.page_start == 1 for unit in out)
