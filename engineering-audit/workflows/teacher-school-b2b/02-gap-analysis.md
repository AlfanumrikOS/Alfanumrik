# Teacher / School-Admin (B2B) Workflow — GAP ANALYSIS

Audit Cycle 5 · Architect · ANALYSIS ONLY · 2026-06-29

Per-gap schema: ID | Title | Evidence | Business impact | Technical impact |
Severity | Likelihood | Recommendation | Effort.
Severity scale: critical > high > medium > low.

---

## TSB-1 — teacher-dashboard grade-fallback leaks ALL platform students in a grade (cross-tenant)

- **Title**: A teacher with `grades_taught` but no class assignment reads every
  student in those grades across ALL schools (P13/P8 cross-tenant break).
- **Evidence**:
  - `resolveStudentsForTeacher` Path B:
    `supabase/functions/teacher-dashboard/index.ts:856-883` — when Path A
    (class-roster) returns 0, it queries `students.in('grade', grades)` with
    **NO `school_id` filter** (`index.ts:869-872`).
  - `assertTeacherOwnsClass` grade branch:
    `index.ts:84-98` — a synthetic `grade-<n>` class id is "owned" iff the grade is
    in `grades_taught`, again **no school scope**.
  - Consumed by `get_heatmap` (`index.ts:365-394`), `get_alerts`
    (`index.ts:483-512`), `get_student_report` (`index.ts:1047`),
    `get_student_mastery_report` (`index.ts:3002`), `get_class_overview/trends`
    (`index.ts:908,1135`).
  - Reads return **full `students.name`** + per-subject mastery/accuracy + XP
    (`index.ts:370-375,490-510,564-599`).
  - No RLS backstop: the Edge Function uses the **service-role** client
    (`index.ts:55-61`), which bypasses RLS. There is also no teacher SELECT policy
    on `public.students` (see TSB-2), so nothing catches it at the DB layer.
- **Business impact**: A single teacher account at any school can enumerate names +
  performance of grade-6–12 students at every other school on the platform. For a
  B2B EdTech selling tenant isolation to schools, this is a contract-breaking,
  DPDP-reportable data exposure.
- **Technical impact**: Tenant isolation void on the busiest teacher surface;
  `canAccessStudent`'s strict roster boundary is silently not in force here.
- **Severity**: **critical** (data exposure scope = whole platform; only the trigger
  condition narrows it).
- **Likelihood**: **medium** — requires a teacher with `grades_taught` set and zero
  class assignments. Newly-onboarded teachers (joined a school but not yet attached
  to a class) and the `teacher_create_profile` default `grades_taught =
  ARRAY['Grade 9']` (baseline `:2955`) make this a realistic everyday state.
- **Recommendation**: Scope every grade-fallback query by the teacher's
  `school_id` (`AND school_id = <teacher.school_id>`), OR — preferred — remove the
  grade fallback entirely and make the teacher-dashboard route student access
  through `canAccessStudent` / a class-roster-only resolver, matching `/api/pulse/*`
  (see TSB-3). Either is **AUTO-FIX-SAFE** (no RBAC change).
- **Effort**: M (touch ~6 handlers + `resolveStudentsForTeacher` + `assertTeacherOwnsClass`;
  add a roster-join test; the existing `teacher-dashboard-roster-join.test.ts`
  gives a harness).

---

## TSB-2 — No teacher-assigned RLS policy on `public.students` (defense-in-depth absent)

- **Title**: Teacher→student-PII reads have zero RLS backstop; the boundary is
  100% app-code over the service-role client.
- **Evidence**:
  - Baseline teacher policies exist on `class_students`, `class_teachers`,
    `classes`, `assignments`, `guardian_student_links`, `at_risk_alerts`,
    `classroom_polls` (baseline `:20190-20257`) — but **no `"Teachers can …"`
    policy on `public.students`** (grep of baseline returns none).
  - `students` has only: student-own, `"School admins can view school students"`
    (baseline `:19906`), and service-role policies.
  - Every teacher read of student PII therefore runs through `supabase-admin`
    (service role) in routes/Edge Functions — e.g. `pulse-server.ts:11-12`
    explicitly documents "the canAccessStudent / class-ownership gate is the actual
    security boundary." Same for `learner_mastery` + `state_events` read by
    `buildSingleStudentPulse` (`pulse-server.ts:325-343`).
- **Business impact**: Any regression that drops or mis-orders the app-code gate
  (e.g. a future route that forgets `canAccessStudent`) exposes student PII with no
  second line of defence. The constitution's stated four-pattern RLS model
  (student-own / parent-linked / teacher-assigned / admin) is only 3-of-4 on the
  central `students` table.
- **Technical impact**: Violates P8 defense-in-depth intent; single point of
  failure on the most security-sensitive table.
- **Severity**: **high**.
- **Likelihood**: low today (current routes are disciplined) but the blast radius
  on regression is large.
- **Recommendation**: Add a `"Teachers can view students in their classes"` SELECT
  policy on `public.students` mirroring the existing `class_students` policy
  (baseline `:20240`): `id IN (SELECT cs.student_id FROM class_students cs JOIN
  class_teachers ct ON ct.class_id=cs.class_id JOIN teachers t ON t.id=ct.teacher_id
  WHERE t.auth_user_id = auth.uid())`. **AUTO-FIX-SAFE** (additive RLS policy, no
  RBAC change). Idempotent migration, RLS already enabled.
- **Effort**: S (one additive policy + a `rls-student-id-policies`-style test).

---

## TSB-3 — Two divergent teacher↔student boundary implementations

- **Title**: `canAccessStudent` is NOT the single boundary the constitution claims;
  teacher-dashboard uses a parallel, looser resolver.
- **Evidence**:
  - Strict path: `canAccessStudent` teacher branch is class-roster-only, fail-closed
    (`rbac.ts:300-345`). Used by `/api/pulse/student/[id]`
    (`student/[id]/route.ts:75`) and `/api/teacher/students/[id]/notes`
    (`notes/route.ts:56`).
  - Loose path: teacher-dashboard `resolveStudentsForTeacher` (`index.ts:810-886`)
    adds the grade fallback (TSB-1) and is the resolver for all reports/heatmap/
    alerts handlers. It does NOT call `canAccessStudent`.
  - The constitution states "`canAccessStudent` is the single cross-role data
    boundary" — true only for `/api/pulse/*`.
- **Business impact**: Inconsistent enforcement; a fix to the boundary (e.g. adding
  tenant scope) applied in `canAccessStudent` does not protect the teacher-dashboard
  surface, and vice-versa. Audit/regression coverage (REG-121) pins the pulse
  funnel but not the Edge Function's resolver.
- **Technical impact**: Two code paths to keep in sync; the looser one is the
  higher-traffic surface.
- **Severity**: **medium** (it is the root mechanism behind TSB-1).
- **Likelihood**: n/a (architectural).
- **Recommendation**: Converge teacher-dashboard student resolution onto a single
  shared, class-roster-only, tenant-scoped helper (lift `canAccessStudent`'s teacher
  branch into a reusable `resolveTeacherRoster(teacherId)` and call it from both).
  **AUTO-FIX-SAFE**.
- **Effort**: M.

---

## TSB-4 — Dual join-table model (`class_students` vs `class_enrollments`) drift risk

- **Title**: Teacher↔student membership is modeled in two tables; different surfaces
  read different ones.
- **Evidence**:
  - `canAccessStudent`, Pulse class route, remediation, teacher-dashboard all use
    `class_students` (`rbac.ts:330`, `class/[classId]/route.ts:135`,
    `remediation/route.ts:118`, `index.ts:196`).
  - `lab-leaderboard` uses `class_enrollments` (`lab-leaderboard/route.ts:139-143`),
    as do several `school-admin` + `v1` routes.
  - A reconciling migration exists: `20260620000700_sync_class_students_class_enrollments.sql`
    (sync trigger), implying the two can diverge.
- **Business impact**: A student enrolled via one table but not the other is
  visible/scoped inconsistently — could be over-exposed on one surface or hidden on
  another (silent under-enforcement OR data gaps).
- **Technical impact**: Membership is the basis of the entire B2B boundary; a
  split-brain membership model undermines every assignment check.
- **Severity**: **medium**.
- **Likelihood**: medium (depends on whether the sync trigger covers all write
  paths — not verified in this pass).
- **Recommendation**: Pick one canonical roster table, make the other a view, and
  point all boundary checks at it. Verify the sync trigger covers every insert/
  delete path. **AUTO-FIX-SAFE** for the read-consolidation; the deprecation of a
  table is a schema change requiring user approval if it DROPs anything.
- **Effort**: M–L.

---

## TSB-5 — `ff_school_pulse_v1` is a UI guard, not a data-access guard (verify)

- **Title**: The Pulse API routes do not gate on `ff_school_pulse_v1`; the flag
  only hides UI.
- **Evidence**: `pulse/student/[id]/route.ts`, `pulse/class/[classId]/route.ts`,
  `pulse/school/route.ts` contain no `ff_school_pulse_v1` check — they gate on
  RBAC + `canAccessStudent` only. REG-124 pins default-OFF "in code, seed, render
  guard," i.e. the render/data-hook layer, not the route.
- **Business impact**: Low — the actual security boundary (RBAC + relationship) is
  intact regardless of the flag, so "default-OFF" is correct as a rollout control,
  but the data endpoints are reachable by any authorized teacher/parent even when
  the feature is "off." If the flag is ever treated as a security control, that
  assumption is wrong.
- **Technical impact**: Flag semantics = visibility, not authorization.
- **Severity**: **low**.
- **Likelihood**: low.
- **Recommendation**: Document the flag as a UI/rollout guard explicitly; if
  feature-level data gating is desired, add a flag check at the top of each pulse
  route (cheap, fail-closed). **AUTO-FIX-SAFE**.
- **Effort**: S.

---

## TSB-6 — Stale "per-resource ownership TODO" comment masks the real residual hole

- **Title**: The end-of-file TODO claims handlers lack per-resource checks; they
  actually have them — the real residual hole is the grade fallback (TSB-1).
- **Evidence**: `index.ts:3716-3721` TODO says class_id/student_id/alert_id/poll_id
  handlers "should verify ownership"; but every handler DOES (`assertTeacherOwnsClass`
  at `:360,479,731,2058,2305,2504,3044,3466`; `owned.find` at `:1048,3003`;
  `assertTeacherOwnsPoll` at `:771`). The comment misdirects a reader away from the
  actual unscoped grade path.
- **Severity**: **low** (documentation/maintainability).
- **Recommendation**: Replace the stale TODO with an accurate note pointing at the
  grade-fallback tenant-scope gap. **AUTO-FIX-SAFE**.
- **Effort**: XS.

---

## COMPLIANT — explicitly verified strong

- **C-1 JWT binding (impersonation closed)**: `resolveTeacherFromJwt`
  (`index.ts:3597-3624`) resolves `teacher_id` from the Bearer token and the
  dispatcher OVERWRITES `body.teacher_id` before any handler runs
  (`index.ts:3648-3650`). A teacher cannot impersonate another by passing their id.
  **P13 COMPLIANT.**
- **C-2 `/api/pulse/student/[id]` triple gate**: authenticate → `canAccessStudent`
  hard boundary → viewing-permission, audit on every deny, **no student payload on
  any deny** (`student/[id]/route.ts:61-149`). The strongest boundary in the
  codebase. **P9/P13 COMPLIANT.**
- **C-3 Mutating teacher routes**: all call `authorizeRequest('<teacher perm>')`
  BEFORE DB I/O, resolve `teachers.id` from `auth.uid()` (never body), and roster/
  ownership-check (`notes`, `remediation`, `parent-notify`, `assignments`,
  `classes`, `join-class`, `messages`). **No `authorizeRequest`-missing route found
  on the teacher mutation surface.** **P9 COMPLIANT.**
- **C-4 `teacher_remediation_assignments` RLS** is a model four-pattern policy set:
  teacher SELECT/INSERT/UPDATE gated on ownership AND roster join, student-own
  SELECT, service-role full (migration `20260613000004:113-202`). Defense-in-depth
  done right — **the template TSB-2 should follow.** **P8 COMPLIANT.**
- **C-5 School-admin tenant scope**: `schoolId` always from `school_admins`, never
  body; every query `.eq('school_id', …)`; cross-tenant `class_id` rejected;
  RLS backstop on `students`/`classes`/`teachers` (baseline `:19906,19901,19911`).
  **P8/P13 COMPLIANT.**
- **C-6 School Pulse aggregate-only**: `/api/pulse/school` returns counts/averages,
  no per-student PII; JWT-bound SECURITY DEFINER RPCs are the boundary
  (`school/route.ts:51-89`). **P13 COMPLIANT.**
- **C-7 PII redaction on teacher surfaces**: lab-leaderboard redacts names to
  "First L." (`lab-leaderboard/route.ts:64-73`); Pulse timeline whitelists a non-PII
  payload subset (`pulse-server.ts:195-260`); parent-notify audit/log is
  metadata-only. No student PII found in `logger.*` calls on teacher routes.
  **P13 COMPLIANT** (caveat: TSB-1 leaks full names of *non-assigned* students —
  that is a boundary failure, not a redaction failure).
- **C-8 B2B escalation attribution**: tiered subject match prevents wrong-teacher
  attribution; 23505 dedupe across co-teachers (`subject-match.ts`,
  `remediation/route.ts:229-258`). **COMPLIANT** (REG-128/REG-133).

## IDOR assessment
- No IDOR found on the audited routes: every `[id]`/`classId`/`student_id`/
  `thread_id` param is validated (UUID) AND ownership-checked before use
  (`student/[id]/route.ts:67,75`; `class/[classId]/route.ts:58,99`;
  `messages/.../route.ts:46,76`; `remediation/route.ts:99-133`). The ONLY way a
  teacher reads a non-assigned student is via TSB-1's grade fallback — which is a
  boundary-scope defect, not a classic forged-id IDOR.

## P7 Bilingual (low-confidence — not exhaustively audited)
- `students/page.tsx` is fully bilingual via the `tt(isHi,en,hi)` helper
  (`students/page.tsx:16`, used throughout). Spot-check only; the other 7 teacher
  pages were not each verified — flag as a **low** follow-up for the frontend agent
  to confirm parity across all teacher/admin surfaces.
