# 06 — Self-Review: Teacher / School-Admin B2B (Cycle 5)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-5
- **Workflow:** teacher-school-b2b (P8 RLS boundary; P9 RBAC enforcement; P13 data privacy / multi-tenant isolation)
- **Reviewer (authors):** architect (RLS/boundary map + TSB-2 migration) + backend (TSB-1/3/6 Edge Function fix) + testing (coverage)
- **Date:** 2026-06-29
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Severity | Owner | Fixed? | Evidence (file / test) | Notes |
|---|---|---|---|---|---|
| **TSB-1** | **CRITICAL** (P8/P13) | backend | yes | `supabase/functions/teacher-dashboard/index.ts` — all **8** grade-fallback sites now `.eq('school_id', <auth-derived>)`-scoped via new `resolveTeacherSchoolId`; fail-closed on null | The gap-analysis named 2 sites; backend found **8** (incl. a cross-tenant WRITE in `handleSetGradeBookCell`). 15 new tests. → REG-184 |
| **TSB-2** | HIGH → reclassified | architect | yes (defense-in-depth) | `supabase/migrations/20260702010000_teacher_assigned_students_rls.sql` — named teacher SELECT policy on `public.students`, predicate-identical to the already-active `is_teacher_of(id)` branch | **Audit-premise correction:** `students` ALREADY had a teacher backstop (the `students_select_merged` policy calls `is_teacher_of(id)`, even stricter via `is_active` guards). New policy adds **discoverability + helper-independence**, not a closed hole. 10 new tests. → REG-185 |
| **TSB-3** | MED | backend | partial + TODO | precise `TODO(TSB-3 convergence)` at `resolveStudentsForTeacher` referencing `canAccessStudent` | Path A roster logic already mirrors `canAccessStudent`; Path B now tenant-scoped + fail-closed. Full convergence needs a shared Next.js/Deno authz module (product-behavior change) → **deferred** |
| **TSB-4** | MED | architect | **GATED (USER)** | dual `class_students` / `class_enrollments` join tables + sync trigger | Read-consolidation is auto-fix-safe; any table DROP requires **USER approval**. Surfaced to CEO. NOT touched |
| **TSB-5** | LOW | ops/frontend | **FOLLOW-UP** | `ff_school_pulse_v1` is a render guard, not a data-access guard | One-line clarifying comment on the (separate) pulse routes. NOT touched |
| **TSB-6** | LOW | backend | yes | stale per-resource-ownership TODO replaced with an accurate `SECURITY NOTE` | Maintainability; the per-resource checks DO exist, JWT binding guards impersonation |

## Self-review checklist
- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly deferred (TSB-1/2/6 landed; TSB-3 partial+TODO; TSB-4 USER-gated; TSB-5 follow-up).
- [x] **TSB-1 completeness walk** — verified by grep that all **8** grade-filtered `students` query sites are now `.eq('school_id', …)`-scoped; non-grade queries filter by rosterIds / explicit studentId and are unchanged. Fixing only the 2 sites the audit named would have left sites 3–8 (incl. the WRITE) leaking.
- [x] **Fail-closed everywhere** — a null/absent teacher `school_id` yields empty / 403 / zero, never all-schools and never a null-match (which would let a school-less teacher enumerate other B2C students).
- [x] **Auth-derived tenant** — `school_id` resolves from the JWT-bound `teacher_id` (the dispatcher overwrites `body.teacher_id` from the Bearer token), never from request body/params. No IDOR.
- [x] **No RBAC role/permission change** — no new permission code, no grant change; no user-approval gate triggered by the landed set (TSB-4 DROP is the only USER-gated item, and it was NOT done).
- [x] **P13** — no student name/email/phone added to any log; IDs/counts only.
- [x] **TSB-2 cannot over-grant** — PostgreSQL OR-combines PERMISSIVE policies; the new policy's predicate equals the already-active `is_teacher_of(id)` branch (same roster join + `is_active` guards), so the selectable row set is unchanged.
- [x] **Migration is additive + idempotent** — `DROP POLICY IF EXISTS … ; CREATE POLICY …` on its own name only; RLS already enabled on `students` (not toggled); safe to re-run; no DROP TABLE/COLUMN, no `SECURITY DEFINER` added.
- [x] **Migration ordering corrected** — renamed `20260629000000` → `20260702010000` (byte-identical) so it applies last; test reference repointed. (Quality condition — resolved.)
- [x] Ownership/scope — backend edits limited to the Edge Function; architect edits limited to the new migration; testing edits limited to new test files. No payment / onboarding / scoring surface touched.

## Known limitations carried forward (for the independent reviewer)
1. **TSB-4 is USER-GATED, not fixed.** The dual `class_students`/`class_enrollments` model + sync trigger is an incomplete migration; any table DROP needs USER approval. Recommend surfacing to CEO.
2. **TSB-3 full convergence deferred.** Removing Path B + bridging the Next.js↔Deno runtime split (so `teacher-dashboard` reuses `canAccessStudent`) is a larger architectural item (ai/architect).
3. **TSB-5 follow-up.** Clarifying comment that `ff_school_pulse_v1` is a render/rollout guard, not the data boundary (ops/frontend; separate pulse surface).
4. **Pre-existing TS2352** at `teacher-dashboard/index.ts:2704` (untouched join-cast) — surfaces under `deno check`, not `tsc`; separate cleanup PR (architect).
5. **Vacuously-green walker** in the OLD `teacher-dashboard-roster-join.test.ts` — harden separately (testing).
6. **CI-resilience:** the Deno dependency pre-warm step has no retry (a transient esm.sh 522 red the Cycle-4 pipeline) — candidate retry-with-backoff on `deno cache` (ops/architect).

## Ready for independent validation?
**YES.** All Cycle-5 auto-fix-safe items (TSB-1 backend, TSB-2 architect, TSB-3 partial+TODO, TSB-6 backend) are implemented and locally green; TSB-4 (USER-gated) and TSB-3-full / TSB-5 + the 3 pre-existing tracked items are explicitly recorded with owners and were not touched.
