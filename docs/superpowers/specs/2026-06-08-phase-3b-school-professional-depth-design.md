# Phase 3B — School Professional Depth (single-school) — Design

**Date:** 2026-06-08
**Status:** Approved (design)
**Owner sequence:** Phase 3A (Teacher) ✅ → **Phase 3B (School/Admin)** ← this doc → Phase 3C (White-Label)
**Predecessor:** `docs/superpowers/specs/2026-06-08-phase-3a-teacher-command-center-design.md`

## 1. Problem & scope

The school-admin portal already exists but is **shallow**: `src/app/school-admin/` has ~24 pages and `src/app/api/school-admin/` ~20 routes, yet the substance is missing. Concretely:

- **Seats are recorded but never enforced.** `school_subscriptions.seats_purchased` is just a number; `school_seat_usage` is audit-only. Nothing blocks over-provisioning.
- **School-admin RBAC is orphaned.** `school_admins.role` (`institution_admin` / `principal` / `vice_principal` / `academic_coordinator`) is not mapped into the RBAC `RoleName` union or scoped in `hasPermission()`. Only a partial `institution_admin` branch exists (`src/lib/rbac.ts:251`) with the `INSTITUTION_*` permission trio (`rbac.ts:673-675`).
- **No school-wide academic rollup.** Phase 3A produced per-class mastery/Bloom data; nothing aggregates it to the principal level.
- **Bulk provisioning is ad-hoc.** CSV import validates fields in the UI parser but never checks seat capacity.

**Scope decision (user-approved):** **single-school depth**. The unit is the **school** (already the tenant root — there is no `organizations` table and we are not adding one). True multi-school chains / org hierarchy are deferred to Phase 3C / white-label tenancy.

**Goal:** deepen the existing principal/admin portal into a professional-grade tool, mirroring the Phase 3A pattern (take a shallow portal → unified Command Center + sequenced flag-gated waves → detect/provision/govern/report).

## 2. Non-goals

- No `organizations`/`institutions` parent entity above `schools`.
- No cross-school seat pooling or aggregated multi-school reporting.
- No changes to the quiz, scoring, XP, or anti-cheat paths (P1/P2/P3 provably zero-diff).
- No pricing/plan SKU changes. Seat **enforcement** is in scope (Wave B, approval-gated); seat **pricing** is not.
- No white-label copy/branding variants (that is Phase 3C).

## 3. Architecture

A unified **School Command Center** as the admin home (`src/app/school-admin/`), with navigation consolidated from ~24 entries to **5 sections**:

```
Overview   · Command Center home (Wave A)
People     · Students, Teachers, Parents, Staff/RBAC (Waves B, C)
Academics  · Classes, Exams, Content, School-wide reports (Wave D)
Billing    · Subscription, Seats, Invoices (Wave B)
Settings   · Branding, Modules, AI config, API keys, Audit log
```

**Principles carried from 3A:**

- **Flag-gated, default OFF.** Each wave behind its own `ff_*` flag in `src/lib/feature-flags.ts` (`FLAG_DEFAULTS = false`). Client hooks sync-paint DEFAULT_OFF with a 1h localStorage cache. **Flag-OFF must be byte-identical to today's portal.**
- **Read-server-of-record reuse.** School-scoped reads extend the existing `supabase/functions/teacher-dashboard/` patterns (or a sibling) and Postgres RPCs. No API route writes learner state (ADR-005 canonical-writer rule).
- **Scoping.** Every read/write authorized via `authorizeRequest(...)` (P9) and gated to the caller's school through `school_admins` membership + roster joins. RLS school-gated on every new table and view (P8).
- **No quiz path touched.** Verified per wave by `git diff origin/main -- src/lib/xp-rules.ts src/lib/score-config.ts src/lib/quiz/submit-side-effects.ts` returning empty.

## 4. Waves

### Wave A — School Command Center (autonomous, read-only)

**What:** The org-scoped admin home. Rolls up the whole school:
- **Classes at-risk** — aggregates the Phase 3A teacher alert signals across every class in the school.
- **Teacher engagement** — who is grading, who is assigning remediation, last-active.
- **Seat utilization** — current `active_students` vs `seats_purchased` (display only; enforcement is Wave B).
- **Weekly academic signal** — school-wide mastery trend + completion.
- **Nav consolidation** — ~24 → 5 sections.

**Server reads (RPCs, read-only):** `get_school_overview`, `get_classes_at_risk`, `get_teacher_engagement`. No writes. No new permission — reuses `institution.view_analytics` + `school_admins` membership.

**Approval:** none (autonomous). **Schema:** none (read-only). **Flag:** `ff_school_command_center`. **Catalog:** REG-96.

### Wave B — Seat-aware provisioning + enforcement (APPROVAL GATE: P11)

**What:**
- Bulk CSV import validated against `seats_purchased`; over-provisioning blocked with a clear error.
- Live seat enforcement: `school_seat_usage` becomes a real, maintained projection; a `check_seat_availability` RPC guards enrollment.
- Deactivating a student frees a seat.
- Invite codes are seat-bounded.

**Approval gate (before building):** seat-limit behavior touches plan access (P11). I will present two policies for the user to choose:
- **Hard block** — enrollment refused at the seat ceiling.
- **Soft warn + grace** — over-limit allowed up to a grace %, flagged to the admin + super-admin, with a remediation window.

**Approval:** **YES** (P11). **Schema:** 1 migration — idempotent, self-contained, no forward-refs to archived `_legacy/` tables (replays clean on fresh Supabase Preview). **Flag:** `ff_school_provisioning`. **Catalog:** REG-97.

### Wave C — School-admin RBAC depth (APPROVAL GATE: RBAC additions)

**What:**
- Wire the orphaned `school_admins.role` enum into the permission system with real scoping:
  - `principal` → full school scope
  - `vice_principal` → full school scope minus billing/contract destructive ops
  - `academic_coordinator` → academics + reporting, no billing/staff management
  - `institution_admin` → existing multi-school-admin semantics, scoped to the school
- Staff management UI: invite / assign / revoke school-admin roles within the school.

**Approval gate (before building):** I will present the exact role → permission matrix (which `INSTITUTION_*` / `class.*` / `report.*` / billing permissions each role gets) for explicit approval before any migration. No permission is granted without sign-off.

**Approval:** **YES** (RBAC additions). **Schema:** 1 grants migration (idempotent). **Flag:** `ff_school_admin_rbac`. **Catalog:** REG-98.

### Wave D — School-wide academic reporting (autonomous, read-only)

**What:**
- Roll up Phase 3A Bloom/mastery data to the school level: per-grade, per-subject, per-teacher comparatives. Mastery read verbatim from `bkt_mastery_state.p_know`; Bloom from `quiz_responses.bloom_level` (no recomputation — same sources Phase 3A Wave C used).
- Board/parent-ready exports (CSV + PDF), scoped and PII-safe.

**Server reads (RPCs):** `get_school_mastery_rollup`, `get_school_bloom_summary`, `export_school_report`. No new permission — reuses `report.view_class` aggregated + `institution.view_analytics`.

**Approval:** none (autonomous, read-only). **Schema:** none. **Flag:** `ff_school_reports_depth`. **Catalog:** REG-99.

## 5. Data flow

```
Wave A:  school_admins (membership) ─┐
         classes / class_students ───┼─► get_school_overview / get_classes_at_risk
         teacher_remediation_assignments (3A) ─► get_teacher_engagement ─► Command Center UI
         school_seat_usage (display only) ──────┘

Wave B:  bulk CSV ─► validate vs school_subscriptions.seats_purchased
         enroll/invite ─► check_seat_availability RPC ─► allow|block (per approved policy)
         deactivate student ─► school_seat_usage projection refresh

Wave C:  school_admins.role ─► RBAC RoleName mapping ─► hasPermission() scoping
         staff management UI ─► assign/revoke (authorizeRequest gated)

Wave D:  bkt_mastery_state.p_know  ─┐
         quiz_responses.bloom_level ┼─► get_school_mastery_rollup / get_school_bloom_summary
         classes / class_students ──┘    ─► report UI + export_school_report (CSV/PDF)
```

## 6. Error handling

- **Seat limit reached (B):** structured error per approved policy (hard 409 / soft 200+warning flag). Never a silent partial import — CSV import is all-or-validated-rows with a per-row error report.
- **No-data states:** every rollup uses the Phase F `DataState` pattern (`live | no_data | table_missing | partial`) so the UI never fakes green numbers.
- **Cross-school access:** any read/write outside the caller's school → 403 (roster/membership join returns empty → authorize fails).
- **Flag OFF:** all new endpoints behave as if absent; existing portal unchanged.

## 7. Invariants & risk

| Invariant | How preserved |
|---|---|
| P1/P2/P3 score/XP/anti-cheat | No quiz path touched; per-wave empty-diff check. |
| P5 grades-as-strings | All grade values `"6"`–`"12"`. |
| P7 bilingual | All new UI strings Hi/En via `AuthContext.isHi`. |
| P8 RLS | Every new table/view RLS-enabled + school-gated in the same migration. |
| P9 RBAC | `authorizeRequest(...)` on every new route; Wave C adds scoping, never bypass. |
| P10 bundle | Reports lazy-loaded (`next/dynamic`); Command Center within budget. |
| P11 payment integrity | Isolated to Wave B behind explicit approval gate; seat enforcement written atomically, idempotent. |
| P13 privacy | Exports scoped to school; no PII in logs; logger redaction intact. |

**Schema-reproducibility:** Waves A & D add no migrations (zero risk). Waves B & C each add one idempotent, self-contained migration with no forward-references to archived `_legacy/` tables, so they replay cleanly on fresh Supabase Preview branches — sidestepping the known incomplete-baseline blocker. The baseline-regen effort (needs prod `SUPABASE_ACCESS_TOKEN`) remains a separate standing item and is **not** a blocker for 3B.

## 8. Testing

- Per wave: unit (RPC contract + scoping), integration (cross-school 403), and a regression-catalog entry (REG-96…99).
- Flag-OFF byte-identical assertion per wave.
- Wave B: seat-policy enforcement tests for both hard-block and soft-warn branches (whichever is approved).
- Wave C: role→permission matrix tests (principal/vice_principal/academic_coordinator/institution_admin) + negative tests (coordinator cannot touch billing).
- Wave D: rollup math parity vs Phase 3A per-class sources; export PII-scoping test.
- Full suite green; P10 bundle check; review chain per P14 (architect/backend/frontend → assessment → testing → quality; backend+architect for Wave B payment-adjacent; architect for Wave C RBAC).

## 9. Sequencing

A (autonomous, ships end-to-end) → **B (pause for P11 seat-policy approval)** → **C (pause for RBAC matrix approval)** → D (autonomous, ships end-to-end). Each wave is its own PR, flag-gated, default OFF.

## 10. Regression catalog

| ID | Wave | Asserts |
|---|---|---|
| REG-96 | A | School Command Center rollup correctness + flag-OFF byte-identical + cross-school 403 |
| REG-97 | B | Seat enforcement (approved policy) + bulk-import seat validation + idempotent projection |
| REG-98 | C | School-admin role→permission scoping + negative (coordinator ∌ billing) |
| REG-99 | D | School rollup parity vs 3A sources + export PII-scoping |

Total catalog after 3B: 63 (after 3A) → **67**.
