# Teacher / School-Admin (B2B) Workflow — ROOT CAUSE

Audit Cycle 5 · Architect · ANALYSIS ONLY · 2026-06-29

For each significant gap: the true root cause and the layer that introduced it.

---

## TSB-1 — grade-fallback cross-tenant student leak

- **Proximate cause**: `resolveStudentsForTeacher` Path B and the `grade-<n>`
  branch of `assertTeacherOwnsClass` query `students.in('grade', grades)` with no
  `school_id` predicate (`index.ts:869-872`, `:84-98`).
- **True root cause**: The teacher-dashboard Edge Function predates multi-tenant
  (school) isolation. The grade fallback was a **single-tenant convenience** ("if a
  teacher has no class yet, show them students of the grades they teach") written
  when there was effectively one school, so "grade 9" unambiguously meant "our
  grade 9." When white-label multi-school landed (`white_label_schools` /
  `school_admins` migrations, Apr–Jun 2026) the `students` table gained `school_id`,
  but this fallback was never retrofitted with a tenant predicate. The service-role
  client masks the defect because RLS — which WOULD catch a cross-school read on an
  RLS-bound client — is bypassed by design for these bulk reads.
- **Introducing layer**: Database-access layer of the **teacher-dashboard Edge
  Function** (owned at implementation by backend; the tenant-isolation boundary is
  architect-owned). The defect is "old single-tenant assumption surviving the
  multi-tenant migration."

## TSB-2 — missing teacher RLS on `public.students`

- **Proximate cause**: No `"Teachers can view students in their classes"` SELECT
  policy on `public.students`; teacher reads rely entirely on service-role app code.
- **True root cause**: Teacher access to student PII was implemented
  **API-first** (service-role + `canAccessStudent`) rather than RLS-first. Because
  the app-code gate "worked," the corresponding RLS policy was never added — RLS was
  only added to the join tables (`class_students`, `class_teachers`) and to
  feature-specific tables (`teacher_remediation_assignments`), not to the central
  `students` table for the teacher pattern. The four-pattern RLS convention in the
  constitution was applied to NEW tables but not back-filled onto the legacy
  `students` table.
- **Introducing layer**: Schema/RLS layer (**architect-owned**) — an omission in the
  baseline policy set, never reconciled.

## TSB-3 — divergent boundary implementations

- **Proximate cause**: `/api/pulse/*` calls `canAccessStudent`; teacher-dashboard
  uses its own `resolveStudentsForTeacher`.
- **True root cause**: The two surfaces were built at different times by different
  efforts. The teacher-dashboard Edge Function is the older surface with bespoke
  ownership helpers (`assertTeacherOwnsClass`, `resolveStudentsForTeacher`). When the
  Pulse/RBAC-conformance work (Phase A / Student Pulse) introduced the canonical
  `canAccessStudent`, the new Pulse routes adopted it but the **existing Edge
  Function was not refactored to consume it** (Deno runtime + no shared import path
  with `src/lib/rbac.ts` made reuse non-trivial). The constitution's "single
  boundary" claim was written from the Pulse work's perspective and never qualified.
- **Introducing layer**: Cross-cutting — architecture/integration. The boundary was
  centralized in `src/lib/rbac.ts` for Next.js routes but the Deno Edge Function
  cannot import it, so a parallel implementation persisted. Root cause is the
  **runtime split (Next.js `src/lib` vs Deno `supabase/functions`)** with no shared
  authorization module bridging the two.

## TSB-4 — dual join-table model

- **Proximate cause**: `class_students` and `class_enrollments` both model
  teacher↔student membership; surfaces disagree on which to read.
- **True root cause**: A mid-flight migration ("Phase-2 canonical join table" — per
  the comment in `lab-leaderboard/route.ts:138`) introduced `class_enrollments` to
  replace `class_students`, but the cutover was never completed. Both tables remain
  live and a sync trigger (`20260620000700`) papers over the divergence instead of
  finishing the migration. Classic **incomplete schema migration** with a
  compensating sync rather than a hard cutover.
- **Introducing layer**: Schema layer (**architect-owned**) — an abandoned-in-place
  table rename.

## TSB-5 — flag is UI-only

- **Proximate cause**: Pulse routes gate on RBAC, not `ff_school_pulse_v1`.
- **True root cause**: Intentional design — the flag was scoped as a rollout/render
  control, and the security boundary was (correctly) placed at RBAC +
  `canAccessStudent`. The gap is **documentation/expectation**, not a code defect:
  the constitution's "default-OFF … in code, seed, render guard" wording can be
  misread as a data-access guarantee.
- **Introducing layer**: Product/feature-flag layer (ops-owned), documentation.

## TSB-6 — stale TODO

- **Proximate cause**: An old TODO survived after the per-resource checks it
  describes were actually implemented.
- **True root cause**: The per-resource ownership work was added handler-by-handler
  over several waves; the summary TODO at the file foot was never deleted. Normal
  comment rot. **Introducing layer**: maintainability/process.

---

## Cross-cutting root cause (the through-line)

Three of the four substantive gaps (TSB-1, TSB-2, TSB-3) share one root: **teacher
access to student data was built API-first over the service-role client, before
multi-tenant isolation, and the older teacher-dashboard Edge Function never
converged onto the later canonical `canAccessStudent` boundary or onto RLS.** The
service-role client structurally hides tenant/relationship defects because it
bypasses the DB-layer net that would otherwise catch them.

The highest-leverage remediation is therefore not six point-fixes but two moves:
1. **Tenant-scope + converge** the teacher-dashboard resolver onto a single
   class-roster-only helper (closes TSB-1 + TSB-3).
2. **Add the teacher-assigned RLS policy on `public.students`** (and ideally
   `learner_mastery` / `state_events`) so the service-role surfaces gain a
   defense-in-depth net (closes TSB-2).

Both are AUTO-FIX-SAFE (no RBAC role/permission changes). TSB-4 (table cutover) is
the only one that may touch a DROP and would then require user approval.
