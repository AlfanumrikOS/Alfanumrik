# Runbook: School Command Center — apply DB read-models + demo seed

> **Purpose**: Fix the three School Command Center widgets (overview,
> classes-at-risk, teacher-engagement) that return HTTP 500 because their
> backing `SECURITY DEFINER` RPCs are not present on the live DB, then seed the
> demo school(s) so the widgets show real numbers.
>
> **Owner**: architect (DB) with ops oversight. **Approver**: user (CEO).
>
> **Root cause (TWO failure modes — both seen on prod)**:
>
> 1. **Migration genuinely pending** — the RPCs `get_school_overview`,
>    `get_classes_at_risk`, `get_teacher_engagement` are defined on disk in
>    `supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql`
>    but that migration (and its dependency `teacher_remediation_assignments`)
>    was never applied. Fix: `supabase db push` (Section A).
>
> 2. **"Repair-skip" — migration marked applied but its body never executed**
>    (the failure mode actually hit on prod, 2026-06-16). During the
>    schema-reproducibility cutover, `20260614000000` was `supabase migration
>    repair`-marked applied on prod so the merge would *skip* re-running it — but
>    on prod the function bodies had never actually been created. Because
>    `supabase_migrations.schema_migrations` already lists `20260614000000`,
>    **`supabase db push` is a NO-OP for it** (the CLI sees it as applied and
>    skips it entirely), so the widgets keep 500-ing with
>    `function public.get_school_overview(uuid) does not exist`. `db push`
>    CANNOT fix a repair-skip — you must stream the migration **body** directly
>    (Section A.2).
>
> **No new function code is needed — making the existing function bodies
> actually exist on the live DB is the fix.**

---

## A. Make the function bodies exist on the live DB

**Environment**: run against the environment whose Command Center is 500-ing
(production if that is where the bug shows; otherwise staging first to rehearse).

> **Decide which path you need FIRST.** Run the existence check in C.1 against
> the target DB:
> - If the three RPCs are **absent** AND `20260614000000` is **NOT** listed in
>   `supabase_migrations.schema_migrations` → it is genuinely pending → use
>   **A.1 (`db push`)**.
> - If the three RPCs are **absent** but `20260614000000` **IS** already listed
>   as applied → this is a **repair-skip** (Section "Root cause" #2) → `db push`
>   will NO-OP → you MUST use **A.2 (stream the body via STDIN)**.

### A.1 — Migration genuinely pending: `supabase db push`

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

> **If C.1 still shows the RPCs absent after a clean `db push`, you are in the
> repair-skip case — go to A.2.** `db push` reports "Remote database is up to
> date" and changes nothing because `20260614000000` is already recorded as
> applied.

### A.2 — Repair-skip: stream the migration BODY via STDIN

When the migration is marked applied but its body never ran, you must execute
the SQL **body** directly (bypassing the `schema_migrations` bookkeeping that
`db push` honours). This is what was done on prod (`shktyoxqhundlvkiwguu`) on
2026-06-16:

```bash
# Run against the LINKED project. STDIN redirect — NOT the argument form.
npx -y supabase db query --linked < supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql
```

> **Windows caveat — use STDIN (`<`), never the argument form.**
> The argument form
> `npx -y supabase db query "$(cat supabase/migrations/20260614000000_*.sql)"`
> **FAILS on Windows** for two independent reasons:
> 1. The file exceeds the Windows command-line length limit (~32 KB), so the
>    argument is truncated and the SQL is incomplete/invalid.
> 2. The shell mangles the `$$` dollar-quoting that wraps the PL/pgSQL function
>    bodies, so even a short fragment parses wrong.
> Piping the file on **STDIN** sidesteps both — the CLI reads the raw file
> verbatim, no shell length limit, no `$$` mangling. STDIN is the reliable
> channel for any large / dollar-quoted migration body on Windows.

The migration is itself idempotent (`CREATE OR REPLACE FUNCTION`,
`CREATE INDEX IF NOT EXISTS`, DO-block-guarded `GRANT`) and is wrapped in its
own `BEGIN; … COMMIT;`, so streaming the body is safe to repeat and does not
disturb the `schema_migrations` row (which already — correctly — lists the
version as applied; only the body was missing).

**Acceptance**: re-run C.1 — the three RPCs now exist.

---

## B. Run the demo seed

The seed is **not** a migration — it lives under `scripts/seed/` and is run by
hand against the project you want populated. It targets **every** demo school
that has an **ACTIVE `school_admin`** (`name ILIKE '%demo%'` AND a live row in
`public.school_admins`), loops over all of them, and is fully idempotent.

> **Two bug fixes baked into the current seed (both discovered live 2026-06-16):**
> - **(A) `preferred_subject` FK.** `students.preferred_subject` has a column
>   DEFAULT of `'Mathematics'` (a NAME) but FKs `public.subjects.code`, whose
>   values are lowercase codes (`'math'`, `'science'`, `'physics'`, …). Leaving
>   the column unset fired the default → `23503` FK violation. The seed now sets
>   `preferred_subject` explicitly to a valid code, aligned per class:
>   Class 9A → `math`, Class 10B → `science`, Class 11 Science → `physics`.
> - **(B) Multi-school email collision + wrong target.** `teachers.email` /
>   `students.email` are GLOBALLY UNIQUE. The old seed used non-school-scoped
>   emails and auto-discovered only the OLDEST `%demo%` school — which on prod is
>   "Alfanumrik Demo School", a school with NO admin (so it can never be
>   demoed). The seed now (i) targets only `%demo%` schools that have an ACTIVE
>   `school_admins` row, looping over ALL of them; and (ii) makes every
>   teacher/student email school-scoped by embedding an 8-char tag from the
>   school id (`left(replace(school_id::text,'-',''),8)`) so running across
>   multiple schools never collides or cross-wires.
> - **(C) Student grade aligned to the enrolled class.** The old seed stamped a
>   student's `grade` from the alphabetical class-loop index (`CASE i WHEN 1 THEN
>   '9' …`), so e.g. `Class 10B` students could get grade `'9'`. The seed now
>   takes `grade` from the enrolled class's `grade` column (`c.grade`, still
>   TEXT — P5), so every student's grade matches the class it sits in.

### B.1 concept_mastery seeding — make "Classes at risk" show real mastery

Added live **2026-06-16**. Freshly-seeded demo students have **no**
`concept_mastery` rows, so the **Classes at risk** widget rendered an
empty/zero column. The seed now gives each demo student a small set of
`concept_mastery` rows with a **per-class `p_know` band**, so the widget shows a
realistic spread.

**Why this is the column that matters.** `get_classes_at_risk` averages
`concept_mastery.p_know` per student and flags a **class** as at-risk when its
students' average `p_know < 0.4` (the **at-risk threshold = 0.4 on `p_know`**).
`mastery_probability` / `mastery_mean` are written in lockstep with `p_know` by
convention; the RPC only reads `p_know`.

**Per-class bands** (one value per student, 3 students per class):

| Class | `p_know` band | class avg | at-risk? |
|---|---|---|---|
| Class 9A | 0.20 / 0.28 / 0.34 | 0.2733 | **yes** (< 0.4) |
| Class 10B | 0.45 / 0.55 / 0.62 | 0.5400 | no |
| Class 11 Science | 0.72 / 0.80 / 0.88 | 0.8000 | no |

**Topic ids are discovered at RUNTIME — never hardcoded.**
`concept_mastery.topic_id` FKs `public.curriculum_topics(id)` (**not** `topics`),
and `(student_id, topic_id)` is UNIQUE. The topic UUIDs are environment-specific,
so the seed discovers them at run time with
`SELECT id FROM public.curriculum_topics ORDER BY id LIMIT 3` and writes one
`concept_mastery` row per `(student, discovered topic)`. It degrades gracefully:
it uses however many topics exist (1..3); if **zero** `curriculum_topics` exist
it `RAISE NOTICE`s and **skips `concept_mastery` only** (classes/teachers/
students still seed). Inserts are idempotent via
`ON CONFLICT (student_id, topic_id) DO NOTHING`, so the step is safe to re-run.

**Verified schema facts (live 2026-06-16):** `concept_mastery` — NOT NULL
`student_id` (FK `students.id`) + `topic_id` (FK `curriculum_topics.id`); UNIQUE
`(student_id, topic_id)`; `concept_id` nullable (left NULL); no CHECK
constraints; `p_know double precision DEFAULT 0.1` is the read column.

**Acceptance.** The verification query block at the bottom of the seed file
(items `1b` + `1c`) shows non-zero `concept_mastery` rows per demo student, and
`get_classes_at_risk` (under the simulated-admin JWT — see C.3) returns the
spread below.

```bash
# Option 1 — Supabase CLI (uses the linked project from step A):
supabase db execute --file scripts/seed/demo-school-data.sql --linked

# Option 2 — psql directly (build DB_URL from the project ref + password):
export DB_URL="postgresql://postgres.${TARGET_PROJECT_REF}:${TARGET_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
psql "$DB_URL" -f scripts/seed/demo-school-data.sql

# Option 3 — STDIN via the CLI (mirrors the A.2 channel; reliable on Windows):
npx -y supabase db query --linked < scripts/seed/demo-school-data.sql
```

**Acceptance**:
- Output includes one `NOTICE: demo-school-data: seeding demo school <uuid> (tag <8char>)`
  + `NOTICE: demo-school-data: seed complete for school <uuid>` PER qualifying
  school.
- If you instead see
  `NOTICE: ... no school matching ILIKE '%demo%' with an ACTIVE school_admin found`,
  no demoable school exists yet — create one (or attach an active `school_admin`
  to an existing `%demo%` school), then re-run. The seed is safe to re-run any
  number of times.

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
(If this returns **0 names but** `20260614000000` is recorded applied, you are
in the repair-skip case — go back to **A.2**.)

You can also confirm directly against `pg_proc.proname` via the CLI on STDIN:

```bash
npx -y supabase db query --linked <<'SQL'
SELECT proname
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('get_school_overview','get_classes_at_risk','get_teacher_engagement')
 ORDER BY proname;
SQL
```

Also confirm the dependency table landed:

```bash
psql "$DB_URL" -At -c "SELECT to_regclass('public.teacher_remediation_assignments');"
```

**Acceptance**: a non-null value (`teacher_remediation_assignments`).

### C.2 Confirm EVERY demoable school has 3 classes + roster

The seed now populates all `%demo%` schools that have an active admin, so verify
**per school** (not just the oldest):

```bash
psql "$DB_URL" -At -F$'\t' -c "
  SELECT
    s.id,
    s.name,
    (SELECT count(*) FROM public.classes c
       WHERE c.school_id = s.id AND c.is_active AND c.deleted_at IS NULL) AS classes,
    (SELECT count(*) FROM public.teachers t
       WHERE t.school_id = s.id AND t.is_active AND t.is_demo)            AS demo_teachers,
    (SELECT count(*) FROM public.students st
       WHERE st.school_id = s.id AND st.is_active AND st.is_demo)         AS demo_students
  FROM public.schools s
  WHERE s.name ILIKE '%demo%'
    AND s.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.school_admins sa
                 WHERE sa.school_id = s.id AND sa.is_active)
  ORDER BY s.id;
"
```

**Acceptance**: per qualifying school `classes >= 3`, `demo_teachers >= 3`,
`demo_students >= 9`. On prod (`shktyoxqhundlvkiwguu`, 2026-06-16) both demoable
schools returned `classes = 3`, `teachers = 3`, `students = 12` (3 pre-existing
+ 9 demo) and `get_school_dashboard_stats` returned
`total_classes = 3 / total_teachers = 3 / total_students = 12`.

### C.3 Exercise the dashboard / Command Center RPCs as the school admin

`get_school_dashboard_stats`, `get_school_overview`, `get_classes_at_risk`, and
`get_teacher_engagement` are `SECURITY DEFINER` and guard on the caller being an
ACTIVE `school_admins` row for `p_school_id` (`auth.uid()` must match). On a
plain `psql` / service-role connection `auth.uid()` is NULL, so these
**intentionally raise `42501` / `Forbidden`** — that is the RLS boundary working,
not a bug.

To exercise them positively from a SQL connection WITHOUT a real login, simulate
the admin's JWT for the duration of one transaction by setting
`request.jwt.claims` (PostgREST/Supabase reads `auth.uid()` from the `sub`
claim). Use the admin's `auth_user_id` (from `public.school_admins`):

```sql
-- Simulated-admin JWT trick — run as ONE transaction.
BEGIN;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<admin auth_user_id>')::text,
  true            -- is_local = true: scoped to this transaction only
);
SELECT public.get_school_dashboard_stats('<school_id>');
SELECT public.get_school_overview('<school_id>');
SELECT * FROM public.get_classes_at_risk('<school_id>', 20, 0);
SELECT * FROM public.get_teacher_engagement('<school_id>', 20, 0);
COMMIT;
```

> Look up the admin's `auth_user_id` for a school with:
> `SELECT auth_user_id, email FROM public.school_admins WHERE school_id = '<school_id>' AND is_active;`
> On prod 2026-06-16 the two demoable schools were
> `61d15e48-8214-425c-bc2f-9c2e2e584f09` (admin `demo-school@alfanumrik.com`)
> and `a2e40b65-4386-46b4-bf6d-2bb2c52ba161` (admin `school-demo@alfanumrik.com`).

You can also exercise them by hitting the widget in the app while logged in as
the school admin, or via a PostgREST `rpc` call carrying that admin's JWT. For a
connection-agnostic proof of the roster, rely on C.2 instead.

### C.4 Confirm the widgets stop 500-ing

Log into the School Command Center page as a school admin of the demo school.
The overview, classes-at-risk, and teacher-engagement widgets should now return
HTTP 200 with populated numbers (3 classes, 3 teachers, 9 students). Because the
seed now also writes `concept_mastery` rows (Section B.1), the **at-risk and
mastery columns are populated** rather than empty — Class 9A shows as at-risk
(avg `p_know` 0.2733 < 0.4) while Class 10B and Class 11 Science do not.

### C.5 VERIFIED OUTCOME — prod `shktyoxqhundlvkiwguu`, 2026-06-16

Recorded for the record (all VERIFIED live on prod):

- **Repair-skip diagnosed**: `20260614000000` was recorded applied in
  `schema_migrations` but the three RPCs did not exist (`db push` was a no-op).
- **RPCs created via A.2**: streamed the migration body with
  `npx -y supabase db query --linked < supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql`
  (STDIN, not the arg form). C.1 then returned all three names.
- **Schools seeded** (the two `%demo%` schools that have an active admin):
  - `61d15e48-8214-425c-bc2f-9c2e2e584f09` — "Demo School — Demo School"
    (admin `demo-school@alfanumrik.com`)
  - `a2e40b65-4386-46b4-bf6d-2bb2c52ba161` — "Demo School — School"
    (admin `school-demo@alfanumrik.com`)
  Each now has classes = 3, teachers = 3, students = 12 (3 pre-existing + 9
  demo), enrollments = 9, class_teacher_links = 3.
- **`get_school_dashboard_stats`** returned `total_classes = 3 /
  total_teachers = 3 / total_students = 12`.
- **All 3 Command Center widget RPCs execute** (under the simulated-admin JWT
  from C.3): `get_school_overview` → `overview_ok`; `get_classes_at_risk` → 3
  rows; `get_teacher_engagement` → 3 rows.
- **Cosmetic grade fix applied** (BUG FIX C): each demo student's `grade` is now
  aligned to its enrolled class's `grade` (was previously assigned by the
  alphabetical class-loop index, so e.g. `Class 10B` students had been stamped
  grade `'9'`).
- **`concept_mastery` seeded** (Section B.1) with runtime-discovered topic ids
  (first 3 of `curriculum_topics ORDER BY id`). VERIFIED `get_classes_at_risk`
  output for a demo school:
  - **Class 9A** → 3 students, **3 at-risk**, avg mastery **0.2733** (< 0.4)
  - **Class 10B** → 3 students, 0 at-risk, avg mastery **0.5400**
  - **Class 11 Science** → 3 students, 0 at-risk, avg mastery **0.8000**

  i.e. only Class 9A falls below the 0.4 at-risk threshold, giving the widget a
  realistic spread.

---

## D. Rollback / cleanup

### D.1 Remove the demo seed data (does NOT touch any migration)

The seed only creates `is_demo = true` rows plus their enrollments, so cleanup
is a scoped delete. It now spans ALL demoable schools (consistent with the seed
target), not just the oldest. Run against the same project:

```bash
psql "$DB_URL" <<'SQL'
BEGIN;
-- All demo schools that have an active admin (the exact seed target set).
WITH demo AS (
  SELECT s.id
  FROM public.schools s
  WHERE s.name ILIKE '%demo%'
    AND s.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.school_admins sa
                 WHERE sa.school_id = s.id AND sa.is_active)
)
-- enrollments first (FK children), then the demo people, then the demo classes.
DELETE FROM public.class_students cs
 USING public.students s
 WHERE cs.student_id = s.id AND s.is_demo
   AND s.school_id IN (SELECT id FROM demo);

DELETE FROM public.class_teachers ct
 USING public.teachers t
 WHERE ct.teacher_id = t.id AND t.is_demo
   AND t.school_id IN (SELECT id FROM demo);

DELETE FROM public.students s
 WHERE s.is_demo AND s.school_id IN (
   SELECT s2.id FROM public.schools s2
    WHERE s2.name ILIKE '%demo%' AND s2.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.school_admins sa
                   WHERE sa.school_id = s2.id AND sa.is_active));

DELETE FROM public.teachers t
 WHERE t.is_demo AND t.school_id IN (
   SELECT s2.id FROM public.schools s2
    WHERE s2.name ILIKE '%demo%' AND s2.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.school_admins sa
                   WHERE sa.school_id = s2.id AND sa.is_active));

-- Demo classes (the seed's 3 by name). Safe-delete; no soft-delete needed for demo.
DELETE FROM public.classes c
 WHERE c.school_id IN (
   SELECT s2.id FROM public.schools s2
    WHERE s2.name ILIKE '%demo%' AND s2.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.school_admins sa
                   WHERE sa.school_id = s2.id AND sa.is_active))
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
supabase link --project-ref "$TARGET_PROJECT_REF" --password "$TARGET_DB_PASSWORD"

# A.1 — migration genuinely pending: apply (version-ordered automatically)
supabase db push --dry-run && supabase db push

# A.2 — repair-skip (marked applied, body never ran; db push NO-OPs):
#        stream the BODY via STDIN. NOT the arg form (Windows ~32KB limit + $$ mangling).
npx -y supabase db query --linked < supabase/migrations/20260614000000_phase3b_school_command_center_read_models.sql

# B. seed demo data (idempotent; targets ALL %demo% schools with an active admin; NOT a migration)
supabase db execute --file scripts/seed/demo-school-data.sql --linked

# C. verify RPCs exist
psql "$DB_URL" -At -c "SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_school_overview','get_classes_at_risk','get_teacher_engagement') ORDER BY proname;"
```
