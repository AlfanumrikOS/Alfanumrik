-- IST day boundary for content_requests rate limit.
-- Controller decision 2026-04-18: Alfanumrik is India-first; students at
-- 23:30 IST Mon and the same student at 00:30 IST Tue are behaviourally
-- different days. UTC day_trunc would incorrectly block the 00:30 IST
-- request. Rebuild the unique index to use Asia/Kolkata timezone.

DROP INDEX IF EXISTS idx_content_requests_one_per_day;

CREATE UNIQUE INDEX idx_content_requests_one_per_ist_day
  ON content_requests (
    student_id,
    grade,
    subject_code,
    chapter_number,
    (date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'))
  );

COMMENT ON INDEX idx_content_requests_one_per_ist_day IS
  'Rate limit: one request per (student, chapter) per IST day. '
  'See 20260418100400_feedback_and_failures.sql for original UTC version.';