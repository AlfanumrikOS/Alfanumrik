# Fix Ledger — live-integrity audit of `shktyoxqhundlvkiwguu` (2026-08-20)

**Single source of truth for the repair program.** One row per finding — 42 rows as of
2026-08-21. This count drifts as findings are added; re-count the `DB-` rows rather than
trusting it.

## How to read this file

- **Scope.** Findings come from a read-only live-integrity audit of the production Supabase
  project `shktyoxqhundlvkiwguu` on **2026-08-20**. That is the only environment; there is no
  staging twin, so every `Before` number below was measured against live production.
- **`Before` values are point-in-time.** They are what the database read on 2026-08-20 and
  nothing re-measures them automatically. A `Before` cell is evidence of what *was* true that
  day, not a live gauge. Re-run the `Detection query` before acting on any row — several of
  these counts move on their own (row counts, queue depths, flag state).
- **`Status` only becomes `VERIFIED` through an independent verification session.** Never
  self-certified. Whoever applies a fix may mark it at most `FIXED-UNVERIFIED`; a *separate*
  session that did not author the change must re-run the detection query, observe the `After`
  value, and only then move the row to `VERIFIED`. This rule exists because six earlier
  hardening migrations shipped and closed zero defect classes (see DB-8) — deploying is not
  fixing, and asserting is not verifying.
- **Status vocabulary:** `NOT-STARTED` / `IN-PROGRESS` / `FIXED-UNVERIFIED` / `VERIFIED` /
  `WONT-FIX`.
- **`Wave` is populated only for the rows that have entered the repair program — currently
  DB-1, DB-2, DB-22 and DB-40, all `Wave = 1`, applied 2026-08-20 (DB-2, DB-22, DB-40) and
  2026-08-21 (DB-1).** Every other row carries `—`
  because no wave has been assigned to it, not because a wave plan exists that excludes it:
  there is still no forward wave plan. Wave 1 is a label applied retrospectively to work already
  done, not a schedule. Do not backfill waves speculatively; assign a wave only when the work is
  actually scheduled.
- **There is no standalone audit document.** The audit was delivered in chat. This file and
  [`2026-08-20-money-table-policies-BEFORE.md`](./2026-08-20-money-table-policies-BEFORE.md)
  (the verbatim pre-change policy capture that backs DB-40) are the only durable artifacts.
  If a finding is not written down here, it is not written down anywhere.
- **Column note.** The column set is fixed at
  `ID | Severity | Wave | Status | Detection query | Before | After | Verified-by | Migration`.
  There is no separate *Finding* column, so each finding statement rides in the `ID` cell after
  the em dash.

---

## P0

| ID | Severity | Wave | Status | Detection query | Before | After | Verified-by | Migration |
|---|---|---|---|---|---|---|---|---|
| **DB-1** — 7 SECURITY DEFINER-behaving views held `GRANT ALL` to `anon` + `authenticated`, RLS bypassed — a **write** exposure, not only a read one. The ACL was `arwdDxtm` = all eight privileges (INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), not SELECT. Read leak confirmed behaviorally under `SET LOCAL ROLE anon`: `v_xp_ledger_drift` → 14 live student UUIDs with real XP balances (max 12,825); `v_secret_rotation_health` → `total_secrets = 7`; `v_backup_health_summary` → backup posture. Two of the seven are auto-updatable (`pg_relation_is_updatable = 28`, no INSTEAD OF triggers, no rules): `question_bank_student_safe` (body is `FROM question_bank;` with no WHERE, all 18,765 rows, resolving as owner `postgres` which has `rolbypassrls = true`) and `v_my_consent_status` — composing to an apparent unfiltered anonymous INSERT/UPDATE/DELETE path into the entire production question bank, bypassing RLS. **The write path was never confirmed open** — testing it pre-apply would have required DML on production — but it was confirmed **closed** post-apply (`DELETE … as anon` → `42501`). **Two corrections to this row's earlier description.** (a) `v_my_consent_status` DOES have an owner filter — `pg_get_viewdef` shows `WHERE (guardian_id IN (SELECT g.id FROM guardians g WHERE g.auth_user_id = auth.uid())) AND revoked_at IS NULL` — so it returned **0 rows to anon**, not a full consent dump; its real defect is narrower: `security_invoker` is unset, so it resolves as owner `postgres` and bypasses all 5 RLS policies on `parental_consent` for any JWT holder, which this migration deliberately did NOT do. (b) `v_secret_rotation_health` leaked `total_secrets = 7`, **not** the most-overdue secret *name* — that column is NULL (see DB-42) | P0 | 1 | FIXED-UNVERIFIED | `BEGIN; SET LOCAL ROLE anon; SELECT has_table_privilege('public.<view>','SELECT') …; ROLLBACK;` across all 7 views, and ideally all 8 privilege types (INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN), repeated under `SET LOCAL ROLE authenticated`. **Do NOT detect this row with `get_advisors(security)` → `security_definer_view` count** (its former detection query): that advisor fires on `security_invoker` being *unset*, which migration `20260821082059` deliberately did not change, so **the advisor still reports 7 after the fix** — by design, not because the row is un-fixed. Setting `security_invoker` is separate, tracked work (it changes view resolution from owner to caller privileges, a behaviour change for the service-role and SECURITY DEFINER-function readers; needs its own change set and review chain) | 7 | `anon` + `authenticated` aclitems removed from all 7 views. relacl `{postgres=arwdDxtm,anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm}` → `{postgres=arwdDxtm,service_role=arwdDxtm}`. 14/14 behavioral denials (7 anon + 7 authenticated), all SQLSTATE `42501`. `DELETE FROM question_bank_student_safe` as anon → `42501`. `service_role` reads all 7 unchanged; `question_bank` still 18,765 rows | applied 2026-08-21, ledger version `20260821082059` — pending independent verification | `supabase/migrations/20260821082059_restrict_secdef_views_to_service_role.sql` (rollback: `docs/runbooks/20260821082059_restrict_secdef_views_to_service_role.DOWN.sql`) |
| **DB-2** — `coupons` fully enumerable by anon (`coupons_read`, roles `{public}`, qual `is_active = true`) | P0 | 1 | FIXED-UNVERIFIED | `SELECT * FROM pg_policies WHERE tablename='coupons'` | 4 of 4 coupons anon-visible (re-confirmed live 2026-08-20 15:14 UTC pre-fix, behaviorally under `SET LOCAL ROLE anon`) | 0 policies on `public.coupons`; anon-visible rows 4 → 0 (RLS enabled, zero policies = deny-all for non-BYPASSRLS roles) | applied 2026-08-20, ledger version `20260820152908` — pending independent verification | `supabase/migrations/20260820152908_lock_down_coupons_read_and_bound_discount.sql` (rollback: `docs/runbooks/20260820152908_lock_down_coupons_read_and_bound_discount.DOWN.sql`) |
| **DB-3** — XP ledger drift: `students.xp_total` ≠ Σ `xp_transactions` | P0 | — | NOT-STARTED | `SELECT count(*) FROM v_xp_ledger_drift` | 14 (of 68 students) | — | — | — |
| **DB-4** — 102 Edge Functions deployed vs ~47 on disk; 3 rival `rag-answer-v3/v4/v5` all hand-deployed 2026-08-17/18 | P0 | — | NOT-STARTED | `list_edge_functions` | 102 deployed | — | — | — |
| **DB-9** — Grade encoding split: 14 peripheral tables store `"Grade 11"`, canonical tables store `"11"`; joins return empty silently | P0 | — | NOT-STARTED | `students ⋈ content_media ON grade` | 0 rows (6,061 assets unreachable) | — | — | — |
| **DB-10** — `user_roles.auth_user_id` orphaned against `auth.users`, no FK | P0 | — | NOT-STARTED | LEFT JOIN `user_roles` → `auth.users` | 31 of 65 (48%) | — | — | — |
| **DB-11** — Notifications addressed to recipients present in no table | P0 | — | NOT-STARTED | recipient LEFT JOIN students/guardians/teachers | 259 of 806 (32%) | — | — | — |
| **DB-12** — `anon`+`authenticated` hold INSERT/UPDATE/DELETE/**TRUNCATE** on nearly all public tables | P0 | — | VERIFIED | `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege('anon', c.oid, 'TRUNCATE')` (and same for `authenticated`); `relacl` on the 4 money tables; `pg_default_acl` for grantor `postgres` | anon 419, authenticated 427 tables held write/TRUNCATE (2026-08-20) | Closed via an unplanned path, not the DESIGN_ONLY file's intended review cycle: `20260823154500` was accidentally applied in full by a routine `db push` sweeping up a file parked in `supabase/migrations/` (incident, 2026-08-23 18:11 UTC), then `20260824010000` partially, deliberately reversed it — restoring INSERT/UPDATE/DELETE in the default-privileges template (so future tables keep working) while **keeping** the two things that actually mattered: TRUNCATE revoked schema-wide on all ~420 existing tables (`anon`/`authenticated` TRUNCATE-holding table count now **0**), and INSERT/UPDATE/DELETE revoked on the 4 money tables (`relacl` now `rxtm`, no `awd`/`D`). Re-verified live 2026-08-31: 0 tables hold anon/authenticated TRUNCATE; the 3 SECURITY INVOKER RPC carve-outs (`record_learning_event`/`update_mastery_bkt`, `mark_notification_read`, `teacher_create_class`) all still resolve their required grants; `pg_default_acl` for grantor `postgres` shows `arwdxtm` (no `D`) for both roles | independently verified 2026-08-31 (this session did not author either the incident-apply or the recovery migration) | `supabase/migrations/20260823154500_db12_narrow_default_grants_and_money_table_write_revoke_DESIGN_ONLY.sql` (incident-applied whole) + `supabase/migrations/20260824010000_restore_default_privileges_template.sql` (partial forward-only reversal); incident record: `docs/runbooks/20260823154500_db12_narrow_default_grants_and_money_table_write_revoke.DOWN.sql` |
| **DB-13** — `concept_mastery` live counter pair never written: `total_attempts`/`total_correct` stay 0 while `attempts`/`correct_attempts` accumulate | P0 | — | NOT-STARTED | `count(*) FILTER (WHERE attempts IS DISTINCT FROM total_attempts)` | 36 of 90 (40%); live cohort sum(attempts)=430 vs sum(total_attempts)=0 | — | — | — |
| **DB-14** — XP diverges between `students.xp_total` and Σ `student_learning_profiles.xp`, in both directions | P0 | — | NOT-STARTED | sum comparison + per-student diff | 24,765 vs 17,155 (gap 7,610 = 30.7%), 6 of 68 mismatched | — | — | — |
| **DB-15** — 3 flags documented OFF are ON in production with NULL `rollout_percentage`, changed 2026-08-18 | P0 | — | NOT-STARTED | `SELECT flag_name,is_enabled,rollout_percentage FROM feature_flags WHERE flag_name IN (...)` | `ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`, `ff_school_pulse_v1` all true/NULL | — | — | — |
| **DB-16** — 41 public functions + 11 relations exist in zero of 603 migrations (30 are SECURITY DEFINER); `is_active_admin` is used by a live RLS policy on `admin_users` → DR broken | P0 | — | NOT-STARTED | `pg_proc`/`pg_class` vs migration statement text | 41 functions, 11 relations | — | — | — |
| **DB-17** — `atomic_quiz_profile_update` has 4 live overloads that disagree on argument order (A/B `p_total,p_correct` vs C/D `p_correct,p_total`) — a positional call to the wrong family silently swaps correct/total | P0 | — | NOT-STARTED | `pg_proc` overload signatures | 4 overloads | — | — | — |
| **DB-18** — Two live RAG chunk stores on incompatible vector geometry, both marked done by the same out-of-band worker 2026-08-18 | P0 | — | NOT-STARTED | column types | `rag_content_chunks` vector(1024) 27,778 rows vs `textbook_chunks` vector(1536) 97 rows | — | — | — |

---

## P1

| ID | Severity | Wave | Status | Detection query | Before | After | Verified-by | Migration |
|---|---|---|---|---|---|---|---|---|
| **DB-5** — 4 `realtime.messages` Foxy policies (guardian/teacher cross-role chat access) exist in 0 of 603 migrations; `_rls_policy_backup_20260818` hand-created after last migration. Policies themselves byte-identical to backup — provenance gap, not drift | P1 | — | NOT-STARTED | `pg_policies` vs migration text | 4 policies, 0 provenance | — | — | — |
| **DB-6** — `auth-write-skeleton` Edge Function: service-role client writes `audit_logs` with caller-controlled `action` | P1 | — | NOT-STARTED | `get_edge_function('auth-write-skeleton')` | v1 ACTIVE, created 2026-08-10 | — | — | — |
| **DB-7** — `schools` anon-readable via vacuous OR predicate `(is_active = true) OR (deleted_at IS NULL)`; projection includes `domain_verification_token`, `gstin`, `billing_email` | P1 | — | NOT-STARTED | `pg_policies` + row count | 9 of 9 rows anon-visible | — | — | — |
| **DB-8** — Six hardening migrations shipped; their defect classes remain open. Nothing re-checks a class after deploy | P1 | — | NOT-STARTED | ledger names vs live advisors | 6 migrations, 0 classes closed | — | — | — |
| **DB-19** — `razorpay_signature` NULL on every payment — no persisted proof P11 verification ran | P1 | — | NOT-STARTED | `count(*) FILTER (WHERE razorpay_signature IS NULL)` | 5 of 5 | — | — | — |
| **DB-20** — `payment_webhook_events` empty despite live payments; `manual_reconciliation_webhook_missing` present in `subscription_events` | P1 | — | NOT-STARTED | `SELECT count(*) FROM payment_webhook_events` | 0 rows | — | — | — |
| **DB-21** — `subscription_id` and `reconciled_at` NULL on every payment — linkage + reconciliation sweep non-functional | P1 | — | NOT-STARTED | null counts | 5 of 5 each | — | — | — |
| **DB-22** — Anon-readable coupon `flat 10000` valid on ₹699/₹1,099 plans, expired but `is_active=true`; no CHECK bounds `discount_value` | P1 | 1 | FIXED-UNVERIFIED | coupons row inspection | 1 coupon, 9–14× item price | `FOXY100` `is_active` true → false (`discount_value` unchanged at 10000); CHECK `coupons_discount_value_bounds` added NOT VALID — `discount_value > 0 AND (percent <= 100 OR flat <= 8799)` | applied 2026-08-20; constraint enforcement proven behaviorally — reactivating `FOXY100` fails SQLSTATE 23514, flat 99999 fails 23514, percent 500 fails 23514, control percent 25 succeeds (all rolled back) — pending independent verification | `supabase/migrations/20260820152908_lock_down_coupons_read_and_bound_discount.sql` (rollback: `docs/runbooks/20260820152908_lock_down_coupons_read_and_bound_discount.DOWN.sql`) |
| **DB-23** — Plan catalog price drift: `unlimited.price_display` vs `price_monthly` | P1 | — | NOT-STARTED | `SELECT plan_code, price_display, price_monthly FROM subscription_plans` | '₹1,499/mo' vs 1099 | — | — | — |
| **DB-24** — One stuck `pending` payment, no order id, no payment id | P1 | — | NOT-STARTED | `payment_history` status histogram | 1 row, 5 days old | — | — | — |
| **DB-25** — `audit_logs.before_state`/`after_state` 100% NULL; `entity_type` entirely NULL — audit trail evidentially empty | P1 | — | NOT-STARTED | null counts | 4,013 of 4,013 rows | — | — | — |
| **DB-26** — 217 MB HNSW vector index never scanned; 585 MB (80% of index footprint) serves 84 scans | P1 | — | NOT-STARTED | `pg_stat_user_indexes.idx_scan` | idx_scan = 0 | — | — | — |
| **DB-27** — `school_id` never populated — school-scoped RLS/Pulse cannot function (and `ff_school_pulse_v1` is ON) | P1 | — | NOT-STARTED | null counts | 90,394 `security_request_audit`, 4,066 `foxy_chat_messages`, 99.7% `audit_logs` | — | — | — |
| **DB-28** — BKT absorbing at 1.0: `p_learn`/`p_guess`/`p_slip` stddev exactly 0; mastery cannot fall after failure | P1 | — | NOT-STARTED | stddev per column + rows at 1.0 | 4 rows at exactly 1.0; one with `consecutive_wrong=1` still `mastered` | — | — | — |
| **DB-29** — `mastery_level` bands overlap and the two writers use disjoint vocabularies | P1 | — | NOT-STARTED | GROUP BY mastery_level with prob ranges | `developing` 0.2–0.6596 overlaps `beginner` 0.2117–0.3920 | — | — | — |
| **DB-30** — `mastered_at` NULL on all rows including those marked `mastered` | P1 | — | NOT-STARTED | null count | 90 of 90; 10 marked mastered | — | — | — |
| **DB-31** — Active MCQs with non-distinct options; one has all four identical (unanswerable). `chk_four_options` enforces count only | P1 | — | NOT-STARTED | distinct-option count per MCQ | 7 rows; `1ba47af7-…` has 1 distinct option | — | — | — |
| **DB-32** — 12 of 23 subjects have zero `curriculum_topics`; active questions unreachable by topic or chapter | P1 | — | NOT-STARTED | subject LEFT JOIN topics; null linkage counts | 12 subjects; 6,014 questions (32%) with neither `topic_id` nor `chapter_id` | — | — | — |
| **DB-33** — IRT never calibrated despite nightly cron | P1 | — | NOT-STARTED | `irt_theta` / `irt_theta_se` distribution | 471 of 478 at defaults (0.0 / 1.0) | — | — | — |
| **DB-34** — `question_bank.embedding` 100% NULL; queue pending since 2026-08-01 with zero worker attempts | P1 | — | NOT-STARTED | embedding null count + queue state | 18,765 rows / 0 embeddings; 18,750 pending, max(attempts)=0 | — | — | — |
| **DB-35** — `get_learning_source` declares `p_grade integer` (P5 violation) and is SECURITY DEFINER with no `search_path` | P1 | — | NOT-STARTED | `pg_get_functiondef` | 1 of 75 grade-taking functions integer-typed | — | — | — |
| **DB-41** — `question_bank` base table still exposes the answer key on every serving path; the safe view was built and never wired up. `question_bank_student_safe` (migration `20260806000004:14`) hard-NULLs `correct_answer_index`, `correct_answer_text` and `solution_steps` and is a genuinely correct safe projection — but it has **zero callers**. Every question-serving surface still reads the base `question_bank` table directly: web `(student)/pyq/page.tsx:66,79`, `(student)/quiz/page.tsx:907,954`, `(student)/mock-exam/page.tsx:126,144`; API `/api/diagnostic/start:295,503`, `/api/diagnostic/complete:193`; mobile `pyq_repository.dart:34,50`, `quiz_repository.dart:104`. Migration `20260814000000`'s own header lists "re-point PYQ/mobile" as outstanding work. So the answer-key protection that was built is not in effect on any serving path | P1 | — | NOT-STARTED | grep for `.from('question_bank')` across `apps/host`, `packages`, `mobile/lib` vs `.from('question_bank_student_safe')` (currently 0) | 0 surfaces use the safe view; all serving paths read the base table | — | — | — |

---

## P2

| ID | Severity | Wave | Status | Detection query | Before | After | Verified-by | Migration |
|---|---|---|---|---|---|---|---|---|
| **DB-36** — 219 of 425 `public` tables have never held a row | P2 | — | NOT-STARTED | `pg_stat_user_tables` | 219 (51.5%) | — | — | — |
| **DB-37** — `scripts/check-config-parity.sh` resolves both config paths from the wrong cwd, exits 1 with no message, invoked by nothing. Configs currently agree; 12 of 19 constants covered by no test (incl. `PROMPT_REV`, `MODEL_ROUTE_REV`) | P2 | — | NOT-STARTED | read script + diff both configs | 0 CI invocations; 7 of 19 constants tested | — | — | — |
| **DB-38** — `flag-posture-canary` uses a closed ~40-name watch list against 84 declared flags, so it structurally cannot report an undeclared enabled flag — this is why DB-15 went undetected | P2 | — | NOT-STARTED | read `route.ts:143-144` + registry count | 40 watched vs 84 declared | — | — | — |
| **DB-39** — REG-314 claims `config-parity.test.ts` verifies `diagram_spec_v1` template parity; that test checks 7 numeric constants and never inspects `REGISTERED_PROMPT_TEMPLATES` | P2 | — | NOT-STARTED | read test + catalog entry | claim unsupported | — | — | — |
| **DB-42** — `v_secret_rotation_health.most_overdue_secret` lacks the `environment` filter its siblings have. Four of the five column subqueries filter `environment = 'production'`; the `most_overdue_secret` subquery does not, so it would surface secret names from **every** environment. It returns NULL today only because `last_rotated_at` / `created_at_estimate` / `rotation_interval` are unpopulated on all 7 `secret_inventory` rows — i.e. it goes live the moment the rotation ledger is used for its intended purpose. The view is no longer anon-readable as of `20260821082059`, so the exposure is now service-role-only; this is a correctness defect in the view body, which that migration deliberately did not touch | P2 | — | NOT-STARTED | `pg_get_viewdef('public.v_secret_rotation_health')` — compare the `most_overdue_secret` subquery's WHERE clause against the other four | most_overdue_secret subquery has no environment filter; `most_overdue_secret IS NULL` (rotation timestamps unpopulated); `total_secrets = 7` | — | — | — |

---

## Fixed

| ID | Severity | Wave | Status | Detection query | Before | After | Verified-by | Migration |
|---|---|---|---|---|---|---|---|---|
| **DB-40** — Client-write RLS policies on the four money/quota tables: a logged-in student could INSERT a `captured` payment, flip pending/failed to captured, DELETE payment records, self-grant `plan_code='unlimited'`, forge/erase `subscription_events`, and reset own AI quota | P0 | 1 | VERIFIED | `SELECT tablename, policyname, cmd, roles::text FROM pg_policies WHERE schemaname='public' AND tablename IN ('payment_history','student_subscriptions','subscription_events','student_daily_usage');` | **21 policies** (13 client-write: 12 `TO authenticated`, 1 `TO public`) | **8 policies** (4 `*_own_select` authenticated + 4 service_role ALL); all 13 confirmed gone | behavioral exploit-closure test, 2026-08-20 (detail below) | `supabase/migrations/20260820143726_drop_client_write_policies_money_tables.sql` |

### DB-40 evidence

- **Detection query (verbatim):**
  ```sql
  SELECT tablename, policyname, cmd, roles::text
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename IN ('payment_history','student_subscriptions','subscription_events','student_daily_usage');
  ```
- **Before:** 21 policies, of which 13 were client-write (12 `TO authenticated`, 1 `TO public`).
  The full verbatim pre-change capture — every `qual` / `with_check` body as `pg_get_expr`
  emitted it — is in
  [`2026-08-20-money-table-policies-BEFORE.md`](./2026-08-20-money-table-policies-BEFORE.md).
- **After:** 8 policies — 4 `*_own_select` (`authenticated`) + 4 `service_role` ALL. All 13
  client-write policies confirmed gone.
- **Verified-by:** behavioral exploit-closure test, 2026-08-20 — 4/4 write attempts denied
  under simulated `authenticated` role:

  | Attempt | Result |
  |---|---|
  | INSERT `payment_history` | `42501` |
  | UPDATE `payment_history` | `UPDATE 0` |
  | INSERT `student_subscriptions` | `42501` |
  | UPDATE `student_daily_usage` | `UPDATE 0` |

  All four ran inside rolled-back transactions with pre/post counts identical. Read smoke test
  PASS (3/1/120 unchanged).
- **Migration:** `supabase/migrations/20260820143726_drop_client_write_policies_money_tables.sql`
  (ledger version `20260820143726`).
- **Rollback:** `docs/runbooks/20260820143726_drop_client_write_policies_money_tables.DOWN.sql`.

> **Footnote on DB-40's `VERIFIED` status.** The verification above ran in the **same session
> that applied the fix**, not an independent one. That does not meet the bar stated at the top
> of this file, where `VERIFIED` requires a separate session that did not author the change.
> The evidence is behavioral (real denials, real SQLSTATEs, rolled-back transactions) rather
> than a mere re-read of `pg_policies`, which is why it is recorded as `VERIFIED` — but a
> reviewer is entitled to, and may reasonably prefer to, **downgrade this row to
> `FIXED-UNVERIFIED` pending independent confirmation**. Re-running the detection query and the
> four write attempts from a fresh session is cheap; do that before treating DB-40 as closed.

---

## Known gaps in this ledger

- **DB-12 closed 2026-08-31 (see the DB-12 row) — not via a planned fix.** The DESIGN_ONLY file
  this note used to warn about was accidentally applied whole by a routine `db push` on
  2026-08-23, then partially reversed by a hand-written recovery migration on 2026-08-24 that
  kept the two things that mattered (TRUNCATE closed schema-wide, money-table writes revoked)
  while restoring what an accidental blanket revoke would otherwise have broken (future-table
  writes). Re-verified independently 2026-08-31. This paragraph is kept as the incident record;
  the risk it originally described no longer exists in production.
- **No forward wave plan exists.** The four rows carrying `Wave = 1` — DB-1, DB-2, DB-22 and
  DB-40 — were labelled retrospectively after being fixed on 2026-08-20 (DB-2, DB-22, DB-40)
  and 2026-08-21 (DB-1); every other row carries `Wave = —` because no wave has been assigned
  to it. Sequencing has not been decided and must not be inferred from the P0/P1/P2 ordering
  here — severity is impact, not schedule.
- **`VALIDATE CONSTRAINT` outstanding on `coupons`.** `coupons_discount_value_bounds` was added
  `NOT VALID` because `FOXY100` (flat 10000) violates it and changing that row's `discount_value`
  was outside the fix's scope. It enforces on all future INSERTs and on any UPDATE of an existing
  row — which is what blocks `FOXY100`'s reactivation — but does not retroactively validate the
  existing row. Once `FOXY100`'s value is resolved or the row removed:
  `ALTER TABLE public.coupons VALIDATE CONSTRAINT coupons_discount_value_bounds;`
- **The `8799` bound is a static mirror.** It equals `max(subscription_plans.price_yearly)`. A
  Postgres `CHECK` cannot contain a subquery, so this value cannot reference its source table. Any
  price rise must revisit this constraint in the same change set, or it will begin rejecting
  legitimate flat coupons.
- **Expired-but-active coupons remain, and are not yet a ledger row.** `LAUNCH50` (expired
  2026-05-31) and `SCHOOL30` (expired 2026-06-30) are still `is_active = true` — the same defect
  class as DB-22, left untouched to keep the fix's blast radius at one row. Moot for clients now
  that `coupons` has no read policy, but still live for any future service-role redemption path.
  Needs its own ledger ID.
- **Nothing in this ledger self-updates.** No canary, test, or cron re-runs these detection
  queries. DB-8 (six hardening migrations, zero classes closed) and DB-38 (a canary that
  structurally cannot see DB-15) are the two findings that explain why: the repair program has
  no closure mechanism yet. Until one exists, a row's `Status` is only as fresh as the last
  person or agent who edited it.
