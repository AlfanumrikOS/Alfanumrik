"""Pipeline orchestrator for POST /v1/bulk-non-mcq-gen.

Phase 2 STUB pipeline:
  1. Admin x-admin-key auth.
  2. Validate question_type.
  3. STUB: returns success=true with 0 generated.

Phase 2.5 will replace step 3 with MoL routing (task_type='quiz_generation')
+ Sonnet oracle grader bypass + question_bank inserts with P6 validation.
"""

from __future__ import annotations

import time
import uuid

import structlog

from .auth import AuthFailed, verify_admin_key
from .models import BulkGenRequest, BulkGenResponse

logger = structlog.get_logger(__name__)


class HandlerError(Exception):
    def __init__(self, label: str, *, status: int) -> None:
        super().__init__(label)
        self.label = label
        self.status = status


class UnauthorizedError(HandlerError):
    pass


class BulkGenError(HandlerError):
    pass


async def run_bulk_non_mcq_gen(
    payload: BulkGenRequest,
    *,
    admin_key_header: str | None,
    request_id: str | None = None,
) -> BulkGenResponse:
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

        # Phase 2 stub: no actual generation. TS path handles all real traffic.
        elapsed = int((time.monotonic() - started) * 1000)
        logger.info(
            "bulk_non_mcq.stub_tick",
            question_type=payload.question_type,
            batch_size=payload.batch_size,
            dry_run=payload.dry_run,
            elapsed_ms=elapsed,
            phase_2_stub=True,
        )
        return BulkGenResponse(
            success=True,
            question_type=payload.question_type,
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
    finally:
        structlog.contextvars.clear_contextvars()
