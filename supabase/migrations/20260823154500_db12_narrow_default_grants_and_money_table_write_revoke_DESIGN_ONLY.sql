-- Migration: 20260823154500_db12_narrow_default_grants_and_money_table_write_revoke_DESIGN_ONLY.sql
-- Purpose: DB-12 remediation design (docs/audits/FIX-LEDGER.md) — narrow the schema-wide
--          `anon`/`authenticated` write grants that are inherited from the baseline
--          `ALTER DEFAULT PRIVILEGES` rule, without breaking the three SECURITY INVOKER RPCs
--          that depend on the current grant surface.
--
-- ============================================================================
-- *** THIS FILE HAS NOT BEEN APPLIED TO ANY ENVIRONMENT. DO NOT `supabase db push` THIS. ***
-- ============================================================================
-- This is a DESIGN ARTIFACT produced by an architect-agent assessment session on 2026-08-23,
-- requested explicitly as "assessment and design only, do not apply to production." It has not
-- been run against production (`shktyoxqhundlvkiwguu`), staging (`gzpxqklxwzishrkiaatd`), or any
-- other environment. It requires its own separate review/approval cycle — at minimum: architect
-- sign-off on the exact statements below, a fresh re-run of the detection queries in this header
-- against whichever environment it targets (grant state drifts — see the re-measurement below),
-- and a staging dry-run with the 3 named RPCs and the 4 money-table read/write paths exercised
-- behaviourally before any production apply. Because it lives in `supabase/migrations/`, the next
-- `supabase db push` against any linked project WILL pick this file up in version order unless a
-- human deliberately reviews it first — that is a known, accepted risk of placing a design
-- artifact in this directory rather than a inert risk of forgetting it exists, and it should be
-- treated as a blocking item on this branch until a reviewer has explicitly signed off (see
-- docs/launch-readiness/04_FINDINGS_AND_CONFLICTS.md, DB-12 design section, 2026-08-23).
--
-- ============================================================================
-- WHAT THIS FILE ASSUMES, AND WHERE THAT ASSUMPTION CAME FROM
-- ============================================================================
-- Every number below was measured live, read-only, against production `shktyoxqhundlvkiwguu` on
-- 2026-08-23 via a direct read-only Postgres connection (not PostgREST — information_schema and
-- pg_catalog are not exposed through the API surface `anon`/`authenticated` actually use, so this
-- required the `SUPABASE_DB_PASSWORD` credential and a session opened with
-- `set_session(readonly=True)`). Re-run the detection queries below before relying on any of this
-- if applying later — this ledger's own header rule applies here too: a `Before` value is
-- point-in-time, not a live gauge.
--
--   * 425 of 425 tables in schema `public` have `relrowsecurity = true`. ZERO tables have RLS
--     disabled. This directly narrows how urgent DB-12 is: there is no table today where the
--     `anon`/`authenticated` INSERT/UPDATE/DELETE grants are the ONLY thing standing between an
--     unauthorized caller and a write — RLS is the actual, universal gate for those three verbs.
--   * 43 tables have RLS enabled with ZERO policies (deny-all for every role except
--     BYPASSRLS `service_role`/`postgres`) — includes `coupons` (the DB-2 fix's intended
--     end-state) and mostly internal/operational tables (`security_*`, `textbooks`,
--     `textbook_chunks`, `users`, `invite_codes`, etc.). Deny-all is the SAFE case, not the risky
--     one — listed here so nobody later "fixes" a table that is already correctly locked down.
--   * Across ALL 425 tables, exactly ONE policy is genuinely permissive on a write verb once the
--     Postgres semantics are applied correctly (INSERT's only meaningful gate is `with_check`;
--     DELETE/UPDATE/ALL's meaningful gate is `qual`, since an unspecified `with_check` on
--     UPDATE/ALL inherits `qual` rather than defaulting open — a naive query that flags any NULL
--     column produces false positives on ~90% of write policies in this schema, because NULL is
--     the STRUCTURALLY EXPECTED value for the inapplicable column on INSERT/DELETE policies, not
--     a defect):
--
--       `demo_requests_public_insert` — INSERT, roles {anon,authenticated}, with_check = true.
--
--     This is a public lead-capture/demo-request form table, not student/PII/money data. Plausibly
--     intentional (anyone should be able to submit a demo request without an account). Left
--     untouched here — flagged as a candidate for its own, separate, low-priority ledger row if a
--     bounded per-IP/rate-limited version is ever wanted, not part of DB-12.
--   * The 4 money tables (`payment_history`, `student_subscriptions`, `subscription_events`,
--     `student_daily_usage`) carry exactly 8 policies today (4 `*_own_select` for `authenticated`
--     + 4 `service_role` ALL) — re-confirmed live, matching the ledger's documented DB-40
--     after-state exactly. Re-confirmed their `relacl` is byte-identical to the DB-1 views'
--     pre-fix pattern: `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--     authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` — i.e. `anon` and
--     `authenticated` still hold ALL EIGHT privileges, TRUNCATE included, on all 4 tables. DB-40
--     dropped policies, never grants. This file's Section 3 is the fix for that specific gap.
--   * Re-measuring the ledger's own headline DB-12 numbers: `anon` currently holds
--     INSERT/UPDATE/DELETE/TRUNCATE on 412 tables (ledger recorded 419 on 2026-08-20);
--     `authenticated` on 420 tables (ledger recorded 427). Both counts moved down by exactly 7 in
--     three days — plausibly some tables were dropped/consolidated, not investigated further here
--     since it doesn't change the shape of the fix. Re-run the query below before quoting either
--     number again.
--
-- ============================================================================
-- TRUNCATE, SPECIFICALLY — INDEPENDENTLY VERIFIED, NOT JUST REPEATED FROM THE LEDGER
-- ============================================================================
-- Two independent structural checks confirm TRUNCATE cannot be gated by row-level security at
-- all, rather than just re-asserting the ledger's claim:
--
--   1. `SELECT DISTINCT cmd FROM pg_policies` across this entire database returns exactly
--      {SELECT, INSERT, UPDATE, DELETE, ALL} — TRUNCATE has never appeared as a policy command,
--      because Postgres's `CREATE POLICY ... FOR { ALL | SELECT | INSERT | UPDATE | DELETE }`
--      syntax has no `FOR TRUNCATE` clause. There is no mechanism by which any policy, on any
--      table, in any schema, could ever restrict a TRUNCATE.
--   2. This matches PostgreSQL's own documented behaviour (Row Security Policies chapter): row
--      security does not apply to TRUNCATE, which is authorized purely by the table-level
--      TRUNCATE privilege independent of any policy.
--
-- Consequence: a table's deny-all (zero-policy) RLS posture — which fully protects it against
-- INSERT/UPDATE/DELETE for `anon`/`authenticated` today — provides ZERO protection against
-- TRUNCATE. Every one of the 412-420 tables carrying the inherited TRUNCATE grant is exposed to
-- this specific verb regardless of how tight its policies are. This is the one part of DB-12 that
-- is NOT "redundant-but-inert" anywhere in the schema — it is inert only in the sense that
-- PostgREST (the only channel through which this app's `anon`/`authenticated` Postgres roles are
-- normally reached — browser, mobile app) has no HTTP verb that maps to SQL TRUNCATE, so there is
-- no known DIRECT external exploitation path via the product's REST surface today. It remains a
-- real, live latent capability, reachable by: (a) any current or future SECURITY INVOKER RPC or
-- Edge Function that ever executes a TRUNCATE statement built from caller input, (b) a direct
-- Postgres connection opened as `anon`/`authenticated` (e.g. a leaked pooler connection string
-- carrying a low-privilege JWT claim), or (c) a Supabase Studio SQL editor session run under
-- anything other than the `postgres`/`service_role` identity. That is precisely why Section 2/3
-- below close it rather than deprioritising it because "nothing calls it today."
--
-- ============================================================================
-- THE 3 SECURITY INVOKER RPCs — FULL CALL-CHAIN TRACED, NOT ASSUMED
-- ============================================================================
-- Live `pg_get_functiondef` + `prosecdef` pulled for all three (2026-08-23). All three ARE
-- SECURITY INVOKER (`prosecdef = false`) with a pinned `search_path = public, pg_temp` — the
-- ledger's premise is confirmed, not just repeated:
--
--   * `record_learning_event(p_student_id, p_topic_id, p_is_correct, ...)`
--       INSERT INTO adaptive_interactions (...)
--       PERFORM update_mastery_bkt(...)          -- ALSO SECURITY INVOKER (prosecdef=false) --
--                                                    traced one level deeper, not assumed safe:
--           SELECT ... FROM concept_mastery WHERE student_id=... AND topic_id=...
--           INSERT INTO concept_mastery (...)     -- first-attempt path
--           UPDATE concept_mastery SET ... WHERE id = ...
--       SELECT s.code FROM curriculum_topics ct JOIN subjects s ON ... WHERE ct.id = p_topic_id
--       PERFORM award_xp(...)                    -- this one IS SECURITY DEFINER
--                                                    (prosecdef=true) — unaffected by any grant
--                                                    change, runs as the function owner.
--
--     Caller-role dependency, once the invoker chain is followed fully: INSERT on
--     `adaptive_interactions`; SELECT + INSERT + UPDATE on `concept_mastery`; SELECT on
--     `curriculum_topics` and `subjects`.
--
--   * `mark_notification_read(p_notification_id)`
--       UPDATE notifications SET is_read = true, read_at = now() WHERE id = p_notification_id
--
--     Caller-role dependency: UPDATE on `notifications`. NOTE: the function itself performs NO
--     ownership check on `p_notification_id` — the entire authorization boundary is the
--     `notif_own` RLS policy on `notifications` (scoped to
--     `recipient_id = get_my_student_id() OR recipient_id = get_my_guardian_id() OR ...`),
--     independently confirmed NOT permissive (qual is a real predicate, not `true`/NULL — see the
--     schema-wide permissive-policy sweep above). This is a structural reason to be careful with
--     ANY future default-privileges narrowing that touches `notifications`: the UPDATE grant is
--     the only thing that lets the RLS policy get evaluated at all. Revoking it would not make the
--     function "more secure" — it would break the feature outright (every notification-read
--     action would 42501).
--
--   * `teacher_create_class(p_teacher_id, p_name, p_grade, p_section, p_subject)`
--       SELECT school_id FROM teachers WHERE id = p_teacher_id
--       INSERT INTO classes (...) RETURNING id, class_code
--       INSERT INTO class_teachers (...)
--
--     Caller-role dependency: SELECT on `teachers`; INSERT on `classes` and `class_teachers`.
--     NOTE: same structural observation as above — the function does not itself verify that
--     `auth.uid()` corresponds to `p_teacher_id`; whatever ownership boundary exists must live in
--     the INSERT policies' `WITH CHECK` on `classes`/`class_teachers`, not in this function body.
--     Not re-verified in this pass (out of scope for a grants-only design) — flagged as a
--     dependency that MUST be re-checked before this function's grants are ever narrowed further
--     than "leave alone."
--
-- None of the tables in this call chain (`adaptive_interactions`, `concept_mastery`,
-- `curriculum_topics`, `subjects`, `notifications`, `teachers`, `classes`, `class_teachers`) are
-- touched by Section 3's targeted revoke below. Section 1 grants below are therefore genuine
-- carve-outs in the sense the task asked for — explicit, named, self-sufficient assertions that
-- would still be true even if a future, broader schema-wide revoke pass ever reached these tables
-- without re-reading this file first.
--
-- ============================================================================
-- WHY TRUNCATE IS HANDLED SCHEMA-WIDE, BUT INSERT/UPDATE/DELETE ARE NOT (THIS TIME)
-- ============================================================================
-- These are deliberately NOT symmetric, for a reason grounded in the measurements above:
--
--   * TRUNCATE is revoked SCHEMA-WIDE (Section 2 for future tables, Section... see note below for
--     existing tables) because (a) it is NEVER mitigated by RLS, on any table, under any policy
--     configuration — the "43 tables are already deny-all" and "only 1 permissive write policy
--     exists" findings above are IRRELEVANT to TRUNCATE risk, and (b) no legitimate use of
--     `anon`/`authenticated` TRUNCATE was found anywhere in this codebase (grep across
--     `apps/host`, `packages`, `supabase/functions`, `mobile` for the literal string `TRUNCATE`
--     turns up no application code path that issues it as a non-admin role). A blanket revoke of
--     one verb, schema-wide, that provably has zero legitimate callers is low-risk in a way a
--     blanket revoke of INSERT/UPDATE/DELETE is not.
--   * INSERT/UPDATE/DELETE are revoked ONLY on the 4 named money tables (Section 3), per this
--     task's explicit scope ("the money tables at minimum"). A schema-wide revoke of these three
--     verbs is EXPLICITLY NOT ATTEMPTED HERE — it needs the "complete write-path map" that
--     `20260821121232_converge_money_table_client_write_policies.sql`'s own header already
--     identified as the blocking prerequisite, given at least one genuinely-permissive,
--     plausibly-intentional write policy exists in this schema today (`demo_requests`) and there
--     may be others not surfaced by this pass's specific heuristics (e.g. permissive SELECT-only
--     exposure was not the target of this sweep — that is DB-2/DB-7's territory, already handled
--     or tracked separately). Treat a full schema-wide INSERT/UPDATE/DELETE narrowing as separate,
--     larger, future work — this design intentionally keeps this file's blast radius small and
--     reviewable, matching the scope discipline `20260821082059` and `20260821121232` both used.
--
-- ============================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT TOUCH
-- ============================================================================
--   * The 7 SECURITY DEFINER-behaving views closed by
--     `supabase/migrations/20260821082059_restrict_secdef_views_to_service_role.sql`
--     (`question_bank_student_safe`, `v_analytics_freshness_status`, `v_backup_health_summary`,
--     `v_my_consent_status`, `v_queue_health`, `v_secret_rotation_health`, `v_xp_ledger_drift`).
--     Section 2's dynamic loop is scoped to `pg_class.relkind = 'r'` (ordinary base tables) —
--     views are excluded BY CONSTRUCTION, not by naming them and hoping the exclusion list stays
--     accurate. Independently re-confirmed live (2026-08-23) that all 7 already show
--     `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` — no `anon`/`authenticated`
--     entry remains on any of them — so this file has nothing to do there even if it were scoped
--     to touch views, which it is not.
--   * `demo_requests_public_insert` (see above) — left alone, flagged as a separate candidate.
--   * Any SELECT grant, anywhere. This file only ever touches INSERT/UPDATE/DELETE/TRUNCATE.
--   * Any RLS policy. Zero `CREATE POLICY`/`DROP POLICY`/`ALTER POLICY` statements appear below.
--   * `coupons` — already deny-all (DB-2), carries the same stale ACL pattern as the money tables,
--     but is explicitly out of this file's "money tables" scope. Flagged as a candidate for the
--     next batch, not included here to keep this design's diff small and reviewable.
--
-- ============================================================================
-- REQUIRED FOLLOW-UP IF THIS IS EVER APPLIED
-- ============================================================================
--   1. Every future migration that CREATEs a table needing `authenticated` (or, rarely, `anon`)
--      writes MUST include an explicit `GRANT INSERT/UPDATE/DELETE ON <table> TO authenticated;`
--      in the SAME migration, once Section 2 lands — the implicit default-privileges grant that
--      silently provided this today will no longer exist for tables created after this migration.
--      The `supabase-patterns` skill's migration template does not currently show this step
--      (it relies on the same implicit default this migration narrows) and should be updated in
--      the same change that applies this file, or every author after this point will hit a
--      confusing `permission denied for table` (42501) the first time RLS is NOT the reason a
--      write fails.
--   2. A DOWN/rollback runbook (docs/runbooks/<applied-ledger-version>_....DOWN.sql) must be
--      authored AT THE TIME this is actually applied — deliberately not pre-written here, because
--      per this repo's own established convention (see `20260821082059`, `20260821121232`), the
--      ledger version this file is stamped with on `supabase db push` will not match its authored
--      filename prefix, and the DOWN file must be named to match the STAMPED version, not the
--      authored one.
--   3. Re-run every detection query in this header against the target environment immediately
--      before applying, and again immediately after, exactly as the `Before`/`After` columns in
--      docs/audits/FIX-LEDGER.md expect. Behaviourally re-verify the 3 RPCs under a real
--      `authenticated` JWT (not just a catalog read) and the 4 money tables' read/write paths,
--      the same way DB-40's re-verification did.
--   4. This design was produced by the architect agent in an assessment-only capacity per an
--      explicit "DO NOT APPLY TO PRODUCTION" instruction. It requires independent review before
--      any apply — do not treat this header's own reasoning as that review.
--
-- Ledger: docs/audits/FIX-LEDGER.md (DB-12). Design writeup:
--         docs/launch-readiness/04_FINDINGS_AND_CONFLICTS.md, DB-12 section, 2026-08-23.
-- Precedents this design follows: 20260821082059_restrict_secdef_views_to_service_role.sql
--         (named-object scope discipline, self-sufficient re-assertion, "does not fix root
--         cause" honesty), 20260821121232_converge_money_table_client_write_policies.sql
--         (explicitly names these same 3 RPCs and 4 money tables as the reason DB-12 is deferred).

BEGIN;

-- ============================================================================
-- SECTION 1 — EXPLICIT CARVE-OUTS FOR THE 3 SECURITY INVOKER RPCs
-- ============================================================================
-- Every grant below is ALREADY TRUE today via the baseline default-privileges rule. Asserting
-- them explicitly here makes this migration SELF-SUFFICIENT: the 3 RPCs keep working even if a
-- later, separate migration narrows or removes the baseline default further, WITHOUT that later
-- migration author needing to have read this file first. Carve-outs, not revoke-then-regrant —
-- these statements never revoke anything; Sections 2/3 below never touch any of these 8 tables.

-- record_learning_event() direct writes + update_mastery_bkt() (its own SECURITY INVOKER callee)
GRANT INSERT ON public.adaptive_interactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.concept_mastery TO authenticated;
GRANT SELECT ON public.curriculum_topics TO authenticated;
GRANT SELECT ON public.subjects TO authenticated;

-- mark_notification_read() — UPDATE grant only; the ownership boundary is the notif_own RLS
-- policy (independently confirmed non-permissive above), not this grant. Do not read this GRANT
-- as itself providing the security boundary.
GRANT UPDATE ON public.notifications TO authenticated;

-- teacher_create_class() — this function does not itself verify p_teacher_id ownership; the
-- WITH CHECK on classes/class_teachers' INSERT policies is the real boundary and was NOT
-- re-verified in this pass (see header note). This grant is a prerequisite for that boundary to
-- even be reachable, not a substitute for it.
GRANT SELECT ON public.teachers TO authenticated;
GRANT INSERT ON public.classes TO authenticated;
GRANT INSERT ON public.class_teachers TO authenticated;


-- ============================================================================
-- SECTION 2 — NARROW THE DEFAULT-PRIVILEGES TEMPLATE FOR *FUTURE* TABLES ONLY
-- ============================================================================
-- Root-cause fix for the going-forward half of DB-12. Affects ONLY tables created after this
-- migration by role `postgres` in schema `public` — zero behaviour change for any of the 425
-- tables that exist today (those are handled, narrowly, in Section 3, plus the schema-wide
-- TRUNCATE-only sweep immediately below). SELECT is deliberately left untouched in the default
-- template — PostgREST read paths for new tables continue to rely on RLS to filter rows, matching
-- the existing, working pattern for all 425 current tables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM authenticated;


-- ============================================================================
-- SECTION 3 — TRUNCATE: SCHEMA-WIDE REVOKE ON *EXISTING* BASE TABLES
-- ============================================================================
-- TRUNCATE is revoked from every existing ordinary table in `public` — see the header's
-- "why TRUNCATE is handled schema-wide" note for the asymmetry rationale. Scoped to
-- `relkind = 'r'` so the 7 DB-1 views (relkind = 'v') are excluded BY CONSTRUCTION, not by a
-- naming list that could drift. `PUBLIC` is named for defence in depth only, matching
-- `20260821082059`'s convention — no bare-PUBLIC aclitem was found on any table in this schema;
-- `anon` and `authenticated` are the grantees that actually hold TRUNCATE.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated;', r.relname);
  END LOOP;
END $$;


-- ============================================================================
-- SECTION 4 — MONEY TABLES: TARGETED INSERT/UPDATE/DELETE REVOKE (NAMED, NOT DYNAMIC)
-- ============================================================================
-- The 4 tables this task named explicitly. TRUNCATE on these 4 is already closed by Section 3
-- above (they are ordinary base tables and were swept by that loop) — these statements cover the
-- remaining 3 verbs, which today are RLS-redundant (no INSERT/UPDATE/DELETE policy exists for
-- `authenticated` on any of the 4 — only `*_own_select` + `service_role ALL`, re-confirmed live
-- 2026-08-23) but removing the grant closes the "someone adds a permissive write policy later and
-- there's no privilege barrier behind it to catch the mistake" gap the DB-1 precedent explicitly
-- warned about for exactly this pattern. SELECT is deliberately NOT revoked — the `*_own_select`
-- policies require it to function; revoking SELECT would turn "read your own rows" into "read
-- nothing" (42501), a regression, not a hardening.
REVOKE INSERT, UPDATE, DELETE ON public.payment_history        FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_subscriptions  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.subscription_events    FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_daily_usage    FROM PUBLIC, anon, authenticated;

-- Self-sufficiency assertion, matching `20260821082059`'s convention: SELECT was never revoked
-- above, so this is a no-op against captured production state, included only so this migration
-- does not depend on what happened to already be true on a fresh environment.
GRANT SELECT ON public.payment_history        TO authenticated;
GRANT SELECT ON public.student_subscriptions  TO authenticated;
GRANT SELECT ON public.subscription_events    TO authenticated;
GRANT SELECT ON public.student_daily_usage    TO authenticated;

COMMIT;
