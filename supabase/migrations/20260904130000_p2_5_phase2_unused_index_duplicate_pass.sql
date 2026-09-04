-- 20260904130000_p2_5_phase2_unused_index_duplicate_pass.sql
--
-- P2-5 database hygiene, continuing the `unused_index` advisor category
-- (deferred at phase 1 -- see 20260903070000's header -- pending a longer
-- idx_scan observation window; the server has been up only ~8.5 days as of
-- writing this, still short of the recommended 4-6 weeks). This migration
-- does NOT touch that observation-window-dependent work. It closes out a
-- SEPARATE, observation-window-INDEPENDENT sub-problem discovered while
-- re-scoping the category: 37 more duplicate-index pairs beyond the 24
-- phase 1 already resolved (22 plain + 2 constraint-backed) -- the same
-- "earlier duplicate-scrubbing pass wasn't exhaustive" pattern already seen
-- repeatedly in this session's RLS-policy hygiene work (Category A, and
-- later batches finding more byte-identical duplicates on `classes` and
-- `students` that Category A's own pass had missed).
--
-- ---------------------------------------------------------------------------
-- WHAT WAS FOUND AND WHY THE FIX IS SAFE REGARDLESS OF USAGE STATS
-- ---------------------------------------------------------------------------
-- 37 tables each carry a plain (non-unique) btree index whose columns,
-- operator classes, sort options, COLLATION, and predicate (for partial
-- indexes) are STRUCTURALLY IDENTICAL to an existing UNIQUE index already
-- enforcing a constraint on that table. Verified via a single query against
-- pg_index (grouping on indkey + indclass + indoption + indcollation +
-- indexprs + indpred -- not just column names, so a same-column pair with a
-- different collation or a different partial-index WHERE clause would NOT
-- have been grouped together) immediately before writing this file, then
-- independently confirmed zero anomalies (every one of the 37 groups is
-- exactly one unique + one plain index, no 3-way ties, no two-unique pairs
-- needing a constraint-level resolution like phase 1's two).
--
-- This is unconditionally safe, independent of idx_scan / the observation
-- window: a unique index is a fully general btree index PLUS a uniqueness
-- guarantee -- it can serve every query the redundant plain index could
-- (equality lookups, range scans, ORDER BY), so the query planner already
-- prefers or is indifferent between them, and dropping the plain twin
-- changes zero query plans. The plain index only doubles the write-path
-- maintenance cost (every INSERT/UPDATE/DELETE on these 37 tables was
-- maintaining two structurally-identical indexes) with no compensating
-- benefit. Also verified via a repo-wide grep that none of the 37 dropped
-- index names are referenced anywhere in application code (only in the
-- historical migrations that originally created them) -- matching phase
-- 1's own finding for its 22 plain-duplicate drops.
--
-- Every DROP INDEX statement below was generated directly from the pg_index
-- query's own output (never hand-retyped), always dropping the PLAIN
-- (non-unique) member of each pair and always keeping the UNIQUE one, since
-- it backs an actual constraint and the choice is therefore structural, not
-- an aesthetic judgment call (unlike phase 1's 22 plain-vs-plain pairs,
-- where "more descriptive name" was the tiebreaker).

DROP INDEX IF EXISTS public.idx_adaptive_interventions_active_lookup;
DROP INDEX IF EXISTS public.idx_adaptive_profile_student;
DROP INDEX IF EXISTS public.idx_admin_users_auth_user;
DROP INDEX IF EXISTS public.idx_agent_steps_run_id;
DROP INDEX IF EXISTS public.idx_rate_limits_v2_lookup;
DROP INDEX IF EXISTS public.idx_boards_code;
DROP INDEX IF EXISTS public.idx_cbse_weights_chapter;
DROP INDEX IF EXISTS public.idx_challenge_attempts_student;
DROP INDEX IF EXISTS public.idx_css_student_chapter;
DROP INDEX IF EXISTS public.idx_classes_code;
DROP INDEX IF EXISTS public.idx_cme_state_lookup;
DROP INDEX IF EXISTS public.idx_cohort_snapshots_week;
DROP INDEX IF EXISTS public.idx_content_versions_type;
DROP INDEX IF EXISTS public.idx_daily_activity_student_date;
DROP INDEX IF EXISTS public.idx_daily_challenges_grade_date;
DROP INDEX IF EXISTS public.idx_dg_student;
DROP INDEX IF EXISTS public.embedding_backfill_queue_source_idx;
DROP INDEX IF EXISTS public.idx_es_student;
DROP INDEX IF EXISTS public.idx_ff_name;
DROP INDEX IF EXISTS public.idx_institution_entitlements_school_key;
DROP INDEX IF EXISTS public.idx_interleave_config;
DROP INDEX IF EXISTS public.idx_invite_codes_code;
DROP INDEX IF EXISTS public.idx_narrative_student;
DROP INDEX IF EXISTS public.idx_onboarding_state_auth_user;
DROP INDEX IF EXISTS public.idx_payment_history_razorpay_pid;
DROP INDEX IF EXISTS public.idx_payment_history_razorpay_payment_id;
DROP INDEX IF EXISTS public.idx_perf_scores_student_subject;
DROP INDEX IF EXISTS public.idx_permissions_code;
DROP INDEX IF EXISTS public.idx_roles_name;
DROP INDEX IF EXISTS public.idx_avatar_prefs_student;
DROP INDEX IF EXISTS public.idx_student_learning_profiles_student_subject;
DROP INDEX IF EXISTS public.idx_nipun_composite_student;
DROP INDEX IF EXISTS public.idx_student_subscriptions_student_id;
DROP INDEX IF EXISTS public.idx_sync_ledger_student;
DROP INDEX IF EXISTS public.idx_tsn_teacher_student;
DROP INDEX IF EXISTS public.idx_teachers_auth_user_id;
DROP INDEX IF EXISTS public.idx_waitlist_email;
