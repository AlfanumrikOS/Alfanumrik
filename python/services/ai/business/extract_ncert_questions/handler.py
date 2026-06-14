"""Pipeline orchestrator for POST /v1/extract-ncert-questions.

Phase 2 STUB pipeline:
  1. Admin x-admin-key auth.
  2. Discover chapters lacking question_bank rows.
  3. STUB: mark each chapter as extraction_pending (no MoL call).
  4. Return summary with phase_2_stub=True.

Phase 2.5 will replace step 3 with MoL routing (task_type='quiz_generation',
gpt-4o-mini primary, Haiku fallback) + question parsing + question_bank
inserts with P6 validation (4 distinct options, correct_answer_index 0..3,
non-empty explanation, valid bloom_level).
"""

from __future__ import annotations

import time
import uuid

import structlog

from .auth import AuthFailed, verify_admin_key
from .models import (
    ExtractedChapter,
    ExtractRequest,
    ExtractResponse,
    ExtractStatusResponse,
)
from .repository import (
    RepositoryError,
    fetch_chapters_without_extractions,
    get_extraction_overview,
)

logger = structlog.get_logger(__name__)


class HandlerError(Exception):
    def __init__(self, label: str, *, status: int) -> None:
        super().__init__(label)
        self.label = label
        self.status = status


class UnauthorizedError(HandlerError):
    pass


class ExtractionError(HandlerError):
    pass


async def run_extraction(
    payload: ExtractRequest,
    *,
    admin_key_header: str | None,
    request_id: str | None = None,
) -> ExtractResponse:
    rid = request_id or str(uuid.uuid4())
    started = time.monotonic()
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        try:
            verify_admin_key(admin_key_header)
        except AuthFailed as err:
            raise UnauthorizedError(
                "unauthorized" if err.status == 401 else "server_misconfigured",
                status=err.status,
            ) from err

        try:
            chapters = await fetch_chapters_without_extractions(
                payload.grade, payload.subject, payload.batch_size
            )
        except RepositoryError as err:
            raise ExtractionError("server_misconfigured", status=500) from err

        if not chapters:
            elapsed = int((time.monotonic() - started) * 1000)
            return ExtractResponse(
                success=True,
                total_found=0,
                processed=0,
                succeeded=0,
                failed=0,
                skipped=0,
                errors=[],
                elapsed_ms=elapsed,
                dry_run=payload.dry_run,
                phase_2_stub=True,
            )

        if payload.dry_run:
            elapsed = int((time.monotonic() - started) * 1000)
            return ExtractResponse(
                success=True,
                total_found=len(chapters),
                processed=0,
                succeeded=0,
                failed=0,
                skipped=0,
                errors=[],
                elapsed_ms=elapsed,
                dry_run=True,
                phase_2_stub=True,
                chapters=[
                    ExtractedChapter(
                        grade=str(c.get("grade") or ""),
                        subject=str(c.get("subject") or ""),
                        chapter_number=int(c.get("chapter_number") or 0),
                        chapter_title=str(c.get("chapter_title") or ""),
                    )
                    for c in chapters
                ],
            )

        # Phase 2 STUB: mark as skipped since we have no extractor yet.
        skipped = len(chapters)
        errors = [
            f"Grade {c.get('grade')} {c.get('subject')} ch{c.get('chapter_number')}: "
            "skipped - phase 2 stub (MoL extractor wires in phase 2.5)"
            for c in chapters
        ][:50]
        elapsed = int((time.monotonic() - started) * 1000)
        logger.info(
            "extract_ncert.stub_tick",
            total_found=len(chapters),
            skipped=skipped,
            elapsed_ms=elapsed,
            phase_2_stub=True,
        )
        return ExtractResponse(
            success=True,
            total_found=len(chapters),
            processed=len(chapters),
            succeeded=0,
            failed=0,
            skipped=skipped,
            errors=errors,
            elapsed_ms=elapsed,
            dry_run=False,
            phase_2_stub=True,
        )
    finally:
        structlog.contextvars.clear_contextvars()


async def get_extraction_status(*, admin_key_header: str | None) -> ExtractStatusResponse:
    try:
        verify_admin_key(admin_key_header)
    except AuthFailed as err:
        raise UnauthorizedError(
            "unauthorized" if err.status == 401 else "server_misconfigured",
            status=err.status,
        ) from err
    try:
        stats = await get_extraction_overview()
    except RepositoryError as err:
        raise ExtractionError("server_misconfigured", status=500) from err
    return ExtractStatusResponse(**stats)
