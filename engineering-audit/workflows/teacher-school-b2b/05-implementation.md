# Teacher / School-Admin (B2B) Workflow — IMPLEMENTATION

Audit Cycle 5 · Backend · 2026-06-29
File changed: `supabase/functions/teacher-dashboard/index.ts` (Deno Edge Function).
Closes: TSB-1 (CRITICAL P8/P13), TSB-3 (partial + TODO), TSB-6.
No migration, no flag, no RBAC/permission change, no schema change.

P8/P13 rationale (applies to every edit below): the function reads/writes on the
**service-role** client (RLS bypassed), so tenant isolation must be enforced in
app code. `teacherId` is JWT-bound at the dispatcher (`resolveTeacherFromJwt`
overwrites `body.teacher_id`, index.ts:3648-3650), so the `school_id` resolved
from it is the authenticated teacher's own tenant — never request-supplied. No
student name/email/phone is added to any log (no logging added at all; IDs only
flow through queries).

---

## Change 0 — new helper `resolveTeacherSchoolId` (index.ts:~85)

Added immediately before `assertTeacherOwnsClass`:

```ts
async function resolveTeacherSchoolId(
  supabase: ReturnType<typeof getServiceClient>,
  teacherId: string,
): Promise<string | null> {
  if (!teacherId) return null
  try {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('school_id')
      .eq('id', teacherId)
      .maybeSingle()
    const sid = (teacher as { school_id?: string | null } | null)?.school_id
    return sid ? String(sid) : null
  } catch {
    return null
  }
}
```
Returns `null` for a school-less teacher; every caller treats `null` as
fail-closed.

---

## Change 1 — `assertTeacherOwnsClass` grade branch (TSB-1 site 1, index.ts:~109)

**Before**
```ts
if (classId.startsWith('grade-')) {
  const grade = classId.replace('grade-', '')
  const { data: teacher } = await supabase
    .from('teachers')
    .select('grades_taught')
    .eq('id', teacherId)
    .single()
  if (!teacher) return false
  const grades = Array.isArray(teacher.grades_taught) ? ... : []
  return grades.includes(grade)
}
```
**After**
```ts
if (classId.startsWith('grade-')) {
  const grade = classId.replace('grade-', '')
  const { data: teacher } = await supabase
    .from('teachers')
    .select('grades_taught, school_id')
    .eq('id', teacherId)
    .single()
  if (!teacher) return false
  if (!(teacher as { school_id?: string | null }).school_id) return false   // fail-closed: no institution ⇒ cannot own a grade pseudo-class
  const grades = Array.isArray(teacher.grades_taught) ? ... : []
  return grades.includes(grade)
}
```
Effect: a school-less teacher gets `403` from every grade-class handler
(heatmap/alerts/overview/trends/mastery/attendance/in-the-moment/grade-book)
before any student row is read.

---

## Change 2 — `resolveStudentsForTeacher` Path B (TSB-1 site 2 / primary, index.ts:~907)

**Before**
```ts
const { data: teacher } = await supabase
  .from('teachers').select('grades_taught').eq('id', teacherId).maybeSingle()
const grades = ...
if (grades.length > 0) {
  const { data: gradeStudents } = await supabase
    .from('students')
    .select('id, name, grade')
    .in('grade', grades)
    .is('deleted_at', null)
    .limit(1000)
```
**After**
```ts
const { data: teacher } = await supabase
  .from('teachers').select('grades_taught, school_id').eq('id', teacherId).maybeSingle()
const schoolId = (teacher as { school_id?: string | null } | null)?.school_id
const grades = ...
if (schoolId && grades.length > 0) {                  // fail-closed on null school
  const { data: gradeStudents } = await supabase
    .from('students')
    .select('id, name, grade')
    .in('grade', grades)
    .eq('school_id', schoolId)                        // ← tenant scope
    .is('deleted_at', null)
    .limit(1000)
```
Covers the 5 reports consumers (overview/trends/student-report/mastery-report
all resolve through this set; `owned.find(...)` ownership at index.ts:~1130 and
~3111 now rejects cross-school student_ids automatically).

---

## Change 3 — `handleGetDashboard` grade count (TSB-1 site 3, index.ts:~149 + ~338)

- `:149` select now includes `school_id`.
- **Before**: `if (classes.length === 0 && teacher.grades_taught) { ... .eq('grade', String(grade)) ... }`
- **After**: gated on `dashSchoolId` and `.eq('grade', String(grade)).eq('school_id', dashSchoolId)`.
  Null-school ⇒ no grade pseudo-classes (prevents leaking per-grade student
  counts of other schools).

---

## Change 4 — `handleGetHeatmap` grade branch (TSB-1 site 4, index.ts:~421)

**Before**: `.from('students').select('id, name, grade').eq('grade', grade).limit(50)`
**After**:
```ts
const schoolId = await resolveTeacherSchoolId(supabase, teacherId)
if (schoolId) {
  const { data } = await supabase.from('students')
    .select('id, name, grade').eq('grade', grade).eq('school_id', schoolId).limit(50)
  students = data
}                                                     // schoolId null ⇒ students stays null ⇒ empty heatmap
```

## Change 5 — `handleGetAlerts` grade branch (TSB-1 site 5, index.ts:~538)

Same shape as Change 4, `.limit(100)`. Null-school ⇒ empty alerts.

---

## Change 6 — `resolveStudentsForClass` + 3 callers (TSB-1 site 6, index.ts:~2089)

- Signature: `resolveStudentsForClass(supabase, classId)` → `(supabase, classId, teacherId)`.
- Grade branch:
  **Before**: `.from('students').select('id, name, grade').eq('grade', grade).is('deleted_at', null).limit(1000)`
  **After**: resolve `schoolId`; `if (!schoolId) return out`; query adds `.eq('school_id', schoolId)`.
- Callers updated (all already `assertTeacherOwnsClass`-gated, all have
  `teacherId` in scope): `handleGetClassOverview` (~2167), `handleGetClassTrends`
  (~3137), `handleGetInTheMomentAlerts` (~3409).

## Change 7 — `handleGetAttendanceRecord` grade branch (TSB-1 site 7, index.ts:~2705)

**Before**: `.from('students').select('id, name').eq('grade', grade).limit(300)`
**After**: resolve `schoolId`; `if (schoolId) { ... .eq('grade', grade).eq('school_id', schoolId).limit(300) }`.

## Change 8 — `handleSetGradeBookCell` membership check (TSB-1 site 8 — cross-tenant WRITE, index.ts:~2410)

The grade-pseudo-class membership test compared grade only, allowing a write
(set grade-book cell) for a same-grade student at another school.
**Before**: `.from('students').select('grade').eq('id', studentId).maybeSingle()` then `=== grade`.
**After**: resolve `schoolId`; only run the check when `schoolId` is set; query
adds `.eq('school_id', studentId-side school)` (`.eq('school_id', schoolId)`), so
a non-same-school student returns null ⇒ `studentInClass = false` ⇒ 403.

---

## TSB-3 — convergence TODO (index.ts:~886)

Added a precise `TODO(TSB-3 convergence)` block above `resolveStudentsForTeacher`
referencing `canAccessStudent` (src/lib/rbac.ts), explaining the runtime split
(Deno cannot import `src/lib`), and that fully removing Path B is a
product-behavior change. Path A roster semantics already match
`canAccessStudent`; Path B is now tenant-scoped + fail-closed.

## TSB-6 — stale TODO replaced (index.ts:~3824)

Replaced the inaccurate "handlers should verify ownership" TODO with a
`SECURITY NOTE` documenting that per-resource ownership IS enforced (lists the
guards), that JWT binding guards impersonation, that the real residual risk was
the grade fallback (now fixed), and pointing at TSB-2 (RLS) + TSB-3
(convergence) follow-ups.

---

## Self-review

- [x] Every grade-filtered `students` query is now `.eq('school_id', …)`-scoped
      (verified by grep: 8 grade sites, all scoped; non-grade queries filter by
      rosterIds / explicit studentId and are unchanged).
- [x] Null `school_id` is fail-closed everywhere (empty / 403 / zero), never
      all-schools and never null-matching.
- [x] `school_id` is auth-derived (JWT-bound `teacherId` → `teachers.school_id`),
      never from request body/params.
- [x] Legitimate cases preserved: teacher WITH a class still sees assigned
      students (Path A / `class_students`, untouched); school teacher with
      `grades_taught` sees only same-school grade students.
- [x] P13: no student name/email/phone added to any log; IDs/counts only.
- [x] No RBAC role/permission, pricing, schema, or DROP change.
- [x] `deno check` introduces **zero new type errors**. One pre-existing
      `TS2352` remains on an UNTOUCHED Supabase-join cast
      (`handleGetAttendanceRecord` non-grade branch, `rosterRows` cast) —
      confirmed present on `HEAD:index.ts` before this change (orig line 2602).
      Not a regression from this PR; flagged for a separate cleanup.
- [x] Index `idx_students_school_grade(school_id, grade)` covers the scoped
      queries (no perf regression).

## Deferred / follow-ups (not in this PR)
- TSB-2: teacher-assigned RLS backstop on `public.students` (architect; see
  04-solution-design.md TSB-2 section — note: the service-role reads here are
  unaffected by RLS, so this is complementary defense-in-depth, not a substitute).
- TSB-3 full convergence: shared authz module bridging Next.js↔Deno.
- TSB-4: `class_students`/`class_enrollments` cutover (DROP half is USER-gated).
- TSB-5: pulse-route flag-semantics comment.
- Pre-existing TS2352 join-cast cleanup in `handleGetAttendanceRecord`.

---

## TSB-2 — migration (architect)

- File: `supabase/migrations/20260702010000_teacher_assigned_students_rls.sql`
  (additive, idempotent; one named teacher SELECT policy on `public.students`,
  predicate-identical to the already-active `is_teacher_of(id)` branch of
  `students_select_merged` → provably no over-grant). Full design +
  audit-premise correction in `04-solution-design.md` TSB-2 section.
- **Migration-ordering correction (RESOLVED).** First authored as
  `20260629000000_…` (sorts before the true latest root migration
  `20260702000800`). Quality raised this as its one APPROVE-WITH-CONDITIONS
  condition; architect renamed the file to `20260702010000` (byte-identical
  content, timestamp prefix only) so it applies last; testing repointed its test
  reference. Re-verified.

---

## tests (testing)

25 new tests, all green; full suite **527/527 vitest** PASS.

- **TSB-1 — tenant scoping (15 tests).** Assert every one of the 8 grade-fallback
  query sites is now `school_id`-scoped and **fail-closed** on a null/absent
  teacher `school_id` (empty / 403 / zero — never all-schools, never a
  null-match). Cover: a school teacher with `grades_taught` sees only same-school
  grade students; a school-less teacher gets no grade fallback (still reaches an
  explicit `class_students` roster); a cross-school same-grade student is never
  read or (site 8) written. `teacher_id` JWT-binding verified so `school_id` is
  auth-derived, never request-supplied.
- **TSB-2 — RLS policy (10 tests).** Assert the new named teacher SELECT policy on
  `public.students` returns the assigned/active-roster student row for the
  assigned teacher and **zero rows** for a non-assigned teacher and for an
  inactive (`cs.is_active`/`ct.is_active = false`) enrollment; predicate parity
  with the pre-existing `is_teacher_of(id)` branch (no over-grant); idempotent
  re-run. Test reference updated to the renamed `20260702010000` path.
- **Gates:** type-check PASS, lint 0 errors, build PASS, no bundle impact (Edge
  Function + migration only).
- **Tracked test debt (not blocking):** the OLD
  `teacher-dashboard-roster-join.test.ts` walker is vacuously green (its
  filter-extraction terminates early) — harden separately (testing follow-up).
