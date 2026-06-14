"""Pure scheduling helpers - peak-window detection + adaptive batch sizing.

Ports of shared.ts (lines 16-69) - constants match TS byte-for-byte.
"""

from __future__ import annotations

from datetime import UTC, datetime

# IST peak window (TS shared.ts:16-17).
IST_PEAK_START_HOUR = 14
IST_PEAK_END_HOUR = 22

# Batch sizes (TS shared.ts:21-22).
BATCH_SIZE_OFF_PEAK = 1000
BATCH_SIZE_PEAK = 250

# Throttle threshold (TS shared.ts:25).
THROTTLE_RPM_THRESHOLD = 2400

# Claim TTL (TS shared.ts:29).
DEFAULT_CLAIM_TTL_SECONDS = 600

# Retry backoff (TS shared.ts:32-33).
RETRY_DELAYS_MS = (5_000, 10_000, 20_000, 40_000)
MAX_RETRIES = len(RETRY_DELAYS_MS) - 1


def _ist_hour(now: datetime) -> int:
    """Return the IST hour from a UTC datetime. IST = UTC + 5:30 (no DST)."""
    utc_minutes = now.hour * 60 + now.minute
    ist_minutes = (utc_minutes + 5 * 60 + 30) % (24 * 60)
    return ist_minutes // 60


def is_peak_hour_ist(now: datetime | None = None) -> bool:
    """True if now falls inside 14:00..22:00 Asia/Kolkata (TS shared.ts:38-50)."""
    n = now if now is not None else datetime.now(UTC)
    h = _ist_hour(n)
    return IST_PEAK_START_HOUR <= h < IST_PEAK_END_HOUR


def decide_batch_size(now: datetime | None = None, throttled: bool = False) -> int:
    """Return batch size for this tick. Halved if throttled (TS shared.ts:55-66)."""
    base = BATCH_SIZE_PEAK if is_peak_hour_ist(now) else BATCH_SIZE_OFF_PEAK
    if throttled:
        return base // 2
    return base


def should_throttle(rpm_last_minute: int) -> bool:
    """True if recent inserts/min exceeded the threshold (TS shared.ts:69)."""
    return rpm_last_minute > THROTTLE_RPM_THRESHOLD
