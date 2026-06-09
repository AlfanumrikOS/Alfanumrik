"""Unit tests for the pure scheduling helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from services.ai.business.verify_question_bank.scheduling import (
    BATCH_SIZE_OFF_PEAK,
    BATCH_SIZE_PEAK,
    IST_PEAK_END_HOUR,
    IST_PEAK_START_HOUR,
    THROTTLE_RPM_THRESHOLD,
    decide_batch_size,
    is_peak_hour_ist,
    should_throttle,
)


def test_constants_match_ts():
    assert IST_PEAK_START_HOUR == 14
    assert IST_PEAK_END_HOUR == 22
    assert BATCH_SIZE_OFF_PEAK == 1000
    assert BATCH_SIZE_PEAK == 250
    assert THROTTLE_RPM_THRESHOLD == 2400


def test_is_peak_at_ist_1500():
    # 15:00 IST = 09:30 UTC
    utc_930 = datetime(2026, 6, 9, 9, 30, tzinfo=timezone.utc)
    assert is_peak_hour_ist(utc_930) is True


def test_is_peak_at_ist_1359_is_off_peak():
    # 13:59 IST = 08:29 UTC (before 14:00 IST)
    utc_829 = datetime(2026, 6, 9, 8, 29, tzinfo=timezone.utc)
    assert is_peak_hour_ist(utc_829) is False


def test_is_peak_at_ist_2200_is_off_peak():
    # 22:00 IST = 16:30 UTC. End boundary is exclusive (h < 22).
    utc_1630 = datetime(2026, 6, 9, 16, 30, tzinfo=timezone.utc)
    assert is_peak_hour_ist(utc_1630) is False


def test_is_peak_at_ist_2159_is_peak():
    # 21:59 IST = 16:29 UTC
    utc_1629 = datetime(2026, 6, 9, 16, 29, tzinfo=timezone.utc)
    assert is_peak_hour_ist(utc_1629) is True


def test_batch_size_off_peak_no_throttle():
    utc_off = datetime(2026, 6, 9, 0, 0, tzinfo=timezone.utc)  # ~5:30 IST
    assert decide_batch_size(utc_off, throttled=False) == BATCH_SIZE_OFF_PEAK


def test_batch_size_peak_no_throttle():
    utc_peak = datetime(2026, 6, 9, 10, 0, tzinfo=timezone.utc)  # 15:30 IST
    assert decide_batch_size(utc_peak, throttled=False) == BATCH_SIZE_PEAK


def test_batch_size_off_peak_throttled_halves():
    utc_off = datetime(2026, 6, 9, 0, 0, tzinfo=timezone.utc)
    assert decide_batch_size(utc_off, throttled=True) == BATCH_SIZE_OFF_PEAK // 2


def test_batch_size_peak_throttled_halves():
    utc_peak = datetime(2026, 6, 9, 10, 0, tzinfo=timezone.utc)
    assert decide_batch_size(utc_peak, throttled=True) == BATCH_SIZE_PEAK // 2


def test_should_throttle_threshold():
    assert should_throttle(THROTTLE_RPM_THRESHOLD - 1) is False
    assert should_throttle(THROTTLE_RPM_THRESHOLD) is False  # exclusive boundary
    assert should_throttle(THROTTLE_RPM_THRESHOLD + 1) is True
