# RBAC Conformance + Student Pulse — Design Spec

- **Date**: 2026-06-12
- **Status**: FOUNDATION step delivered (RBAC conformance migration + test). Pulse APIs/UI are a later, separate step (backend/frontend owned).
- **Owning agents**: architect (RBAC base, schema, RLS), backend (Pulse APIs), frontend (Pulse UI), assessment (signal correctness review).
- **Product invariants in scope**: P8 (RLS boundary), P9 (RBAC enforcement), P13 (data privacy), P5 (grades are strings), P7 (bilingual UI).

---

## 1. Context

The Alfanumrik RBAC layer (6 base + 5 extended = 11 roles, ~70 matrix permission codes, role→permission grants, 4 resource-access-ownership patterns) was historically seeded by a long chain of migrations. After the 2026-05-03 Section 10 cleanup, that chain was archived under `supabase/migrations/_legacy/timestamped/`, and a pg_dump-derived idempotent baseline (`00000000000000_baseline_from_prod.sql`) became the only root migration. The Supabase CLI applies **only** files at the immediate `supabase/migrations/` root, so `_legacy/` is skipped on fresh environments (CI live-DB, new staging, DR). The baseline is **schema-only** for the RBAC tables — it does NOT carry the seed rows. This creates a reproducibility gap: a fresh DB has the RBAC *tables* but not the *matrix data*.

Separately, the product wants a **Student Pulse** capability: a small set of derived "signals" (inactivity, mastery-cliff, at-risk concentration) surfaced through four role-scoped "lenses" (student self-view, parent child-view, teacher class-view, principal school-view). Pulse reads existing learner state and must enforce the same ownership boundaries the RBAC matrix already encodes.

This spec covers two deliverables. **(A)** the design (this document). **(B)** the FOUNDATION implementation: an additive, idempotent RBAC conformance migration + an offline conformance test proving the matrix is 100% present. **Pulse APIs/UI are explicitly out of this step.**

## 2. Goals / Non-Goals

**Goals**
- Make the full RBAC Matrix reproducible from a single, replayable, additive root migration (the conformance guard).
- Prove conformance mechanically with a deterministic, offline test that fails CI on any future matrix drift.
- Define the Pulse architecture (signals, lenses, ownership) so the later backend/frontend step can build against a frozen contract.
- Keep everything additive: never remove an existing role, permission, grant, or resource rule; leave the ~84-code prod superset untouched.

**Non-Goals**
- Implementing Pulse APIs, RPCs, or UI (later step).
- Adding any NEW permission code or role (would require CEO approval).
- Touching adaptive-loop / Phase-A learner-state mutation logic.
- Reconciling the TS-only permission constants that have no DB grant (see §10).

## 3. Resolved Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Additive conformance** — the migration re-asserts (never resets) the matrix using `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`. Extra prod codes are left untouched. | The DB is a superset of the matrix. A reset would be destructive and violate P8/P9 and the hard "additive only" constraint. The conformance artifact is the *floor*, not the ceiling. |
| 2 | **Reuse the school-admin code path** — Pulse's principal/school lens authorizes via the existing `school-admin-auth.ts` (`authorizeSchoolAdmin` + `SCHOOL_ADMIN_ROLE_CAPABILITIES`, gated by `ff_school_admin_rbac`), not a new role. | All four school-admin roles already resolve to the single `institution_admin` RBAC role. Reusing this keeps the 11 platform roles untouched and the narrowing O(1) in code. |
| 3 | **Reuse aggregators** — Pulse signals are computed from `buildStudentState()` and the `state_events` timeline, not new ingestion. Signal math lives in a pure `signals.ts`. | Avoids a parallel data pipeline; keeps signals testable in isolation and consistent with the cognitive engine. |

## 4. RBAC Base Conformance

Three artifacts.

**(a) Conformance migration** — `supabase/migrations/20260612123200_rbac_matrix_conformance.sql`. Idempotently INSERTs every matrix row: 11 roles, every matrix permission code, every role→permission grant, the 4 resource_access_rules, and the `institution_admin → teacher` inheritance grant. Roles/permissions resolved BY name/code (never UUID). `roles` → `ON CONFLICT (name)`, `permissions` → `ON CONFLICT (code)`, `role_permissions` → `ON CONFLICT (role_id, permission_id)`, `resource_access_rules` → `WHERE NOT EXISTS` (no unique constraint exists on that table). Wrapped in `BEGIN/COMMIT`. No DROP/DELETE/TRUNCATE/UPDATE.

**(b) Conformance test** — `src/__tests__/lib/rbac/matrix-conformance.test.ts`. Encodes the matrix as a `role → expected permission codes` structure and statically asserts the migration file covers every role, every code, every grant, the inheritance grant, all 15 resource rules across the 4 ownership patterns, plus the additive/idempotent guards. Deterministic and offline (no DB).

**(c) Frontend `usePermissions` wiring** — already present (`src/lib/usePermissions.ts`, client-convenience only). No security change; the server `authorizeRequest()` remains the boundary. Pulse UI will consult `usePermissions().can(...)` only for show/hide.

## 5. Student Pulse Architecture

Pulse reuses `buildStudentState()` + the `state_events` timeline and a pure `signals.ts`. It exposes **4 lenses**, each mapping to an existing matrix permission and an existing ownership check (`canAccessStudent`):

| Lens | Audience | Matrix permission | Ownership |
|------|----------|-------------------|-----------|
| Self | student | `progress.view_own` | own (`auth_user_id = auth.uid()`) |
| Child | parent | `child.view_progress` | linked (`guardian_student_links`, approved/active) |
| Class | teacher | `class.view_analytics` | assigned (`class_teachers` → `class_students`) |
| School | principal / institution_admin | `institution.view_analytics` | school (school membership via school-admin path) |

**3 signals** (pure functions in `signals.ts`):
| Signal | Definition (computed from state + `state_events`) |
|--------|----------------------------------------------------|
| inactivity | No qualifying learning event within the configured window. |
| mastery-cliff | A previously-mastered concept's mastery has decayed below threshold (history from `state_events`). |
| at-risk-concentration | A cluster of low-mastery / failing concepts concentrated in one subject or chapter. |

**Frontend components**: `src/components/pulse/*`, wired into student `/progress`, parent child page, teacher `/teacher/students/[id]` + Command Center, and principal `/school-admin`. Bilingual (P7).

## 6. Security (P8 / P9 / P13)

- **P8**: Pulse never bypasses RLS from client code; all reads go through server routes that use `supabase-admin` only after `authorizeRequest()` + `canAccessStudent()`.
- **P9**: Every Pulse route calls `authorizeRequest(request, '<lens permission>')`; the client `usePermissions()` is UI convenience only.
- **P13**: Signals return derived booleans/scores and concept identifiers — no raw PII. No student-identifiable data in logs or Sentry.

## 7. Validation & RCA

- `src/__tests__/lib/rbac/signals.test.ts` — pure signal math (later step).
- `src/__tests__/lib/rbac/matrix-conformance.test.ts` — RBAC matrix conformance (THIS step, delivered).
- `e2e/pulse-rls.spec.ts` — cross-role RLS boundary (later step): a parent cannot read a non-linked child's pulse; a teacher only sees assigned students.
- Regression catalog: new entry **REG-120** (RBAC matrix conformance — see §Appendix A and the suggested catalog text in the report). Pulse RLS entries to follow with the Pulse step.
- **RCA-before-PR gate**: any failing check triggers an explicit root-cause statement and fix before the PR is opened (applied in this step — see Appendix A).

## 8. File Map

| Area | Path |
|------|------|
| Conformance migration | `supabase/migrations/20260612123200_rbac_matrix_conformance.sql` |
| Conformance test | `src/__tests__/lib/rbac/matrix-conformance.test.ts` |
| RBAC library | `src/lib/rbac.ts`, `src/lib/rbac-types.ts`, `src/lib/usePermissions.ts` |
| School-admin path | `src/lib/school-admin-auth.ts` |
| RBAC seed provenance | `supabase/migrations/_legacy/timestamped/2026032{4,7}*`, `…20260417100000…`, `…20260418120000…` + root seeds (`20260507110000`, `20260610110000`, `20260611000050`, `20260613000000`, `20260614000002`) |
| Pulse signals (later) | `src/lib/pulse/signals.ts` |
| Pulse components (later) | `src/components/pulse/*` |
| Pulse APIs (later) | `src/app/api/pulse/*` |

## 9. Build Sequence & Agents

1. **architect** (THIS step): conformance migration + conformance test + this spec.
2. **backend** (later): Pulse API routes + RPCs, reusing `buildStudentState` and `authorizeRequest`.
3. **frontend** (later): `src/components/pulse/*` + lens wiring + bilingual strings.
4. **assessment** (later): review signal correctness (`signals.ts`).
5. **testing** (later): `signals.test.ts`, `e2e/pulse-rls.spec.ts`, REG-120 catalog entry.
6. **quality** (each step): gates 1–4 + review.

## 10. Risks

- **Nested clone** — `d:\Alfa_local\Alfanumrik\Alfanumrik\` is excluded from tsconfig; never create/edit files there. All edits are under the canonical root.
- **Guardian link status (`active` vs `approved`) ambiguity** — `canAccessStudent` already accepts BOTH `active` and `approved` for `guardian_student_links`; Pulse reuses `canAccessStudent` rather than re-deriving the parent boundary, eliminating drift.
- **Mastery-cliff history source** — depends on `state_events` retaining enough timeline to detect decay; if events are pruned, the signal degrades gracefully to "unknown" rather than false-negative.
- **TS school-scale follow-up** — school-lens aggregation over many students may need pagination/caching; tracked as a Pulse-step performance follow-up.
- **TS-only permission constants without a DB grant** — `admin.manage_users`, `system.manage_roles`, `student.profile.write`, `student.scan`, `study_plan.write`, `exam.write` exist in the `PERMISSIONS` TS registry but have no seed/grant in the migration chain. They are NOT part of the conformance matrix (seeding them would be a *new* permission addition needing CEO approval). Flagged for a later reconciliation decision.
- **Top risk: P8/P13** — a Pulse lens leaking another student's derived signals is the highest-severity failure mode; mitigated by routing every read through `authorizeRequest()` + `canAccessStudent()` and the planned `e2e/pulse-rls.spec.ts`.

## 11. Out of Scope

- Pulse APIs / RPCs / UI (later backend+frontend step).
- **Phase A adaptive loops** and any learner-state mutation.
- New permission codes, new roles, pricing/plan changes.
- Any change to the agent system, CI/CD, or deployment config.

## 12. Open Items

- REG-120 catalog text suggested in the FOUNDATION report; testing agent owns the catalog edit.
- Decision on the 6 TS-only permission constants (seed vs remove from TS) — needs CEO input.
- Window/threshold constants for the 3 signals — to be fixed by assessment in the Pulse step.

---

## Appendix A: RBAC Conformance Verification

*Findings from Deliverable B, Step 1 (read-only inspection of the RBAC seed state). Source: static analysis of the migration chain. The Supabase MCP `execute_sql`/`list_tables` read-only tools were not invokable in this agent session, so the live-DB cross-check was deferred; the migration-chain analysis below is the authoritative matrix definition.*

### A.1 What the cleaned baseline contains

`00000000000000_baseline_from_prod.sql` defines the RBAC **tables only** (schema-only; no seed rows):
- `permissions` (cols: `id, code, resource, action, description, is_active, created_at`) — UNIQUE `permissions_code_key` on `(code)`.
- `roles` (cols incl. `name, display_name, display_name_hi, hierarchy_level, is_system_role, is_active`) — UNIQUE `roles_name_key` on `(name)`.
- `role_permissions` (`role_id, permission_id, granted_at, granted_by`) — UNIQUE `role_permissions_role_id_permission_id_key` on `(role_id, permission_id)`.
- `resource_access_rules` (`role_id, resource_type, ownership_check, field_restrictions, max_records_per_request`) — **PK on `id` ONLY; NO unique constraint** on `(role_id, resource_type, ownership_check)`.

The baseline carries **zero** `INSERT`/`COPY` of RBAC seed rows (the 140 data statements in the baseline are unrelated table/function bodies). **Consequence**: on any fresh DB, the RBAC tables exist but are EMPTY until a root migration seeds them.

### A.2 Where the matrix data actually lived (the legacy/seed chain)

| Source migration | Seeds |
|---|---|
| `_legacy/…20260324070000_production_rbac_system.sql` | 6 base roles; ~42 base permission codes; student/parent/teacher grant blocks; admin + super_admin wildcard grants; 15 resource_access_rules (own/linked/assigned/any) |
| `_legacy/…20260327210000_extended_rbac_roles.sql` | 5 extended roles (institution_admin, content_manager, support, finance, reviewer); institution/content/support/finance codes; their grant blocks; **institution_admin → teacher inheritance** |
| `_legacy/…20260409000005_add_diagnostic_permissions.sql` | `diagnostic.attempt`, `diagnostic.complete` → student |
| `_legacy/…20260417100000_rbac_phase1_security_hardening.sql` | tutor codes + tutor grant block; `foxy.interact`, `stem.observe` → student |
| `_legacy/…20260418120000_super_admin_access_permission_seed.sql` | `super_admin.access` |
| `_legacy/…20260415000011_subject_governance_rbac_permission.sql` | `super_admin.subjects.manage` |
| `_legacy/…20260416200100_school_admin_extra_permissions.sql` | `school.manage_{branding,billing,domain,settings}`, `school.export_data` → institution_admin |
| root `20260507110000` | `school.manage_modules` → institution_admin |
| root `20260505120000` | `account.delete` |
| root `20260610110000` | `school.manage_content` → institution_admin; diagnostic.* (re-assert) |
| root `20260611000050` | `payments.subscribe` → student |
| root `20260613000000` | `child.encourage` → parent (+admin/super_admin) |
| root `20260614000002` | institution.* Wave C (`export_reports, manage_billing, view_billing, manage_staff`) + `manage_students` re-assert → institution_admin |

### A.3 Delta (present vs added by the conformance migration)

- **On PROD** (matrix already seeded by the chain above + has a ~84-code superset): the conformance migration is a **pure no-op** — every `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS` short-circuits. Zero rows change. The extra ~14 superset codes are untouched.
- **On a FRESH DB** (CI live-DB, new staging, DR — where `_legacy/` is NOT applied): before this migration the RBAC tables are **empty**; the conformance migration is what **adds the entire matrix** — all 11 roles, all ~70 matrix codes, every grant, the inheritance grant, and the 15 resource_access_rules. This closes the reproducibility gap.
- **Net effect**: additive everywhere. The conformance migration is the single artifact that guarantees the matrix is 100% present regardless of environment, and the offline test pins it so future drift fails CI.

### A.4 Matrix shape (encoded + asserted)

- **Roles (11)**: student(10), parent(30), tutor(40), teacher(50), support(55), reviewer(58), content_manager(60), finance(65), institution_admin(70), admin(90), super_admin(100).
- **Permission universe**: ~70 matrix codes across resources study_plan, quiz, exam, image, report, review, foxy, simulation, leaderboard, profile, notification, progress, diagnostic, stem, payments, account, child, class, test, student, worksheet, tutor, user, role, permission, system, content, analytics, support, finance, institution, school, super_admin, super_admin_subjects.
- **Grants**: explicit per-role blocks for student/parent/teacher/tutor/content_manager/reviewer/support/finance/institution_admin; admin + super_admin wildcards; institution_admin inherits teacher.
- **Resource access rules (15 rows / 4 patterns)**: student→own (×5), parent→linked (×3), teacher→assigned (×4), admin→any (×3).

### A.5 Validation result

- `npx vitest run src/__tests__/lib/rbac/matrix-conformance.test.ts` → **PASS** (254 assertions across 1 file).
- `npm run type-check` → **PASS** (exit 0).
- No RCA required: both checks passed on first run; no failing state was reached.
