"""Pipeline orchestrator for POST /v1/verify-question-bank.

Phase 2 STUB pipeline:
  1. Cron-secret auth.
  2. Throttle detection (grounded_ai_traces RPM).
  3. Adaptive batch sizing (peak vs off-peak; halve on throttle).
  4. Claim batch.
  5. STUB: release each row back to legacy_unverified (no actual verifier call).
  6. Return summary.

Phase 2.5: replace step 5 with an HTTP call to the grounded-answer Edge
Function (or direct MoL once grounded-answer is also ported). The contract
preserves claim/release semantics so swap is internal.
"""

from __future__ import annotations

import time
import uuid

import structlog

from .auth import AuthFailed, verify_cron_secret
from .models import VerifierCronRequest, VerifierCronResponse
from .repository import RepositoryError, claim_batch, get_rpm_last_minute, release_claim
from .scheduling import decide_batch_size, is_peak_hour_ist, should_throttle

logger = structlog.get_logger(__name__)


class HandlerError(Exception):
    def __init__(self, label: str, *, status: int) -> None:
        super().__init__(label)
        self.label = label
        self.status = status


class UnauthorizedError(HandlerError):
    pass


async def run_verifier_cron(
    _payload: VerifierCronRequest,
    *,
    cron_secret_header: str | None,
    request_id: str | None = None,
) -> VerifierCronResponse:
    rid = request_id or str(uuid.uuid4())
    started = time.monotonic()
    structlog.contextvars.bind_contextvars(request_id=rid)
    try:
        try:
            verify_cron_secret(cron_secret_header)
        except AuthFailed as err:
            label = "unauthorized" if err.status == 401 else "server_misconfigured"
            raise UnauthorizedError(label, status=err.status) from err

        try:
            rpm = await get_rpm_last_minute()
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err
        throttled = should_throttle(rpm)
        peak = is_peak_hour_ist()
        batch_size = decide_batch_size(throttled=throttled)

        try:
            claimed_rows = await claim_batch(batch_size)
        except RepositoryError as err:
            raise HandlerError("server_misconfigured", status=500) from err

        # Phase 2 stub: each claimed row is released back unchanged. The cron
        # tick will reclaim them on the next pass when the verifier is wired.
        released_count = 0
        for row in claimed_rows:
            qid = row.get("id") if isinstance(row, dict) else None
            if isinstance(qid, str):
                await release_claim(qid)
                released_count += 1

        elapsed_ms = int((time.monotonic() - started) * 1000)

        logger.info(
            "verify_qb.tick_complete",
            claimed=len(claimed_rows),
            released=released_count,
            batch_size=batch_size,
            is_peak=peak,
            throttled=throttled,
            elapsed_ms=elapsed_ms,
            phase_2_stub=True,
        )

        return VerifierCronResponse(
            claimed=len(claimed_rows),
            verified=0,
            released=released_count,
            failed=0,
            batch_size=batch_size,
            is_peak=peak,
            throttled=throttled,
            elapsed_ms=elapsed_ms,
            phase_2_stub=True,
        )
    finally:
        structlog.contextvars.clear_contextvars()
