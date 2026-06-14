"""Pipeline orchestrator for POST /v1/parent-report-generator.

Six-step pipeline mirroring TS (skipping the Claude call - template path
is the Python primary, identical to what students see when Claude fails
on the TS side):
  1. Bearer JWT - guardian verification.
  2. Validate parent-student link in parent_student_links.
  3. Fetch student name + week-window data (quiz, foxy, profile, mastery).
  4. Compute WeeklyStats (pure).
  5. Build report from bilingual template (Phase 2.5 will add MoL variant).
  6. Return ParentReportResponse.

P13: never logs the report contents, only structural metadata (stat
counters + counts).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import structlog

from .auth import AuthFailed, verify_guardian
from .models import (
    ParentReportRequest,
    ParentReportResponse,
    WeeklyReport,
    WeeklyStats,
)
from .repository import (
    RepositoryError,
    fetch_concept_mastery,
    fetch_foxy_sessions,
    fetch_learning_profile,
    fetch_quiz_sessions,
    fetch_student_name,
    verify_guardian_student_link,
)
from .stats import compute_weekly_stats
from .templates import build_template_report

logger = structlog.get_logger(__name__)


class HandlerError(Exception):
    def __init__(self, label: str, *, status: int) -> None:
        super().__init__(label)
        self.label = label
        self.status = status


class UnauthorizedError(HandlerError):
    pass


class GuardianNotLinkedError(HandlerError):
    pass


async def build_parent_report(
    payload: ParentReportRequest,
    *,
    authorization_header: str | None,
    request_id: str | None = None,
) -> ParentReportResponse:
    """Run the full template-path pipeline.

    Raises UnauthorizedError (401/403/503) or GuardianNotLinkedError (403)
    or HandlerError (500). All errors carry TS-shaped label.
    """
    rid = request_id or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(
        request_id=rid, student_id=payload.student_id, language=payload.language
    )
    try:
        try:
            guardian = await verify_guardian(authorization_header)
        except AuthFailed as err:
            raise UnauthorizedError(
                "unauthorized" if err.status in (401, 403) else "server_misconfigured",
                status=err.status,
            ) from err
        assert guardian.guardian_id is not None

        try:
            linked = await verify_guardian_student_link(guardian.guardian_id, payload.student_id)
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err
        if not linked:
            raise GuardianNotLinkedError("guardian_not_linked_to_student", status=403)

        try:
            student_name = await fetch_student_name(payload.student_id)
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err

        try:
            quiz_sessions = await fetch_quiz_sessions(payload.student_id)
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err
        try:
            foxy_sessions = await fetch_foxy_sessions(payload.student_id)
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err
        try:
            learning_profile = await fetch_learning_profile(payload.student_id)
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err
        try:
            mastery_rows = await fetch_concept_mastery(payload.student_id)
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err

        stats_dict = compute_weekly_stats(
            quiz_sessions, foxy_sessions, learning_profile, mastery_rows
        )
        report_dict = build_template_report(stats_dict, payload.language, student_name)
        report = WeeklyReport(
            period=report_dict["period"],
            highlights=report_dict["highlights"],
            concerns=report_dict["concerns"],
            suggestion=report_dict["suggestion"],
            stats=WeeklyStats(**stats_dict),
        )

        logger.info(
            "parent_report.built",
            quizzes_completed=stats_dict["quizzes_completed"],
            avg_score=stats_dict["avg_score"],
        )

        return ParentReportResponse(
            report=report,
            generated_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        )
    finally:
        structlog.contextvars.clear_contextvars()
