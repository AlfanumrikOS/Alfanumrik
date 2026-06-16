# Runbook: School Command Center — apply DB read-models + demo seed

> **Purpose**: Fix the three School Command Center widgets (overview,
> classes-at-risk, teacher-engagement) that return HTTP 500 because their
> backing `SECURITY DEFINER` RPCs are not yet applied on the live DB, then seed
> the demo school so the widgets show real numbers.
>
> **Owner**: architect (DB) with ops oversight. **Approver**: user (CEO).
>
> **Root cause**: The RPCs `get_school_overview`, `get_classes_at_risk`, and
> `get_teacher_engagement` are defined on disk in
> `supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql`
> but that migration (and its dependency,
> `teacher_remediation_assignments`) has not been applied to the live DB. **No
> new function code is needed — applying the existing migrations is the fix.**

---

## A. Apply the pending migrations (`supabase db push`)

**Environment**: run against the environment whose Command Center is 500-ing
(production if that is where the bug shows; otherwise staging first to rehearse).
`supabase db push` applies only the files at the immediate
`supabase/migrations/` root in ascending version order, so the files below run
in the correct order automatically.

The migrations that must end up APPLIED, **in this order**:

1. `20260613000004_teacher_remediation_assignments.sql`
   — creates `public.teacher_remediation_assignments` (read by
   `get_teacher_engagement`).
2. `20260619000150_reconcile_teacher_remediation_assignments.sql`
   — reconciliation: physically (re)creates the same table on any environment
   where `20260613000004` was `migration repair`-marked applied but its body
   never ran (the schema-reproducibility cutover). Idempotent no-op where the
   table already exists.
3. `20260614000000_phase3b_school_command_center_read_models.sql`
   — defines the three Command Center RPCs + covering indexes.

> Note on ordering: `db push` sorts by the numeric version prefix, so
> `20260613000004` and `20260614000000` apply before the `20260619*` files.
> `get_teacher_engagement` only *reads* `teacher_remediation_assignments` at
> call time (not at CREATE time), so the function defines cleanly even before
> the table physically exists; both end up present after the full push.

```bash
# 0. Authenticate + link to the TARGET project (staging first is recommended).
supabase login                                  # paste SUPABASE_ACCESS_TOKEN
supabase link --project-ref "$TARGET_PROJECT_REF" --password "$TARGET_DB_PASSWORD"

# 1. Preview what will be applied (read-only; no mutation).
supabase db push --dry-run

# 2. Apply.
supabase db push
```

**Acceptance**:
- Exit code `0`.
- The dry-run / push output lists the three files above as pending → applied
  (files already recorded as applied are skipped — that is fine and expected).
- No `ERROR:` lines (notably no
  `relation "public.teacher_remediation_assignments" does not exist`).

---

## B. Run the demo seed

The seed is **not** a migration — it lives under `scripts/seed/` and is run by
hand against the project you want populated. It self-discovers the demo school
(oldest school whose name matches `ILIKE '%demo%'`) and is fully idempotent.

```bash
# Option 1 — Supabase CLI (uses the linked project from step A):
supabase db execute --file scripts/seed/demo-school-data.sql --linked

# Option 2 — psql directly (build DB_URL from the project ref + password):
export DB_URL="postgresql://postgres.${TARGET_PROJECT_REF}:${TARGET_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
psql "$DB_URL" -f scripts/seed/demo-school-data.sql
```

**Acceptance**:
- Output includes `NOTICE: demo-school-data: seeding demo school <uuid>` then
  `NOTICE: demo-school-data: seed complete`.
- If you instead see `NOTICE: ... no school matching ILIKE '%demo%' found`, no
  demo school exists yet — create one first (or rename an existing test school
  to contain "demo"), then re-run. The seed is safe to re-run any number of
  times.

---

## C. Verify the fix

### C.1 Confirm the three RPCs exist

```bash
psql "$DB_URL" -At -c "
  SELECT proname
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('get_school_overview','get_classes_at_risk','get_teacher_engagement')
   ORDER BY proname;
"
```

**Acceptance**: exactly **3 names** returned:
`get_classes_at_risk`, `get_school_overview`, `get_teacher_engagement`.

Also confirm the dependency table landed:

```bash
psql "$DB_URL" -At -c "SELECT to_regclass('public.teacher_remediation_assignments');"
```

**Acceptance**: a non-null value (`teacher_remediation_assignments`).

### C.2 Confirm the demo school has 3 classes + roster

```bash
psql "$DB_URL" -At -c "
  WITH demo AS (
    SELECT id FROM public.schools
     WHERE name ILIKE '%demo%' AND deleted_at IS NULL
     ORDER BY created_at ASC NULLS LAST LIMIT 1
  )
  SELECT
    (SELECT count(*) FROM public.classes c
       WHERE c.school_id = (SELECT id FROM demo) AND c.is_active AND c.deleted_at IS NULL) AS classes,
    (SELECT count(*) FROM public.teachers t
       WHERE t.school_id = (SELECT id FROM demo) AND t.is_active AND t.is_demo)            AS demo_teachers,
    (SELECT count(*) FROM public.students s
       WHERE s.school_id = (SELECT id FROM demo) AND s.is_active AND s.is_demo)            AS demo_students;
"
```

**Acceptance**: `classes >= 3`, `demo_teachers >= 3`, `demo_students >= 9`.

### C.3 (Optional) Exercise the dashboard RPC as the school admin

`get_school_dashboard_stats` / `get_school_overview` are `SECURITY DEFINER` and
guard on `is_school_admin_of(p_school_id)`, i.e. `auth.uid()` must be an ACTIVE
`school_admins` row for that school. On a plain `psql` / service-role connection
`auth.uid()` is NULL, so these **intentionally raise `Forbidden`** — that is the
RLS boundary working, not a bug. To exercise them positively, hit the widget in
the app while logged in as the school admin, or issue a PostgREST `rpc` call
with that admin's JWT. For a connection-agnostic proof, rely on C.2 instead.

### C.4 Confirm the widgets stop 500-ing

Log into the School Command Center page as a school admin of the demo school.
The overview, classes-at-risk, and teacher-engagement widgets should now return
HTTP 200 with populated numbers (3 classes, 3 teachers, 9 students; at-risk and
mastery columns are 0/empty until `concept_mastery` rows accrue for the demo
roster — that is expected for freshly-seeded demo students).

---

## D. Rollback / cleanup

### D.1 Remove the demo seed data (does NOT touch any migration)

The seed only creates `is_demo = true` rows plus their enrollments, so cleanup
is a scoped delete. Run against the same project:

```bash
psql "$DB_URL" <<'SQL'
BEGIN;
WITH demo AS (
  SELECT id FROM public.schools
   WHERE name ILIKE '%demo%' AND deleted_at IS NULL
   ORDER BY created_at ASC NULLS LAST LIMIT 1
)
-- enrollments first (FK children), then the demo people.
DELETE FROM public.class_students cs
 USING public.students s
 WHERE cs.student_id = s.id AND s.is_demo
   AND s.school_id = (SELECT id FROM demo);

DELETE FROM public.class_teachers ct
 USING public.teachers t
 WHERE ct.teacher_id = t.id AND t.is_demo
   AND t.school_id = (SELECT id FROM demo);

DELETE FROM public.students s
 WHERE s.is_demo AND s.school_id = (SELECT id FROM (
   SELECT id FROM public.schools
    WHERE name ILIKE '%demo%' AND deleted_at IS NULL
    ORDER BY created_at ASC NULLS LAST LIMIT 1) d);

DELETE FROM public.teachers t
 WHERE t.is_demo AND t.school_id = (SELECT id FROM (
   SELECT id FROM public.schools
    WHERE name ILIKE '%demo%' AND deleted_at IS NULL
    ORDER BY created_at ASC NULLS LAST LIMIT 1) d);

-- Demo classes (the seed's 3 by name). Safe-delete; no soft-delete needed for demo.
DELETE FROM public.classes c
 WHERE c.school_id = (SELECT id FROM (
   SELECT id FROM public.schools
    WHERE name ILIKE '%demo%' AND deleted_at IS NULL
    ORDER BY created_at ASC NULLS LAST LIMIT 1) d)
   AND c.name = ANY (ARRAY['Class 9A','Class 10B','Class 11 Science']);
COMMIT;
SQL
```

> The `class_students` / `class_teachers` FKs are `ON DELETE CASCADE`, so
> deleting the demo students/teachers also clears their enrollments even if the
> explicit enrollment deletes above were skipped. Deleting the demo classes
> cascades any remaining enrollments on them.

### D.2 The migrations are NOT rolled back

The Phase 3B read-models and `teacher_remediation_assignments` are additive,
read-only (functions) / additive table + RLS, and are required for the feature.
There is no reason to roll them back. If a defect is found in an RPC, fix it
with a new `CREATE OR REPLACE FUNCTION` migration (never edit the baseline,
never `DROP` in panic).

---

## Quick reference

```bash
# A. apply migrations (3 files, version-ordered automatically)
supabase link --project-ref "$TARGET_PROJECT_REF" --password "$TARGET_DB_PASSWORD"
supabase db push --dry-run && supabase db push

# B. seed demo data (idempotent, self-discovering, NOT a migration)
supabase db execute --file scripts/seed/demo-school-data.sql --linked

# C. verify RPCs + roster
psql "$DB_URL" -At -c "SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_school_overview','get_classes_at_risk','get_teacher_engagement') ORDER BY proname;"
```
