# Cycle Log — 2026-06-29 — Teacher / School-Admin B2B (P8, P9, P13)

> Dated summary of Cycle 5, the fifth workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/teacher-school-b2b/` (01-map … 08-regression + STATUS.md).

## Workflow
- **Cycle:** 5
- **Workflow:** teacher-school-b2b (teacher portal + school-admin tenant surface + teacher-dashboard Edge Function + Pulse cross-role boundary)
- **Primary invariants:** P8 (RLS boundary), P9 (RBAC enforcement), P13 (data privacy / multi-tenant isolation)
- **Status:** **CYCLE 5 LANDED — critical cross-tenant leak (TSB-1) closed + TSB-2 defense-in-depth; TSB-4 USER-gated, TSB-3/5 + 3 tracked items follow-ups**

## Headline finding
The **primary teacher analytics surface** (the `teacher-dashboard` Supabase Edge Function) bypasses the constitution's "single cross-role boundary" `canAccessStudent` and applied a looser, **tenant-unscoped** grade fallback. On the **service-role** client (RLS bypassed by design), a teacher with `grades_taught` but no class could read names/mastery/XP of **every student in those grades across ALL schools** — a contract-ending, DPDP-reportable multi-tenant break for a B2B EdTech. Closed this cycle.

## Agents involved
- **architect** — workflow lead for MAP → GAP → ROOT-CAUSE (01–03); authored the RLS/RBAC/auth boundary map and the TSB-2 teacher SELECT policy migration; performed the migration-ordering RENAME that resolved the quality condition.
- **backend** — lead implementer: TSB-1 8-site tenant scoping (`resolveTeacherSchoolId` helper, fail-closed), TSB-3 partial convergence + precise TODO, TSB-6 SECURITY NOTE.
- **testing** — 15 TSB-1 tenant-scoping + 10 TSB-2 RLS-policy tests; repointed the migration test reference after the rename; regression sweep (527/527 GREEN); filed REG-184 / REG-185.
- **quality** — independent validation (did not implement); walked all 8 grade-fallback sites; confirmed fail-closed + TSB-2 no-over-grant; verdict **APPROVE WITH CONDITIONS** (migration ordering) → condition RESOLVED.
- **ops (this doc)** — documentation finalization (04/05 reconciliation; 06/07/08 + STATUS; STATE/backlog/coverage updates; cycle log).

## Gaps found (TSB-1 … TSB-6) and dispositions
| ID | Title | Severity | Owner | Disposition |
|---|---|---|---|---|
| TSB-1 | teacher-dashboard grade-fallback leaks ALL platform students in a grade (cross-tenant) | **CRITICAL** (P8/P13) | backend | **LANDED** — all 8 grade-fallback sites `school_id`-scoped via auth-derived `resolveTeacherSchoolId`; fail-closed; → REG-184 |
| TSB-2 | No teacher-assigned RLS policy on `public.students` (defense-in-depth absent) | HIGH → **reclassified** defense-in-depth | architect | **LANDED** — named teacher SELECT policy; predicate-IDENTICAL to the already-active `is_teacher_of(id)` branch; → REG-185 |
| TSB-3 | Two divergent teacher↔student boundary implementations | MED | backend | **PARTIAL + TODO** — Path B tenant-scoped + fail-closed now; full convergence (shared Next.js/Deno authz module) deferred |
| TSB-4 | Dual `class_students` / `class_enrollments` join-table model | MED | architect | **GATED (USER)** — read-consolidation auto-fix-safe; any table DROP needs USER approval. Surface to CEO |
| TSB-5 | `ff_school_pulse_v1` is a UI guard, not a data-access guard | LOW | ops/frontend | **FOLLOW-UP** — clarifying comment on the (separate) pulse routes |
| TSB-6 | Stale per-resource-ownership TODO masks the real residual hole | LOW | backend | **LANDED** — replaced with accurate SECURITY NOTE |

Plus compliant positives C-1..C-8 (JWT-bind impersonation closed, Pulse triple-gate, mutating-route `authorizeRequest`-before-I/O, `teacher_remediation_assignments` model RLS, school-admin tenant scope, school aggregate-only, PII redaction, B2B escalation attribution). No classic IDOR found — the only non-assigned-student read path was TSB-1's grade fallback.

## The 8-site finding (audit named 2, backend found 8)
`assertTeacherOwnsClass` (ownership gate), `resolveStudentsForTeacher` Path B (reports/overview/trends/student-report/mastery), `handleGetDashboard` (per-grade count), `handleGetHeatmap`, `handleGetAlerts`, `resolveStudentsForClass` (overview/bloom/in-the-moment), `handleGetAttendanceRecord`, and `handleSetGradeBookCell` (a cross-tenant **WRITE**). Fixing only the 2 named sites would have left sites 3–8 — including the WRITE — exploitable by a teacher **with** a school.

## TSB-2 premise correction (material finding)
The audit's premise ("no teacher SELECT policy on `public.students`"; "4-pattern model is 3-of-4") was **incomplete**. `public.students` ALREADY had a teacher backstop via `students_select_merged` → `is_teacher_of(id)` (baseline), which is in fact **stricter** (adds `cs.is_active`/`ct.is_active` guards). The new policy is **predicate-identical** (PERMISSIVE OR-combine → unchanged row set, provably no over-grant); its value is **discoverability + helper-independence**, not closing a hole. Hence HIGH → defense-in-depth.

## What landed vs gated
- **Landed + APPROVED (auto-fix-safe security hardening; no RBAC role/permission change):** TSB-1 (backend), TSB-2 (architect), TSB-3-partial + TODO (backend), TSB-6 (backend).
- **Gated (USER APPROVAL required):** TSB-4 (the `class_students`/`class_enrollments` table DROP). Surface to CEO.
- **Follow-ups:** TSB-3 full convergence (ai/architect — shared cross-runtime authz module), TSB-5 (ops/frontend — pulse flag-semantics comment).
- **Pre-existing tracked items:** TS2352 join-cast at `index.ts:2704` (architect cleanup PR), vacuously-green roster-join walker (testing hardening), Deno pre-warm retry (ops/architect CI-resilience).

## Files touched (code/migration/test — by builders, outside this doc-only finalization)
- `supabase/functions/teacher-dashboard/index.ts` (TSB-1 8-site tenant scoping + `resolveTeacherSchoolId` + TSB-3 TODO + TSB-6 SECURITY NOTE)
- `supabase/migrations/20260702010000_teacher_assigned_students_rls.sql` (NEW — TSB-2; renamed from `20260629000000` to resolve the ordering condition)
- test files: 15 TSB-1 tenant-scoping + 10 TSB-2 RLS-policy tests (testing); migration test-reference repoint

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **0 errors**
- test **527/527 vitest PASS** (incl. 15 TSB-1 + 10 TSB-2 new)
- build **PASS**; **no bundle impact** (Edge Function + migration only)
- quality verdict **APPROVE WITH CONDITIONS** (migration ordering) → **RESOLVED**; regression sweep **GREEN**

## Quality condition (RESOLVED)
The TSB-2 migration was timestamped `20260629000000` — out-of-order, before the true latest root migration `20260702000800`. Architect **RENAMED** it to `20260702010000` (sorts last; content **byte-identical**); testing updated the test reference; re-verified. Condition closed.

## P14 review chain (RBAC / RLS boundary) — COMPLETE
architect (RLS/boundary map + TSB-2 migration) + backend (TSB-1 Edge Function fix) → testing (coverage GREEN) + quality (independent **APPROVE WITH CONDITIONS**, condition resolved).

## Regression catalog
- **REG-184** (P8/P13) — teacher-dashboard grade-fallback tenant scoping: all 8 grade-filtered `students` query sites (incl. the `handleSetGradeBookCell` WRITE) `school_id`-scoped via the auth-derived `resolveTeacherSchoolId`; fail-closed (empty / 403 / zero); no null-match, no all-schools read; `teacher_id` JWT-bound.
- **REG-185** (P8) — teacher-assigned RLS backstop on `public.students`: named teacher SELECT policy, predicate-identical to `is_teacher_of(id)` (assigned + active-roster only); zero rows for non-assigned / inactive-enrollment teacher; idempotent.
- Catalog 150 → **152**. Existing B2B/boundary entries **REG-120 / REG-121 / REG-122 / REG-124 / REG-128 remain green**.
  (Authoritative: `.claude/regression-catalog.md`.)

## Program-level RISK (CEO visibility)
- **Critical cross-tenant leak found and fixed (TSB-1).** Pre-fix, a single teacher account could enumerate names + performance of grade-6–12 students at every other school — a contract-ending, DPDP-reportable exposure. Now closed at all 8 sites and pinned by REG-184. Trigger condition was realistic (newly-onboarded teacher with `grades_taught` default but no class). Recommend confirming no exploitation in production logs.
- **TSB-4 USER-gated decision (table DROP).** Resolving the dual `class_students`/`class_enrollments` model requires a decision on dropping a table; surfaced for CEO approval.

## Next workflow
**Super-Admin & Observability** — `PRIORITY-BACKLOG.md` rank 6 (invariants P9, P13): admin auth, audit logging, analytics without PII, health/observability accuracy. Owner squad: ops (lead) + frontend.
