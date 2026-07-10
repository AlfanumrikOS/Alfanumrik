-- TSB-4 class membership divergence quantification.
-- Read-only. Export with:
--   supabase db query --linked -f scripts/tsb4-class-membership-divergence-quantification.sql -o json
--
-- Direction A removes teacher visibility after the canonical enrollment row is
-- already inactive. Direction B would widen teacher visibility if auto-applied,
-- so it remains manual-review evidence only.

WITH joined_pairs AS (
  SELECT
    ce.class_id AS ce_class_id,
    ce.student_id AS ce_student_id,
    ce.is_active AS ce_is_active,
    cs.class_id AS cs_class_id,
    cs.student_id AS cs_student_id,
    cs.is_active AS cs_is_active
  FROM public.class_enrollments ce
  FULL OUTER JOIN public.class_students cs
    ON cs.class_id = ce.class_id
   AND cs.student_id = ce.student_id
),
classified AS (
  SELECT
    CASE
      WHEN ce_class_id IS NOT NULL AND cs_class_id IS NOT NULL
        AND ce_is_active = false AND cs_is_active = true
        THEN 'direction_a_ce_inactive_cs_active'
      WHEN ce_class_id IS NOT NULL AND cs_class_id IS NOT NULL
        AND ce_is_active = true AND cs_is_active = false
        THEN 'direction_b_ce_active_cs_inactive'
      WHEN ce_class_id IS NOT NULL AND cs_class_id IS NULL
        THEN 'class_enrollments_only'
      WHEN ce_class_id IS NULL AND cs_class_id IS NOT NULL
        THEN 'class_students_only'
      ELSE 'matched_or_both_inactive'
    END AS divergence_type,
    CASE
      WHEN ce_class_id IS NOT NULL AND cs_class_id IS NOT NULL
        AND ce_is_active = false AND cs_is_active = true
        THEN 'fail_closed_visibility_removal'
      WHEN ce_class_id IS NOT NULL AND cs_class_id IS NOT NULL
        AND ce_is_active = true AND cs_is_active = false
        THEN 'authorization_widening_manual_review'
      WHEN ce_class_id IS NOT NULL AND cs_class_id IS NULL
        THEN 'canonical_only_manual_review'
      WHEN ce_class_id IS NULL AND cs_class_id IS NOT NULL
        THEN 'legacy_only_manual_review'
      ELSE 'no_action'
    END AS review_posture,
    COALESCE(ce_class_id, cs_class_id) AS class_id,
    COALESCE(ce_student_id, cs_student_id) AS student_id
  FROM joined_pairs
)
SELECT
  divergence_type,
  review_posture,
  COUNT(*)::int AS pair_count,
  (ARRAY_AGG(class_id ORDER BY class_id, student_id) FILTER (
    WHERE divergence_type <> 'matched_or_both_inactive'
  ))[1:20] AS sample_class_ids,
  (ARRAY_AGG(student_id ORDER BY class_id, student_id) FILTER (
    WHERE divergence_type <> 'matched_or_both_inactive'
  ))[1:20] AS sample_student_ids
FROM classified
GROUP BY divergence_type, review_posture
ORDER BY
  CASE divergence_type
    WHEN 'direction_a_ce_inactive_cs_active' THEN 1
    WHEN 'direction_b_ce_active_cs_inactive' THEN 2
    WHEN 'class_enrollments_only' THEN 3
    WHEN 'class_students_only' THEN 4
    ELSE 5
  END;
