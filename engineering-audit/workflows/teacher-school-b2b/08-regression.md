# 08 — Regression: Teacher / School-Admin B2B (Cycle 5)

> Phase: REGRESSION. Dependent-workflow regression sweep.

- **Cycle:** cycle-5
- **Workflow:** teacher-school-b2b (P8 RLS boundary; P9 RBAC enforcement; P13 data privacy / multi-tenant isolation)
- **Verification squad:** **testing**
- **Date:** 2026-06-29
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] Teacher-dashboard + RLS suites green — **527/527 vitest** PASS (incl. 15 new TSB-1 tenant-scoping + 10 new TSB-2 RLS-policy tests).
- [x] No previously-passing test now skipped or weakened — the new tests are **additive** pins (8-site tenant scoping; the teacher SELECT policy predicate-parity + fail-closed-on-non-assignment). The renamed migration's test reference is the only existing edit, repointing `20260629000000` → `20260702010000` (path-only; same assertions).
- [x] type-check green; lint 0 errors; build green; **no bundle impact** (Edge Function + migration only).

## P14 review-chain completeness (RBAC / RLS boundary) — COMPLETE
Per `.claude/skills/review-chains/SKILL.md`, an RBAC/RLS-boundary change requires architect (maker) → backend + testing + (ops where admin-surface) — here the squad was architect + backend makers with testing + quality reviewers:

| Role | Agent | Scope | Result |
|---|---|---|---|
| Maker (RLS / boundary) | **architect** | RLS/RBAC/auth boundary map (01–03) + TSB-2 teacher SELECT policy migration | DONE |
| Maker (Edge Function fix) | **backend** | TSB-1 8-site tenant scoping + `resolveTeacherSchoolId` + TSB-3 TODO + TSB-6 SECURITY NOTE | DONE |
| Coverage | **testing** | 15 TSB-1 + 10 TSB-2 tests; migration-reference repoint | **GREEN** (527/527) |
| Independent validation | **quality** | re-ran all gates; walked all 8 sites; confirmed fail-closed + TSB-2 no-over-grant | **APPROVE WITH CONDITIONS** — condition (migration ordering) **RESOLVED** |

**Chain: COMPLETE** for the auto-fix-safe set. (TSB-4 opens its own USER-governance gate for the table DROP; TSB-3-full + TSB-5 are follow-ups.)

## Dependent-workflow regression result
The teacher/school-admin B2B surface shares dependencies with the Student Pulse boundary, the adaptive-remediation B2B escalation, and the school-admin tenant surface. No regressions:

| Dependent flow | Shared dependency | Regression? |
|---|---|---|
| Student Pulse boundary (`/api/pulse/*`) | `canAccessStudent` is the single boundary; **separate** code path from the Edge Function | none — TSB-1 fixes the Edge Function resolver only; the pulse funnel was already strict (roster-only, fail-closed); REG-121 still green |
| Adaptive-remediation B2B escalation | teacher attribution via `class_students`⋈`class_teachers` + 23505 dedupe | none — TSB-1/TSB-2 do not touch the cron worker or `teacher_remediation_assignments` RLS; REG-128/REG-133 still green |
| School-admin tenant surface | `.eq('school_id', schoolId)` from `school_admins`, never body | none — unchanged; the new `students` teacher policy OR-combines, does not affect the school-admin policy |
| RLS-bound readers of `public.students` | the new teacher SELECT policy | none — predicate-identical to the already-active `is_teacher_of(id)` branch; service-role paths bypass RLS and are unaffected |

## Existing B2B / boundary regressions — still green
| REG-ID | Pins | Status after Cycle 5 |
|---|---|---|
| REG-120 | Full RBAC matrix conformance (every role/permission/grant from one additive idempotent root migration) | **green** — no RBAC role/permission/grant change this cycle |
| REG-121 | Student Pulse cross-role data boundary (`canAccessStudent` single boundary on `/api/pulse/*`; no payload on deny) | **green** — separate path; untouched |
| REG-122 | Pulse signal derivation (inactivity / mastery-cliff / at-risk-concentration) | **green** — untouched |
| REG-124 | `ff_school_pulse_v1` flag-gate default-OFF (render guard) | **green** — TSB-5 only *documents* the render-vs-data semantics; no code change |
| REG-128 | Adaptive B2B escalation attribution (subject-match tiering + cross-teacher 23505 dedupe) | **green** — cron worker untouched |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Filed in catalog? |
|---|---|---|---|
| **REG-184** | P8 / P13 | teacher-dashboard grade-fallback tenant scoping — all **8** grade-filtered `students` query sites (incl. the `handleSetGradeBookCell` WRITE) are `school_id`-scoped via the auth-derived `resolveTeacherSchoolId`; **fail-closed** (empty / 403 / zero) on a null/absent teacher `school_id`; no null-match, no all-schools read; `teacher_id` is JWT-bound | filed → catalog 152 |
| **REG-185** | P8 | teacher-assigned RLS backstop on `public.students` — named teacher SELECT policy, predicate-identical to the already-active `is_teacher_of(id)` branch (assigned + active-roster only); returns assigned row, **zero rows** for non-assigned / inactive-enrollment teacher; idempotent | filed → catalog 152 |

> `.claude/regression-catalog.md` is authoritative. Catalog **150 → 152**.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| Teacher B2B tenant-isolation assertions | grade-fallback cross-tenant leak UNGUARDED (8 sites); no teacher SELECT policy on `students` discoverable | **527/527 vitest** — 8-site tenant scoping + fail-closed + the teacher RLS backstop all pinned |
| Regression catalog entries | 150 (REG-182/183, Cycle 4) | **152** with REG-184 (P8/P13 tenant scoping) + REG-185 (P8 teacher RLS backstop) |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-29 Cycle-5 row).

## Residual risk
1. **TSB-4 — GATED (USER, MED).** Dual `class_students`/`class_enrollments` join tables (incomplete migration, sync trigger papers over it). Read-consolidation is auto-fix-safe; any table DROP requires **USER approval**. Recommend CEO surfacing.
2. **TSB-3 full convergence — FOLLOW-UP (ai/architect, MED).** Shared cross-runtime authz module so `teacher-dashboard` reuses `canAccessStudent`; Path B is now tenant-scoped + fail-closed as the safe interim.
3. **TSB-5 — FOLLOW-UP (ops/frontend, LOW).** `ff_school_pulse_v1` is a render guard, not a data-access guard; a one-line clarifying comment on the (separate) pulse routes.
4. **Pre-existing TS2352** at `teacher-dashboard/index.ts:2704` (untouched join-cast) — surfaces under `deno check`, not `tsc`; separate cleanup PR (architect).
5. **Vacuously-green walker** in the OLD `teacher-dashboard-roster-join.test.ts` (filter-extraction terminates early) — harden separately (testing).
6. **CI-resilience** — the Deno dependency pre-warm step has no retry (a transient esm.sh 522 red the Cycle-4 pipeline); candidate retry-with-backoff on `deno cache` (ops/architect).

## Sweep verdict
**GREEN** — 527/527 vitest PASS, P14 chain complete for the auto-fix-safe set (quality APPROVE WITH CONDITIONS, condition RESOLVED), no dependent-flow regression, REG-120/121/122/124/128 still green, the two new guards (REG-184/185) close the critical cross-tenant student-PII leak + add the teacher RLS backstop; the residual TSB-4 (USER-gated) + TSB-3-full + TSB-5 + the 3 pre-existing tracked items are gated/follow-up, not sweep failures.
