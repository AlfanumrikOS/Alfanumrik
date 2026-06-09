"""verify-question-bank - retroactive verifier cron (Phase 2 structural port).

Pythonized port of supabase/functions/verify-question-bank/index.ts. Phase 2
ports the claim/release infrastructure + adaptive batch sizing + peak-hour
detection. The actual grounded-answer verifier call (TS lines 100-280) is
STUBBED in this port - each claimed row is released with verification_state
unchanged (legacy_unverified) so the next cron tick reclaims it. Phase 2.5
will wire the verifier call via HTTP to the grounded-answer Edge Function or
direct MoL once grounded-answer itself is ported.

Public entrypoint: run_verifier_cron
"""

from .handler import HandlerError, UnauthorizedError, run_verifier_cron
from .models import VerifierCronRequest, VerifierCronResponse
from .scheduling import (
    BATCH_SIZE_OFF_PEAK,
    BATCH_SIZE_PEAK,
    IST_PEAK_END_HOUR,
    IST_PEAK_START_HOUR,
    decide_batch_size,
    is_peak_hour_ist,
    should_throttle,
)

__all__ = [
    "BATCH_SIZE_OFF_PEAK",
    "BATCH_SIZE_PEAK",
    "HandlerError",
    "IST_PEAK_END_HOUR",
    "IST_PEAK_START_HOUR",
    "UnauthorizedError",
    "VerifierCronRequest",
    "VerifierCronResponse",
    "decide_batch_size",
    "is_peak_hour_ist",
    "run_verifier_cron",
    "should_throttle",
]
