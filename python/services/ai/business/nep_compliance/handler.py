"""Pipeline orchestrator for POST /v1/nep-compliance.

Two actions:
- generate_hpc: aggregate across student profile + mastery + sessions, produce
  HPCReport, cache in nep_compliance_reports.
- get_hpc: fetch most recent cached HPC for (student, academic_year, term);
  if not cached, generate fresh.

No LLM call. Pure data aggregation following the TS index.ts pipeline.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import structlog

from .mapping import (
    CBSE_EXAM_SECTIONS,
    CONSISTENCY_BENCHMARK_DAYS,
    CURIOSITY_BENCHMARK_QUESTIONS,
    SELF_REGULATION_BENCHMARK_DAYS,
    STUDY_REGULARITY_BENCHMARK_DAYS,
    compute_behavior_rating,
    get_academic_year,
    get_current_term,
    mastery_to_competency_level,
)
from .models import (
    BloomDistribution,
    CBSESectionReadiness,
    CompetencyEntry,
    HolisticIndicators,
    HPCReport,
    LearningBehaviors,
    NepComplianceRequest,
    NepComplianceResponse,
    PortfolioHighlight,
    StudentInfo,
    SubjectPerformance,
)
from .repository import (
    RepositoryError,
    fetch_concept_mastery,
    fetch_existing_report,
    fetch_learning_profiles,
    fetch_quiz_sessions,
    fetch_student,
    upsert_report,
)

logger = structlog.get_logger(__name__)


class HandlerError(Exception):
    def __init__(self, label: str, *, status: int) -> None:
        super().__init__(label)
        self.label = label
        self.status = status


class StudentNotFoundError(HandlerError):
    pass


DEFAULT_BOARD = "CBSE"

VALID_BLOOM_LEVELS = {"remember", "understand", "apply", "analyze", "evaluate", "create"}


async def handle_nep_compliance(
    payload: NepComplianceRequest,
    *,
    authenticated_student_id: str,
    request_id: str | None = None,
) -> NepComplianceResponse:
    """Run the HPC pipeline for the route-authorized student only.

    ``payload.student_id`` is retained for wire compatibility with the legacy
    Edge Function contract, but is never used as an authority boundary.
    """
    rid = request_id or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(
        request_id=rid, student_id=authenticated_student_id, action=payload.action
    )
    try:
        if payload.action == "get_hpc":
            return await _get_hpc(authenticated_student_id)
        return await _generate_hpc(authenticated_student_id)
    finally:
        structlog.contextvars.clear_contextvars()


async def _get_hpc(student_id: str) -> NepComplianceResponse:
    """get_hpc: try cached, fall back to generate."""
    now = datetime.now(UTC)
    academic_year = get_academic_year(now)
    term = get_current_term(now)
    try:
        existing, _err = await fetch_existing_report(student_id, academic_year, term)
    except RepositoryError as err:
        raise HandlerError("server_misconfigured", status=500) from err
    if existing and existing.get("report_data"):
        report_dict = existing["report_data"]
        return NepComplianceResponse(success=True, report=_coerce_report(report_dict))
    return await _generate_hpc(student_id)


async def _generate_hpc(student_id: str) -> NepComplianceResponse:
    """generate_hpc: full aggregation pipeline."""
    now = datetime.now(UTC)
    academic_year = get_academic_year(now)
    term = get_current_term(now)

    try:
        student_row, _err = await fetch_student(student_id)
    except RepositoryError as err:
        raise HandlerError("server_misconfigured", status=500) from err
    if student_row is None:
        raise StudentNotFoundError(f"student_not_found: {student_id}", status=404)

    student_name = str(student_row.get("name") or "")
    student_grade = str(student_row.get("grade") or "")

    try:
        profiles, _err = await fetch_learning_profiles(student_id)
    except RepositoryError as err:
        raise HandlerError("server_misconfigured", status=500) from err

    try:
        mastery_rows, _err = await fetch_concept_mastery(student_id)
    except RepositoryError as err:
        raise HandlerError("server_misconfigured", status=500) from err

    try:
        sessions, _err = await fetch_quiz_sessions(student_id)
    except RepositoryError as err:
        raise HandlerError("server_misconfigured", status=500) from err

    bloom = BloomDistribution()
    for s in sessions:
        lvl_raw = s.get("bloom_level")
        lvl = str(lvl_raw or "remember").lower()
        if lvl in VALID_BLOOM_LEVELS:
            current = getattr(bloom, lvl)
            setattr(bloom, lvl, current + 1)
            bloom.total += 1

    by_subject: dict[str, list[dict[str, Any]]] = {}
    for m in mastery_rows:
        ct = m.get("curriculum_topics") or {}
        subjects_obj = ct.get("subjects") if isinstance(ct, dict) else None
        subj_name = "unknown"
        if isinstance(subjects_obj, dict):
            subj_name = str(subjects_obj.get("name") or "unknown").lower()
        by_subject.setdefault(subj_name, []).append(m)

    subject_perf: dict[str, SubjectPerformance] = {}
    for subj, masteries in by_subject.items():
        if masteries:
            avg = round(
                sum((m.get("mastery_level") or 0) for m in masteries) / len(masteries) * 100
            )
        else:
            avg = 0
        chapter_numbers: set[int] = set()
        for m in masteries:
            ct = m.get("curriculum_topics") or {}
            ch = ct.get("chapter_number") if isinstance(ct, dict) else None
            if isinstance(ch, int):
                chapter_numbers.add(ch)
        subject_perf[subj] = SubjectPerformance(
            avg_mastery_pct=max(0, min(100, avg)),
            concepts_attempted=len(masteries),
            concepts_total=max(len(masteries), 20),
            chapters_covered=len(chapter_numbers),
            chapters_total=max(len(chapter_numbers), 10),
        )

    competencies = {
        subj: CompetencyEntry(overall_level=mastery_to_competency_level(perf.avg_mastery_pct))
        for subj, perf in subject_perf.items()
    }

    total_xp = sum((p.get("xp_total") or 0) for p in profiles)
    max_streak = max([0, *((p.get("streak_days") or 0) for p in profiles)])
    total_q_asked = sum((p.get("total_questions_asked") or 0) for p in profiles)
    active_day_set = {
        (s.get("created_at") or "")[:10] for s in sessions if isinstance(s.get("created_at"), str)
    }
    active_day_set.discard("")
    active_days = len(active_day_set)
    behaviors = LearningBehaviors(
        consistency=compute_behavior_rating(max_streak, CONSISTENCY_BENCHMARK_DAYS),
        curiosity=compute_behavior_rating(total_q_asked, CURIOSITY_BENCHMARK_QUESTIONS),
        self_regulation=compute_behavior_rating(active_days, SELF_REGULATION_BENCHMARK_DAYS),
        collaboration=None,
    )

    study_reg = (
        min(100, round(active_days / STUDY_REGULARITY_BENCHMARK_DAYS * 100)) if sessions else 0
    )
    holistic = HolisticIndicators(
        total_sessions=len(sessions),
        active_days=active_days,
        streak_best=max_streak,
        notes_created=0,
        xp_total=total_xp,
        study_regularity_pct=max(0, min(100, study_reg)),
    )

    cbse: dict[str, dict[str, CBSESectionReadiness]] = {}
    for subj, sections in CBSE_EXAM_SECTIONS.items():
        perf = subject_perf.get(subj)
        readiness_pct = perf.avg_mastery_pct if perf else None
        cbse[subj] = {
            sec["section"]: CBSESectionReadiness(
                section=sec["section"],
                marks=sec["marks"],
                readiness_pct=readiness_pct,
            )
            for sec in sections
        }

    portfolio: list[PortfolioHighlight] = []

    report = HPCReport(
        student=StudentInfo(name=student_name, grade=student_grade, board=DEFAULT_BOARD),
        academic_year=academic_year,
        term=term,
        class_percentile=0,
        bloom_distribution=bloom,
        competency_levels=competencies,
        subject_performance=subject_perf,
        learning_behaviors=behaviors,
        holistic_indicators=holistic,
        cbse_readiness=cbse,
        portfolio_highlights=portfolio,
        generated_at=now.isoformat().replace("+00:00", "Z"),
    )

    try:
        await upsert_report(student_id, academic_year, term, report.model_dump())
    except RepositoryError:
        logger.warning("nep_compliance.upsert_failed_noncritical")

    return NepComplianceResponse(success=True, report=report)


def _coerce_report(raw: dict[str, Any]) -> HPCReport:
    """Coerce a stored JSONB report back to typed HPCReport."""
    try:
        return HPCReport.model_validate(raw)
    except Exception:  # noqa: BLE001
        cleaned = {k: v for k, v in raw.items() if k in HPCReport.model_fields}
        return HPCReport.model_validate(cleaned)
