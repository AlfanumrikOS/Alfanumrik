-- Migration: 20260808000100_topic_mastery_rollup_view.sql
-- Purpose: Foxy North-Star Phase 2 (spec §1.3) — read-model consolidation.
--   topic_mastery is a stale parallel mastery store (no live writer after the
--   v2 spine consolidation); concept_mastery is the single canonical learner
--   state. This view exposes concept_mastery in topic_mastery's SHAPE
--   (subject code / grade / topic_tag / chapter_number / mastery_percent /
--   consecutive_correct) so readers can re-point without a schema change.
--
-- Column names VERIFIED against the baseline + later ADD COLUMNs (2026-08-05):
--   concept_mastery: student_id, attempts, correct_attempts,
--     mastery_probability, mastery_level, last_attempted_at, next_review_at,
--     review_interval_days, ease_factor, updated_at (all baseline);
--     streak_current (added 20260525100000_adr_004_phase_2_bkt_schema.sql).
--     NOTE concept_mastery ALSO has a baseline column named
--     consecutive_correct, but it is NOT maintained by the live writer
--     (update_learner_state_post_quiz writes streak_current) — so the rollup
--     exposes streak_current AS consecutive_correct, matching the
--     topic_mastery reader contract with the value that is actually current.
--   curriculum_topics: id, subject_id, grade (TEXT, P5), title, chapter_number.
--   subjects: id, code.
--
-- SECURITY: WITH (security_invoker = true) — the view executes with the
--   CALLER's privileges, so concept_mastery/curriculum_topics/subjects RLS
--   applies to every read. No SECURITY DEFINER surface is introduced (P8).
--   Students see only their own rows (concept_mastery student policies);
--   service role sees all.
--
-- Idempotent: CREATE OR REPLACE VIEW + COMMENTs. No DDL on any table, no
--   DROPs — topic_mastery and cme_concept_state are COMMENT-tombstoned only;
--   dropping either requires explicit user approval (house rule) and a
--   compensating-migration plan.
-- Owner: architect. Added: 2026-08-05. Reviewers: assessment, backend.

CREATE OR REPLACE VIEW public.topic_mastery_rollup
WITH (security_invoker = true) AS
SELECT
  cm.student_id,
  s.code                        AS subject,
  ct.grade,                                        -- TEXT '6'..'12' (P5)
  ct.title                      AS topic_tag,
  ct.chapter_number,
  cm.attempts                   AS total_attempts,
  cm.correct_attempts,
  cm.mastery_probability * 100  AS mastery_percent,
  cm.mastery_level,
  cm.mastery_probability,
  cm.last_attempted_at,
  cm.next_review_at,
  cm.review_interval_days,
  cm.ease_factor,
  cm.streak_current             AS consecutive_correct,
  cm.updated_at
FROM public.concept_mastery cm
JOIN public.curriculum_topics ct ON ct.id = cm.topic_id
JOIN public.subjects s           ON s.id  = ct.subject_id;

COMMENT ON VIEW public.topic_mastery_rollup IS
  'Foxy North-Star Phase 2 (20260808000100): canonical mastery read model in '
  'the legacy topic_mastery shape, sourced from concept_mastery (single '
  'source of truth) joined to curriculum_topics + subjects. '
  'security_invoker=true — caller RLS applies. consecutive_correct is '
  'concept_mastery.streak_current (the live-writer-maintained streak). '
  'Readers of topic_mastery / cme_concept_state should re-point here.';

COMMENT ON TABLE public.topic_mastery IS
  'RETIRED (Foxy North-Star Phase 2, 20260808000100) — stale parallel mastery '
  'store with no live writer; concept_mastery is the single source of truth. '
  'Read public.topic_mastery_rollup instead. DROP pending explicit user '
  'approval + compensating migration plan (house rule: no DROP TABLE without '
  'approval). Data retained as-is for forensic comparison until then.';

COMMENT ON TABLE public.cme_concept_state IS
  'RETIRED 2026-08 (Foxy North-Star Phase 2, 20260808000100) — no writer; '
  'readers re-pointed to concept_mastery / public.topic_mastery_rollup. DROP '
  'pending explicit user approval + compensating migration plan.';
