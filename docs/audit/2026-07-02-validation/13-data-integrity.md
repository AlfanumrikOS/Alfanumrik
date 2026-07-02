# Phase 2 Validation — Data Integrity Audit (2026-07-02, re-spawn)

Static audit only. Source: `supabase/migrations/00000000000000_baseline_from_prod.sql`
(pg_dump-derived baseline) + all subsequent root-level dated migrations through
`20260702130000_xc3_student_select_helper.sql` (345 root files total). No live DB
connection — every verdict below is derived from migration SQL text and `src/` grep.

## D-1: Referential integrity (FK constraints on the 15 hottest tables)
STATUS: DONE (exhaustive — every `*_id`-shaped column on all 15 named tables checked
against the full `ADD CONSTRAINT ... FOREIGN KEY` set in the chain)

**Verdict: PARTIALLY CONFIRMED — 11/15 tables fully FK-constrained; 4 have confirmed
unconstrained `*_id` columns.**

Method: for each table, enumerated every `*_id` (and `question_id`/`plan_id`-shaped)
column from its `CREATE TABLE`, then grepped the full migration chain for a matching
`FOREIGN KEY` on that exact column. Baseline tables checked via
`00000000000000_baseline_from_prod.sql`; net-new tables (`adaptive_interventions`,
`learner_twin_snapshots`, `learner_twin_memory`) checked via their own migrations
(`20260619000200`, `20260702000200`, `20260702000300`). No `monthly_synthesis_runs`/
`dive_artifacts`/`parent_student_links` in the baseline — located at
`20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql` and
`20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql`; `parent_student_links` does
not exist as a table name anywhere in the chain — only `guardian_student_links` does
(confirms the prompt's "either/or" framing was correct to hedge).

### Fully constrained (11/15)
`students` (auth_user_id → auth.users, school_id → schools), `quiz_sessions`
(student_id → students CASCADE, school_id → schools), `question_bank` (topic_id →
curriculum_topics, chapter_id → chapters ×2 redundant constraints, cbse_paper_id →
cbse_board_papers, created_by/updated_by/reviewed_by/published_by → auth.users, subject
→ subjects.code), `student_subscriptions` (student_id → students CASCADE, plan_id →
subscription_plans), `class_students` (class_id → classes CASCADE, student_id →
students CASCADE), `xp_transactions` (student_id → students CASCADE — `reference_id` is
a synthetic dedupe key, not a table reference, correctly untyped as FK),
`adaptive_interventions` (student_id → students CASCADE, teacher_assignment_id →
teacher_remediation_assignments SET NULL), `learner_twin_snapshots` (student_id →
students CASCADE), `payment_webhook_events` (no internal `*_id`-shaped column at all —
`razorpay_account_id`/`razorpay_event_id` are external Razorpay string identifiers, not
surrogate-key references, so N/A rather than a gap).

### Confirmed unconstrained `*_id` columns (orphan-row risk) — 4/15 tables

1. **`quiz_responses.question_id`** (`00000000000000_baseline_from_prod.sql:12197-12225`
   define; FK block at the same file has only `quiz_session_id → quiz_sessions` and
   `student_id → students`, no constraint on `question_id`). This is the single
   highest-severity finding: **four other tables in the same schema correctly FK the
   identical column name to `question_bank(id)`** — `content_reports.question_id`
   (baseline:18933), `question_misconceptions.question_id` (baseline:19297),
   `question_responses.question_id` (baseline:19309),
   `user_question_history.question_id` (baseline:19773), plus post-baseline
   `mock_test_attempts.question_id` (`20260520000008_mock_test_attempts.sql:114`) and
   `learning_events.question_id` (`20260615122657_create_learning_events.sql:13`) — but
   `quiz_responses`, the table that records every live quiz answer (the P1/P4-critical
   write path), does not. A `question_bank` row deletion or a client-supplied bogus
   `question_id` can silently orphan the per-question audit trail for the platform's
   highest-traffic write. [SEVERITY: HIGH]
2. **`learner_twin_memory.concept_topic_id`, `learner_twin_memory.misconception_id`**
   (`20260702000300_learner_twin_memory.sql:36-37`) — both nullable `uuid`, no
   `REFERENCES` clause, and no FK found anywhere else in the chain. `student_id` on the
   same table IS correctly constrained. Lower severity than #1 because these are
   nullable "may reference a catalog entity" fields on a brand-new (2026-07-02) append-
   only table, not the core write path — but the same orphan-row exposure exists.
   [SEVERITY: MEDIUM]
3. **`monthly_synthesis_runs.student_id`** (`20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql:25-38`)
   — declared `uuid NOT NULL` with only a `UNIQUE (student_id, synthesis_month)`
   constraint and RLS policies that reference `students` indirectly (via a subquery),
   but **no `FOREIGN KEY` to `students(id)` anywhere in the chain**. Every peer
   pedagogy-v2 table checked elsewhere in this audit (`adaptive_interventions`,
   `learner_twin_snapshots`, `dive_artifacts`) uses the identical `student_id uuid NOT
   NULL` shape — three of four correctly add `REFERENCES public.students(id)`, this one
   doesn't. [SEVERITY: MEDIUM — student_id is NOT NULL and the RLS-linked lookup will
   simply return zero rows for an orphan, so no cross-tenant leak, but a deleted
   student's monthly synthesis rows will not cascade and will accumulate as dead rows]
4. **`dive_artifacts.student_id`** (`20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql:59-74`)
   — same pattern as #3: `uuid NOT NULL`, `UNIQUE (student_id, iso_week)`, RLS via
   subquery, **no FK to `students(id)`**. Additionally `phenomenon_slug TEXT` (nullable,
   set only when `picker_option = 'phenomenon'`) has no FK to `phenomena.slug` despite
   `phenomena` being created in the same migration two tables above it — a second,
   smaller unconstrained reference in the same file. [SEVERITY: MEDIUM]

### Intentionally-unconstrained (polymorphic / audit-trail — not counted as defects)

- **`notifications.recipient_id` / `notifications.sender_id`**
  (`00000000000000_baseline_from_prod.sql:12503-12520`) — both `uuid`, no FK, paired
  with `recipient_type`/`sender_type` discriminator columns. This is a polymorphic
  association (recipient can be a student, teacher, guardian, or admin row) — Postgres
  cannot express a single-column FK across multiple target tables, so this is a
  structural trade-off inherent to the polymorphic design, not an oversight. Flagged for
  completeness since it IS a real orphan-row/type-mismatch risk in practice (nothing
  stops `recipient_type='student'` from pairing with a `guardians.id` value at the DB
  layer — that validation, if it exists, is app-layer only) but not counted in the "4
  tables" headline above since fixing it would require a schema redesign (e.g.
  per-recipient-type nullable FK columns), not a missing-constraint bug.
- **`guardian_student_links.approved_by` / `guardian_student_links.revoked_by`**
  (baseline:11411-11428) — both `uuid`, no FK (only supporting indexes
  `idx_guardian_links_approved`, `idx_gsl_revoked_by` at lines 17165/17153). These are
  audit-trail "who acted" columns (presumably `auth.users.id` of the approving/revoking
  guardian or admin), not core relational data — lower-severity than #1-4 since the
  table's actual relational spine (`guardian_id`, `student_id`) is fully constrained.

**Exhaustive vs sampled**: exhaustive for the 15 named tables (every `*_id`-shaped
column on each was individually checked against the full-chain FK grep, not sampled).
Not exhaustive beyond those 15 — the discovery-phase document (`docs/audit/2026-07-02-discovery/03-data-infra.md`)
explicitly notes chain-wide FK/constraint completeness across all 364 tables was "not
independently re-verified" and remains out of scope here too.

## D-2: Orphaned backup tables (PII/retention liability)
STATUS: DONE (exhaustive — both flagged names checked directly against their creating
migrations + `src/` grep)

**Verdict: CONFIRMED they exist and are orphaned; REFUTED as a PII liability.**

Two backup tables, both created as pre-change rollback snapshots by data-fix
migrations, both still present with no follow-up `DROP TABLE` migration found anywhere
in the chain:

| Table | Created by | Columns | PII-shaped? |
|---|---|---|---|
| `_ao10b_grade_backfill_backup` | `supabase/migrations/20260702070000_ao10b_backfill_student_grade_p5.sql:75-80` | `id uuid`, `old_grade text`, `new_grade text`, `backfilled_at timestamptz` | **No.** Migration's own comment at line 74 states "id is a UUID — no PII." Only grade-string values captured. |
| `_tsb4_isactive_backfill_backup` | `supabase/migrations/20260702060000_class_membership_isactive_backfill.sql:84-90` | `class_id uuid`, `student_id uuid`, `table_name text`, `old_is_active boolean`, `backfilled_at timestamptz` | **No.** Migration's own header comment (lines 81-82) states "service-role-only forensic/rollback table (UUIDs only, no PII)." |

Both tables:
- Have RLS **enabled** with an explicit service-role-only policy (`_ao10b_backup_service_role_all`
  at line 87; `_tsb4_isactive_backfill_backup_service_role` at line 96) — not merely
  RLS-on-no-policy like `mass_gen_log`/`school_subscriptions`.
- Are read **only** by their own test files (`src/__tests__/ao10b-grade-backfill.test.ts`,
  `src/__tests__/tsb4-enrollments-rls-reconcile.test.ts`) — no production application
  code (`src/app/`, `src/lib/`) references either table name. Confirmed by grep across
  `src/`.

**Conclusion**: orphaned (no cleanup migration), but not a retention/PII liability —
both store only surrogate UUIDs, grade strings, and a boolean, and are explicitly
documented as PII-free in their own creating migrations. This matches the discovery-phase
finding in `docs/audit/2026-07-02-discovery/03-data-infra.md` §6.4. [SEVERITY: LOW —
schema clutter / hygiene item, safe to `DROP TABLE` (with user approval per the
architect's DROP rule) once the underlying backfills are confirmed stable, not a
data-privacy defect]

## D-3: `mass_gen_log` RLS-no-policy documentation check
STATUS: DONE (exhaustive full-chain grep)

**Verdict: CONFIRMED — RLS enabled, zero policies, and NOT documented the way
`school_subscriptions` is.**

- `mass_gen_log` created at `supabase/migrations/00000000000000_baseline_from_prod.sql:12136-12144`;
  RLS enabled at line 21377 (`ALTER TABLE "public"."mass_gen_log" ENABLE ROW LEVEL
  SECURITY`).
- Full-chain grep for `CREATE POLICY ... mass_gen_log` across all 345 root migrations:
  **zero matches.** No policy exists for this table anywhere in the chain.
- Full-chain grep for `mass_gen_log` outside the baseline file: **zero matches in any
  other migration** — confirms no dedicated documentation migration exists (unlike
  `school_subscriptions`, which got `supabase/migrations/20260516030000_document_school_subscriptions_rls.sql`
  adding `COMMENT ON TABLE public.school_subscriptions IS 'Service-role only... intentional...'`).
  No equivalent `COMMENT ON TABLE public.mass_gen_log` exists in the migration chain.
- **Partial documentation does exist, but at the test layer, not the schema layer**:
  `src/__tests__/rls-inventory.test.ts:258` pins `AUDIT_DENY_ALL = ['mass_gen_log',
  'school_subscriptions']` with a test asserting "BASELINE deny-all is EXACTLY
  {mass_gen_log, school_subscriptions}" — so the zero-policy posture is a known,
  regression-tested invariant, but a future Supabase-advisor `0008_rls_enabled_no_policy`
  lint pass or a new engineer reading the schema in isolation would see no in-DB
  rationale comment on `mass_gen_log` the way they would for `school_subscriptions`.
- Columns (`id`, `net_req_id`, `grade`, `subject`, `chapter_number`, `chapter_title`,
  `fired_at`, `status`) are non-PII — consistent with an internal bulk-question-generation
  firing log.
- No reader found: grep across `src/` finds only the test file and the generated
  `src/types/database.types.ts` type stub; grep across `supabase/functions/` finds zero
  references. The table appears to be dead/unused by any live write or read path (no
  Edge Function or API route inserts into or selects from it), which is consistent with
  the zero-policy posture being low-risk regardless of documentation gap.

This confirms the discovery-phase finding in `docs/audit/2026-07-02-discovery/03-data-infra.md`
§6.5 verbatim. [SEVERITY: LOW — same "likely-intentional, needs a one-line
`COMMENT ON TABLE`" follow-up the discovery doc already recommended; not a live
data-exposure risk since no code path reads/writes the table]

## D-4: Grade-format (P5) sweep — integer/smallint grade columns or parseInt/Number(grade)
STATUS: DONE (exhaustive regex sweep of `supabase/migrations/` for integer-typed grade
columns + full `src/` grep for `parseInt`/`Number` applied to grade values)

**Verdict: REFUTED as a live P1-severity violation of P5's storage/interface rule; two
schema-drift items CONFIRMED and worth flagging.**

The canonical `students.grade` (and every other `*.grade`/`grade_*` column that stores
actual per-student grade identity, e.g. `question_bank.grade`, `question_bank.target_grade`
where sampled) is `text` throughout the baseline and every post-baseline migration — no
`CREATE TABLE`/`ALTER TABLE` sets a grade-identity column to `integer`/`smallint`. TS
types confirm the same: `grade: string` at `src/lib/types.ts:11,84,354,397,519,543,623`
(line 354 carries an explicit `// P5: grade is a string` comment).

**Two schema-drift items found (not storage violations, but worth a Phase 3 look):**

1. **`launch_narrative_burst()` RPC casts grade to int for a range comparison.**
   `supabase/migrations/00000000000000_baseline_from_prod.sql:5567-5570` (function
   `public.launch_narrative_burst`): `v_grade_num := regexp_replace(v_student.grade,
   '[^0-9]', '', 'g')::int;` then compares `v_grade_num >= min_grade AND v_grade_num <=
   max_grade` against `public.narrative_templates.min_grade`/`max_grade`, both declared
   `integer` at lines 12352-12353. This is a **local coercion for range comparison only**
   — `students.grade` itself is never written back as an int, and `narrative_templates`
   is a config/range table (story-gating bounds), not student identity data. This
   mirrors the same accepted "coerce for comparison" pattern the frontend uses (see
   item 3 below) — REFUTED as a P5 storage violation, but flagged because it is the one
   SQL-side CAST-to-int-of-grade found in the entire chain.
2. **`tutor_personas.target_grades` is `integer[]`, inconsistent with 5 sibling
   `target_grades` columns that are all `text[]`.** Baseline line 14601
   (`tutor_personas`) vs. lines 9480, 11217, 12594, 12688, 13323 (all `"target_grades"
   "text"[]` on other tables — one, line 12688, even defaults to `ARRAY['Grade
   6'::text', ...]` prefixed strings). Grep across `src/**/*.{ts,tsx}` and
   `supabase/**/*.sql` for `tutor_personas` finds **zero references outside the
   generated `src/types/database.types.ts` stub and the baseline migration itself** —
   the table appears to be dead/unused by any live read or write path, so this
   inconsistency has no runtime blast radius today, but it's a real type-shape
   inconsistency that would bite the moment someone builds a feature against
   `tutor_personas`. [SEVERITY: LOW — dead-table schema inconsistency, not a live bug]

**`parseInt`/`Number()` applied to grade values in `src/` — 14 call sites, all local
numeric-comparison/sort/range-check coercions, none writing the coerced value back to
DB/API/state as the canonical representation:**

`src/app/api/dive/state/route.ts:83`, `src/app/onboarding/page.tsx:116` (comment only,
documents the convention), `src/app/profile/page.tsx:429-430`, `src/lib/sanitize.ts:65`
(`isValidGrade` — validates range, returns boolean, does not mutate storage),
`src/lib/quiz-engine.ts:375`, `src/app/api/school-admin/reports/route.ts:115` (sort
comparator), `src/components/navigation/MobileBottomNav.tsx:82`,
`src/components/navigation/DesktopSidebar.tsx:21`, `src/lib/ncert-solver.ts:165`,
`src/lib/ai/validation/output-guard.ts:112`, `src/lib/exam-engine.ts:72,211`,
`src/lib/ai/validation/content-guard.ts:60`, `src/lib/foxy/curriculum-scope.ts:219`,
`src/app/api/rhythm/today/route.ts:318,325`.

This matches the codebase's own explicitly documented convention (comment at
`src/app/onboarding/page.tsx:112-118`): storage is always the bare string `"6".."12"`;
"TS consumers parseInt(student.grade) / compare (grade === '11') / interpolate (Class
{grade})" are all treated as legitimate reader-side patterns, with the SQL side using
`normalize_grade()` for its own coercion needs. **REFUTED as a P5 violation** — P5
governs the stored/interface representation, and every DB column, RPC parameter, API
payload, and TS type sampled remains `string`/`text`. Local numeric coercion for
comparison/sort is the accepted, in-repo-documented pattern, not the "hardcoded
integer grade" class of bug the invariant exists to prevent.

## D-5: Soft-delete honoring (salvaged from prior run — cited, not re-investigated)
STATUS: DONE (reproduced from `00-orchestrator-salvage.md`, not re-investigated per instructions)

**Verdict: UNPROVEN / two confirmed gaps.**

7/10 reader surfaces honor `is_active`. Two gaps confirmed by the prior run:

1. **`src/app/api/quiz/route.ts:155-171` — NO `is_active`/`account_status` gate.** A
   soft-deleted student holding a still-valid JWT can start/submit a quiz server-side.
   [SEVERITY: HIGH — bypasses account deactivation at the single highest-traffic
   student-facing write path]
2. **`students` RLS encodes no `is_active` predicate.** Deactivation correctness is
   app-layer only — RLS itself does not defend against a soft-deleted student's own
   row-level reads/writes once the JWT is valid. [SEVERITY: MEDIUM — defense-in-depth
   gap, not a standalone exploit since app-layer gates exist elsewhere]

Deletion shape: soft-delete on the `students` row itself, combined with **hard-delete**
of ~18 dependent tables (including `class_students`, `guardian_student_links`). A
separate DPDP 30-day erasure flow also exists independently of this soft-delete path.

Evidence file:line: `src/app/api/quiz/route.ts:155-171` (no gate); `students` table RLS
policies (baseline + chain) — no `is_active = true` predicate found in any policy
`USING`/`WITH CHECK` clause on `students`.

## D-6: Idempotency-backing unique constraints
STATUS: DONE (exhaustive — all three named constraints located and read directly)

**Verdict: CONFIRMED — all three exist in the migration chain.**

| Constraint | Location | Shape |
|---|---|---|
| `payment_webhook_events` dedupe | `00000000000000_baseline_from_prod.sql:15720` | `ADD CONSTRAINT "payment_webhook_events_unique_event" UNIQUE ("razorpay_account_id", "razorpay_event_id")`. Backed by an `ON CONFLICT (razorpay_account_id, razorpay_event_id) DO NOTHING` write path at line 6520 inside the webhook-ingest function. Matches P11's "Event-level idempotency lives in `payment_webhook_events` (unique on razorpay_event_id)" claim — the actual key is the composite `(razorpay_account_id, razorpay_event_id)`, a stricter/equivalent form (correct for multi-account Razorpay setups, not a deviation). |
| `adaptive_interventions` dedupe | `supabase/migrations/20260619000200_adaptive_interventions.sql:129-131` | `CREATE UNIQUE INDEX IF NOT EXISTS adaptive_interventions_one_active ON public.adaptive_interventions (student_id, subject_code, chapter_number) WHERE status = 'active'` — a partial unique index enforcing "at most one active intervention per (student, subject, chapter)" at the DB level, explicitly commented as "race-proof against concurrent/duplicate cron invocations" (guardrail 5). A sibling table (`teacher_remediation_assignments`, the B2B escalation target) has its own analogous backstop: `uq_teacher_remediation_assignments_open_dedupe` in `supabase/migrations/20260619000400_teacher_remediation_dedupe_index.sql:121-127`, a COALESCE-expression unique index over `(student_id, class_id, COALESCE(chapter_id, nil-uuid))` guarding `status='assigned'`. |
| `xp_transactions` dedupe | `00000000000000_baseline_from_prod.sql:18221` | `CREATE UNIQUE INDEX "idx_xp_txn_reference_id" ON "public"."xp_transactions" USING "btree" ("reference_id") WHERE ("reference_id" IS NOT NULL)` — this constraint **predates and is unmodified by** `20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql`; that migration's own header explicitly states "No table / column / index / RLS / RBAC change" (line 89-90 of that file). What `20260702020000` actually fixes is the *producer* side of the bug: the `fn_quiz_session_sync_profile()` AFTER-INSERT trigger was writing a **second, uncapped** XP increment directly to `students.xp_total`/`student_learning_profiles` (bypassing the ledger and the pre-existing `idx_xp_txn_reference_id` unique index entirely, since it never touched `xp_transactions`), while `atomic_quiz_profile_update()` wrote the capped, ledgered, ON-CONFLICT-protected copy. The migration neuters the trigger down to streak-only maintenance so `atomic_quiz_profile_update` is the sole XP writer — a correctness fix for a **P2 double-award bug**, not a change to the dedupe constraint itself. |

**Interesting secondary finding (not one of the 3 asked-for constraints, surfaced during
verification):** `subscription_events` also carries a dedupe index —
`CREATE UNIQUE INDEX "idx_sub_events_idempotent" ON "public"."subscription_events" USING
"btree" ("razorpay_event_id") WHERE ("razorpay_event_id" IS NOT NULL)` (baseline line
18035) — consistent with the same idempotency discipline being applied across the
payments surface, not just the single table named in the prompt.

All three requested constraints are real, live (not dead/commented-out), and correctly
wired to an `ON CONFLICT`/partial-unique-index enforcement point in their respective
write paths.

## D-7: RAG RPC liveness (salvaged from prior run — cited, not re-investigated)
STATUS: DONE (reproduced from `00-orchestrator-salvage.md`, not re-investigated per instructions)

**Verdict: CONFIRMED — 4 of 6 RAG-retrieval RPCs are dead/test-only.**

| RPC | Status |
|---|---|
| `search_rag_chunks` | **DEAD** — no live caller |
| `hybrid_rag_search` | **TEST-ONLY** — exercised only by test code, not a live request path |
| `get_rag_chunks_for_node` | **DEAD** — paired with `get_rag_context_for_adaptive`, `EXECUTE` already revoked |
| `get_rag_context_for_adaptive` | **DEAD** — same pair, `EXECUTE` already revoked |
| `match_rag_chunks_ncert` | LIVE |
| `select_quiz_questions_rag` | LIVE |
| `match_rag_chunks` | LIVE |

Additional finding: **`match_rag_chunks_v2` fallback is dead-on-arrival** — a v2 code
path exists but was never migrated, so the fallback can never actually execute.

This corroborates the independent discovery-phase finding in
`docs/audit/2026-07-02-discovery/03-data-infra.md` §6.7, which flags the same RAG RPC
cluster (`hybrid_rag_search`, `match_rag_chunks`, `match_rag_chunks_ncert`,
`search_rag_chunks`, `select_quiz_questions_rag`, `get_rag_chunks_for_node`) as
"overlapping signatures... iterative refinements... rather than clearly distinct call
sites" and recommends an ai-engineer-owned consolidation review. [SEVERITY: LOW-MEDIUM —
dead-code/schema-clutter, not a correctness or security defect, but the
`EXECUTE`-revoked pair suggests a prior remediation was already half-done]

## Phase 3 queue (severity-ranked)
STATUS: DONE

| # | Finding | Severity | Source | Fix shape |
|---|---|---|---|---|
| 1 | `src/app/api/quiz/route.ts:155-171` has no `is_active`/`account_status` gate — soft-deleted student with a valid JWT can start/submit quizzes server-side | HIGH | D-5 | Add an `is_active`/`account_status` check to the student-resolution helper before allowing quiz start/submit |
| 2 | `quiz_responses.question_id` has no FK to `question_bank(id)`, unlike 6 sibling tables (`content_reports`, `question_misconceptions`, `question_responses`, `user_question_history`, `mock_test_attempts`, `learning_events`) that all correctly constrain the identical column name | HIGH | D-1 | Add `ALTER TABLE quiz_responses ADD CONSTRAINT quiz_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES question_bank(id) ON DELETE SET NULL` (validate existing data first — likely needs `NOT VALID` + backfill validate, matching the `fk_question_bank_chapter` precedent) |
| 3 | Server anti-cheat Check 3 is a tautological dead no-op (jsonb_array_length <> v_total can never fire) — P3 partial failure | HIGH | salvaged from `00-orchestrator-salvage.md` (C-6, api-contract audit — cross-referenced here since it's adjacent to this audit's anti-cheat/integrity scope) | See `11-api-contracts.md` for the fix — flagged here only for cross-linking, not re-investigated by this audit |
| 4 | `students` RLS encodes no `is_active` predicate — deactivation correctness is app-layer only (defense-in-depth gap) | MEDIUM | D-5 | Add an `is_active = true` (or equivalent) predicate to the relevant `students` SELECT policies, or explicitly document why RLS intentionally omits it |
| 5 | `monthly_synthesis_runs.student_id` and `dive_artifacts.student_id` have no FK to `students(id)`, unlike the sibling pedagogy-v2 tables `adaptive_interventions`/`learner_twin_snapshots`/`learner_twin_memory` which all correctly constrain the same column shape | MEDIUM | D-1 | Add the missing `REFERENCES public.students(id) ON DELETE CASCADE` to both columns; also add `dive_artifacts.phenomenon_slug → phenomena(slug)` |
| 6 | `learner_twin_memory.concept_topic_id` / `.misconception_id` unconstrained | MEDIUM | D-1 | Add FKs to the respective catalog tables once the target tables are confirmed (concept/topic catalog, misconception catalog) |
| 7 | 4 of 6 RAG-retrieval RPCs dead/test-only (`search_rag_chunks`, `hybrid_rag_search`, `get_rag_chunks_for_node`, `get_rag_context_for_adaptive`); `match_rag_chunks_v2` fallback dead-on-arrival | LOW-MEDIUM | D-7 | ai-engineer-owned consolidation review (per discovery §6.7) — drop or document dead RPCs |
| 8 | `mass_gen_log` — RLS-enabled, zero policies, no documenting `COMMENT ON TABLE` (unlike `school_subscriptions`, which has one); table appears fully unreferenced by any app code | LOW | D-3 | One-line `COMMENT ON TABLE public.mass_gen_log IS '...intentional service-role-only...'` migration, mirroring `20260516030000_document_school_subscriptions_rls.sql` |
| 9 | `notifications.recipient_id`/`sender_id` and `guardian_student_links.approved_by`/`revoked_by` unconstrained (polymorphic-association / audit-trail columns) | LOW | D-1 | Structural — not a quick-fix; if ever revisited, consider per-type nullable FK columns for `notifications`, or an app-layer CHECK/trigger validating `recipient_type`↔`recipient_id` consistency |
| 10 | `_ao10b_grade_backfill_backup` / `_tsb4_isactive_backfill_backup` orphaned backup tables (no cleanup migration) | LOW | D-2 | `DROP TABLE` migration once the AO-10b/TSB-4 backfills are confirmed stable (requires user approval per the architect's DROP rule) |
| — | Grade-format (P5) — no live storage/interface violations found; SQL-side `launch_narrative_burst()` grade→int CAST and `tutor_personas.target_grades integer[]` are schema-drift/dead-table items, not exploitable P5 defects | INFO | D-4 | No action required; note `tutor_personas` appears dead if a future cleanup pass targets unused tables |

**Exhaustive vs sampled summary**: D-1 exhaustive for the 15 named tables; D-2/D-3/D-6
exhaustive (full-chain grep on the exact named objects); D-4 exhaustive on SQL-side
integer-grade-column search and full `src/` `parseInt`/`Number` grep; D-5/D-7 reproduced
verbatim from the prior run's salvaged findings, not re-investigated. Beyond the 15
named tables and the specific objects named in the prompt, chain-wide FK/constraint
completeness across all 364 tables remains unverified (consistent with the discovery
doc's own stated scope boundary).
