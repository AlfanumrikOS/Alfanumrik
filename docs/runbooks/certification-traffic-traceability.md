# Certification Traffic Traceability — Runbook

**Date:** 2026-07-02
**Status:** Convention specified, ready to implement. No new migration required (every column referenced below already exists — confirmed by direct schema read, see "Schema verification" below).
**Owner:** ops (this runbook, convention definition, query patterns) · testing (implements the seeding script against this spec) · architect (owns the one flagged optional follow-up migration, see "Gaps to flag to architect")
**Origin:** `docs/audit/2026-07-02-certification/evidence/stage-1-static/code-trace-notes/environment-readiness-ops.md` §1 ("TRACEABILITY — MUST BE ESTABLISHED"), proposed convention in that file's §1 "Proposed minimal, actionable convention".

## Why this exists

There is currently no single, canonical, DB-queryable way to mark rows created by a certification run as synthetic. Three partial, inconsistent conventions exist in the codebase today (`is_demo` alone via `seed-staging-test-student.yml`'s test student, which does NOT set `is_demo`; `is_demo` + a `drill-synthetic-*` email marker via `staging-adaptive-drill.yml`; `is_demo` + `is_test_account` + `account_status='test'` via `/api/super-admin/test-accounts`, with no registry row). None of the three is documented as *the* canonical convention, and the one existing staging E2E test account is genuinely indistinguishable from a real student by any DB column.

This runbook fixes that by specifying one concrete, adoptable convention, built entirely from primitives that already exist and are already respected by the super-admin reporting APIs.

## The convention — four required signals

Every row created by a certification seeding run MUST carry all four of the following. They are independent signals (not one signal expressed four ways) so that a bug in setting any single one does not silently deanonymize the run.

### 1. Email domain suffix: `@certification.alfanumrik.invalid`

Use the RFC 2606 reserved `.invalid` TLD — the same reserved-namespace pattern `staging-adaptive-drill.yml` already uses (`@example.invalid`), scoped to a dedicated `certification.alfanumrik.invalid` subdomain so certification rows are distinguishable from drill rows by domain alone. `.invalid` guarantees the address can never resolve or receive real mail, and is queryable independent of any flag:

```sql
WHERE email LIKE '%@certification.alfanumrik.invalid'
```

Exact email shape per seeded account:

```
cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid
```

Where:
- `<run_id_short>` = first 8 hex characters of the per-run UUID (see signal 3 below), lowercase.
- `<role>` = one of `student`, `teacher`, `parent`, `school_admin` (matches `demo_accounts.role`'s allowed values — see signal 4).
- `<n>` = a zero-padded sequence number unique within `(run_id, role)`, e.g. `001`, `002`, so multiple seeded accounts of the same role in one run never collide.

Example: `cert-a1b2c3d4-student-014@certification.alfanumrik.invalid`

**Full role coverage note (updated 2026-07-02, post remediation-wave quality review):** the certification plan requires seeding all 7 mission roles - student, teacher, parent, school administrator, super administrator, content author, support staff - not just the 4 values `demo_accounts.role` accepts today. `super_admin` is a legal `demo_accounts.role` value and is seeded with a full registry row like the other 4. Content author and support staff map to `admin_users` rows distinguished only by `admin_level`, and `demo_accounts_role_check` has no legal value for either today - `scripts/seed-certification-accounts.ts` seeds both roles fully (email marker, name marker, `is_demo=true` on their `admin_users` row) but deliberately does NOT write a `demo_accounts` registry row for them, rather than mislabeling them under an existing role. This is intentional, not a gap: the four traceability signals below still apply to their base row (email domain, `is_demo`, name marker), only the registry-row convenience lookup is unavailable for these two roles until `demo_accounts_role_check` is widened (tracked as a follow-up for architect, not required to unblock certification).

If a synthetic school is seeded, prefix its `schools.name` with `[CERTIFICATION]` (human-readable operator visibility in `/super-admin/institutions` — a display convenience layered on top of the four signals below, not a substitute for them, per the evidence file's §1e recommendation).

### 2. `is_demo = true` on every base-table row

Set on the row's own table. All of the following columns already exist (verified against migrations listed in "Schema verification" below — no migration needed):

| Table | Column | Migration that added it |
|---|---|---|
| `students` | `is_demo` | pre-baseline (present in `00000000000000_baseline_from_prod.sql`) |
| `teachers` | `is_demo` | `20260515000001_add_is_demo_to_teachers_and_guardians.sql`, re-confirmed idempotent in `20260603150000_demo_account_authority_completeness.sql` |
| `guardians` | `is_demo` | `20260515000001_add_is_demo_to_teachers_and_guardians.sql`, re-confirmed idempotent in `20260603150000_demo_account_authority_completeness.sql` |
| `admin_users` | `is_demo` | pre-baseline |
| `school_admins` | `is_demo` | pre-baseline |
| `schools` | `is_demo` | pre-baseline |
| `student_subscriptions` | `is_demo` | pre-baseline |
| `school_subscriptions` | `is_demo` | pre-baseline |

This is the signal the super-admin reporting APIs already respect: `src/app/api/super-admin/stats/route.ts` (`countRows('students', 'is_demo=eq.false')`) and `src/app/api/super-admin/analytics/route.ts` (signup trend, plan distribution, leaderboard, all filtered `is_demo=eq.false`). Setting `is_demo=true` on every certification row is therefore not cosmetic — it is already wired to keep certification traffic out of every dashboard/metric an operator looks at.

**Rows with no `is_demo` column** (`quiz_sessions`, `chat_sessions`, and any other child table keyed by `student_id`/`auth_user_id`): these do **not** need a new column. Traceability is inherited through the FK join back to the owning `students`/`teachers`/`guardians` row, which does carry `is_demo=true`. Any report or query that needs to exclude certification-run quiz/chat volume should join to the owner table and filter `is_demo=false` there (this is exactly what the existing super-admin analytics routes already do for aggregate counts).

### 3. Run marker embedded in `name` / `display_name`: `cert-<run_id_short>`

Generate one UUID per certification run (`certification_run_id`, minted once at the start of the seeding script — same mechanism as `staging-adaptive-drill.yml`'s `drill_run_id`). Embed its first-8-hex-chars form in every row's human-readable name field:

- `students.name`, `teachers.name`, `guardians.name` → `cert-<run_id_short>-<role>-<n>` (mirrors the email local-part exactly, so a human operator scanning a table by eye can match name↔email at a glance).
- `schools.name` (if a synthetic school is seeded) → `[CERTIFICATION] cert-<run_id_short>-school-<n>`.

There is currently **no dedicated typed column** for the full `certification_run_id` UUID on any base table or on `demo_accounts` (see "Gaps to flag to architect" below). Until that lands, the run id is only queryable via `LIKE 'cert-<run_id_short>-%'` on the name/display_name field, or by re-deriving `run_id_short` from a known full run id. This is sufficient for a certification-scale run (bounded, single-operator-invoked) but is a documented limitation, not an oversight.

### 4. One `demo_accounts` registry row per top-level account

Insert into the existing `demo_accounts` table (created by `20260528000001_promote_demo_accounts_v2.sql`) — this is what makes the existing `purge_demo_account_by_id(p_demo_account_id UUID)` SECURITY DEFINER RPC (migration `20260528000004_demo_account_purge_cron.sql`) usable for teardown instead of requiring bespoke SQL per account (see "Teardown" below). Register **one row per top-level account** — i.e., one per student, one per teacher, one per parent, one per school_admin. Do **not** register a row per quiz session or per school (the school itself is reached transitively through the `school_admin` row's `school_id`, matching how `purge_demo_account_by_id`'s `role='school_admin'` branch already works).

Exact registry-row shape a seeding script must write:

```sql
INSERT INTO demo_accounts (
  auth_user_id,   -- the synthetic account's auth.users.id (already created by the seeding
                   -- script via the normal signup/bootstrap path, or a directly-inserted
                   -- auth.users row if the script uses the admin API)
  role,           -- one of: 'student' | 'teacher' | 'parent' | 'school_admin' | 'super_admin'
                   -- (matches demo_accounts_role_check; certification seeding writes a
                   -- registry row for all 5 of these. content_author/support_staff are
                   -- seeded too but have no legal demo_accounts.role value today, so no
                   -- registry row is written for them - see the role-coverage note above.)
  persona,        -- NULL is fine (column default is 'average'; certification seeding has
                   -- no use for the weak/average/high_performer persona axis)
  display_name,   -- 'cert-<run_id_short>-<role>-<n>' — MUST exactly match the name field
                   -- set on the base-table row (signal 3 above)
  email,          -- 'cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid' —
                   -- MUST exactly match the base-table row's email (signal 1 above)
  school_id,      -- the synthetic school's id if this account belongs to one (student /
                   -- teacher / school_admin under a seeded school), else NULL (e.g. a
                   -- standalone parent account not tied to school seeding)
  is_active,      -- true
  created_by      -- the operator's or service account's auth_user_id if known, else NULL
                   -- (column is nullable)
) VALUES (
  $auth_user_id, $role, NULL, $display_name, $email, $school_id, true, $created_by
);
```

`created_at`/`updated_at`/`last_reset_at` all have sane defaults (`now()` / `now()` / `NULL`) and do not need to be set explicitly.

## Schema verification

All four signals above use columns confirmed present by direct migration read during the same investigation this runbook is based on (`environment-readiness-ops.md` §1d):
- `is_demo` on `students`/`teachers`/`guardians`/`admin_users`/`school_admins`/`schools`/`student_subscriptions`/`school_subscriptions` — confirmed present.
- `demo_accounts` table, with columns `id, auth_user_id, role, persona, display_name, email, school_id, is_active, created_by, created_at, updated_at, last_reset_at` — confirmed present, RLS enabled, `service_role`-only policy.
- `purge_demo_account_by_id(UUID)` RPC — confirmed present, `SECURITY DEFINER`, `EXECUTE` granted to `service_role` only.

**No migration is required to adopt this convention.**

## Query patterns for isolating certification data

```sql
-- All certification students from a specific run
SELECT * FROM students
WHERE is_demo = true
  AND email LIKE 'cert-a1b2c3d4-%@certification.alfanumrik.invalid';

-- All certification rows of any role, any run (coarse sweep)
SELECT 'students' AS tbl, id, name, email FROM students WHERE email LIKE '%@certification.alfanumrik.invalid'
UNION ALL
SELECT 'teachers', id, name, email FROM teachers WHERE email LIKE '%@certification.alfanumrik.invalid'
UNION ALL
SELECT 'guardians', id, name, email FROM guardians WHERE email LIKE '%@certification.alfanumrik.invalid'
UNION ALL
SELECT 'school_admins', id, name, email FROM school_admins WHERE email LIKE '%@certification.alfanumrik.invalid';

-- Quiz/chat volume generated by one certification run (join-inherited traceability)
SELECT count(*) FROM quiz_sessions qs
JOIN students s ON s.id = qs.student_id
WHERE s.is_demo = true
  AND s.email LIKE 'cert-a1b2c3d4-%@certification.alfanumrik.invalid';
```

## Reporting isolation — already confirmed, no further change needed

`src/app/api/super-admin/stats/route.ts` and `src/app/api/super-admin/analytics/route.ts` already filter `is_demo=eq.false` on every metric they compute (total/active/signup counts, signup trend, plan distribution, leaderboard). As long as signal 2 (`is_demo=true`) is set correctly on every seeded row, certification traffic will not appear in any existing super-admin dashboard metric without further ops/backend work.

## Teardown

Preferred path — via the existing `purge_demo_account_by_id` RPC, once every top-level account is registered per signal 4:

```sql
-- Per registered account (student / teacher / parent), in any order:
SELECT purge_demo_account_by_id('<demo_accounts.id>');

-- For a school_admin-role registration, purge_demo_account_by_id already
-- deletes is_demo=true students under school_id BEFORE deleting the schools
-- row, in the correct FK order — but it does NOT delete teachers under that
-- school (see "Gaps to flag to architect" below). Delete certification
-- teachers manually first if the run seeded any:
DELETE FROM teachers WHERE school_id = '<school_id>' AND is_demo = true;
-- THEN call purge_demo_account_by_id() for the school_admin registration.
```

Auth-user deletion (`auth.users` row) is intentionally left to the caller/Edge Function per the RPC's own contract (it returns `auth_user_id` for that purpose) — it does not have admin API key access from SQL.

**Mandatory post-teardown leak check** (mirrors `staging-adaptive-drill.yml`'s teardown assertion pattern — fail the job if any row survives):

```sql
SELECT
  (SELECT count(*) FROM students      WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM teachers      WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM guardians     WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM school_admins WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM schools       WHERE name LIKE '[CERTIFICATION]%')
+ (SELECT count(*) FROM demo_accounts WHERE email LIKE '%@certification.alfanumrik.invalid')
  AS remaining_certification_rows;
-- MUST be 0 after teardown completes. Non-zero = manual cleanup required.
```

## Gaps to flag to architect

These are genuinely missing pieces this runbook cannot resolve itself (migrations are out of ops's domain — architect owns them). Neither blocks adopting the convention above; both are optional hardening follow-ups.

1. **No dedicated `certification_run_id` column exists** on `demo_accounts` or any base table. The convention above works without one (via `LIKE` on the email/name marker), but an indexed `certification_run_id UUID NULL` column on `demo_accounts` (with a supporting index) would let a teardown or reporting script do an exact-match `WHERE certification_run_id = $1` instead of a `LIKE` scan, and would let one run's rows be counted/audited in O(1) instead of a string scan. Not blocking; recommend architect add if certification runs become routine/frequent enough that `LIKE` scan cost becomes material.

2. **`purge_demo_account_by_id`'s `role='school_admin'` branch does not delete `teachers`.** Confirmed by direct read of `20260528000004_demo_account_purge_cron.sql` — the school_admin branch deletes `students WHERE school_id = ... AND is_demo = true` (correctly, before the `schools` delete) but has no equivalent `DELETE FROM teachers WHERE school_id = ... AND is_demo = true` line. Since `teachers_school_id_fkey` has no `ON DELETE CASCADE` (confirmed against `00000000000000_baseline_from_prod.sql`), any certification-seeded teacher left under the school will block the RPC's own `DELETE FROM schools` step with a Postgres `23503` foreign-key violation. This runbook's teardown section works around it with a manual `DELETE FROM teachers ...` step before calling the RPC; recommend architect add the missing branch to the RPC itself so the single-call teardown is actually single-call. (This gap was independently surfaced in the same evidence file this runbook is built from — `environment-readiness-ops.md` §3 — as part of the broader schools-teardown FK finding, which is being addressed separately by architect in the same remediation wave; see `docs/runbooks/2026-07-02-environment-readiness-remediation.md`.)

## What the seeding script (testing agent) must do, precisely

For every synthetic account the certification run creates:
1. Create the account through the normal signup/bootstrap path (or direct admin-API/service-role insert), producing an `auth.users` row and a base-table row (`students`/`teachers`/`guardians`/`school_admins`).
2. On that base-table row, set `is_demo = true`, `name = 'cert-<run_id_short>-<role>-<n>'`, `email = 'cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid'`.
3. Insert exactly one `demo_accounts` row per top-level account per the exact shape specified above, with `display_name` and `email` matching byte-for-byte.
4. If seeding a synthetic school: set `schools.is_demo = true` and `schools.name = '[CERTIFICATION] cert-<run_id_short>-school-<n>'`.
5. Log the full `certification_run_id` UUID (not just the short form) once, at the start of the run, so an operator can reconstruct `run_id_short` for teardown/query purposes without guessing.
6. At the end of the run (or in a separate, deliberately-invoked teardown script), follow the "Teardown" section above, and assert the leak-check query returns 0 before declaring cleanup complete.
