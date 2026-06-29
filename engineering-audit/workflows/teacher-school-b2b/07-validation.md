# 07 — Independent Validation: Teacher / School-Admin B2B (Cycle 5)

> Phase: INDEPENDENT VALIDATION. A fresh quality agent (did NOT implement) verifies.

- **Cycle:** cycle-5
- **Workflow:** teacher-school-b2b (P8 RLS boundary; P9 RBAC enforcement; P13 data privacy / multi-tenant isolation)
- **Validator squad:** **quality** (independent of the builder squad)
- **Date:** 2026-06-29
- **Self-review reference:** `./06-self-review.md`
- **Verdict:** **APPROVE WITH CONDITIONS** — the single condition (migration ordering) is now **RESOLVED**.

## Independence statement
The validating quality agent did **not** author any Cycle-5 change (TSB-1 backend; TSB-2 architect; TSB-6 backend). It re-ran every gate from a clean state rather than trusting the builders' reported results, and independently walked all 8 grade-fallback query sites in `teacher-dashboard/index.ts` to confirm each is tenant-scoped and fail-closed.

## The 8-site completeness walk (verified, not trusted)
The audit's gap-analysis named 2 grade-fallback sites; the validator independently confirmed backend's finding of **8**, and that **every** one is now `school_id`-scoped via `resolveTeacherSchoolId` with a fail-closed null branch:

| # | Site | Function | Leak class (pre-fix) | Post-fix verdict |
|---|---|---|---|---|
| 1 | grade branch | `assertTeacherOwnsClass` | ownership gate (guards 4/5/6/7/8) | scoped + fail-closed → **PASS** |
| 2 | Path B | `resolveStudentsForTeacher` | name+grade (reports/overview/trends/student-report/mastery) | scoped + fail-closed → **PASS** |
| 3 | grade count | `handleGetDashboard` | per-grade count across all schools | scoped + fail-closed → **PASS** |
| 4 | grade branch | `handleGetHeatmap` | name+grade+mastery | scoped + fail-closed → **PASS** |
| 5 | grade branch | `handleGetAlerts` | name+grade+accuracy | scoped + fail-closed → **PASS** |
| 6 | grade branch | `resolveStudentsForClass` | name+grade (overview/bloom/in-the-moment) | scoped + fail-closed → **PASS** |
| 7 | grade branch | `handleGetAttendanceRecord` | name | scoped + fail-closed → **PASS** |
| 8 | grade membership | `handleSetGradeBookCell` | cross-tenant **WRITE** | scoped + fail-closed → **PASS** |

Confirmed: fixing only sites 1+2 (the audit's named pair) would have left sites 3–8 — including the cross-tenant WRITE at site 8 — exploitable by a teacher **with** a school. The fix covers all 8.

## Fail-closed confirmation (verified)
- A null/absent teacher `school_id` yields **empty / 403 / zero** at every site — never an unscoped all-schools read and never a null-match (which would have let a school-less teacher enumerate other `school_id IS NULL` B2C students in a grade). Fail-closed→empty is the only zero-exposure option and is what shipped.
- `school_id` is **auth-derived** from the JWT-bound `teacher_id` (dispatcher overwrites `body.teacher_id` from the Bearer token) — never request-supplied. No IDOR.
- Index `idx_students_school_grade(school_id, grade)` covers the scoped queries — no perf regression.

## TSB-2 audit-premise correction (independently re-derived)
Confirmed the audit's premise ("no teacher SELECT policy on `public.students`"; "3-of-4 four-pattern model") was **incomplete**: `public.students` ALREADY carries a teacher backstop via `students_select_merged` → `is_teacher_of(id)` (baseline), which is in fact **stricter** (adds `cs.is_active`/`ct.is_active` guards). The new migration's policy is **predicate-identical** to that branch → PERMISSIVE OR-combine leaves the selectable row set **unchanged** → provably no over-grant. Its value is **discoverability + independence** from the helper function, not closing a hole. **Reclassified HIGH → defense-in-depth.**

## Gate re-run (verified, not trusted) — quality gates, verbatim
- [x] **type-check** — **PASS**
- [x] **lint** — **PASS** (0 errors)
- [x] **test** — **PASS** — **527/527 vitest** (incl. 15 TSB-1 + 10 TSB-2 new)
- [x] **build** — **PASS**
- [x] **bundle** — **no impact** (Edge Function + migration only; no shared chunk, no page touched)

## The APPROVE-WITH-CONDITIONS condition — and its resolution
- **Condition (raised):** the TSB-2 migration was timestamped `20260629000000` — out-of-order, **before** the true latest root migration `20260702000800_adaptive_interventions_allow_blocked_prerequisite.sql`. An out-of-order migration risks `supabase db push` skip/warn behavior on fresh environments.
- **Resolution (verified RESOLVED):** architect **RENAMED** the file to `20260702010000` (sorts strictly last; content **byte-identical** — only the timestamp prefix changed); testing repointed its test reference to the new path. Quality re-verified that (a) the file now sorts last, (b) the SQL body is unchanged, (c) the test still references the correct path, (d) all gates remain green. **Condition closed.**

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P8 RLS boundary | yes (primary) | yes — strengthened | TSB-2 adds a named, discoverable teacher SELECT policy on `public.students` (defense-in-depth, predicate-identical → no over-grant); the existing `is_teacher_of` net remains in force |
| P13 Data privacy | yes (primary) | yes — strengthened | TSB-1 closes the cross-tenant student-PII leak (names/mastery/XP across all schools) at all 8 sites; fail-closed; no PII added to any log |
| P9 RBAC enforcement | yes | yes (unchanged) | No role/permission/grant change; the JWT-bind + `authorizeRequest`/`assertTeacherOwnsClass` gates are unchanged (TSB-1 scopes *within* the existing gate) |
| P7 Bilingual | partial | unchanged | `students/page.tsx` bilingual (spot-checked); broader teacher-page parity is a low frontend follow-up (per `02-gap-analysis.md`) |
| P1/P2/P3/P4/P5/P6/P11/P12/P15 | no (this cycle) | n/a | No scoring/XP/anti-cheat/atomic/grade-format/question-quality/payment/AI/onboarding surface touched |

## FOX-style residual / gated dispositions (independent confirmation)
- **TSB-4 (USER-GATED).** The dual `class_students`/`class_enrollments` model + sync trigger is an incomplete migration. Read-consolidation is auto-fix-safe, but any table DROP requires **USER approval**. Confirmed not touched; recommend CEO surfacing.
- **TSB-3 full convergence (deferred).** A shared cross-runtime authz module (so `teacher-dashboard` reuses `canAccessStudent`) is a product-behavior change; Path B is now tenant-scoped + fail-closed as the safe interim. Confirmed.
- **TSB-5 (follow-up).** `ff_school_pulse_v1` render-vs-data semantics clarifying comment on the separate pulse routes. Confirmed not a security defect (RBAC + `canAccessStudent` is the real boundary).

## Verdict
**APPROVE WITH CONDITIONS** — the in-scope auto-fix-safe set (TSB-1 backend, TSB-2 architect, TSB-3 partial+TODO, TSB-6 backend) passes independent re-test; all gates green (type-check PASS, lint 0 errors, 527/527 vitest, build PASS, no bundle impact); the 8-site completeness walk and fail-closed behavior independently confirmed; no invariant regression. The **single condition** (TSB-2 migration ordering) is **RESOLVED** (renamed `20260629000000` → `20260702010000`, byte-identical; test reference updated; re-verified). TSB-4 (USER-gated DROP) + TSB-3-full + TSB-5 + the 3 pre-existing tracked items are documented gated/follow-ups, not validation failures.

## Gate 5 (P14 review-chain) confirmation
The mandatory RBAC/RLS-boundary chain is **COMPLETE**: architect (RLS/boundary map + TSB-2 migration) + backend (TSB-1 Edge Function fix) → testing (coverage GREEN) + quality (independent **APPROVE WITH CONDITIONS**, condition resolved). See `08-regression.md`.

## Required fixes before COMPLETE (if REJECT)
None outstanding for the auto-fix-safe set — the one condition is resolved. The workflow is not marked fully COMPLETE only because **TSB-4** is USER-gated (table-drop decision) and **TSB-3-full / TSB-5** + the 3 pre-existing tracked items are follow-ups; see `STATUS.md`.
