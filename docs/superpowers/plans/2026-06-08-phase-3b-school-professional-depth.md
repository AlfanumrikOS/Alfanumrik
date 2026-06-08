# Phase 3B Implementation Plan — School Professional Depth (single-school)

- **Spec:** `docs/superpowers/specs/2026-06-08-phase-3b-school-professional-depth-design.md`
- **Date:** 2026-06-08
- **Sequencing:** Waves ship in order A → B → C → D, each its own PR through the review chain (builder → testing → quality), each behind a feature flag (default OFF). This plan details **Wave A** fully; B/C/D are outlined and expanded into step lists when their turn comes. B and C each open with an explicit CEO approval gate (P11 seat-policy; RBAC matrix).

## Conventions
- Path alias `@/*` → `src/*`. Three Supabase clients (client / server / admin) used strictly per their boundaries; `supabase-admin` is server-only.
- Every new table/view/function ships RLS + policies/guards in the same migration. Every API route uses `authorizeRequest('permission.code')`.
- No new scoring/XP/anti-cheat math anywhere. Verify per wave: `git diff origin/main -- src/lib/xp-rules.ts src/lib/score-config.ts src/lib/quiz/submit-side-effects.ts` returns empty.
- Bilingual (P7) on all new admin UI via `AuthContext.isHi`. Technical terms not translated.
- TDD: write the failing test first for every RPC contract, route handler, and resolver branch; watch it fail; then implement.

## Cross-cutting engineering standards (scalable · stable · clean · optimum runtime)
These are non-negotiable for every wave and are checked at the quality gate.

**Scalable**
- Server-side aggregation only. School-wide rollups computed in a single SQL pass (CTEs / GROUP BY), never per-row loops or client-side fan-out. No N+1.
- Every list endpoint is paginated (keyset preferred; `limit`/`offset` acceptable) with a hard server-side `LIMIT` cap.
- Every aggregate query is backed by a covering index on its join/filter columns (`school_id`, `class_id`, `student_id`, `status`). RPCs are designed O(school size), not O(all rows).
- Expensive school-wide reads use a short-TTL cache; seat numbers reuse the existing `school_seat_usage` daily-snapshot rather than recomputing live where freshness allows.

**Stable**
- Migrations are idempotent (`CREATE ... IF NOT EXISTS`, guarded `GRANT`/`INSERT ... ON CONFLICT`), additive-only, self-contained (no forward-refs to archived `_legacy/` tables) so they replay clean on fresh Supabase Preview.
- All writes (Waves B/C) are idempotent and atomic. Seat enforcement (B) is single-transaction.
- Feature-flag gating, default OFF; flag-OFF byte-identical to today's portal. No breaking changes to existing routes or contracts.
- DataState pattern (`live | no_data | table_missing | partial`) on every read — never fake green numbers.

**Clean workflows**
- ADR-005 canonical-writer rule: no API route writes learner state. Strict read-RPC vs write-RPC separation.
- One reused Edge Function / RPC pattern (extend `teacher-dashboard` patterns or a `school-admin-dashboard` sibling — decide in A1, do not fork ad-hoc).
- Thin API routes: authorize → resolve caller school → call RPC → shape response. Typed contracts shared client↔server.

**Optimum runtime**
- Heavy report/PDF/CSV UI lazy-loaded via `next/dynamic` (protects P10 bundle). Exports generated server-side off the hot path.
- SWR client cache + revalidate; sensible server cache headers on read routes.
- Debounced class/section/grade switching; no refetch storms.

## Wave A — School Command Center (autonomous, read-only)

### A1 — Read-model RPCs (architect designs, backend implements)
- Decide the host: extend `supabase/functions/teacher-dashboard/` patterns vs a `school-admin-dashboard` sibling. Record the decision at the top of the migration.
- `get_school_overview(p_school_id text)` — ONE aggregate query returning a single JSON row: class/teacher/student counts, seat utilization (`active_students` vs `school_subscriptions.seats_purchased`, seats sourced from `school_seat_usage` snapshot), weekly academic signal (avg mastery trend + completion). SECURITY DEFINER with an internal guard: caller must be a `school_admins` member of `p_school_id`.
- `get_classes_at_risk(p_school_id text, p_limit int, p_offset int)` — per-class risk rollup aggregating the Phase 3A at-risk signals across `classes → class_students → bkt_mastery_state` in a single GROUP BY; ordered by risk desc; paginated; capped LIMIT.
- `get_teacher_engagement(p_school_id text, p_limit int, p_offset int)` — per-teacher activity: grading count, remediation assigned (`teacher_remediation_assignments` from 3A), last-active; paginated.
- Indexes: ensure covering indexes exist on `class_students(class_id)`, `classes(school_id)`, `teacher_remediation_assignments(teacher_id, status)`, `bkt_mastery_state(student_id)`. Add any missing ones in this migration (idempotent).
- No new table, no new permission. Reuses `institution.view_analytics`.

### A2 — Authz + school-scope resolution (backend)
- Reuse `institution.view_analytics` (NO new permission → Wave A has no approval gate). `authorizeRequest('institution.view_analytics')` on every route.
- Resolve the caller's school from `school_admins` membership server-side; never trust a client-supplied `school_id` without the membership check.

### A3 — API routes (backend)
- `GET /api/school-admin/overview` → `get_school_overview`.
- `GET /api/school-admin/classes-at-risk?limit&offset` → `get_classes_at_risk`.
- `GET /api/school-admin/teacher-engagement?limit&offset` → `get_teacher_engagement`.
- Each: authorize → resolve school → call RPC → return DataState-wrapped JSON with cache headers. Thin handlers, typed response.

### A4 — Command Center UI + nav consolidation (frontend)
- `src/app/school-admin/` home becomes the Command Center behind `ff_school_command_center` (default OFF; current dashboard remains when OFF — byte-identical). Panels: overview KPIs, classes-at-risk rail (paginated), teacher-engagement table (paginated), seat-utilization gauge (display only; enforcement is Wave B).
- Consolidate nav ~24 → 5 sections (Overview · People · Academics · Billing · Settings). Every existing route stays reachable (no dead links) via section pages / account menu.
- SWR for client caching; lazy-load non-critical panels via `next/dynamic`. Bilingual (P7). Loading / empty / error / no-data states for every panel.

### A5 — Tests (testing)
- Unit: each RPC's aggregation correctness + school-scope guard (caller not in school → empty/deny).
- Integration: cross-school access → 403; flag-OFF byte-identical assertion.
- E2E: admin opens Command Center → sees rollup → paginates classes-at-risk → drills into a class.
- Performance: against a seeded large school, assert single-query plans / no N+1 and response within budget.
- Regression-catalog: REG-96 (School Command Center rollup correctness + flag-OFF byte-identical + cross-school 403).

### A6 — Gate (quality)
- type-check / lint / build / bundle (P10); review chain complete (architect + backend + frontend + assessment + testing); cross-cutting standards checklist verified; verdict; merge when CI green.

## Wave B — Seat-aware provisioning + enforcement (outline; APPROVAL GATE: P11)
Open with the seat-policy approval gate (hard-block vs soft-warn+grace). Then: `check_seat_availability` RPC guarding enrollment (single-transaction, idempotent); bulk CSV import validated against `seats_purchased` with a per-row error report; deactivation frees a seat; `school_seat_usage` becomes a maintained projection; seat-bounded invite codes. One idempotent, self-contained migration. Behind `ff_school_provisioning`. REG-97. Review chain adds **architect + backend** (payment-adjacent).

## Wave C — School-admin RBAC depth (outline; APPROVAL GATE: RBAC additions)
Open with the role→permission matrix approval gate. Then: wire `school_admins.role` (principal / vice_principal / academic_coordinator / institution_admin) into the RBAC `RoleName` mapping + `hasPermission()` scoping; staff management UI (invite / assign / revoke within the school). One idempotent grants migration. Behind `ff_school_admin_rbac`. REG-98. Review chain led by **architect** (RBAC), with backend + frontend + testing.

## Wave D — School-wide academic reporting (outline; autonomous, read-only)
`get_school_mastery_rollup`, `get_school_bloom_summary`, `export_school_report` (mastery verbatim from `bkt_mastery_state.p_know`, Bloom from `quiz_responses.bloom_level` — same sources as 3A Wave C). Per-grade / per-subject / per-teacher comparatives; board/parent-ready CSV+PDF, scoped + PII-safe, generated server-side and lazy-loaded. Reuses `report.view_class` aggregated + `institution.view_analytics`. No migration. Behind `ff_school_reports_depth`. REG-99.

## Review chains (per change)
- Read-model RPCs / schema / indexes → **architect** (backend, frontend, ops, testing review).
- API routes → **backend** (architect for authz; testing review).
- Admin pages / nav → **frontend** (ops, testing review).
- Seat enforcement (B) → **backend + architect** (payment-adjacent, P11); testing.
- RBAC wiring (C) → **architect** (backend, frontend, ops, testing review).
- Reporting (D) → **backend** (assessment for rollup parity; frontend; testing).
- Each wave → testing then quality before merge.
