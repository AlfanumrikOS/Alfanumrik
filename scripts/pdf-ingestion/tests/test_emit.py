"""embedding_text composition, DB allowlists, dedupe and quality scoring."""

from __future__ import annotations

import pytest

from extractor import EXTRACTION_VERSION
from extractor.emit import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_QUESTION_TYPES,
    UNIT_TYPE_MAP,
    ContentItem,
    EmitValidationError,
    RunReport,
    SourceMeta,
    build_extract,
    build_item,
    compose_embedding_text,
    content_sha256,
    dedupe,
    quality_score,
    resolve_types,
    validate_items,
)
from extractor.units import Unit

META = SourceMeta(
    source_document="ncert-x-science.pdf",
    source_hash="a" * 64,
    grade="10",
    subject="Science",
    chapter_number=6,
    chapter_title="Life Processes",
)


def unit(**overrides) -> Unit:
    base = dict(
        unit_type="worked_example",
        content="Glucose is broken down without oxygen to yield ethanol.",
        title="Anaerobic respiration",
        heading_path="Chapter 6 > 6.2 Respiration > Anaerobic",
        page_start=101,
        page_end=101,
        signal="strong",
        language="en",
        answer=None,
    )
    base.update(overrides)
    return Unit(**base)


# ---------------------------------------------------------------------------
# embedding_text -- SHORT by design
# ---------------------------------------------------------------------------
def test_embedding_text_has_the_exact_terse_shape():
    text = compose_embedding_text(
        unit(answer="Ethanol and carbon dioxide are produced."), META
    )
    assert text.splitlines() == [
        "Grade 10 Science — Chapter 6: Life Processes",
        "Anaerobic respiration — worked example",
        "Glucose is broken down without oxygen to yield ethanol.",
        "Answer: Ethanol and carbon dioxide are produced.",
    ]


def test_embedding_text_omits_the_answer_line_when_there_is_no_answer():
    text = compose_embedding_text(unit(), META)
    assert "Answer:" not in text
    assert len(text.splitlines()) == 3


@pytest.mark.parametrize("banned", ["Board:", "Grade:", "Subject:", "Chapter:", "Type:", "Title:"])
def test_embedding_text_carries_no_label_scaffolding(banned):
    """Shared boilerplate inflates absolute cosine against a 0.22 floor."""
    text = compose_embedding_text(unit(answer="x = 4"), META)
    assert banned not in text


def test_embedding_text_never_says_cbse():
    """Board is always CBSE -- it discriminates nothing and costs every vector."""
    assert "CBSE" not in compose_embedding_text(unit(), META)


def test_embedding_text_header_is_at_most_two_lines():
    text = compose_embedding_text(unit(), META)
    body_start = text.index(unit().content)
    assert text[:body_start].count("\n") == 2


def test_embedding_text_omits_missing_components_without_dangling_separators():
    bare = SourceMeta(source_document="x.pdf", source_hash="b" * 64)
    text = compose_embedding_text(unit(title=""), bare)
    assert not text.startswith("—")
    assert " —  " not in text
    assert text.splitlines()[0] == "worked example"


def test_embedding_text_uses_terse_type_labels_not_raw_enum_names():
    assert "qa pair" not in compose_embedding_text(unit(unit_type="qa_pair"), META)
    assert "— question" in compose_embedding_text(unit(unit_type="qa_pair"), META)


def test_embedding_text_is_truncated_but_content_is_not():
    long_text = "sentence. " * 5000
    item = build_item(unit(unit_type="worked_example", content=long_text), META)
    assert len(item.embedding_text) <= 8000
    assert item.content == long_text


# ---------------------------------------------------------------------------
# DB CHECK-constraint allowlists
# ---------------------------------------------------------------------------
def test_every_unit_type_maps_inside_the_db_allowlists():
    for unit_type, (content_type, question_type) in UNIT_TYPE_MAP.items():
        assert content_type in ALLOWED_CONTENT_TYPES, unit_type
        assert question_type is None or question_type in ALLOWED_QUESTION_TYPES, unit_type


@pytest.mark.parametrize(
    "unit_type,expected",
    [
        ("concept_explanation", ("content", None)),
        ("definition", ("content", None)),
        ("worked_example", ("content", "example")),
        ("mcq", ("qa", "mcq")),
        ("diagram_caption", ("diagram", None)),
        ("table", ("content", None)),
    ],
)
def test_resolve_types(unit_type, expected):
    assert resolve_types(unit(unit_type=unit_type)) == expected


def test_qa_pair_is_exercise_under_an_exercise_heading_else_intext():
    assert resolve_types(unit(unit_type="qa_pair", in_exercise=True)) == ("qa", "exercise")
    assert resolve_types(unit(unit_type="qa_pair", in_exercise=False)) == ("qa", "intext")


def test_unknown_unit_type_is_rejected_before_write():
    with pytest.raises(EmitValidationError):
        resolve_types(unit(unit_type="freeform_notes"))


def test_validate_items_rejects_an_out_of_allowlist_content_type():
    item = build_item(unit(), META)
    item.content_type = "lesson"
    with pytest.raises(EmitValidationError, match="chk_rag_content_type"):
        validate_items([item])


def test_validate_items_rejects_an_out_of_allowlist_question_type():
    item = build_item(unit(), META)
    item.question_type = "very_long_answer"
    with pytest.raises(EmitValidationError, match="chk_rag_question_type"):
        validate_items([item])


def test_validate_items_rejects_an_integer_grade():
    """P5: grades are strings "6".."12", never integers."""
    item = build_item(unit(), META)
    item.grade = 10
    with pytest.raises(EmitValidationError, match="grade must be a string"):
        validate_items([item])


# ---------------------------------------------------------------------------
# Dedupe
# ---------------------------------------------------------------------------
def test_identical_units_share_a_sha_and_collapse():
    items = [build_item(unit(), META), build_item(unit(), META)]
    assert items[0].content_sha256 == items[1].content_sha256
    kept, hits = dedupe(items)
    assert (len(kept), hits) == (1, 1)


def test_same_stem_with_different_answers_does_not_collapse():
    a = build_item(unit(unit_type="qa_pair", answer="four"), META)
    b = build_item(unit(unit_type="qa_pair", answer="five"), META)
    assert a.content_sha256 != b.content_sha256
    assert dedupe([a, b])[1] == 0


def test_sha_is_metadata_independent():
    other = SourceMeta(source_document="other.pdf", source_hash="c" * 64, grade="9")
    assert content_sha256(unit()) == content_sha256(unit())
    assert build_item(unit(), META).content_sha256 == build_item(unit(), other).content_sha256


# ---------------------------------------------------------------------------
# quality_score -- must be a real lever, not one constant
# ---------------------------------------------------------------------------
def test_strong_resolved_and_long_scores_top_tier():
    long_content = " ".join(["word"] * 45)
    assert quality_score(unit(content=long_content, signal="strong")) == 0.8


def test_weak_signal_scores_mid_tier():
    long_content = " ".join(["word"] * 45)
    assert quality_score(unit(content=long_content, signal="weak")) == 0.6


def test_short_unit_cannot_reach_the_top_tier():
    assert quality_score(unit(content="Too short.", signal="strong")) == 0.6


def test_missing_heading_cannot_reach_the_top_tier():
    long_content = " ".join(["word"] * 45)
    assert quality_score(unit(content=long_content, signal="strong", heading_path="")) == 0.6


def test_unreviewed_diagram_caption_scores_lowest():
    assert quality_score(unit(unit_type="diagram_caption")) == 0.3


def test_quality_scores_are_not_all_the_same_value():
    """The production defect being fixed: every non-null value was exactly 0.7."""
    long_content = " ".join(["word"] * 45)
    scores = {
        quality_score(unit(content=long_content, signal="strong")),
        quality_score(unit(content=long_content, signal="weak")),
        quality_score(unit(unit_type="diagram_caption")),
    }
    assert len(scores) == 3
    assert 0.7 not in scores


# ---------------------------------------------------------------------------
# Output contract
# ---------------------------------------------------------------------------
REQUIRED_FIELDS = (
    "unit_type",
    "content",
    "embedding_text",
    "answer",
    "title",
    "heading_path",
    "page_start",
    "page_end",
    "content_sha256",
    "source_document",
    "source_hash",
    "language",
    "content_type",
    "question_type",
    "needs_review",
    "quality_score",
)


def test_extract_json_is_versioned_and_carries_every_required_field():
    items = [build_item(unit(), META)]
    payload = build_extract(items, RunReport(source_document="x.pdf", source_hash="d" * 64))
    assert payload["extraction_version"] == EXTRACTION_VERSION == "pdf_ingest/1.0.0"
    assert payload["report"]["extraction_version"] == EXTRACTION_VERSION
    record = payload["units"][0]
    for field_name in REQUIRED_FIELDS:
        assert field_name in record, field_name


def test_content_item_is_json_serializable():
    import json

    payload = build_extract(
        [build_item(unit(), META)], RunReport(source_document="x.pdf", source_hash="e" * 64)
    )
    assert json.loads(json.dumps(payload, ensure_ascii=False))["units"][0]["page_start"] == 101


def test_content_item_field_names_do_not_drift_from_the_contract():
    fields = set(ContentItem.__dataclass_fields__)
    assert set(REQUIRED_FIELDS) <= fields
