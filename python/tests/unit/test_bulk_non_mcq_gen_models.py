"""Unit tests for Pydantic models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.ai.business.bulk_non_mcq_gen.models import BulkGenRequest, BulkGenResponse


def test_request_defaults():
    r = BulkGenRequest()
    assert r.question_type == "short_answer"
    assert r.batch_size == 5
    assert r.dry_run is False
    assert r.grade is None


def test_request_grade_string():
    r = BulkGenRequest(grade="9")
    assert r.grade == "9"
    assert isinstance(r.grade, str)


def test_request_empty_grade_to_none():
    r = BulkGenRequest(grade="")
    assert r.grade is None


def test_request_question_type_values():
    for qt in ["short_answer", "long_answer", "fill_blank"]:
        r = BulkGenRequest(question_type=qt)
        assert r.question_type == qt


def test_request_invalid_question_type():
    with pytest.raises(ValidationError):
        BulkGenRequest(question_type="mcq")


def test_request_batch_size_clamp():
    with pytest.raises(ValidationError):
        BulkGenRequest(batch_size=0)
    with pytest.raises(ValidationError):
        BulkGenRequest(batch_size=21)


def test_response_phase_2_stub_default_true():
    r = BulkGenResponse()
    assert r.phase_2_stub is True
    assert r.success is True
    assert r.question_type == "short_answer"


def test_response_extra_forbidden():
    with pytest.raises(ValidationError):
        BulkGenResponse(unknown_field="x")
