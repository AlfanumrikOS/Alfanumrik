# School-Admin Portal — Demo QA Checklist

> **Scope**: Post-remediation QA pass for the `/school-admin` portal on branch
> `feat/portal-rbac-saas-remediation`. Verifies that the portal is hard-wired to the
> single **purple "School Command Center"** UI and that every nav surface either works,
> shows a clean empty/error state, is correctly flag-gated, or is explicitly blocked on
> pending operator action against the live DB.
>
> **Owner**: ops. **Last updated**: 2026-06-16.
>
> **DB STATUS — VERIFIED 2026-06-16**: The DB layer has now been **APPLIED and VERIFIED
> against the live DB** (project `shktyoxqhundlvkiwguu`). The 3 Command Center read-model
> RPCs (`get_school_overview`, `get_classes_at_risk`, `get_teacher_engagement`) were
> missing on the live DB — migration `20260614000000` was marked APPLIED but its body
> never executed ("repair-skip"). They have now been created on the live DB
> (`CREATE OR REPLACE`, idempotent); `teacher_remediation_assignments` and all other
> required tables already existed. Two demo schools with active admins were seeded, and
> end-to-end verification through the real `is_school_admin_of` guard confirms the
> Command Center widgets return data (or clean empty states), not errors. See
> [Verified results (2026-06-16)](#verified-results-2026-06-16). _History: this section
> previously read "pending DB verification" because the read-model RPCs were suspected
> repair-skipped on the live DB; that has now been confirmed and remediated._

---

## 1. Nav audit

Source of truth for the nav: `src/app/school-admin/_components/ConsolidatedSchoolNav.tsx`
(purple `ConsolidatedSchoolNav`, 5 sections). Status legend:

- **WORKING** — verified to render with its own loading/error/empty states.
- **EMPTY STATE** — load-state-safe; renders a clean empty/no-data state when there is nothing to show.
- **WORKING (verified 2026-06-16)** — Phase 3B read-model RPCs applied + verified against the live DB; widgets return data (or clean empty states), not 500s.
- **FLAG-GATED** — only renders when a feature flag (and sometimes a role) is ON; default-OFF means hidden.
- **NOT BUILT** — no implementation on disk.

| Nav Item | Route | Flag / Module gate | Status | Notes |
|---|---|---|---|---|
| **Overview** | | | | |
| Command Center | `/school-admin` | — (sole home; legacy toggle removed) | WORKING (verified 2026-06-16) | Overview / Classes-at-risk / Teacher-engagement widgets call `get_school_overview`, `get_classes_at_risk`, `get_teacher_engagement`. The 3 RPCs were repair-skipped on the live DB and have now been created there (`CREATE OR REPLACE`); verified end-to-end through `is_school_admin_of` — `get_school_overview` non-null, `get_classes_at_risk` 3 rows, `get_teacher_engagement` 3 rows, `get_school_dashboard_stats` total_classes=3 / total_teachers=3 / total_students=12. Page shell, header, language toggle, sign-out, school-picker, and per-widget Retry/empty states present and safe. `avg_mastery` is null (no `concept_mastery` data yet) → mastery widget shows an empty state, not an error. School Pulse summary remains **FLAG-GATED** (`ff_school_pulse_v1` OFF) — unchanged. |
| **People** | | | | |
| Students | `/school-admin/students` | — | Pending DB verification | Roster screen. Has its own load/error/empty handling; live data depends on demo seed. |
| Teachers | `/school-admin/teachers` | — | Pending DB verification | Roster screen. Live data depends on demo seed (3 demo teachers). |
| Parents | `/school-admin/parents` | — | WORKING | Fixed this pass: try/finally + admin-error card + empty state + 8s timeout backstop. No longer skeletons forever. Empty state points admins to the school invite code. |
| Enrollment | `/school-admin/enroll` | — | Pending DB verification | Enrollment surface; live counts depend on demo seed + class rosters. |
| Invite Codes | `/school-admin/invite-codes` | — | Pending DB verification | Invite-code management. |
| Staff | `/school-admin/staff` | `ff_school_admin_rbac` (rbacOnly) + `manage_staff` capability | FLAG-GATED | Only renders when `ff_school_admin_rbac` is ON; further hidden for roles lacking `manage_staff`. Hidden by default. |
| Roles & Access | `/school-admin/rbac` | — | Pending DB verification | Role/access management surface. |
| **Academics** | | | | |
| Principal Assistant | `/school-admin/ai-assistant` | `ff_principal_ai_v1` (principalAiOnly) + role `principal` | FLAG-GATED | Renders only when `ff_principal_ai_v1` is ON AND caller is a principal. Route 404s (flag off) / 403s (non-principal) server-side regardless. Hidden by default. |
| Classes | `/school-admin/classes` | — | Pending DB verification | Class list; live data depends on demo seed (3 classes). |
| Exams | `/school-admin/exams` | module `testing_engine` | WORKING | Verified HAS CONTENT, with its own loading/error/empty states. Hidden if the `testing_engine` module is disabled. |
| Content | `/school-admin/content` | module `lms` | Pending DB verification | Content surface; hidden if the `lms` module is disabled. |
| Academic Reports | `/school-admin/reports` | module `analytics` | WORKING | Renamed this pass from "Reports" → "Academic Reports". 4 tabs (School Overview / Class Performance / Student Detail / Subject Gaps). Class Performance dropdown now surfaces load errors + Retry and a distinct empty hint (fixed this pass). Tab data depends on quiz activity / demo seed for non-empty numbers. |
| Board Report | `/school-admin/reports-depth` | `ff_school_reports_depth` (reportsDepthOnly) + module `analytics` | FLAG-GATED | Renamed this pass from "School Report" → "Board Report" to disambiguate from Academic Reports. Renders only when `ff_school_reports_depth` is ON; analytics module gating also applies. Read routes 404 server-side when flag off. Hidden by default. |
| Announcements | `/school-admin/announcements` | module `communication` | Pending DB verification | Announcements surface; hidden if the `communication` module is disabled. |
| **Billing** | | | | |
| Billing | `/school-admin/billing` | `view_billing` capability (when `ff_school_admin_rbac` ON) | Pending DB verification | Billing surface. With RBAC flag ON, hidden for `academic_coordinator` (lacks `view_billing`); write actions gated server-side inside the page. |
| **Settings** | | | | |
| Branding | `/school-admin/branding` | `manage` capability (when RBAC ON) | WORKING | Verified HAS CONTENT, with its own loading/error/empty states. |
| Modules | `/school-admin/modules` | `manage` capability (when RBAC ON) | WORKING | Verified HAS CONTENT, with its own loading/error/empty states. Controls the module gates above. |
| AI Config | `/school-admin/ai-config` | module `ai_tutor` + `manage` capability (when RBAC ON) | WORKING | Load-state-safe. Hidden if the `ai_tutor` module is disabled. |
| API Keys | `/school-admin/api-keys` | `manage` capability (when RBAC ON) | Pending DB verification | API-key management. |
| Audit Log | `/school-admin/audit-log` | — (view-level; ungated) | WORKING | Verified HAS CONTENT, with its own loading/error/empty states. |
| Setup | `/school-admin/setup` | `manage` capability (when RBAC ON) | WORKING | Load-state-safe. |

> **No NOT BUILT rows**: every nav item resolves to a page on disk. The "Pending DB
> verification" rows are pages whose code-level load/error/empty handling exists but
> whose live behaviour was not exercised against a seeded live DB in this pass.

---

## 2. Per-screen QA

For each screen: **Expected** behaviour, **Actual** behaviour after the remediation
fixes (code-level, as read on this branch), and **Remaining known issues**.

### 2.1 Command Center (`/school-admin`)

- **Expected**: Single purple "School Command Center" home for every school admin. KPI
  overview strip (classes / teachers / students / active / seat use / avg mastery),
  classes-at-risk rail, teacher-engagement table, and (when enabled) a School Pulse
  summary. Header subtitle reads "School overview and analytics".
- **Actual after fixes**:
  - Portal is hard-wired to `CommandCenter` (`src/app/school-admin/page.tsx` renders it
    directly). The legacy orange "Atlas" shell is deprecated to
    `_deprecated_AtlasSchoolAdmin.tsx` (not rendered); the `ff_school_command_center`
    legacy/new toggle is removed, so there is no orange↔purple flip and no first-paint
    flag race.
  - Header subtitle changed from "Read-only overview" → **"School overview and
    analytics"** (`School overview and analytics` / `स्कूल अवलोकन और विश्लेषण`).
  - Each widget has its own loading skeleton, Retry-on-error path, and a proper
    `NoDataState` (no fake green zeros). Multi-school callers get a school picker.
- **Remaining known issues**:
  - The three backing RPCs (`get_school_overview`, `get_classes_at_risk`,
    `get_teacher_engagement`) and the `teacher_remediation_assignments` table may be
    repair-skipped on the live DB → widgets may return HTTP 500 until the DB-apply
    runbook is executed. **Pending DB verification.**
  - School Pulse summary is additionally gated OFF by `ff_school_pulse_v1` (default OFF)
    AND `institution.view_analytics`; it does not mount (no `/api/pulse/school` call)
    while the flag is OFF.
  - Even after RPCs apply, at-risk / mastery columns stay 0/empty until
    `concept_mastery` rows accrue for the demo roster — expected for freshly seeded
    students.

### 2.2 Parents (`/school-admin/parents`)

- **Expected**: Parent-links list + send-message composer. Must never hang on an
  infinite skeleton; must distinguish "not a school admin" (redirect) from a load
  failure (retryable) from "no parents yet" (empty state).
- **Actual after fixes**:
  - `fetchAdminRecord` wraps the admin lookup in try/catch/finally so `loadingAdmin` is
    cleared on every path. A query error shows a retryable inline error card (no
    bounce); a genuinely missing admin record redirects to `/login`.
  - An 8s timeout backstop flips a still-spinning page to the retryable error state.
  - Empty parent list renders an `EmptyState` pointing admins to the school invite code
    (an empty list is not treated as an error).
- **Remaining known issues**: none code-level. Live parent-link rows depend on real
  parent↔child links existing; the demo seed does not create parent links.

### 2.3 Academic Reports (`/school-admin/reports`)

- **Expected**: 4 tabs — School Overview, Class Performance, Student Detail, Subject
  Gaps. Each tab handles its own loading/error/empty. The Class Performance class
  dropdown must not silently swallow load errors (e.g. a `403` for a reports-only admin
  lacking `class.manage`).
- **Actual after fixes**:
  - Page title is "Academic Reports" (matching the renamed nav item).
  - Class Performance dropdown now tracks `classOptionsError`, `classOptionsLoaded`,
    and `classOptionsLoading` separately. A failed `/api/school-admin/classes` fetch
    shows an inline error notice + **Retry** (`role="alert"`); a successful fetch with
    zero classes shows a distinct empty hint ("No classes found for this school yet.").
    The two never stack.
  - Every tab has Retry-on-error and `EmptyState` for no-data.
- **Remaining known issues**: tab numbers are zero/empty until students take quizzes
  (or the demo seed + quiz activity exist). Class Performance requires the
  `class.manage`-gated classes endpoint; a reports-only admin will see the surfaced
  error rather than a populated dropdown — by design. **Pending DB verification** for
  populated numbers.

### 2.4 Verified working screens (own load/error/empty states)

- **Exams** (`/school-admin/exams`) — HAS CONTENT, module-gated by `testing_engine`.
- **Modules** (`/school-admin/modules`) — HAS CONTENT; controls the module gates.
- **Branding** (`/school-admin/branding`) — HAS CONTENT.
- **Audit Log** (`/school-admin/audit-log`) — HAS CONTENT; view-level, ungated.
- **AI Config** (`/school-admin/ai-config`) — load-state-safe; module-gated by `ai_tutor`.
- **Setup** (`/school-admin/setup`) — load-state-safe.

- **Remaining known issues**: none specific to these screens in this pass.

### 2.5 Flag-gated screens (hidden by default)

- **Staff** (`/school-admin/staff`) — `ff_school_admin_rbac` + `manage_staff`.
- **Principal Assistant** (`/school-admin/ai-assistant`) — `ff_principal_ai_v1` + role `principal`.
- **Board Report** (`/school-admin/reports-depth`) — `ff_school_reports_depth` + module `analytics`.

- **Expected**: these entries are absent from the sidebar while their flag is OFF, and
  the routes 404/403 server-side regardless (the nav gate is UI polish only, not a
  security boundary — P9).
- **Actual after fixes**: nav filters them out by default (byte-identical-OFF). Server
  enforcement is unchanged.
- **Remaining known issues**: not exercised in the ON state during this pass.

---

## 3. Sidebar identity

- **Expected**: a single, stable identity in the sidebar brand header (no flip between
  "School Admin / S" and "Demo School / D").
- **Actual after fixes**: the identity flip is fixed via a single identity source
  feeding `ConsolidatedSchoolNav`'s `brandTitle` / `brandSubtitle`. The brand header
  renders one consistent title + initial.
- **Remaining known issues**: none code-level.

---

## 4. Blocked / pending operator action

A clean demo (real, non-zero numbers in the Command Center widgets and Reports tabs)
required the following operator steps against the target live DB. **Steps 1–3 are now
DONE and verified against project `shktyoxqhundlvkiwguu` (2026-06-16).** One optional
follow-up remains (concept_mastery data — see step 4).

### Prerequisites for a clean demo (in order)

1. **[DONE 2026-06-16] Apply + verify the Phase 3B read-model RPCs** (fixed the Command
   Center widget 500s):
   - Runbook: `docs/runbooks/school-admin-portal-db-apply.md`
   - Root cause: migration `20260614000000` was marked APPLIED in `supabase_migrations`
     but its body never executed (repair-skip), so the 3 RPCs were missing on the live
     DB. `teacher_remediation_assignments` and all other required tables already existed.
   - Action taken: the 3 RPCs were created directly on the live DB via `CREATE OR
     REPLACE` (idempotent) —
     `20260614000000_phase3b_school_command_center_read_models.sql` is the authoritative
     source for their definitions.
   - **Verified**: exactly 3 functions present — `get_classes_at_risk`,
     `get_school_overview`, `get_teacher_engagement` — and
     `to_regclass('public.teacher_remediation_assignments')` is non-null.

2. **[DONE 2026-06-16] Seed the demo schools** (so widgets/reports show numbers):
   - Two demo schools with active admins were seeded:
     - **Demo School — Demo School** (`61d15e48…`, admin `demo-school@alfanumrik.com`)
     - **Demo School — School** (`a2e40b65…`, admin `school-demo@alfanumrik.com`)
   - Each now has: **classes=3, teachers=3, students=12** (3 pre-existing + 9 demo),
     **enrollments=9, class_teacher_links=3**.
   - **Verified**: `classes >= 3`, `teachers >= 3`, `students >= 12` for both schools.

3. **[DONE 2026-06-16] Verify the widgets stop 500-ing**: a simulated admin JWT was run
   through the real `is_school_admin_of` guard. `get_school_dashboard_stats` returns
   total_classes=3 / total_teachers=3 / total_students=12; `get_school_overview` returns
   non-null; `get_classes_at_risk` returns 3 rows; `get_teacher_engagement` returns 3
   rows. Widgets render data or clean empty states, **not** errors.

4. **[OPTIONAL — remaining follow-up] Backfill `concept_mastery` data** so "classes at
   risk" and the mastery KPI reflect real mastery rather than null. `avg_mastery` is
   currently null (no `concept_mastery` rows for the demo roster yet), so those columns
   show an empty/null state — expected for freshly seeded students, not a bug. This is a
   nice-to-have for a richer demo, not a blocker.

### Notes / caveats

- The `get_school_dashboard_stats` call-site bug was fixed in code this pass
  (`{ school_id }` → `{ p_school_id }`); no migration needed (the function already
  existed). This is a code fix, not an operator action.
- After seeding, **at-risk and mastery columns remain 0/empty/null** until
  `concept_mastery` rows accrue for the demo roster (`avg_mastery` is currently null) —
  that is expected for freshly seeded students, not a bug. Backfilling that data is the
  optional step 4 above.
- **School Pulse** stays hidden regardless of the above until `ff_school_pulse_v1` is
  flipped ON (default OFF) — a separate, independent operator decision.
- Steps 1–3 are **DONE and verified against the live DB on 2026-06-16** (project
  `shktyoxqhundlvkiwguu`); Command Center widgets and dashboard stats are confirmed
  working. See [Verified results (2026-06-16)](#verified-results-2026-06-16). Reports tab
  numbers still depend on real quiz activity for non-zero values.

### Verified results (2026-06-16)

Applied + verified against the live DB (project `shktyoxqhundlvkiwguu`).

**DB layer**

- The 3 Command Center read-model RPCs were **missing** on the live DB (migration
  `20260614000000` marked APPLIED but body never executed — a repair-skip). They were
  **created** on the live DB via `CREATE OR REPLACE` (idempotent):
  `get_school_overview`, `get_classes_at_risk`, `get_teacher_engagement`.
- `teacher_remediation_assignments` and all other required tables already existed — no
  table changes needed.

**Demo schools seeded (per-school counts)**

| School | ID | Admin | classes | teachers | students | enrollments | class_teacher_links |
|---|---|---|---|---|---|---|---|
| Demo School — Demo School | `61d15e48…` | `demo-school@alfanumrik.com` | 3 | 3 | 12 (3 pre-existing + 9 demo) | 9 | 3 |
| Demo School — School | `a2e40b65…` | `school-demo@alfanumrik.com` | 3 | 3 | 12 (3 pre-existing + 9 demo) | 9 | 3 |

**End-to-end RPC outputs (via simulated admin JWT through the real `is_school_admin_of` guard)**

| RPC | Result |
|---|---|
| `get_school_dashboard_stats` | total_classes=3, total_teachers=3, total_students=12 |
| `get_school_overview` | non-null |
| `get_classes_at_risk` | 3 rows |
| `get_teacher_engagement` | 3 rows |

`avg_mastery` is **null** (no `concept_mastery` data yet) → the affected widgets show a
data/empty state, **not** an error. Backfilling `concept_mastery` is the optional
follow-up (step 4 above).

---

## 5. What was fixed in this pass (changelog)

All committed on branch `feat/portal-rbac-saas-remediation`:

- **Single purple UI**: `/school-admin` is hard-wired to the "School Command Center"
  (purple). The legacy orange "Atlas" shell was deprecated/renamed to
  `_deprecated_AtlasSchoolAdmin.tsx`; the `ff_school_command_center` legacy/new toggle
  was removed. No more orange↔purple flip and no first-paint flag race.
- **Dashboard RPC bug fixed**: `get_school_dashboard_stats` was called with
  `{ school_id }` but the function parameter is `p_school_id` → corrected to
  `{ p_school_id }`. No migration (the function already existed).
- **Command Center subtitle**: "Read-only overview" → "School overview and analytics".
- **Parents page no longer skeletons forever**: try/finally + admin-error card + empty
  state + 8s timeout backstop.
- **Reports "Class Performance" dropdown no longer silently swallows errors**: shows an
  inline error + Retry, with a distinct empty hint for the genuinely-empty case.
- **Nav reporting items disambiguated**: "Reports" → "Academic Reports";
  "School Report" → "Board Report".
- **Sidebar identity flip fixed**: the "School Admin / S" ↔ "Demo School / D" flip is
  resolved via a single identity source.
