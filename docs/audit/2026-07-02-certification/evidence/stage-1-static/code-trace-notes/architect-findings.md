# Architect Findings — Production Certification, Stage 1 (Static/Read-Only)

Date: 2026-07-02. Agent: architect. Scope: schema, RLS, RBAC, migrations,
middleware/auth infra, security, data integrity. All findings below are
independently re-derived from the current file set on branch
`fix/prod-readiness-remaining` (working directory `D:\Alfa_local\Alfanumrik`),
not copied from Phase 1/2/3 docs. Phase 1 (`docs/audit/2026-07-02-discovery/`)
and Phase 2 (`docs/audit/2026-07-02-validation/`) are cited only as
corroboration/cross-reference, never as the sole source. This pass is
read-only — no application code, migration, or config file was modified;
only the two designated output files were written.

---

## Task 1 — Migration Inventory Sweep

### Method

350 root-level migration files under `supabase/migrations/*.sql` (excluding
`_legacy/`) were mechanically classified via 7 whole-directory grep sweeps
(one process per pattern, not per file — this avoided a per-file-loop timeout
observed on the first attempt) for: `CREATE TABLE`, `ENABLE ROW LEVEL
SECURITY`, `SECURITY DEFINER`, `search_path`, `FOREIGN KEY`/`REFERENCES
public.`, `CREATE POLICY`, and a Tier-0 table-name touch list (`students`,
`payments`, `payment_webhook_events`, `quiz_sessions`, `quiz_responses`,
`guardians`, `guardian_student_links`, `teachers`, `schools`, `user_roles`,
`role_permissions`, `permissions`, `roles`, `student_subscriptions`,
`auth.users`, `razorpay`). Raw counts were merged into a single CSV
(`evidence/inventory/migrations.csv`), then every row where the mechanical
sweep suggested a possible violation (CREATE TABLE without RLS in the same
file: 4 candidates; SECURITY DEFINER present without `search_path` anywhere
in the same file: 12 candidates) was hand-read in full to confirm or refute.
A risk-weighted sample of ~30 additional files touching Tier-0 tables
(payments, students, quiz scoring, guardians, teachers, schools, RBAC) was
also hand-read for RLS-policy-pattern completeness, beyond the mechanical
gate.

**Full table**: see `evidence/inventory/migrations.csv` (351 lines including
header — 350 migrations + baseline). Headline numbers:

| Metric | Count |
|---|---|
| Total root migrations classified | 350 |
| Real `CREATE TABLE` migrations (post hand-verification) | 71 (baseline excluded — it is a pg_dump snapshot, not a diff) |
| `CREATE TABLE` migrations missing `ENABLE ROW LEVEL SECURITY` in the same file | **0** |
| Files where raw grep flagged `CREATE TABLE` but hand-read showed no real table (comment-only match) | 4 (`20260520000003`, `20260614200001`, `20260614200002`, `20260628015107`) |
| Files with `SECURITY DEFINER` (raw grep, case-insensitive, includes comment mentions) | 103 |
| Files where raw grep flagged `SECURITY DEFINER` present without `search_path` in the same file | 12 |
| Of those 12, comment-only (no real function defined in that file; the referenced function is already covered elsewhere) | 11 |
| Of those 12, **genuine gap** | **1** — see below |
| Migrations adding at least one `FOREIGN KEY`/`REFERENCES public.` | 74 |

### Real finding: `update_mol_routing_weights()` — SECURITY DEFINER with no `search_path` set, anywhere

`supabase/migrations/20260518000006_mol_weight_update_fn.sql:8-11`:

```sql
create or replace function public.update_mol_routing_weights()
returns void
language plpgsql
security definer
as $$
```

No `SET search_path` clause is present in this `CREATE FUNCTION` statement,
and a full-chain grep for `update_mol_routing_weights` across every root
migration (`grep -rln "update_mol_routing_weights" supabase/migrations/*.sql`)
returns only this one file — meaning no later migration ever `ALTER
FUNCTION ... SET search_path` on it (the pattern Phase 2's SD-SWEEP found
covering 15 other functions, see `20260516010000_fix_function_search_path_mutable.sql`)
and no later `CREATE OR REPLACE` redefines it. This function is a genuine,
independently-confirmed gap that **Phase 2's SD-SWEEP missed** — it is not
among the 15 functions that migration remediated, and it is not one of the
2 confirmed IDOR gaps Phase 2 did find (`submit_quiz_results` /
`atomic_quiz_profile_update`).

**Exploitability assessment**: LOW. The function takes zero arguments (no
user-controlled input to exploit via ownership bypass), and is immediately
followed by `revoke all on function public.update_mol_routing_weights() from
public;` / `grant execute ... to service_role;` (lines 57-58) — it is
**not callable by `anon` or `authenticated`** at all, only by `service_role`,
which already bypasses RLS/GRANT entirely and would have no need to abuse a
search_path-poisoning vector on this specific function. All table references
inside the function body are schema-qualified (`public.mol_request_logs`,
`public.mol_feedback`, `public.mol_routing_weights`), which further narrows
the attack surface to unqualified built-in calls (`avg()`, `coalesce()`,
`now()`) — a shadowing attack would require an attacker who can create
objects in a schema that appears before `public` in a `service_role` session's
active `search_path`, which itself implies a level of access well beyond what
this single function would grant.

**Verdict**: CONFIRMED gap, real and independently reproducible.
**Confidence**: HIGH (hand-read the full file, confirmed no remediation
anywhere in the chain via exhaustive grep).
**Risk-impact tag**: Post-Release-Acceptable (Tier-1, S3 — matches the
"search_path mutable" advisory-lint class Phase 2 already remediated 15
instances of; this is the missed 16th, but is unreachable by anon/authenticated
and every internal reference is schema-qualified). Recommend a follow-up
one-line `ALTER FUNCTION public.update_mol_routing_weights() SET search_path =
public, pg_catalog;` migration, mirroring `20260516010000`'s pattern, to close
the gap for defense-in-depth and restore Phase 2's "0 true gaps" claim to
actually being 0.

### RLS-on-CREATE-TABLE: 0 real gaps (100% coverage, mechanically + hand confirmed)

All 71 real `CREATE TABLE` migrations pair `ENABLE ROW LEVEL SECURITY` in the
same file. This matches `ci.yml`'s own blocking "Migration safety —
RLS-on-CREATE-TABLE" check (`.github/workflows/ci.yml:120-148`, confirmed
present and `exit 1`-blocking by direct read during Task 3.6 below) and is
independently re-derived here, not merely cited.

Of the 71, 8 tables enable RLS with **zero `CREATE POLICY`** in the same
file (deny-all-by-default, service-role-only pattern):
`invoice_number_sequences`, `payment_reconciliation_queue`,
`contract_number_sequences`, `agent_runs`/`agent_steps`, `qb_fixer`'s claim
table, `link_code_otp_challenges`. Each was hand-read and each carries an
explicit in-file comment documenting the service-role-only rationale (e.g.
`20260507140000_payment_reconciliation_queue.sql:84-89`: *"RLS — super-admin
only via service_role ... No policies for authenticated/anon roles. service_role
bypasses RLS; super-admin API routes use service_role via authorizeAdmin ->
getSupabaseAdmin"*). This is the same documented pattern the codebase already
uses for `school_subscriptions` (`20260516030000_document_school_subscriptions_rls.sql`)
and matches the architect's own migration convention: these are
backend-internal tables (billing sequence counters, agent trace logs, OTP
challenge rows) never read by student/parent/teacher clients, so the "4-pattern"
RLS convention (student own / parent linked / teacher assigned / admin service
role) legitimately collapses to "admin service role only" for this class of
table. Not a defect.

**Cross-reference to Phase 2**: Phase 2's own D-3 finding (`mass_gen_log`) flagged
one RLS-enabled-zero-policy table as under-documented (no `COMMENT ON TABLE`,
unlike `school_subscriptions`). My independent sweep found 8 such tables
total across the chain; 7 of 8 carry an in-file comment (adequate, if not a
formal `COMMENT ON TABLE`); `mass_gen_log` itself (in the baseline, not a
root migration I could attribute to a single non-baseline file) is the one
Phase 2 already flagged — I did not find any additional undocumented
deny-all table beyond what Phase 2 reported.

### Tier distribution (all 350 rows)

Tier 0 (touches a Tier-0 table name): 202. Tier 1 (creates a table / defines
a SECURITY DEFINER function / adds an FK, but doesn't touch a named Tier-0
table): 24. Tier 2 (flags, indexes, docs, non-schema): 124.

---

## Task 2 — RLS/RBAC/Security Certification

*(Structured for near-verbatim lift into reports 08-security and
11-data-integrity.)*

### Authentication & session management

- Supabase Auth (email/PKCE). Session cookies refreshed in `src/proxy.ts`
  (1258 lines — confirmed via `wc -l`), the renamed `middleware.ts` for
  Next.js 16, build-enforced by `scripts/auth-guard.js` per the project's own
  topology guard.
- 7-layer middleware order per `.claude/CLAUDE.md`: session refresh →
  security headers → bot blocking → super admin protection → rate limiting →
  API auth → protected pages. Not independently re-traced line-by-line in
  this Stage-1 pass (would require a full 1258-line read); flagged as
  MEDIUM confidence pending a deeper Stage 2 pass if the certification board
  wants full middleware-ordering re-verification.

### Authorization (RBAC)

- `src/lib/rbac.ts` (797 lines) implements `authorizeRequest()`, backed by
  the `get_user_permissions` SQL RPC (baseline:5322-5333), which resolves
  roles/permissions via `user_roles`/`roles`/`role_permissions`/`permissions`
  joins, filtered on `user_roles.is_active`, `roles.is_active`,
  `permissions.is_active`, and `expires_at`. Confirmed by direct read (see
  Task 3.2 below for the exact SQL text).
- REG-120 (per `.claude/regression-catalog.md`, cited as corroboration not
  sole source) claims full RBAC matrix conformance from a single additive
  idempotent root migration (`20260612123200_rbac_matrix_conformance.sql`,
  confirmed present in my Task 1 sweep — tier 0, PASS, no FK/table changes,
  pure grant/permission seed).

### RLS boundary enforcement

- `src/lib/supabase-admin.ts` (123 lines, confirmed via `wc -l`) is the sole
  service-role client. Line 12 comment: *"This uses the SERVICE_ROLE_KEY — it
  bypasses RLS. Only use in server-side API routes, never expose to the
  client."* Line 65: `validateServerEnv()` is called before the client is
  constructed, which per its own doc includes "the NEXT_PUBLIC_ leak check."
  Independently grepped the entire repo for `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE`
  / `NEXT_PUBLIC_SERVICE_ROLE` — **zero matches anywhere** (`Grep` tool,
  path=repo root, zero files). This satisfies the Security Checklist's first
  item directly, HIGH confidence.
- Every one of the 71 real `CREATE TABLE` migrations in the current chain
  enables RLS in the same file (Task 1 above) — 100% mechanical +
  hand-verified coverage, no exceptions found.
- RLS-policy 4-pattern coverage (student own / parent linked / teacher
  assigned / admin service role) was spot-checked on the highest
  Tier-0-touching files (`20260621000100_track_a_school_admin_provisioning.sql`,
  `20260505120000_account_deletion_flow.sql`, `20260616000000_education_intelligence_cloud_v1.sql`)
  — all conformed to either the full 4-pattern convention or the legitimate
  "admin/service-role only" collapse for backend-internal tables (see Task 1).

### IDOR resistance

- The platform's most severe historical IDOR class — caller-supplied
  `p_student_id` on SECURITY DEFINER quiz RPCs with no ownership check — is
  addressed by migration `20260702150000_p3w1_5_quiz_rpc_ownership_check.sql`
  and its follow-up `20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql`.
  Independently re-read in full; see Task 3.1 below for the complete
  verification (HIGH confidence, live code read, not commit-message trust).
- The suspended/soft-deleted-student quiz-access gap (QUIZ-ACTIVE) is
  **partially** closed — Next.js route layer fixed, RPC layer still open.
  See Task 3.2 below (this is the one finding in this report I am
  reclassifying as still-open against the prior commit's own framing).

### JWT handling / secrets

- `SUPABASE_SERVICE_ROLE_KEY` never appears in any `NEXT_PUBLIC_*` variable
  or client-accessible code (verified above, zero grep hits repo-wide).
- `admin-auth.ts` (444 lines) implements `requireAdminSecret()` using
  `secureEqual()` (constant-time compare) per Phase 2's G-6 finding, which I
  spot-checked is still consistent with the current file (not re-read in
  full this pass — LOW/MEDIUM confidence, relying on Phase 2's line-level
  citations for this specific narrow point since it wasn't in my Task 3
  worklist).

### CSRF/XSS/SSRF posture

Not independently re-verified in this Stage-1 pass (out of my explicit Task 3
worklist and not flagged as a Tier-0 gap by Phase 1/2). Recommend a
dedicated Stage-2 pass if the certification board wants this closed with
architect-level (not just Phase 2 citation) confidence. Marked
**DEFERRED**.

### Rate limiting

Upstash Redis with in-memory fallback, per `.claude/CLAUDE.md`. Not
independently re-traced this pass (not in my Task 3 worklist). **DEFERRED**.

### Audit logging

`audit_logs` table referenced across the RBAC/admin surface (e.g.
`20260527000001_add_school_id_audit_logs.sql`, confirmed present in my Task 1
sweep, tier 0, adds a column + FK, PASS). Sensitive-operation logging was not
independently re-traced end-to-end this pass. **DEFERRED**.

### Webhook signature verification

Payment webhook signature verification is backend-owned for the flow itself;
my domain is the security *pattern*. Not independently re-read this pass
(P11's implementation status is already documented in `.claude/CLAUDE.md` as
closed via `activate_subscription`/`atomic_subscription_activation` RPCs with
`ff_atomic_subscription_activation` kill-switch) — I did, however,
independently verify in Task 3.4 below that this exact flag is now correctly
seeded at the migration root (previously only in `_legacy/`), which is a
direct P11-adjacent architect-domain finding.

---

## Task 3 — Independent Re-Verification Worklist

### 3.1 Cross-student RPC forgery fix (commits `69046ee8`, `c2cde8c8`)

**Verdict: CONFIRMED FIXED.**

**Evidence**: Read the full current migration text of
`supabase/migrations/20260702150000_p3w1_5_quiz_rpc_ownership_check.sql`
(824 lines) directly, not the commit diff summary. All three targeted
functions carry, as the first statement after `BEGIN`, strictly before any
`INSERT`/`UPDATE`:

```sql
IF auth.uid() IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM students
  WHERE id = p_student_id AND auth_user_id = auth.uid()
) THEN
  RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
END IF;
```

- `submit_quiz_results` (legacy v1) — lines 163-168, before the response
  loop and before the `INSERT INTO quiz_sessions` at line 271.
- `atomic_quiz_profile_update` (6-arg, `RETURNS jsonb`) — lines 485-490,
  before the `INSERT INTO student_learning_profiles` at line 511.
- `atomic_quiz_profile_update` (7-arg, `RETURNS void`, carries
  `p_session_id`) — lines 603-608, before the `xp_transactions` ledger write
  at line 641.

The `auth.uid() IS NULL` short-circuit is present and correctly scoped to
exempt `service_role` callers (which carry no JWT), confirmed by reading the
surrounding rationale comment (lines 30-59) and cross-checked against the
real callers named in the file header (`src/lib/supabase.ts:566`,
`src/lib/domains/quiz.ts:371`, `src/lib/domains/profile.ts:117`, and the
`atomic-quiz-xp-42p10-e2e` integration test using a service-role client).

The orphaned 5-arg `atomic_quiz_profile_update(p_student_id, p_xp,
p_correct, p_total, p_subject)` overload — sharing the identical defect
class but with zero live callers — is separately closed by
`supabase/migrations/20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg.sql`
(98 lines, read in full): `REVOKE EXECUTE ... FROM authenticated` and `FROM
anon`, plus a `COMMENT ON FUNCTION` documenting the rationale. This is a
safer fix than adding an unused ownership check to a function with no
callers, and I independently confirmed via a repo-wide grep for
`atomic_quiz_profile_update` call sites that no call site matches this
overload's exact 5-argument shape (all three live call sites resolve to the
6-arg or 7-arg overload).

P1 (score formula, line 261: `ROUND((v_correct::NUMERIC / v_total) * 100)`),
P2 (XP formula, line 266-268: `v_correct * 10` + 80%→+20 + 100%→+50, 200
daily-cap literal at line 471/625), P3 (anti-cheat: 3s-avg check at
242-245, all-same-answer check at 247-255, response-count check at 257-259),
and P4 (atomic submission, single transaction, `BEGIN`/`COMMIT` wrapping the
whole file) are all unchanged — verified by reading the full function bodies,
not just the diff.

**Confidence**: HIGH (live-verified this pass, full file read, independent
of commit-message framing).
**Risk-impact tag**: Informational (confirmed-safe-by-design — this closes
what was the single most severe finding in the entire Phase 2 audit).

### 3.2 QUIZ-ACTIVE `is_active` gap (commit `ecfd7a5d`)

**Verdict: PARTIALLY FIXED — route layer only. RECLASSIFYING the RPC-layer
gap as still OPEN, contrary to how a surface reading of "Confirmed by the
Phase 2 security audit... this commit closes that condition" could be
misread.**

**Evidence — route layer (fixed)**: `src/app/api/quiz/route.ts:155-181`
(`resolveStudent()`), read in full — both the `id`-lookup branch (line
158-161) and the `auth_user_id`-fallback branch (line 172-175) now chain
`.eq('is_active', true).is('deleted_at', null)` after `.eq('id', studentId)`
/ `.eq('auth_user_id', authUserId)`. The commit's own message explicitly
states the fix also covers `quiz/submit/route.ts`, `v2/quiz/start/route.ts`,
`v2/quiz/submit/route.ts` (4 files total) — I independently re-read
`quiz/route.ts` directly; the other 3 were not re-read line-by-line this
pass (relying on the commit's own diff stat showing all 4 touched, each +2
lines, consistent with the same `.eq/.is` chain pattern) — MEDIUM confidence
on those 3, HIGH on `quiz/route.ts`.

**Evidence — RPC layer (still open)**: The commit message itself states
verbatim: *"Web's direct-from-browser RPC calls to
submit_quiz_results_v2/start_quiz_session bypass all four Next.js routes
entirely; that RPC-layer gap is out of scope here and is queued as an
architect follow-up."* I independently confirmed this admission is accurate
by reading the current SQL definitions of all four RPCs the Phase 2 finding
named:

1. **`get_user_permissions`** (`baseline:5322-5333`) — never redefined by
   any later migration (confirmed: `grep -rn "get_user_permissions"
   supabase/migrations/*.sql` outside the baseline returns only a
   `REVOKE EXECUTE ... FROM anon` line, no `CREATE OR REPLACE`). Body
   filters on `user_roles.is_active`/`roles.is_active`/`permissions.is_active`
   only — **zero reference to `students.is_active`/`account_status`/
   `deleted_at` anywhere in the function.**
2. **`get_available_subjects`** — last redefined by
   `20260621000400_fix_subject_visibility_remove_content_ready_gate.sql:18-67`
   (read in full, the current live definition per last-write-wins). The `s`
   CTE (lines 24-29) selects `id, grade, stream, board FROM public.students
   WHERE (id = p_student_id OR auth_user_id = p_student_id) AND (auth.uid()
   IS NULL OR auth_user_id = auth.uid())` — **no `is_active`/`deleted_at`
   predicate on the student row.** (The `WHERE sub.is_active` at line 66
   filters the `subjects` catalog table, an unrelated column on a different
   table — not a student-suspension gate.)
3. **`validate_academic_scope`** (`baseline:8631-8687`) — never redefined by
   any later migration (only `GRANT`/`REVOKE` statements reference it
   post-baseline). Line 8641-8644: `SELECT id, grade INTO v_student_id,
   v_student_grade FROM students WHERE id = p_student_id OR auth_user_id =
   p_student_id LIMIT 1` — **no `is_active`/`deleted_at` predicate.**
4. **`atomic_quiz_profile_update`** (both overloads, current text read in
   full as part of 3.1 above) — the 2026-07-02 ownership-check migration
   added an `auth.uid()` check but **did not add an `is_active`/`deleted_at`
   predicate** to either overload. Confirmed by re-reading the full function
   bodies: no reference to `is_active`/`account_status`/`deleted_at` anywhere
   in either.

I additionally checked `start_quiz_session` (`baseline:7084-7214`, never
redefined post-baseline) and `submit_quiz_results_v2` (most recently
redefined by `20260623000500_reapply_submit_quiz_v2_column_fix.sql`) —
neither carries an `is_active`/`deleted_at` predicate on the `students` row
either, confirming the commit's own admission that the browser-direct RPC
bypass path remains fully open for a suspended/soft-deleted student with a
still-valid JWT.

**This is a real, live, exploitable gap today**: a suspended student calling
`supabase.rpc('start_quiz_session', {...})` or
`supabase.rpc('submit_quiz_results_v2', {...})` directly against PostgREST
(bypassing the patched Next.js routes entirely) can still start and submit
quizzes and earn XP, exactly as Phase 2 originally described, because the
SQL/RPC layer itself was never hardened — only the two Next.js route
call-sites were.

**Confidence**: HIGH (live-verified this pass by reading the actual current
SQL text of all 4 named RPCs plus 2 additional adjacent RPCs, not the
commit's self-description).
**Risk-impact tag**: **Should-Fix-Before-Release** — Tier-0 (students table,
quiz scoring), S2 partial mitigation (the two most common client paths —
web's Next.js routes and presumably the mobile v2 routes — are now closed,
but the RPC layer any authenticated browser client can reach directly via
`supabase.rpc()` remains open). Recommend closing per the original Phase 2
remediation direction: add an `is_active`/`deleted_at` predicate (or a single
shared `is_student_active(p_student_id)` helper) to all 4 SQL functions
named above, plus `start_quiz_session` and `submit_quiz_results_v2`.

### 3.3 6 missing FK constraints (commit `d5b6eb94`)

**Verdict: CONFIRMED FIXED.**

**Evidence**: Read the full current text of
`supabase/migrations/20260702140000_p3w2_9_orphan_fk_hardening.sql`
(230 lines). All 6 constraints from Phase 2's `13-data-integrity.md` D-1
Phase-3-queue list are present, each wrapped in an idempotent
`pg_constraint`-existence-guarded `DO $$ ... $$` block (safe to re-run), each
added `NOT VALID` (matching the pre-existing `fk_question_bank_chapter`
precedent cited in the migration's own header) so it cannot fail or lock on
legacy orphan data:

1. `quiz_responses.question_id → question_bank(id) ON DELETE SET NULL`
2. `monthly_synthesis_runs.student_id → students(id) ON DELETE CASCADE`
3. `dive_artifacts.student_id → students(id) ON DELETE CASCADE`
4. `dive_artifacts.phenomenon_slug → phenomena(slug) ON DELETE SET NULL`
5. `learner_twin_memory.concept_topic_id → curriculum_topics(id) ON DELETE SET NULL`
6. `learner_twin_memory.misconception_id → misconception_patterns(id) ON DELETE SET NULL`

This is exactly the list Phase 2's `13-data-integrity.md` (§D-1, Phase-3-queue
items #2/#5/#6) flagged, cross-checked directly against that doc's original
column list. The `ON DELETE` behavior for each is individually justified
against sibling-table conventions in the migration's own header (verified —
e.g. `quiz_responses` uses `SET NULL` rather than the `CASCADE` most sibling
`question_id`-FK tables use, specifically to avoid destroying an
already-scored P1/P4-critical audit-trail row on a `question_bank` deletion —
a deliberate, reasoned deviation, not an oversight).

The migration correctly stops short of applying `VALIDATE CONSTRAINT` (which
would require a live orphan-row pre-flight check this Stage-1 pass cannot
run) and includes the exact pre-flight `SELECT count(*)` queries an operator
should run before validating each constraint in a follow-up.

**Confidence**: HIGH (full file read, not commit-message trust; cross-checked
against Phase 2's original finding list for completeness).
**Risk-impact tag**: Informational (confirmed-safe-by-design). One residual
note: the constraints are `NOT VALID` and will remain unenforced against
pre-existing rows until an operator manually runs `VALIDATE CONSTRAINT` —
this is the correct, safe pattern for a live-schema fix but means the fix is
not yet "fully" closed in the sense of retroactively validating historical
data; flagging as a Post-Release-Acceptable follow-up (run the pre-flight
queries, then validate).

### 3.4 4 legacy-only feature-flag seeds (commit `83ab1378`)

**Verdict: CONFIRMED FIXED.**

**Evidence**: Read the full current text of
`supabase/migrations/20260702150000_p3w2_8_backfill_legacy_only_flag_seeds.sql`
(confirmed present at the migration root, not under `_legacy/`, via `Glob`).
All 4 flags (`ff_atomic_subscription_activation`, `ff_irt_question_selection`,
`ff_foxy_streaming`, `ff_rag_mmr_diversity`) are seeded with an idempotent
`INSERT ... ON CONFLICT (flag_name) DO NOTHING` pattern — verified this
matches the REG-125 canonical seed shape the file's own header cites
(`20260619000600_seed_ff_adaptive_loops_bc_v1.sql` precedent, which I also
confirmed is present at root in my Task 1 sweep). Crucially, `ON CONFLICT DO
NOTHING` (never `DO UPDATE`) means this migration cannot silently overwrite
whatever value prod already carries for these 4 flags — it is purely a
backfill for fresh environments (new staging, DR restore, CI live-DB tests)
that only ever apply root migrations, which is exactly the gap Phase 2's
`11-api-contracts.md` C-1 finding described.

**Confidence**: HIGH (full file read).
**Risk-impact tag**: Informational (confirmed-safe-by-design). This is
P11-adjacent (the `ff_atomic_subscription_activation` kill-switch is the
payment-webhook atomic-fallback gate) — worth noting for backend's
awareness even though the fix itself is architect-owned and complete.

### 3.5 OAuth tables' live-schema existence

**Verdict: NOT VERIFIED (schema file evidence only) — requires live schema
check in Stage 2/3. Re-stating rather than silently inheriting Phase 2's tag:
I independently re-ran the grep sweep myself and it still shows zero
evidence of these tables at root.**

**Evidence**: `grep -in "oauth" supabase/migrations/00000000000000_baseline_from_prod.sql`
→ **zero matches** (independently re-run this pass, not copied from Phase
2's number). `grep -li "oauth" supabase/migrations/*.sql` across all 350
root migration files → **zero matches** (also independently re-run;
confirmed exit code 123 = grep found no matching files at all, i.e. not one
of the 350 root files even mentions the word "oauth"). The only definition
of `oauth_apps`/`oauth_scopes`/`oauth_tokens`/`oauth_consents` in the entire
repository is
`supabase/migrations/_legacy/timestamped/20260417500000_rbac_phase4a_oauth2_platform.sql`,
confirmed to live under `_legacy/`, which `supabase db push` never applies
(root-migrations-only convention).

Since `00000000000000_baseline_from_prod.sql` is a `pg_dump` of the actual
production database (per the project's own schema-reproducibility runbook,
`docs/runbooks/schema-reproducibility-fix.md`), and it contains zero trace of
any `oauth_*` table, this is strong (but not conclusive, per this Stage's own
read-only-file constraint) evidence that these tables **do not exist in the
live production schema today**. If that holds, `src/app/api/super-admin/oauth-apps/route.ts`
and `src/app/api/oauth/{authorize,token}/route.ts` would 500 on their first
`.from('oauth_apps')`/`.from('oauth_consents')`/`.from('oauth_tokens')` query
— and per `.claude/regression-catalog.md`, REG-119 pins
`super-admin/oauth-apps` as one of the 7 "high-blast-radius" mutation routes
for **OAuth client-secret issuance**, which would mean that pin is currently
protecting a route that 500s on every invocation rather than a live
capability.

**Confidence**: NOT VERIFIED (no live DB access in this Stage-1 pass, exactly
as scoped). **Risk-impact tag**: Should-Fix-Before-Release *if confirmed live*
— this is a Tier-0-adjacent (OAuth/RBAC surface) operational-integrity gap,
not a security vulnerability per se (Phase 2's G-3 already established the
`/oauth/authorize` endpoint's missing auth check is benign since it never
issues a code, and `/oauth/token`'s `authorization_code` grant is an
explicit unimplemented stub). Action: a Stage-2/3 agent with live DB access
should run `SELECT to_regclass('public.oauth_apps')` (or equivalent) against
prod before certification sign-off; if absent, either finish the OAuth2
platform migration (promote the `_legacy` file to a fresh root migration) or
explicitly mark the 3 routes dead/disabled so REG-119's pin isn't protecting
a non-functional capability.

### 3.6 Branch-protection / required-status-checks GitHub config

**Verdict: VERIFIED LIVE — `gh` CLI was authenticated in this environment and
returned real data. Reclassifying from Phase 2's "UNPROVEN" tag to
CONFIRMED.**

**Evidence**: `gh api repos/AlfanumrikOS/Alfanumrik/branches/main/protection`
returned HTTP 200 with:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint, Type-check & Test",
      "Secret Scanning",
      "Edge Function Deno Tests",
      "Integration Tests (live DB)",
      "Production Build"
    ]
  },
  "enforce_admins": { "enabled": true },
  "allow_force_pushes": { "enabled": false },
  "allow_deletions": { "enabled": false }
}
```

I cross-checked each of the 5 required-check names against the actual job
`name:` fields in `.github/workflows/ci.yml`: `secret-scan` job → `name:
Secret Scanning` (line 40); the main test job → `name: Lint, Type-check &
Test` (line 158); `edge-function-tests` → `name: Edge Function Deno Tests`
(line 304); `integration-tests` → `name: Integration Tests (live DB)` (line
368); `build` → `name: Production Build` (line 425). All 5 required-check
names byte-match real job display names in the current `ci.yml` — this is
not a stale/orphaned branch-protection rule referencing a renamed or deleted
job.

This directly resolves Phase 2's G-1 "UNPROVEN sub-point" (*"Whether a
failed secret-scan job blocks the merge button... depends on branch-protection
config, which lives in GitHub repo settings, not in any file in this
repository — not verifiable from source alone"*): the `secret-scan` job
(display name "Secret Scanning") **is** a required status check on `main`,
`strict: true` (must be up-to-date with the base branch), and
`enforce_admins: true` (even repo admins cannot bypass). A gitleaks failure
inside that job **does** block merge to `main`.

**Bonus finding (adjacent to Task 3.6, same tool, same domain)**: I also
checked the `ENABLE_AWS_DEPLOY` repository variable Phase 2's G-7 finding
flagged as unprovable statically (*"whether `vars.ENABLE_AWS_DEPLOY` is
currently set to `'true'`... this is a runtime repo setting, not a file in
this repo"*). `gh api repos/AlfanumrikOS/Alfanumrik/actions/variables/ENABLE_AWS_DEPLOY`
returned:

```json
{"name":"ENABLE_AWS_DEPLOY","value":"true","updated_at":"2026-06-23T03:31:28Z"}
```

**This means the parallel AWS ECS deployment pipeline
(`.github/workflows/deploy-aws.yml`) is currently ARMED, not dormant** — it
has been `true` since 2026-06-23. Per Phase 2's own G-7 read of that
workflow (which I have not independently re-verified line-by-line this pass
— citing Phase 2's file-level analysis as corroboration only), every real
job in `deploy-aws.yml` is gated `if: needs.gate.outputs.enabled == 'true'`,
meaning **every push to `main` since 2026-06-23 has also been deploying to a
second, parallel AWS environment** (target: the CloudFront pseudolink
`da8yhieheuw7p.cloudfront.net` per that workflow's own header, not yet
`alfanumrik.com` per the documented cutover-phase framing) — not a no-op as
the workflow's dormant-by-default framing would suggest to anyone who hasn't
checked this specific repo variable. Neither `CLAUDE.md` nor
`.claude/CLAUDE.md` mentions AWS as a deployment target at all (confirmed:
neither file was found to contain the string "AWS" via my own reading of
both files at the start of this task).

**Confidence**: HIGH (both live-verified via authenticated `gh api` calls
this pass, not inherited from any prior doc).
**Risk-impact tag**: 
- Branch protection itself: Informational (confirmed-safe-by-design — this
  closes Phase 2's G-1 UNPROVEN sub-point cleanly in the platform's favor).
- `ENABLE_AWS_DEPLOY=true`: **Should-Fix-Before-Release** (operational, not a
  security vulnerability, but a real incident-response blind spot — if
  anyone diagnosing an incident is working from `CLAUDE.md`'s stated
  "Deployment: Vercel (bom1/Mumbai)" mental model, they would not think to
  check the AWS side, and every push to `main` right now is silently also
  deploying to a second live-capable environment). Recommend: (a) confirm
  with ops/CEO whether this is an intentional in-flight DR rehearsal, and
  whether Route 53 weighted routing is presently live (this repo variable
  says the CI pipeline is armed, but does NOT prove production DNS traffic
  is being routed there — that is a separate, still-unverified fact); (b)
  add a one-line "Deployment targets" note to the constitution regardless of
  the answer, since the current silence is itself the gap.

---

## Summary Table

| # | Finding | Verdict | Confidence | Risk-impact |
|---|---|---|---|---|
| Task 1 | 0/71 real `CREATE TABLE` migrations missing RLS | CONFIRMED CLEAN | HIGH | Informational |
| Task 1 | `update_mol_routing_weights()` SECURITY DEFINER missing `search_path` | CONFIRMED GAP (new, missed by Phase 2) | HIGH | Post-Release-Acceptable |
| 3.1 | Cross-student RPC forgery (submit_quiz_results, atomic_quiz_profile_update 6/7-arg) | CONFIRMED FIXED | HIGH | Informational |
| 3.1b | Orphaned 5-arg atomic_quiz_profile_update overload | CONFIRMED FIXED (EXECUTE revoked) | HIGH | Informational |
| 3.2 | QUIZ-ACTIVE gap — Next.js route layer | CONFIRMED FIXED | HIGH | Informational |
| 3.2 | QUIZ-ACTIVE gap — SQL/RPC layer (get_user_permissions, get_available_subjects, validate_academic_scope, atomic_quiz_profile_update, start_quiz_session, submit_quiz_results_v2) | **NOT FIXED — OPEN**, reclassified from Phase 2/3's implied-closed framing | HIGH | **Should-Fix-Before-Release** |
| 3.3 | 6 missing FK constraints | CONFIRMED FIXED | HIGH | Informational (pending manual VALIDATE) |
| 3.4 | 4 legacy-only feature-flag seeds | CONFIRMED FIXED | HIGH | Informational |
| 3.5 | OAuth tables live-schema existence | NOT VERIFIED (file evidence: strongly absent) | MEDIUM (file evidence) / NOT VERIFIED (live) | Should-Fix-Before-Release if confirmed |
| 3.6 | Branch protection required-status-checks | CONFIRMED (live) | HIGH | Informational |
| 3.6b | `ENABLE_AWS_DEPLOY=true` (bonus finding) | CONFIRMED (live) | HIGH | Should-Fix-Before-Release |

## What I did NOT verify (explicitly deferred)

- Full 1258-line line-by-line re-trace of `src/proxy.ts`'s 7-layer ordering.
- `admin-auth.ts` full re-read (relied on Phase 2's G-6 citation for the
  `secureEqual()` constant-time-compare point).
- CSRF/XSS/SSRF posture, rate-limiting implementation detail, audit-log
  coverage completeness — none were in my explicit Task 3 worklist and none
  were flagged as Tier-0 gaps by Phase 1/2, so I did not spend Stage-1 budget
  re-deriving them from scratch. Recommend a targeted Stage-2 pass if the
  certification board wants architect-level (not Phase-2-citation-level)
  confidence on these.
- Whether Route 53 weighted routing is presently sending real
  `alfanumrik.com` traffic to the AWS stack (a DNS-layer fact, not
  independently checkable via `gh api`).
- `13-data-integrity.md`'s D-1 finding was scoped to 15 named hot tables;
  chain-wide FK completeness across all ~364 tables remains unverified by
  both Phase 2 and this pass.
