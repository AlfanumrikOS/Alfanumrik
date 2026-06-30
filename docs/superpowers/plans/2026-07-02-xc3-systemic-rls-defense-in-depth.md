# XC-3 — Systemic RLS Defense-in-Depth (Program Plan)

- **Owner:** architect (schema/RLS); testing (guards); backend/frontend (route migrations)
- **Status:** DESIGN (this doc is the audit + program plan + first-slice spec; no app code/migrations/tests changed in this pass)
- **Date:** 2026-07-02
- **Invariants in play:** P8 (RLS boundary), P9 (RBAC enforcement), P13 (data privacy)
- **Supersedes / subsumes:** Cycle-5 TSB-2 (RLS backstops on PII tables), Cycle-7 PP-5 (parent routes → RLS-scoped clients)
- **Trigger incident:** TSB-4 (`20260702010000`) inlined a `class_students` subquery in a `students` SELECT policy, causing `students → class_students → students` RLS recursion that broke every authenticated client read of `students`. Fixed by `20260702080000` (delegate to `is_teacher_of` SECURITY DEFINER helper).

---

## 1. Problem statement (grounded in the audit)

The dominant data path on this platform bypasses RLS. **273 of 362 API `route.ts` files (75.4% of all routes) import the RLS-bypassing service-role client (`src/lib/supabase-admin.ts`).** Of the 289 routes that touch Postgres directly, **252 use the admin client exclusively, 21 use both, and only 14 use the RLS-respecting `supabase-server.ts` client exclusively (~95% of DB-touching routes lean on the admin client; 0 routes use the anon `@/lib/supabase` client).** RLS is therefore present at the schema layer but is **not actually exercised on the primary request path** — authorization on those 273 routes rests entirely on hand-written `authorizeRequest()` + app-level checks (e.g. `canAccessStudent`). A single missed check is an unbounded data-exposure bug with no second line of defense.

> **Correction to the "~87%" close-out figure.** The real number is **75.4% of all routes (273/362)** or **~95% of DB-touching routes (252 admin-only + 21 both, of 287 that import a data client)**. "87%" is between the two and matches neither precisely; use the two figures above.

At the same time, the schema's RLS posture is genuinely strong where it is used, which makes "turn RLS back on at the request path" a realistic goal rather than a rewrite:

- **Baseline (`00000000000000_baseline_from_prod.sql`): 270 tables, 270 with `ENABLE ROW LEVEL SECURITY`, 522 policies.** Only **2 tables are RLS-on-but-policy-less (deny-all / service-role-only): `mass_gen_log` and `school_subscriptions`** — both intentional (`school_subscriptions` is documented in `20260516030000_document_school_subscriptions_rls.sql`). No high-sensitivity table lacks RLS.
- **The recursion class is systemic, not a one-off.** **141 of 522 baseline policies inline a cross-table subquery** (SECURITY INVOKER, so the referenced table's *own* RLS re-evaluates — the exact mechanism behind TSB-4). Only **75 policies delegate to a SECURITY DEFINER helper** (the safe pattern). The apex `students` table is read by the inline subqueries of **84** policies. TSB-4 was the first time such an inline subquery was added *on `students` itself* over a table (`class_students`) that reads `students` back — closing the cycle. The latent edges to close that same loop again already exist throughout the schema.

The program's job: **(a)** make the TSB-4 recursion class statically un-shippable everywhere (not just on `students`), **(b)** stop the admin-client share from silently growing, then **(c)** progressively move read paths back onto RLS-respecting clients so defense-in-depth is real where it matters most (student PII, payments, parent/guardian visibility).

---

## 2. Audit findings (authoritative numbers)

### 2.1 API-route client usage (scope: `src/app/api/**/route.ts`)

| Metric | Count | Notes |
|---|---:|---|
| Total `route.ts` | 362 | |
| Import `supabase-admin` (RLS-bypassing) | **273** | 75.4% of all routes |
| Import `supabase-server` (RLS-respecting) | 35 | |
| Import anon `@/lib/supabase` | 0 | none in routes |
| Import **both** admin + server | 21 | mixed routes |
| Import **neither** | 73 | pure compute / proxy-to-Edge / RPC elsewhere |
| DB-touching routes (admin and/or server) | 289 | admin-only 252, both 21, server-only 14 |

**Admin-client routes bucketed by sensitivity prefix** (top): `super-admin` 71, `school-admin` 32, `parent` 19, `v1` 18, `teacher` 16, `cron` 16, `student` 13, `internal` 13, `v2` 9, `payments` 7, `schools` 6, `learner` 5, `foxy` 5, `support` 4, `pulse` 4, `public` 4, `exams` 4, `quiz` 3, `auth` 3, `alfabot` 3, remainder 1–2 each.

Sensitivity reading:
- **Student PII / learner reads** (`student`, `learner`, `v1`/`v2` child + progress, `pulse`, `parent`, `teacher`): the largest migratable surface — many are *reads* that an RLS-scoped client can serve unchanged once the policy is trusted.
- **Payments** (`payments` 7, plus `cron/reconcile-payments`, `super-admin/payment-ops`, `billing`): admin client is largely **correct** here — webhooks and reconciliation legitimately need service-role. These stay on admin; XC-3 does not touch P11 flows except to add the *allowlist entry* documenting why.
- **Admin** (`super-admin` 71, `internal` 13, `school-admin` 32): admin client is appropriate by design; gated by `authorizeRequest` + secret. These are allowlisted, not migrated.
- **Public** (`public/v1/*`, `alfabot`, `health`): no per-user row scoping; admin or anon as appropriate.

### 2.2 Table RLS coverage (baseline + root chain)

- **(a) RLS enabled + has policies:** 268 of 270 baseline tables.
- **(b) RLS enabled, NO policies (deny-all, service-role-only):** **2** — `mass_gen_log`, `school_subscriptions` (intentional; `school_subscriptions` documented).
- **(c) Tables WITHOUT RLS:** none in the baseline (270 tables / 270 `ENABLE RLS`). 95 new tables were added across the post-baseline root chain; the `post-edit-check.sh` content hook already blocks a new table without `ENABLE ROW LEVEL SECURITY` in the same migration. Phase 0 adds a chain-wide static inventory to confirm there is no drift (see §5).
- **High-sensitivity set — all covered** (RLS on + policies): `students` (5 policies), `student_subscriptions` (2), `payment_history` / `payment_webhook_events` / `subscription_events` (RLS on), `guardian_student_links` (9), `guardians` (4), `quiz_responses` (2), `quiz_sessions` (3), `concept_mastery` (2, helper-based), `foxy_chat_messages` (3), `messages` (1), `class_students` (7), `teachers` (5), `admin_users` (2).

> **Correction to the brief's table list.** `payment_transactions` and `bkt_mastery_state` **do not exist** under those names. Real payment substrate: `payment_history`, `student_subscriptions`, `subscription_events`, `subscription_plans`, `payment_webhook_events`, `school_invoices`, `school_subscriptions`. Real mastery substrate: `concept_mastery`, `concept_mastery_score`, `topic_mastery`, `layer_mastery`, `adaptive_mastery`. All exist with RLS + policies; no gap.

### 2.3 Recursion-risk graph

**SECURITY DEFINER RLS helpers** (all `STABLE`, `SET search_path = public`, inner reads bypass RLS → no re-entry, no cycle):

| Helper | Reads | Pattern |
|---|---|---|
| `get_my_student_id()` / `get_my_student_ids()` / `get_student_id_for_auth()` | `students` | student-own |
| `get_my_teacher_id()` | `teachers` | teacher identity |
| `get_my_teacher_student_ids()` | `class_students ⋈ classes ⋈ class_teachers` | teacher→students |
| `is_teacher_of(uuid)` | `class_students ⋈ class_teachers ⋈ teachers` (both `is_active`) | teacher-assigned |
| `is_guardian_of(uuid)` | `guardian_student_links ⋈ guardians` (status active/approved) | parent-linked |
| `is_school_admin_of(uuid)` | `school_admins` | school-admin |
| `get_admin_school_id()` | (admin school resolution) | school-admin scope |
| `is_admin()` | `admin_users` | platform admin |

**Edges (where TSB-4-class recursion can recur).** A cycle needs a **back-edge**: a policy on table A whose USING **inlines** a subquery over RLS-enabled table B, while B has a policy that reads A back. The danger zone is the **identity core**: `students`, `class_students`, `class_teachers`, `classes`, `teachers`, `guardians`, `guardian_student_links`, `school_admins`.

- **Apex `students`** is read by **84** policies' inline subqueries. `students`' own SELECT (`students_select_merged`) correctly uses **helpers** (`is_teacher_of`, `is_guardian_of`) — those bypass RLS, so no cycle.
- **One latent inline edge already on `students`:** `"School admins can view school students"` inlines `FROM school_admins`. Safe **only while `school_admins` has no policy that reads `students` back** (it currently self-scopes via `auth.uid()`). This is precisely the class the generalized guard must track; it should eventually be refactored to a SECURITY DEFINER helper (e.g. an `is_school_admin_of_student(uuid)`).
- **The back-edge TSB-4 closed:** `class_students` policy `"Students can view own enrollment"` inlines `FROM students`. Combined with TSB-4's new inline `students → class_students` policy, the cycle formed. The fix delegated the `students→teacher` check to `is_teacher_of` (DEFINER).
- **Other one-directional inline edges (safe today, tracked):** `classes "Students can view their enrolled classes"` (inline `class_students ⋈ students`), `classroom_polls`, `guardian_student_links` (5 inline policies), `offline_pending_responses`, etc. These read *toward* the identity core (leaf→students) and do not close a cycle — but each is an inline cross-table subquery and so is in the guard's tracked set.
- **Most-referenced inline-subquery targets:** `students` 84, `admin_users` 35, `guardians` 16, `teachers` 15, `guardian_student_links` 11, `school_admins` 5.

**Stale-test finding (must reconcile in Phase 0).** The brief references `src/__tests__/students-rls-no-recursion.test.ts` (REG-210) — **it does not exist on disk.** What exists is `src/__tests__/rls-teacher-assigned-students.test.ts`, which pins the **shape of the now-superseded *recursive* TSB-4 policy** (`20260702010000`) — it asserts the inline `class_students` join is present. After `20260702080000` that inline form is exactly what we never want again. No test currently enforces the non-recursive fixed shape or guards the recursion class. Phase 0 slice (a) both generalizes the guard and reconciles this stale test.

---

## 3. Goals / Non-Goals

**Goals**
- Make the TSB-4 recursion class statically impossible to ship on **any** table (not just `students`).
- Freeze the admin-client blast radius (273 routes) so it cannot silently grow.
- Add RLS backstops where app code is the only boundary, prioritised by sensitivity.
- Migrate **low-risk read routes** from the admin client to the RLS-respecting server client, proving the policies hold real traffic, without behavior change.

**Non-Goals**
- **Not** migrating payment/webhook/reconciliation routes off the admin client — service-role is correct there (P11). They are allowlisted, not changed.
- **Not** migrating super-admin / internal-admin routes — service-role-by-design; gated by `authorizeRequest` + secret.
- **Not** rewriting the 141 existing inline-subquery policies in one pass — they are grandfathered by an allowlist; only *new/changed* policies must use helpers.
- **Not** changing any RBAC role/permission, the score/XP path, or any product invariant. No `DROP TABLE`/`DROP COLUMN`.
- **Not** a live-Postgres RLS test harness (none exists in-repo); guards are source/shape-level, consistent with `rls-student-id-policies.test.ts`.

---

## 4. Phased plan

Each phase states **scope · risk · recursion-safety rule · rollout/rollback · verification**. The recursion-safety rule is identical and binding across every phase:

> **RS-RULE (binding).** Every **new or modified** RLS policy MUST pass the generalized recursion guard (Phase 0a): its `USING` / `WITH CHECK` MUST NOT inline a `FROM`/`JOIN` over a *different* RLS-enabled table. Cross-table authorization MUST delegate to a SECURITY DEFINER helper (`is_teacher_of`, `is_guardian_of`, `is_school_admin_of`, `get_my_*`, or a new documented helper). Same-table self-references, `auth.uid()` comparisons, and helper calls are allowed.

### Phase 0 — Guardrails + inventory (zero prod risk) — *first slice, spec in §5*
- **Scope:** (a) generalized recursion guard across the whole migration chain, seeded with the 141-policy baseline allowlist; (b) anti-regression guard freezing the 273-route admin-client set; reconcile the stale `rls-teacher-assigned-students.test.ts`; chain-wide RLS inventory (confirm no table without RLS, re-confirm the 2 deny-all tables are intentional).
- **Risk:** none (tests/CI only; no schema, no route change).
- **Rollout/rollback:** land as test files + CI wiring; rollback = revert the test files. No migration.
- **Verification:** new guards fail on a deliberately-recursive sample policy and on a new admin-import route not in the allowlist; pass on the current tree.
- **Gates:** Phase 0 must land before any Phase ≥1 policy or route change (it is the enforcement the later phases rely on).

### Phase 1 — Backstop RLS on the top-sensitivity set (additive policies only)
- **Scope:** confirm/补 the four-pattern policy set (student-own / parent-linked / teacher-assigned / admin service-role) on the highest-sensitivity tables (`students` is done; extend the audit-named-but-deferred `concept_mastery`/`topic_mastery`/`layer_mastery`, `quiz_responses`, `foxy_chat_messages`, `guardian_student_links`, `student_subscriptions`). Refactor `students`' `"School admins can view school students"` inline edge to a SECURITY DEFINER helper (closes the last latent inline edge on the apex table).
- **Risk:** medium — additive PERMISSIVE policies are OR-combined and cannot remove access, but any new policy is recursion-relevant. Mitigated by RS-RULE + Phase 0a guard.
- **Recursion-safety:** all new policies delegate to helpers; the guard blocks any inline cross-table form at CI.
- **Rollout/rollback:** one idempotent migration per table (`DROP POLICY IF EXISTS … ; CREATE POLICY …`); rollback = drop the named policy (the helper-based `students_select_merged`-style net remains).
- **Verification:** per-table shape test (presence + helper delegation + `is_active`/status guards), guard green, manual `SELECT`-as-role checks in the migration footer.
- **Notify (review chain):** frontend (parent portal), backend (child-progress API), assessment (if mastery tables touched), ai-engineer (if AI-read tables touched), testing.

### Phase 2 — Migrate low-risk **read** routes: admin → server client
- **Scope:** the `student`/`learner`/`pulse`/`parent`-read GET routes that read only rows the calling user already owns (covered by the Phase 1 policies). Swap `supabase-admin` → `supabase-server`; remove the matching allowlist entries so the count ratchets **down**.
- **Risk:** medium — a too-strict policy could turn a 200 into an empty result. Mitigated by per-route contract tests (same JSON shape) and gradual rollout (a few routes per PR).
- **Recursion-safety:** no new policies; relies on Phase 1.
- **Rollout/rollback:** per-route; rollback = revert the import swap (re-add allowlist entry). Independent per route.
- **Verification:** route contract test (authorized user sees own data; cross-user request returns empty/403); allowlist count decreases by exactly the migrated set.

### Phase 3 — Migrate teacher/school-admin **read** routes
- **Scope:** teacher/school-admin reads that map onto `is_teacher_of` / `is_school_admin_of`. Higher complexity (multi-row, cross-tenant) → after Phase 2 proves the pattern.
- **Risk:** medium-high (tenant-scoping correctness). Gated by Phase 2 completion.
- Otherwise same structure as Phase 2.

### Phase 4 — Write paths + residual hardening (explicitly later, may be deferred)
- **Scope:** consider RLS-scoped clients for selected non-payment write routes; refactor remaining grandfathered inline-subquery policies (the 141 → helper migration, table by table) so the allowlist shrinks toward zero.
- **Risk:** high; out of scope for initial XC-3 execution — listed for completeness.

**Sequencing / dependencies**
- Phase 0 **gates everything** (it is the guard the other phases trust).
- Phase 1 tables are **independent of each other** (one migration each, parallelizable).
- Phase 2 routes are **independent of each other** but **depend on Phase 1** for the tables they read.
- Phase 3 **depends on Phase 2** (pattern proven) and Phase 1 (teacher policies).
- Phase 4 depends on all prior.

---

## 5. Phase 0 — first safe slice (SPEC)

**Premise:** zero production risk — CI/test artifacts only. No migration, no route change, no schema change. This is the enforcement layer every later phase depends on.

### 5a. Generalized recursion guard (REG-210 → all tables)  — **owner: testing**

Replace the students-only intent (and reconcile the stale `rls-teacher-assigned-students.test.ts`) with a chain-wide static guard.

**File:** `src/__tests__/rls-no-cross-table-recursion.test.ts` (new). Source-level, Vitest, no live Postgres — consistent with `rls-student-id-policies.test.ts`.

**Algorithm**
1. **Build the RLS-enabled table set `R`:** scan every `supabase/migrations/**/*.sql` (baseline + root chain) for `ALTER TABLE … "public"."<t>" ENABLE ROW LEVEL SECURITY`. `R` = the set of `<t>`. (A table is "RLS-protected" iff it is in `R`.)
2. **Build the helper set `H`:** the SECURITY DEFINER helper names from §2.3 (`is_teacher_of`, `is_guardian_of`, `is_school_admin_of`, `is_admin`, `get_my_student_id`, `get_my_student_ids`, `get_student_id_for_auth`, `get_my_teacher_id`, `get_my_teacher_student_ids`, `get_admin_school_id`) plus any future helper tagged with a `-- rls-helper` marker comment at its definition.
3. **Parse every `CREATE POLICY … ;` statement** (greedy to the terminating `;`, multi-line — pg_dump wraps the `USING`/`WITH CHECK` across lines). For each policy record `policyTable` (the `ON "public"."<t>"` target) and the `USING`/`WITH CHECK` body.
4. **Flag a policy as a recursion risk iff** its body contains a `FROM "public"."<b>"` or `JOIN "public"."<b>"` where **`b ∈ R` and `b ≠ policyTable`** — i.e. an inline SECURITY-INVOKER subquery over a *different* RLS-protected table.
5. **Exemptions (avoid false positives):**
   - **Self-reference:** `b === policyTable` (same-table subquery does not re-enter a *foreign* RLS evaluator in a cycle-forming way) → allowed.
   - **Helper delegation:** a `FROM`/`JOIN` that is part of a SECURITY DEFINER helper *definition* is irrelevant (helpers are `CREATE FUNCTION`, not `CREATE POLICY`); a policy that merely *calls* `h(...)` for `h ∈ H` has no `FROM` and is allowed.
   - **`auth.uid()` comparisons** and non-table subqueries (e.g. `( SELECT auth.uid() )`) → no `FROM "public"."…"`, so not flagged.
   - **Tables not in `R`** (reference data, no RLS) → allowed (no foreign RLS to re-enter).
6. **Baseline allowlist (grandfather the 141):** an exported constant `GRANDFATHERED_INLINE_POLICIES` keyed by `"policyTable::policyName"` seeded with the existing baseline inline-subquery policies. The test **fails only for a flagged policy NOT in the allowlist** — i.e. any *new or modified* policy introducing the inline pattern. The allowlist is the explicit, reviewable debt ledger that Phase 4 drains.

**Acceptance criteria (5a)**
- [ ] Test enumerates `R` from the live migration chain (not a hardcoded list) and asserts `students`, `class_students`, `teachers`, `guardians`, `guardian_student_links`, `school_admins`, `classes` ∈ `R`.
- [ ] A synthetic recursive policy fixture (inline `FROM "public"."class_students"` on a `students` policy, not in the allowlist) **fails** the guard.
- [ ] A synthetic helper-delegating policy fixture (`USING ( public.is_teacher_of(id) )`) **passes**.
- [ ] The current tree **passes** (141 baseline inline policies all in `GRANDFATHERED_INLINE_POLICIES`; the fixed `20260702080000` `students` teacher policy passes because it delegates to `is_teacher_of`).
- [ ] `20260702010000`'s recursive inline form is **not** in the allowlist (it is superseded by `080000`), so if anyone re-creates that inline shape the guard fails.
- [ ] Stale `rls-teacher-assigned-students.test.ts` is reconciled: its assertions that pin the *recursive inline* shape are replaced with assertions that the **effective end-state** policy (post-`080000`) delegates to `is_teacher_of` (no inline `class_students` join on `students`).
- [ ] Catalogued as REG-210 (generalized) in `.claude/regression-catalog.md`.

### 5b. Admin-client anti-regression allowlist guard — **owner: architect (allowlist) + testing (guard)**

**File:** `src/__tests__/api-admin-client-allowlist.test.ts` (new) + `scripts/admin-client-allowlist.json` (the seeded baseline list, architect-owned).

**Algorithm**
1. Enumerate all `src/app/api/**/route.ts`.
2. Flag any that import from `…/supabase-admin`.
3. Compare against `admin-client-allowlist.json` (seeded with the **current 273**).
4. **Fail CI if** a `route.ts` imports `supabase-admin` and is **not** in the allowlist (the 273 can't grow silently). Optionally warn if an allowlisted file no longer imports admin (so Phase 2/3 migrations prune the list and the count ratchets down).

**Acceptance criteria (5b)**
- [ ] Allowlist JSON seeded with exactly the current 273 admin-importing `route.ts` paths (architect reviews the seed; each entry is implicitly "service-role justified for now").
- [ ] A synthetic new `route.ts` importing `supabase-admin` and absent from the allowlist **fails** the guard.
- [ ] Current tree **passes**.
- [ ] Removing a path from the allowlist while its route still imports admin **fails** (prevents accidental list shrink without the import swap).
- [ ] Wired into `.github/workflows/ci.yml` test stage (runs with the normal Vitest suite — no separate job needed).
- [ ] Catalogued as a new REG entry.

### 5c. RLS inventory assertion (cheap, confirmatory)
- [ ] A static test asserting: every `CREATE TABLE "public"."<t>"` in the chain has a matching `ENABLE ROW LEVEL SECURITY` for `<t>` in the chain, **except** an explicit `RLS_EXEMPT` allowlist (currently empty); and the only deny-all (RLS-on, zero-policy) tables are the intentional `{mass_gen_log, school_subscriptions}` set. Fails if a new table ships without RLS or a new deny-all table appears unannounced.

### Dispatch (who implements what, next)
- **5a generalized recursion guard + stale-test reconcile → `testing`** (architect reviews the `R`/`H` sets and the grandfather allowlist for correctness).
- **5b admin-client allowlist:** **architect** seeds + owns `admin-client-allowlist.json` (the justification ledger); **testing** writes the guard test + CI wiring.
- **5c inventory assertion → testing** (architect reviews exemptions).

---

## 6. Verification summary (per phase)

| Phase | What proves it | Prod risk |
|---|---|---|
| 0 | Guards fail on synthetic violations, pass on current tree; allowlists seeded | none |
| 1 | Per-table shape tests (helper delegation, status/`is_active` guards); recursion guard green; manual SELECT-as-role | medium (additive, OR-combined) |
| 2 | Per-route contract tests (own-data 200, cross-user empty/403); admin allowlist count ↓ | medium |
| 3 | Teacher/school-admin tenant-scope contract tests; allowlist count ↓ | medium-high |
| 4 | Grandfather allowlist shrinks; inline→helper shape tests | high (deferred) |

---

## 7. Appendix — audit commands (reproducible)

- Client usage: `grep -rlE "supabase-admin" src/app/api --include=route.ts | wc -l` (273); `… supabase-server …` (35); total `find src/app/api -name route.ts | wc -l` (362).
- RLS coverage: from `00000000000000_baseline_from_prod.sql` — `ENABLE ROW LEVEL SECURITY` ×270; `CREATE POLICY` ×522; deny-all = `comm -23` of RLS-on tables vs policy-target tables = `{mass_gen_log, school_subscriptions}`.
- Recursion class: per-`CREATE POLICY` statement scan — 141 inline a `FROM "public"."…"` over another table; 75 delegate to a helper; inline targets `students` 84 / `admin_users` 35 / `guardians` 16 / `teachers` 15 / `guardian_student_links` 11 / `school_admins` 5.
- Helpers: `00000000000000_baseline_from_prod.sql` lines 8979–9228 (`get_my_*`, `is_*`).
