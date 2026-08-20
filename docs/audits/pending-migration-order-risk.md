# Pending-Migration Order Risk — five unapplied migrations that sort BEFORE the 2026-08-20 P0 fixes

**Date:** 2026-08-20
**Author:** architect (investigation only — no migration was applied, reordered, renamed, or edited)
**Production project:** `shktyoxqhundlvkiwguu`
**Scope:** the five migrations present on disk but absent from `supabase_migrations.schema_migrations`

## The situation

Two P0 fixes were applied to production on 2026-08-20 and are the newest ledger rows:

| Version | What it did |
|---|---|
| `20260820143726_drop_client_write_policies_money_tables` | Dropped **13** own-row INSERT/UPDATE/DELETE RLS policies from `payment_history`, `student_subscriptions`, `subscription_events`, `student_daily_usage`, leaving exactly 8 (4 `*_own_select` + 4 service-write). |
| `20260820152908_lock_down_coupons_read_and_bound_discount` | Dropped policy `coupons_read` on `public.coupons`, set `FOXY100.is_active = false`, added CHECK `coupons_discount_value_bounds` (NOT VALID). |

Five migrations exist on disk, are **not** in the ledger, and **all five sort BEFORE** those two. The
next `supabase db push` therefore applies them *after* the fixes despite carrying lower version
numbers.

| Migration | Origin |
|---|---|
| `20260814000023_keyless_question_serving_and_server_side_p6.sql` | this branch only (absent from `origin/main`) |
| `20260814000024_reconcile_subjects_allowed_with_plan_reality.sql` | this branch only (absent from `origin/main`) |
| `20260820000100_seed_learning_source_view_permission.sql` | `origin/main` only (absent from this branch) |
| `20260820000101_fix_get_learning_source_rpc_hardening.sql` | `origin/main` only (absent from this branch) |
| `20260820120000_reassert_select_quiz_questions_rag_staging_drift.sql` | `origin/main` only (absent from this branch) |

All five files were read in full. Nothing was modified.

---

## Summary verdict table

| Migration | Origin | Verdict | One-line reason |
|---|---|---|---|
| `20260814000023_keyless_question_serving_and_server_side_p6` | branch | **WOULD-REGRESS-A-FIX** | Narrows the live disproved-state exclusion from three states back to `!= 'failed'`, reverting the applied `20260814000014` — and its own keyless payload is then clobbered by `20260820120000`. |
| `20260814000024_reconcile_subjects_allowed_with_plan_reality` | branch | **SAFE-OUT-OF-ORDER** | Writes only `subscription_plans.subjects_allowed`; touches no money table, no coupon, no policy, no constraint; its own in-transaction P11 tamper guard proves no price/gateway column moves. |
| `20260820000100_seed_learning_source_view_permission` | main | **SAFE-OUT-OF-ORDER** | Two guarded `INSERT ... ON CONFLICT DO NOTHING` into `permissions` / `role_permissions`; shares zero objects with either fix. |
| `20260820000101_fix_get_learning_source_rpc_hardening` | main | **SAFE-OUT-OF-ORDER** | Replaces one dead RPC's signature and grants; depends only on `20260816000007`, which is already applied. |
| `20260820120000_reassert_select_quiz_questions_rag_staging_drift` | main | **WOULD-REGRESS-A-FIX** | Re-issues `select_quiz_questions_rag` from a pre-`0023` body — if `0023` lands first, this silently re-adds `correct_answer_index` to the outbound payload and strips the server-side P6 filter. |

---

## THE QUESTION THAT MATTERS MOST — does any of the five reopen the closed P0?

**No. All five are clean with respect to both 2026-08-20 fixes.** This was established by literal
grep over the exact text of all five files (2,264 lines total), not by reading intent from headers.

Search executed (case-insensitive, whole-file, including comments):

```
payment_history | student_subscriptions | subscription_events | student_daily_usage
coupon | FOXY100 | discount
```

Result across all five files: **`(NO MATCHES AT ALL)`** — not one occurrence, not even inside a
comment.

Second search, for the 13 dropped policy names and the fixes' surviving objects:

```
_own_(insert|update|delete) | "Students can insert own payment_history"
payments_service_write | subs_service_write | sub_events_service_write
"Service role manages usage" | coupons_read | coupons_discount_value_bounds
```

Result across all five files: **`(NO MATCHES)`**.

Third search, for the statement classes that could reopen the hole indirectly:

```
CREATE POLICY | DROP POLICY | ALTER POLICY | ROW LEVEL SECURITY | FORCE ROW
DROP CONSTRAINT | ADD CONSTRAINT | VALIDATE CONSTRAINT | ALTER TABLE
```

Result: **zero `CREATE POLICY`, zero `DROP POLICY`, zero `ALTER POLICY`, zero
`ENABLE`/`DISABLE ROW LEVEL SECURITY`, zero `ALTER TABLE`, zero `DROP CONSTRAINT`, zero
`ADD CONSTRAINT` in any of the five.** The only textual hits were prose comments
(e.g. `20260814000023.sql:142` — `"no ALTER TABLE, no DROP of any kind, no RLS policy change"`).

The only `GRANT`/`REVOKE` statements in the five are **function-level `EXECUTE` grants**, never
table-level grants:

- `20260814000023.sql:258` — `GRANT EXECUTE ON FUNCTION public.question_bank_p6_valid(...)`
- `20260814000023.sql:1136-1138` — `GRANT EXECUTE`/`REVOKE EXECUTE ... FROM anon` on `check_formative_answer`
- `20260820000101.sql:156-159` — `REVOKE ALL`/`GRANT EXECUTE` on `get_learning_source`
- `20260820120000.sql:370` — `REVOKE EXECUTE ... FROM anon` on `select_quiz_questions_rag`

Per-migration explicit statement:

| Migration | Re-creates a dropped money policy? | Re-grants client write to the 4 money tables? | Re-creates `coupons_read`? | Alters/drops `coupons_discount_value_bounds`? | Touches `coupons` rows? |
|---|---|---|---|---|---|
| `20260814000023` | No | No | No | No | No |
| `20260814000024` | No | No | No | No | No |
| `20260820000100` | No | No | No | No | No |
| `20260820000101` | No | No | No | No | No |
| `20260820120000` | No | No | No | No | No |

**However — a separate, real reproducibility hazard was found while checking this (see
"Recommended action", item 4): `20260816000005_fix_payment_history_rls.sql` on `origin/main`
contains, at lines 36-40:**

```sql
DROP POLICY IF EXISTS "Students can insert own payment_history" ON public.payment_history;
CREATE POLICY "Students can insert own payment_history"
  ON public.payment_history
  ...
```

That policy name is **one of the 13** `20260820143726` dropped. `20260816000005` is already in the
ledger, so `db push` will *not* re-run it — but any `supabase db reset`, fresh-environment rebuild,
staging re-sync from zero, or `supabase migration repair`-driven replay **would recreate it**. The
P0 is closed in production today; it is *not* closed in the migration chain as source of truth.

---

## 1. `20260820000100_seed_learning_source_view_permission.sql` (origin/main, 136 lines)

### 1.1 What it does

Three statements inside `BEGIN; ... COMMIT;`:

1. `INSERT INTO permissions (code, resource, action, description, is_active) VALUES ('learning_source.view', 'learning_source', 'view', '...', true) ON CONFLICT (code) DO NOTHING;`
2. `INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name IN ('student','teacher') AND p.code = 'learning_source.view' ON CONFLICT (role_id, permission_id) DO NOTHING;`
3. The same grant join for `('admin','super_admin')`.

No policy, no grant on any table, no RLS change, no constraint, no DDL. It is the DB half of a P0-1
fix whose other half repoints `/api/learning-sources` from a bare `authorizeRequest(request)` to
`authorizeRequest(request, 'learning_source.view')`.

### 1.2 Idempotent?

**Yes.** Both inserts are `ON CONFLICT ... DO NOTHING`, backed by real constraints verified in
`supabase/migrations/00000000000000_baseline_from_prod.sql`:

- line 15732 — `ADD CONSTRAINT "permissions_code_key" UNIQUE ("code")`
- line 15908 — `ADD CONSTRAINT "role_permissions_role_id_permission_id_key" UNIQUE ("role_id", "permission_id")`

Column shape also verified against baseline lines 12670-12678: `(id, code, resource, action,
description, is_active, created_at)` — no `name`/`category` column, so the `VALUES` list is valid.
Manual re-run is a clean no-op.

### 1.3 What breaks if it applies AFTER the two fixes?

**Nothing.** It shares no object with either fix. `permissions` and `role_permissions` were not
touched by `20260820143726` or `20260820152908`. Applying it late only delays the moment the
`/api/learning-sources` RBAC gate stops 403'ing student/teacher callers.

One real, non-ordering caveat: `learning_source.view` is a **new permission code and a new grant**.
Per the constitution ("User Approval Required For → RBAC role or permission additions") this needs
user approval before it goes to production, independent of ordering.

### 1.4 Interdependencies among the five

**None.** In particular it does **not** depend on `20260820000101`, and `20260820000101` does not
depend on it — see §2.4. It has no relationship to `0023`, `0024`, or `20260820120000`.

### 1.5 VERDICT

**`SAFE-OUT-OF-ORDER`** — two constraint-guarded RBAC seed inserts that share no object with either
2026-08-20 fix and are order-independent within the five.

---

## 2. `20260820000101_fix_get_learning_source_rpc_hardening.sql` (origin/main, 178 lines)

### 2.1 What it does

Inside `BEGIN; ... COMMIT;`:

1. `DROP FUNCTION IF EXISTS "public"."get_learning_source"(text, integer, text, text, text);` — drops the **old signature only**, required because `p_grade` changes type and `CREATE OR REPLACE` cannot change a parameter type.
2. `CREATE OR REPLACE FUNCTION "public"."get_learning_source"(p_board text, p_grade text, p_subject_code text, p_sha256_16 text, p_filename text DEFAULT 'source.pdf') RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''` — the corrected function.
3. Grants:

```sql
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) FROM postgres;
GRANT EXECUTE ON FUNCTION "public"."get_learning_source"(text, text, text, text, text) TO service_role;
```

The three substantive fixes, confirmed from source (this **does** address the earlier audit finding):

- **P5** — `p_grade` moves `integer → text`, validated as `IF p_grade IS NULL OR NOT (p_grade = ANY (ARRAY['6','7','8','9','10','11','12'])) THEN RAISE EXCEPTION ...`. Note the file's own comment explaining why it must be `NOT (x = ANY(...))` and not `x <> ANY(...)` — the naive form would reject every grade.
- **SECURITY DEFINER hardening** — `SET search_path = ''` added; `20260816000007` had **no** `search_path` pin at all on a SECURITY DEFINER function.
- **Path traversal** — the old `v_path LIKE '%/..%' OR v_path LIKE '%..%/'` pair (whose second arm let a *leading* `../` through) is replaced by a per-segment loop rejecting any `'..'` or empty segment.

The function still mints no URL — it returns a path plus a note that the loader route does the
signing. The header states, and grep corroborates, that nothing currently calls it (dead code,
hardened defensively).

### 2.2 Idempotent?

**Yes, with one nuance.** `DROP FUNCTION IF EXISTS` on the integer signature is a one-time
transition that no-ops on replay; `CREATE OR REPLACE` then carries idempotency for the text
signature. `REVOKE`/`GRANT` are inherently repeatable. Manual re-run is safe.

Nuance worth a reviewer's eye (not an ordering issue): `REVOKE ALL ... FROM postgres` strips the
owner's explicit EXECUTE. Since the function is `SECURITY DEFINER` and executes *as* the owner while
requiring the *caller* to hold EXECUTE, and `service_role` is granted, the intended path works. But
this is an unusual line and worth confirming against how the Supabase migration runner connects.

### 2.3 What breaks if it applies AFTER the two fixes?

**Nothing.** Its only dependency is `20260816000007_create_get_learning_source_rpc.sql`, which is on
`origin/main` and **is** in the ledger. Neither fix removed a function, a signature, a grant, or a
table this migration reads. `coupons` and the four money tables never appear in it.

### 2.4 Interdependencies among the five

**The prompt's hypothesis is not borne out.** `20260820000101` does **not** harden an RPC created by
`20260820000100`. `20260820000100` creates no RPC at all — it seeds an RBAC permission row. The RPC
being hardened here was created by `20260816000007` (already applied). The two `20260820000100/101`
files are the *DB* and *RPC* halves of the same 2026-08-20 P0-1 code review, but they are
**mutually order-independent** — either can apply first. No dependency on `0023`, `0024`, or
`20260820120000`.

### 2.5 VERDICT

**`SAFE-OUT-OF-ORDER`** — it depends only on `20260816000007`, which is already applied, and shares
no object with either 2026-08-20 fix.

---

## 3. `20260820120000_reassert_select_quiz_questions_rag_staging_drift.sql` (origin/main, 372 lines)

### 3.1 What it does

Inside `BEGIN; ... COMMIT;`:

1. `CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag(p_student_id uuid, p_subject text, p_grade text, p_chapter_number integer DEFAULT NULL, p_count integer DEFAULT 10, p_difficulty_mode text DEFAULT 'mixed', p_question_types text[] DEFAULT ARRAY['mcq']::text[], p_query_embedding vector DEFAULT NULL)` — `SECURITY DEFINER`, `SET search_path TO 'public'`, body copied verbatim from `20260814000014_tiered_verification_serving_and_truthful_picker.sql`.
2. `COMMENT ON FUNCTION public.select_quiz_questions_rag IS '...'`
3. `REVOKE EXECUTE ON FUNCTION public.select_quiz_questions_rag(...) FROM anon;`

Purpose per its own header: a hypothesis-driven defensive re-assertion to close a suspected drift
between the live *staging* definition and this source tree, which is failing three assertions in
`apps/host/src/__tests__/migrations/select-quiz-questions-rag-verification-gate.test.ts`. It is
explicitly a no-op if the hypothesis is wrong.

No table, column, index, policy, RLS, or constraint is touched.

### 3.2 Idempotent?

**Yes.** `CREATE OR REPLACE` + `COMMENT ON` (overwrites) + `REVOKE` (no-op when already revoked).
Re-running manually against an identical definition changes nothing.

### 3.3 What breaks if it applies AFTER `20260820143726` and `20260820152908`?

**Nothing, with respect to those two fixes** — it shares no object with them.

**But it collides head-on with `20260814000023`, another of the five.** Both define
`public.select_quiz_questions_rag`. `20260814000023` sorts *earlier*, so in a chain containing both,
`20260820120000` applies **last and wins**. A direct `diff` of the two function bodies confirms
`20260820120000` would revert every change `0023` makes to that function:

- **Re-adds the answer key to the outbound payload.** `0023` removes the member; `20260820120000` restores it:

```
-    'options', options,
+    'options', options, 'correct_answer_index', correct_answer_index,
```

  and, in the `candidate_pool` CTE:

```
-      qb.options, qb.explanation, qb.explanation_hi, qb.hint,
+      qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
```

- **Strips the server-side P6 filter** from all four predicate blocks (pool-count, seen-count, 80%-reset DELETE, `candidate_pool`) plus the verified-pool count:

```
-      AND public.question_bank_p6_valid(
-            qb.question_text, qb.options, qb.correct_answer_index,
-            qb.explanation, COALESCE(qb.question_type_v2, qb.question_type, 'mcq'))
```

  `20260814000023`'s own section-7c post-condition calls this exact combination out:
  *"a keyless payload without the server-side gate is strictly worse than the status quo: nothing
  would enforce 'correct_answer_index 0-3' at all."* After `20260820120000` overwrites it, the
  primary quiz-serving RPC has neither the key removed nor the P6 gate applied — i.e. back to the
  pre-`0023` posture on that one function, while `select_quiz_questions_v2`, both
  `get_quiz_questions` overloads, and `start_quiz_session` keep `0023`'s changes. That is a
  half-applied keyless/keyed mix, which is precisely what `0023`'s transaction was written to
  prevent.

**This regression would not be caught by CI.** `apps/host/src/__tests__/security/keyless-question-serving.test.ts`
reads a single hardcoded filename (`const MIGRATION = '20260814000023_keyless_question_serving_and_server_side_p6.sql'`,
line 35) and statically scans **that file only**. It does not walk the migration chain looking for a
later definition of the same function. It would stay green while the deployed function re-emits the
answer key.

Conversely, if `20260814000023` never lands, `20260820120000` applied against production today is a
literal no-op on the function body (production already runs `20260814000014`'s definition).

### 3.4 Interdependencies among the five

- **Hard conflict with `20260814000023`** on `public.select_quiz_questions_rag` (bidirectional clobber; last-applied wins).
- No relationship to `0024`, `20260820000100`, or `20260820000101`.

Also relevant to interpreting a CI run after this merges: its header notes that touching
`supabase/migrations/**` triggers both `sync-staging-migrations.yml` and `ci.yml` on the same commit,
sharing the `staging-db-push` concurrency group — which guarantees mutual exclusion but **not
ordering**, so a single post-merge CI run is not conclusive evidence either way.

### 3.5 VERDICT

**`WOULD-REGRESS-A-FIX`** — if `20260814000023` lands first, this file silently restores
`correct_answer_index` to the primary serving RPC's payload and removes its server-side P6 filter,
and the existing keyless test cannot see it.

---

## 4. `20260814000023_keyless_question_serving_and_server_side_p6.sql` (this branch, 1,301 lines)

### 4.1 What it does

Inside a single `BEGIN; ... COMMIT;`:

1. **Creates** `public.question_bank_p6_valid(text, jsonb, integer, text, text)` — a pure `IMMUTABLE`, `SECURITY INVOKER` predicate over passed-in values (reads no table), the SQL twin of `packages/lib/src/quiz/question-validation.ts` at the `allowNonMcq: true` posture. `GRANT EXECUTE` on it.
2. **Replaces** `select_quiz_questions_rag` (8-arg), `select_quiz_questions_v2` (7-arg), `get_quiz_questions` (5-arg **and** the 4-arg baseline overload), and `start_quiz_session` (2-arg) — each keeping its exact existing signature, `SECURITY DEFINER` and `SET search_path`. In each: the `'correct_answer_index'` JSON member is removed from the outbound payload, and `question_bank_p6_valid(...)` is added as a WHERE-clause filter (all four repeated predicate blocks in the two pool-aware RPCs) or a hard skip (`start_quiz_session`).
3. **Creates** `public.check_formative_answer(uuid, integer)` — new `SECURITY DEFINER` grading RPC with an inline ownership guard (`SELECT 1 FROM students WHERE auth_user_id = auth.uid()`), `SET search_path TO 'public'`, `GRANT EXECUTE ... TO authenticated` + `REVOKE EXECUTE ... FROM anon`.
4. **`COMMENT ON FUNCTION`** for each.
5. **Section 7: self-verifying post-conditions** in a `DO $$` block — 7a (no serving RPC emits a `'correct_answer_index'` member, checked via `strpos(prosrc, '''correct_answer_index''')`), 7b (`start_quiz_session` still snapshots the key and gates on P6), 7c (every serving RPC calls `question_bank_p6_valid`), 7d (both `get_quiz_questions` overloads present), 7e (`submit_quiz_results_v2` still reads `correct_answer_index_snapshot` — P1 intact), 7f (eight behavioural assertions on the predicate itself). Any failure rolls the whole transaction back.

Policies/RLS/constraints/tables: **none touched.** Its own trailer states `Tables touched: none / RLS policies: unchanged`, and grep confirms it.

### 4.2 Idempotent?

**Yes.** `CREATE OR REPLACE FUNCTION` + `GRANT`/`REVOKE` + `COMMENT ON` throughout; no `CREATE TABLE`,
no `ALTER TABLE`, no `DROP` of any kind, no index change. The section-7 assertions are read-only
checks over `pg_proc` and pure-function calls, so a manual re-run either passes identically or
aborts the whole transaction — it cannot half-apply.

### 4.3 What breaks if it applies AFTER `20260820143726` and `20260820152908`?

**Nothing, with respect to those two fixes.** It reads/writes only `question_bank`,
`user_question_history`, `quiz_session_shuffles`, `ops_events`, `students`, `chapters`, `subjects`,
`topics`, `ff_grounded_ai_enforced_pairs`. Zero occurrences of any money table or of `coupons`.

**But it regresses a *different*, already-applied fix.** `20260814000014_tiered_verification_serving_and_truthful_picker.sql`
(on `origin/main`, in the ledger, and **not present on this branch's disk**) widened the disproved-state
exclusion in `select_quiz_questions_rag` from the literal `'failed'` to all three disproved states.
`20260814000023` was written from the earlier `20260802100000` base and reverts that widening in all
four predicate blocks:

```
-    AND qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')
+    AND qb.verification_state != 'failed'
```

Applied to production as-is, that makes rows in `failed_fix_in_flight` and `failed_unfixable`
servable again — the exact defect `20260814000014`'s own `COMMENT ON FUNCTION` describes:
*"rows the verifier had DISPROVED and the repair agent had claimed were still servable."* This is a
content-quality (P6) regression of a live fix, delivered by ordinary timestamp ordering, and it is
invisible on this branch because `20260814000014` is not on disk here.

Note also: this branch is missing `20260814000012`-`20260814000017`, all of `20260815*`, and all of
`20260816*`, which are on `origin/main` and applied. Whatever `0023` was reviewed against on this
branch is **not** the schema that is actually live.

### 4.4 Interdependencies among the five

- **Hard conflict with `20260820120000`** on `public.select_quiz_questions_rag` — see §3.3. Applied together, `20260820120000` wins and undoes `0023`'s changes to that one function while leaving the other four functions keyless. `0023`'s section-7 assertions pass at its own apply time and are never re-evaluated afterwards, so nothing catches the later clobber.
- No dependency on `0024`. Despite `0024`'s header line *"Timestamped after 20260814000023, the current chain head"*, that is sequencing prose, not a functional dependency — `0024` touches no object `0023` creates. `0024` can apply without `0023`.
- No relationship to `20260820000100`/`101`.

### 4.5 VERDICT

**`WOULD-REGRESS-A-FIX`** — it reverts the applied `20260814000014` three-state disproved-question
exclusion back to `!= 'failed'`, and its own keyless-payload half is then clobbered by
`20260820120000`; it does **not** touch either 2026-08-20 money/coupon fix.

---

## 5. `20260814000024_reconcile_subjects_allowed_with_plan_reality.sql` (this branch, 277 lines)

### 5.1 What it does

Inside `BEGIN; ... COMMIT;`, four steps:

0. `CREATE TEMP TABLE _plan_price_guard ON COMMIT DROP AS SELECT sp.plan_code, sp.price_monthly, sp.price_yearly, sp.price_display, sp.razorpay_plan_id, sp.razorpay_plan_id_monthly, sp.razorpay_plan_id_quarterly, sp.is_active FROM public.subscription_plans sp;` — an in-transaction pricing snapshot used as a tamper control.
1. One guarded audit row: `INSERT INTO public.admin_audit_log (...) SELECT NULL, 'subscription_plans.subjects_allowed.reconciled', 'system', NULL, jsonb_build_object(... 'subjects_allowed_before', ... 'pricing_change', FALSE ...), now() WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log l WHERE l.action = 'subscription_plans.subjects_allowed.reconciled');`
2. The one mutation: `UPDATE public.subscription_plans sp SET subjects_allowed = -1 WHERE sp.subjects_allowed IS DISTINCT FROM -1;`
3. `COMMENT ON COLUMN public.subscription_plans.subjects_allowed IS 'DEPRECATED / non-enforcing...'`
4. A `DO $$` assertion block: **4a** every plan row now reads `-1`, else `RAISE EXCEPTION ... ERRCODE = 'check_violation'`; **4b** a P11 tamper control — a `FULL OUTER JOIN` of `_plan_price_guard` against live `subscription_plans` with `IS DISTINCT FROM` on `price_monthly`, `price_yearly`, `price_display`, all three `razorpay_plan_id*` columns and `is_active`, raising `'P11 GUARD: this migration must not change price/Razorpay/plan identity...'` on any drift (including an added or deleted plan row).

No policy, no RLS, no constraint, no `ALTER TABLE`, no `DROP`. Reads `plan_subject_access` for the
audit payload only.

### 5.2 Idempotent?

**Yes**, per statement, and deliberately so:

- Temp table: `ON COMMIT DROP` — every run starts clean.
- Audit insert: `WHERE NOT EXISTS` on the action code, so exactly one snapshot row ever exists. The file notes this guard is load-bearing, not cosmetic: an unguarded replay would write a second "snapshot" showing post-change state and destroy the rollback signal.
- Update: `WHERE subjects_allowed IS DISTINCT FROM -1` matches zero rows on replay (`IS DISTINCT FROM`, not `<>`, so a NULL row is caught rather than skipped into a 4a abort).
- `COMMENT ON` overwrites.
- Assertion 4b compares before/after **within the same transaction**, so it holds regardless of when it runs and what prices are current — no hard-coded price literal to rot.

Dependencies verified present on this branch: `supabase/migrations/20260620000800_add_razorpay_plan_id_quarterly.sql`
(the `razorpay_plan_id_quarterly` column read by 4b), `20260814000018_plan_subject_access_restrict.sql`,
`admin_audit_log` (baseline line 9489 — `admin_id` and `entity_id` are nullable, so the `SELECT NULL, ...`
insert is valid), and `plan_subject_access` (baseline).

### 5.3 What breaks if it applies AFTER `20260820143726` and `20260820152908`?

**Nothing.** `subscription_plans` is a *plan catalogue* table, not one of the four money tables the
RLS fix touched (`payment_history`, `student_subscriptions`, `subscription_events`,
`student_daily_usage`), and neither fix altered it, its policies, or its constraints.

The one place a reviewer might reasonably suspect an interaction is the coupons CHECK
`coupons_discount_value_bounds`, whose flat-discount ceiling (`<= 8799`) is presumably pegged to a
current plan price. **This migration changes no price** — that is not merely asserted in prose, it is
enforced at apply time by assertion 4b, which would abort the whole transaction if any price,
Razorpay id, `plan_code` or `is_active` moved. So the coupon bound cannot be invalidated by this
file.

Vacuous-pass note, from the file's own comment: on a fresh database with no seeded plans, both step 2
and assertion 4a operate on zero rows and pass with nothing to check. That is correct behaviour, not
a silent failure.

### 5.4 Interdependencies among the five

**None.** Its header's *"Timestamped after 20260814000023, the current chain head"* records sequencing,
not dependency. Grep confirms it shares no object with `0023`, `20260820000100`, `20260820000101`, or
`20260820120000`. It requires only `20260814000018` and `20260620000800`, both applied.

### 5.5 VERDICT

**`SAFE-OUT-OF-ORDER`** — a single-column reconciliation on `subscription_plans` with an
in-transaction P11 tamper guard, sharing no object with either 2026-08-20 fix or with any other of
the five.

---

## Recommended action

This section states what needs deciding. It does **not** recommend applying anything.

1. **Decide whether `20260814000023` and `20260820120000` may both exist in the chain.**
   They define the same function and the later one wins. A human must choose one of: (a) rebase
   `0023`'s body onto `20260814000014`'s three-state exclusion **and** re-issue it with a version
   number *above* `20260820120000` so it applies last; (b) fold `0023`'s keyless payload + P6 filter
   into a successor of `20260820120000`; or (c) drop one of the two. Whoever decides this owns the
   answer to "does the primary quiz-serving RPC ship the answer key after the next push."
   Reviewers to involve: **assessment** (P6 / question-quality and the disproved-state semantics),
   **backend** (`/api/quiz` callers and the client-side keyless companion change), **testing** (the
   test gap in item 2).

2. **Decide whether `apps/host/src/__tests__/security/keyless-question-serving.test.ts` should scan
   the whole migration chain instead of one hardcoded filename.** As written (line 35) it cannot
   detect a later migration re-adding `'correct_answer_index'` to a serving RPC. This is the reason
   the §3.3 regression would ship green. Owner: **testing**.

3. **Decide whether `20260814000023` should be applied to production at all in its current form.**
   It was authored on a branch missing `20260814000012`-`0017`, all of `20260815*`, and all of
   `20260816*` — i.e. against a schema that is not the live one. At minimum its
   `verification_state` predicate needs reconciling against `20260814000014` before anyone considers
   pushing it.

4. **Decide how to close the chain-level reproducibility hole on `payment_history`.**
   `20260816000005_fix_payment_history_rls.sql` (origin/main, applied) recreates
   `"Students can insert own payment_history"` — one of the 13 policies `20260820143726` dropped.
   `db push` will not re-run it, but a `db reset`, a fresh environment, or a staging rebuild from
   zero would. Separately, `20260820143726` and `20260820152908` exist **only on this branch** and
   are absent from `origin/main`, so `origin/main`'s chain does not reproduce the fixed state at
   all. A human should decide whether to (a) land both fix files on `main`, and (b) add a
   compensating late migration that re-drops the recreated policy, or amend the chain some other
   way. Reviewers: **architect** (owner), **backend** (payment flow), **ops** (staging/CI rebuild
   procedure).

5. **Decide on the `learning_source.view` permission addition.** `20260820000100` adds a new RBAC
   permission code and grants it to `student`, `teacher`, `admin`, `super_admin`. The constitution
   requires user approval for RBAC permission additions. That approval decision is independent of
   the ordering question and is unresolved here.

6. **Decide whether `20260820120000`'s staging-drift hypothesis is still worth testing.** Its own
   header says it is a no-op if the hypothesis is wrong, and warns that a single post-merge CI run
   cannot distinguish "hypothesis wrong" from "job-ordering race" because
   `sync-staging-migrations.yml` and `ci.yml`'s `integration-tests` share the `staging-db-push`
   concurrency group without an ordering guarantee. Owner: **ops** (which job actually ran first)
   with **architect**.

7. **Confirm the ledger independently before acting on any of the above.** Everything in this
   document about *what is applied* comes from the stated ledger facts, not from a query run here.
   The authoritative check is `SELECT version FROM supabase_migrations.schema_migrations ORDER BY
   version DESC LIMIT 20;` against `shktyoxqhundlvkiwguu`.

---

## Investigation method (so this can be re-run)

All five files were staged into a scratch directory and grepped literally:

```bash
# money tables + coupons — zero matches across all five
grep -rniE 'payment_history|student_subscriptions|subscription_events|student_daily_usage|coupon|FOXY100|discount' <five>

# the 13 dropped policy names + the 8 survivors + the new CHECK — zero matches
grep -rniE '_own_(insert|update|delete)|Students can insert own|payments_service_write|subs_service_write|sub_events_service_write|Service role manages usage|coupons_read|coupons_discount_value_bounds' <five>

# policy / RLS / grant / constraint statements — only function-level EXECUTE grants found
grep -rniE 'CREATE POLICY|DROP POLICY|ALTER POLICY|ROW LEVEL SECURITY|FORCE ROW|GRANT |REVOKE |DROP CONSTRAINT|ADD CONSTRAINT|VALIDATE CONSTRAINT|ALTER TABLE' <five>

# every top-level statement in each file, to catch anything the pattern greps missed
grep -nE '^[[:space:]]*(BEGIN|COMMIT|CREATE|DROP|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|COMMENT|DO|SET|SELECT)' <each>
```

The `select_quiz_questions_rag` collision was confirmed by extracting both function bodies
(`20260814000023.sql` lines 275-524 and `20260820120000.sql` lines 92-356) and running `diff -u`.

Every file was read successfully. Nothing was unreadable, and nothing in this document is inferred
from a file that could not be opened.
