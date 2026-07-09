"""Regression tests for the legacy Foxy-X API wrapper.

These tests pin the intended HTTP semantics of the old root-level FastAPI
surface so accidental exception swallowing does not silently turn 400s into
500s.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.index import app


def test_process_event_returns_400_for_unregistered_student():
    client = TestClient(app)

    res = client.post(
        "/api/py/events/process",
        json={
            "student_id": "missing-student",
            "action": {"type": "quiz_submit"},
        },
    )

    assert res.status_code == 400
    assert res.json()["detail"] == "Student not registered."
