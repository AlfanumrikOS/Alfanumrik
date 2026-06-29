# Teacher / School-Admin (B2B) Workflow — SOLUTION DESIGN

Audit Cycle 5 · 2026-06-29

This file collects the remediation designs for the Cycle-5 B2B gaps. Each gap's
owning agent appends its own section — do not overwrite another agent's section.

- TSB-1 (grade-fallback cross-tenant leak) — **backend** (DONE, below).
- TSB-2 (missing teacher RLS backstop on `public.students`) — **architect** (below).
- TSB-3 (resolver convergence) / TSB-5 (flag semantics) / TSB-6 (stale TODO) — **backend** (below).

---

## TSB-1 / TSB-3 / TSB-5 / TSB-6 (backend)

### TSB-1 — grade-fallback cross-tenant student-PII leak (CRITICAL, P8/P13)

**Why architect's TSB-2 RLS net does NOT cover this**: the teacher-dashboard
Edge Function reads on the **service-role** client (`SERVICE_CLIENT`,
index.ts:55-61), which **bypasses RLS by design** for bulk reads. The
`is_teacher_of` branch of `students_select_merged` (architect's finding) only
fires on an RLS-respecting client. So the grade-fallback leak must be closed in
**app code** here regardless of TSB-2. TSB-2 remains the right defense-in-depth
for any future RLS-bound reader.

**Footprint (wider than the 2 sites the gap-analysis named).** Eight grade
fallbacks leak once a teacher has `grades_taught` + the trigger condition:

| # | Site | Function | Leak |
|---|---|---|---|
| 1 | grade branch | `assertTeacherOwnsClass` | ownership gate (guards 4/5/6/7/8) |
| 2 | Path B | `resolveStudentsForTeacher` | name+grade (reports/overview/trends/student-report/mastery-report) |
| 3 | grade count | `handleGetDashboard` | per-grade count across all schools |
| 4 | grade branch | `handleGetHeatmap` | name+grade+mastery |
| 5 | grade branch | `handleGetAlerts` | name+grade+accuracy |
| 6 | grade branch | `resolveStudentsForClass` | name+grade (overview/bloom/in-the-moment) |
| 7 | grade branch | `handleGetAttendanceRecord` | name |
| 8 | grade membership | `handleSetGradeBookCell` | cross-tenant **WRITE** |

Fixing only sites 1+2 is insufficient: a teacher **with** a school still passes
the gate and reads/writes other schools' same-grade students via 4/5/6/7/8.

**Approach — tenant-scope every grade query by the auth-derived school_id,
fail-closed on null.**
1. New helper `resolveTeacherSchoolId(supabase, teacherId)` → `string | null`.
   `teacherId` is JWT-bound (dispatcher overwrites `body.teacher_id` from the
   Bearer token, index.ts:3648-3650 / audit C-1) → `school_id` is the
   authenticated teacher's own tenant, never request-supplied.
2. Each grade query gains `.eq('school_id', <resolved>)`.
3. **Null school_id ⇒ EMPTY / 403 / zero (fail-closed)** — an independent/B2C
   teacher with no institution gets no grade fallback rather than all-schools.
   They reach students only through an explicit `class_students` roster
   (unchanged).

**Why scope-not-remove**: keeps the intended product behavior (a school
teacher with `grades_taught` but no class yet sees their OWN school's
grade students). Index-backed by `idx_students_school_grade(school_id, grade)`
(baseline:18020) → no perf regression.

**Null-school decision (explicit)**: chose fail-closed→empty over
(a) leaving unscoped [the bug] or (b) matching null-school students [would let a
school-less teacher enumerate other B2C students in a grade — smaller but still
cross-account]. Fail-closed is the only zero-exposure option.

**Alternatives**: (A) RLS + RLS-bound client = TSB-2, architect-owned, pursued
as complementary follow-up not a substitute; (B) remove fallback entirely =
TSB-3 full convergence, product-behavior change, deferred; (C) SECURITY DEFINER
RPC = heavier, schema-touching, unwarranted for a one-predicate fix.

**Risk / rollback**: only a (rare) school-less teacher loses the grade
dashboard (still sees class rosters — intended). B2C `school_id IS NULL`
students correctly excluded from a school teacher's grade fallback. Revert = one
commit; no migration, flag, schema, or RBAC change.

### TSB-3 — convergence with `canAccessStudent`

`canAccessStudent` (rbac.ts:300-345) teacher branch is class-roster-only,
fail-closed, no grade fallback. Disposition: **partial now + documented
deferral.** Path A roster logic already mirrors it; Path B is now tenant-scoped
+ fail-closed. A precise `TODO(TSB-3 convergence)` is added at
`resolveStudentsForTeacher`. Full convergence = removing Path B (a
product-behavior change) AND bridging the Next.js↔Deno runtime split (the
`src/lib/rbac.ts` helper can't be imported into the Deno function) — a larger
architectural item, reported as a follow-up.

### TSB-5 — `ff_school_pulse_v1` is a UI/rollout guard, not a data guard

**Reported, not changed here.** It concerns `src/app/api/pulse/*` (a separate
Student-Pulse surface under REG-124); a clarifying comment there is correct but
out of scope for a teacher-dashboard B2B fix. Recommended follow-up: one-line
comment per pulse route — *"`ff_school_pulse_v1` is a render/rollout guard; the
security boundary is `authorizeRequest` + `canAccessStudent`."* No behavior
change; the actual boundary is already correct.

### TSB-6 — stale per-resource-ownership TODO

Replaced the misdirecting end-of-file TODO with an accurate `SECURITY NOTE`:
per-resource checks ARE enforced, JWT binding guards impersonation, the real
residual risk was the grade fallback (now fixed), and TSB-2/TSB-3 are the
defense-in-depth follow-ups.

---

## TSB-2 RLS policy (architect)

### Migration
- File: `supabase/migrations/20260702010000_teacher_assigned_students_rls.sql`
- Timestamp: `20260702010000` (strictly after the latest existing root migration
  `20260702000800_adaptive_interventions_allow_blocked_prerequisite.sql`, so
  `supabase db push` applies it last and never warns/skips on out-of-order ordering).
- **Quality-condition resolution (RESOLVED):** the migration was originally
  authored as `20260629000000_…` — which sorts *before* the true latest root
  migration `20260702000800` (out-of-order). Independent quality flagged this as
  the single APPROVE-WITH-CONDITIONS condition. Architect **RENAMED** the file to
  `20260702010000` (content **byte-identical**; only the timestamp prefix
  changed) so it sorts last; testing updated its test reference to the new path;
  re-verified. Condition now closed. See `07-validation.md`.
- Change: adds ONE additive `SELECT` RLS policy
  `"Teachers can view students in their classes"` on `public.students`. No other
  table, policy, role, permission, column, or data is touched.

### Audit-premise correction (material finding)
TSB-2's evidence ("no teacher SELECT policy on `public.students`"; "students has
only student-own / school-admin / service-role"; the four-pattern model is
"3-of-4") is **based on a grep for `"Teachers can …"`-named policies and is
incomplete**. The teacher-assigned backstop on `public.students` **already
exists**, but under a different name and via a helper function:

- `00000000000000_baseline_from_prod.sql:22309` —
  `students_select_merged` (FOR SELECT) `USING (auth_user_id = auth.uid() OR
  public.is_teacher_of(id) OR public.is_guardian_of(id))`. This single
  consolidated policy carries all three non-admin patterns (student-own,
  teacher-assigned, parent-linked).
- `00000000000000_baseline_from_prod.sql:9212` — `public.is_teacher_of(uuid)`
  (SECURITY DEFINER) is the exact `class_students ⋈ class_teachers ⋈ teachers`
  roster join, resolved from `auth.uid()`, and is in fact **stricter** than the
  template — it additionally requires `cs.is_active = true AND ct.is_active = true`.

So the four-pattern model on `students` is already **4-of-4** at runtime; the
gap is one of **discoverability and single-point-of-dependence**, not absence.

### What the migration adds and why
An **independent, self-contained** teacher-assigned SELECT policy that inlines
the roster join directly on `public.students`, rather than depending on the
`is_teacher_of` SECURITY DEFINER helper and its placement inside
`students_select_merged`. Rationale:
- The existing net is single-source: if a future migration drops/alters
  `is_teacher_of` or removes its branch from the merged policy, the teacher
  boundary silently changes. An inline, named policy is independent of both.
- Discoverability: the audit itself was fooled by the helper indirection. A
  policy named in the `"Teachers can …"` convention is what reviewers grep for.

### The join chosen (assigned-students-only)
```sql
id IN (
  SELECT cs.student_id
  FROM public.class_students cs
  JOIN public.class_teachers ct ON ct.class_id = cs.class_id
  JOIN public.teachers       t  ON t.id        = ct.teacher_id
  WHERE t.auth_user_id = auth.uid()
    AND cs.is_active = true
    AND ct.is_active = true
)
```
Identity map: `auth.uid()` → `teachers.auth_user_id` → `teachers.id` →
`class_teachers.teacher_id` → `class_teachers.class_id` →
`class_students.class_id` → `class_students.student_id` = `students.id`.

### Template mirrored (file:line)
- Roster join + identity pattern mirrored from the model four-pattern policy set
  on `teacher_remediation_assignments`:
  `supabase/migrations/20260613000004_teacher_remediation_assignments.sql:124-131`
  (the teacher SELECT `student_id IN (SELECT cs.student_id FROM class_students cs
  JOIN class_teachers ct … JOIN teachers t … WHERE t.auth_user_id = auth.uid())`),
  named by the audit (C-4) as the template TSB-2 should follow.
- Same join also appears verbatim in the baseline at:
  - `00000000000000_baseline_from_prod.sql:20240` — `"Teachers can view students
    in their classes"` on `class_students` (the audit's cited mirror, baseline:20240).
  - `00000000000000_baseline_from_prod.sql:20228-20232` — `"Teachers can view
    links for their students"` on `guardian_student_links`.
  - `00000000000000_baseline_from_prod.sql:9217-9226` — `public.is_teacher_of`,
    whose `is_active` guards this policy reproduces.

### Why it cannot over-grant
- PostgreSQL OR-combines PERMISSIVE policies for the same command. The new
  policy's predicate is **identical** to the already-active `is_teacher_of(id)`
  branch (same join, same `is_active` guards), so the set of student rows a
  teacher can SELECT is **unchanged** — strictly assigned, active-roster-only.
- No grade fallback, no `school_id`-wide grant (school-admin scope is the
  separate baseline:19906 policy, untouched). A non-assigned / cross-school
  student is not selectable via this policy.
- The `cs.is_active`/`ct.is_active` guards are **deliberately retained** to match
  `is_teacher_of`. A literal template mirror that omitted them would have
  OR-broadened the boundary to students reachable through INACTIVE (left-the-class)
  enrollments — an over-grant — so they are kept.

### Additive / idempotent
- `DROP POLICY IF EXISTS … ; CREATE POLICY …` (this policy's own name only).
- No existing policy modified or dropped; RLS already enabled on `students` and
  is NOT toggled (no destructive disable/re-enable).
- Safe to re-run. No RBAC change, no DROP TABLE/COLUMN, no `SECURITY DEFINER`
  added, no user input in SQL, no data mutated.

### Scope decision
**students-only.** `learner_mastery` / `state_events` (audit candidates) are
deferred: `learner_mastery` is not present under that name in the reproducible
baseline (live mastery substrate is `bkt_mastery_state` / `concept_mastery`), and
applying the roster join there needs a separate column/relationship verification
to avoid an over-grant. Tracked as a follow-up rather than guessed at —
tight-and-correct over broad.

### Rollback
```sql
DROP POLICY IF EXISTS "Teachers can view students in their classes"
  ON public.students;
```
The pre-existing `is_teacher_of` net in `students_select_merged` remains in force,
so rollback restores the prior (already-protected) state with no exposure.

### Coordination / downstream reviewers (P14 RBAC/RLS chain)
- No RBAC role/permission change → no user approval gate triggered.
- Notify **backend** (child-progress / teacher-dashboard reads) and **frontend**
  (parent/teacher portals) that the `students` teacher SELECT boundary is now
  also enforced at the DB layer for any RLS-respecting client — service-role
  paths are unaffected (service role bypasses RLS). No behavior change expected
  because the predicate equals the already-active boundary.
- **testing**: candidate for an `rls-student-id-policies`-style regression
  asserting (a) assigned teacher sees the row, (b) non-assigned/inactive-enrollment
  teacher sees zero rows via this policy.
