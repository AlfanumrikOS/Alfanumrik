"""Pipeline orchestrator for POST /v1/monthly-synthesis-builder.

Six-step pipeline mirroring the TS Edge Function:
  1. Cron-secret auth (constant-time).
  2. Idempotency lookup - short-circuit if the row already exists.
  3. Aggregate weekly artifacts + concept-mastery + curriculum-topic rows.
  4. Build the structured bundle (pure transformation).
  5. Insert into monthly_synthesis_runs (idempotent via UNIQUE constraint).
  6. Return BuildResponse.

No LLM call lives here - the bilingual summary is generated lazily by the
Next.js side when the student first views the synthesis. TS error labels
("missing_student_id", "invalid_synthesis_month", etc) are preserved
verbatim because the Edge proxy + Next.js consumer parse them.
"""

from __future__ import annotations

import uuid

import structlog

from .auth import AuthFailed, verify_cron_secret
from .bundle import (
    compute_mastery_counters,
    derive_chapter_mock_summary,
    derive_chapters_touched,
    month_boundaries_of,
)
from .models import (
    BuildResponse,
    BuildSynthesisRequest,
    ChapterMockSummary,
    MasteryDelta,
    SynthesisBundle,
)
from .repository import (
    RepositoryError,
    fetch_concept_mastery_rows,
    fetch_curriculum_topics,
    fetch_dive_artifact_ids,
    fetch_existing_run,
    insert_synthesis_run,
)

logger = structlog.get_logger(__name__)


class HandlerError(Exception):
    """Base handler error with HTTP status + machine-readable label."""

    def __init__(self, label: str, *, status: int) -> None:
        super().__init__(label)
        self.label = label
        self.status = status


class UnauthorizedError(HandlerError):
    """Auth boundary failure - maps to 401 / 503."""


class BundleBuildError(HandlerError):
    """Bundle-build step returned an error - maps to 500."""


async def build_synthesis(
    payload: BuildSynthesisRequest,
    *,
    cron_secret_header: str | None,
    request_id: str | None = None,
) -> BuildResponse:
    """Run the full bundle-build + insert pipeline.

    Raises UnauthorizedError (401/503) or BundleBuildError (500). The
    .label attribute carries the TS-shaped error label.
    """
    rid = request_id or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(
        request_id=rid,
        student_id=payload.student_id,
        synthesis_month=payload.synthesis_month,
    )
    try:
        try:
            verify_cron_secret(cron_secret_header)
        except AuthFailed as err:
            label = "unauthorized" if err.status == 401 else "server_misconfigured"
            raise UnauthorizedError(label, status=err.status) from err

        bounds = month_boundaries_of(payload.synthesis_month)
        if bounds is None:
            raise BundleBuildError("invalid_synthesis_month_format", status=500)
        start_iso, end_iso = bounds

        try:
            existing, existing_err = await fetch_existing_run(
                payload.student_id, payload.synthesis_month
            )
        except RepositoryError as err:
            raise BundleBuildError("server_misconfigured", status=500) from err
        if existing_err:
            raise BundleBuildError(existing_err, status=500)
        if existing is not None:
            bundle_dict = existing.get("bundle") or {}
            return BuildResponse(
                id=str(existing.get("id")) if existing.get("id") else None,
                alreadyExists=True,
                bundle=_bundle_from_dict(bundle_dict, payload.synthesis_month),
            )

        try:
            artifact_ids, art_err = await fetch_dive_artifact_ids(
                payload.student_id, start_iso, end_iso
            )
        except RepositoryError as err:
            raise BundleBuildError("server_misconfigured", status=500) from err
        if art_err:
            raise BundleBuildError(art_err, status=500)

        try:
            cm_rows, cm_err = await fetch_concept_mastery_rows(
                payload.student_id, start_iso, end_iso
            )
        except RepositoryError as err:
            raise BundleBuildError("server_misconfigured", status=500) from err
        if cm_err:
            raise BundleBuildError(cm_err, status=500)

        touched_topic_ids = [
            r["topic_id"] for r in cm_rows if isinstance(r.get("topic_id"), str)
        ]
        topic_rows: list[dict] = []
        if touched_topic_ids:
            try:
                topic_rows, topic_err = await fetch_curriculum_topics(touched_topic_ids)
            except RepositoryError as err:
                raise BundleBuildError("server_misconfigured", status=500) from err
            if topic_err:
                raise BundleBuildError(topic_err, status=500)

        mastered, improved, regressed = compute_mastery_counters(cm_rows)
        chapters_touched = derive_chapters_touched(topic_rows)
        chapter_mock_dict = derive_chapter_mock_summary(chapters_touched)
        bundle = SynthesisBundle(
            monthLabel=payload.synthesis_month,
            weeklyArtifactIds=artifact_ids,
            masteryDelta=MasteryDelta(
                chaptersTouched=chapters_touched,
                topicsMastered=mastered,
                topicsImproved=improved,
                topicsRegressed=regressed,
            ),
            chapterMockSummary=(
                ChapterMockSummary(**chapter_mock_dict) if chapter_mock_dict else None
            ),
        )

        try:
            inserted, insert_err, raced = await insert_synthesis_run(
                payload.student_id,
                payload.synthesis_month,
                bundle.model_dump(),
            )
        except RepositoryError as err:
            raise BundleBuildError("server_misconfigured", status=500) from err
        if raced:
            return BuildResponse(id=None, alreadyExists=True, bundle=bundle)
        if insert_err:
            raise BundleBuildError(insert_err, status=500)

        inserted_id = (
            str(inserted.get("id"))
            if inserted and isinstance(inserted.get("id"), str)
            else None
        )
        return BuildResponse(id=inserted_id, alreadyExists=False, bundle=bundle)
    finally:
        structlog.contextvars.clear_contextvars()


def _bundle_from_dict(raw: dict, month_label_fallback: str) -> SynthesisBundle:
    """Coerce a stored JSONB bundle back to the typed SynthesisBundle."""
    delta_raw = raw.get("masteryDelta") or {}
    if not isinstance(delta_raw, dict):
        delta_raw = {}
    mock_raw = raw.get("chapterMockSummary")
    mock = (
        ChapterMockSummary(
            chapters=list(mock_raw.get("chapters") or []),
            totalQuestions=int(mock_raw.get("totalQuestions") or 0),
            targetDifficulty=float(mock_raw.get("targetDifficulty") or 0.55),
        )
        if isinstance(mock_raw, dict)
        else None
    )
    return SynthesisBundle(
        monthLabel=raw.get("monthLabel") or month_label_fallback,
        weeklyArtifactIds=list(raw.get("weeklyArtifactIds") or []),
        masteryDelta=MasteryDelta(
            chaptersTouched=list(delta_raw.get("chaptersTouched") or []),
            topicsMastered=int(delta_raw.get("topicsMastered") or 0),
            topicsImproved=int(delta_raw.get("topicsImproved") or 0),
            topicsRegressed=int(delta_raw.get("topicsRegressed") or 0),
        ),
        chapterMockSummary=mock,
    )
