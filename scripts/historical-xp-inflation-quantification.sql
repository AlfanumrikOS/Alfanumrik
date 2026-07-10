-- RCA-06 / SLC-1-backfill historical XP inflation quantification.
-- READ ONLY: run this against staging/production before any CEO/product-comms
-- clamp or backfill decision. It reports suspected historical inflation only;
-- it must not mutate leaderboard, student, or ledger state.

WITH quiz_ledger AS (
  SELECT
    xt.student_id,
    date_trunc('day', xt.created_at AT TIME ZONE 'Asia/Kolkata')::date AS activity_day,
    COALESCE(xt.reference_id, '') AS reference_id,
    COALESCE(xt.amount, 0) AS amount
  FROM public.xp_transactions xt
  WHERE xt.daily_category = 'quiz'
),
daily_over_cap AS (
  SELECT
    ql.student_id,
    ql.activity_day,
    SUM(ql.amount) AS quiz_xp,
    GREATEST(SUM(ql.amount) - 200, 0) AS suspected_over_cap_xp
  FROM quiz_ledger ql
  GROUP BY ql.student_id, ql.activity_day
  HAVING SUM(ql.amount) > 200
),
duplicate_reference_ids AS (
  SELECT
    ql.reference_id,
    COUNT(*) AS row_count,
    COUNT(DISTINCT ql.student_id) AS student_count,
    SUM(ql.amount) AS duplicate_reference_xp
  FROM quiz_ledger ql
  WHERE ql.reference_id <> ''
  GROUP BY ql.reference_id
  HAVING COUNT(*) > 1
),
ledger_totals AS (
  SELECT
    xt.student_id,
    SUM(COALESCE(xt.amount, 0)) AS ledger_xp_total
  FROM public.xp_transactions xt
  GROUP BY xt.student_id
),
cached_total_vs_ledger_delta AS (
  -- Cached-total comparison reads students.xp_total against the ledger sum.
  SELECT
    s.id AS student_id,
    COALESCE(s.xp_total, 0) AS cached_xp_total,
    COALESCE(lt.ledger_xp_total, 0) AS ledger_xp_total,
    COALESCE(s.xp_total, 0) - COALESCE(lt.ledger_xp_total, 0) AS cached_minus_ledger_xp
  FROM public.students s
  LEFT JOIN ledger_totals lt ON lt.student_id = s.id
  WHERE ABS(COALESCE(s.xp_total, 0) - COALESCE(lt.ledger_xp_total, 0)) > 0
),
quiz_session_vs_ledger AS (
  -- Live quiz_sessions no longer carries a session XP column. Keep this typed
  -- dimension empty rather than failing the whole read-only RCA-06 report.
  SELECT
    NULL::uuid AS student_id,
    NULL::uuid AS session_id,
    NULL::date AS completed_day,
    0::integer AS session_xp,
    0::integer AS ledger_session_xp,
    0::integer AS session_minus_ledger_xp
  FROM public.quiz_sessions qs
  WHERE false
),
student_impact_summary AS (
  SELECT
    COALESCE(doc.student_id, ctl.student_id, qsl.student_id) AS student_id,
    COALESCE(SUM(doc.suspected_over_cap_xp), 0) AS daily_over_cap_xp,
    COALESCE(MAX(ABS(ctl.cached_minus_ledger_xp)), 0) AS cached_total_vs_ledger_delta_xp,
    COALESCE(SUM(GREATEST(qsl.session_minus_ledger_xp, 0)), 0) AS quiz_session_vs_ledger_xp
  FROM daily_over_cap doc
  FULL OUTER JOIN cached_total_vs_ledger_delta ctl ON ctl.student_id = doc.student_id
  FULL OUTER JOIN quiz_session_vs_ledger qsl
    ON qsl.student_id = COALESCE(doc.student_id, ctl.student_id)
  GROUP BY COALESCE(doc.student_id, ctl.student_id, qsl.student_id)
),
leaderboard_risk_sample AS (
  SELECT
    s.id AS student_id,
    s.grade,
    COALESCE(s.xp_total, 0) AS current_xp_total,
    sis.daily_over_cap_xp,
    sis.cached_total_vs_ledger_delta_xp,
    sis.quiz_session_vs_ledger_xp,
    (
      sis.daily_over_cap_xp
      + sis.cached_total_vs_ledger_delta_xp
      + sis.quiz_session_vs_ledger_xp
    ) AS suspected_inflated_xp
  FROM student_impact_summary sis
  JOIN public.students s ON s.id = sis.student_id
  ORDER BY suspected_inflated_xp DESC, current_xp_total DESC
  LIMIT 50
)
SELECT
  'student_impact_summary' AS section,
  jsonb_build_object(
    'impacted_students', COUNT(*),
    'daily_over_cap_students', COUNT(*) FILTER (WHERE daily_over_cap_xp > 0),
    'cached_total_vs_ledger_delta_students', COUNT(*) FILTER (WHERE cached_total_vs_ledger_delta_xp > 0),
    'quiz_session_vs_ledger_students', COUNT(*) FILTER (WHERE quiz_session_vs_ledger_xp > 0),
    'suspected_inflated_xp_total', COALESCE(SUM(
      daily_over_cap_xp
      + cached_total_vs_ledger_delta_xp
      + quiz_session_vs_ledger_xp
    ), 0)
  ) AS result
FROM student_impact_summary

UNION ALL

SELECT
  'daily_over_cap' AS section,
  jsonb_agg(to_jsonb(daily_over_cap) ORDER BY suspected_over_cap_xp DESC, quiz_xp DESC) AS result
FROM daily_over_cap

UNION ALL

SELECT
  'duplicate_reference_ids' AS section,
  COALESCE(jsonb_agg(to_jsonb(duplicate_reference_ids) ORDER BY duplicate_reference_xp DESC), '[]'::jsonb) AS result
FROM duplicate_reference_ids

UNION ALL

SELECT
  'cached_total_vs_ledger_delta' AS section,
  jsonb_agg(to_jsonb(cached_total_vs_ledger_delta) ORDER BY ABS(cached_minus_ledger_xp) DESC) AS result
FROM cached_total_vs_ledger_delta

UNION ALL

SELECT
  'leaderboard_risk_sample' AS section,
  jsonb_agg(to_jsonb(leaderboard_risk_sample) ORDER BY suspected_inflated_xp DESC, current_xp_total DESC) AS result
FROM leaderboard_risk_sample;
