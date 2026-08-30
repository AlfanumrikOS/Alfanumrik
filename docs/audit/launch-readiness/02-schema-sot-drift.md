# 02 — Schema & Source-of-Truth Drift

**Audit date:** 2026-08-29/30
**Evidence source:** Source-of-truth drift agent (completed), Grade encoding agent (completed)

---

## 1. Generated Types Status

**File:** `apps/host/src/types/database.types.ts`
- Last regenerated: commit `5e49069a` (2026-08-27) — **3 days stale**
- 7 new migrations landed after that commit without regenerating types
- 4 analytics objects missing (materialized views in `analytics` schema — may be intentional)

**Critical finding: Generated types are dead infrastructure.** Only ONE file in the entire codebase imports from `database.types.ts` — `apps/host/src/infrastructure/database/index.ts`, which re-exports `Database` and `TypedSupabaseClient`. Zero application files use the `Database["public"]["Tables"]["tablename"]["Row"]` pattern. All application code uses hand-written types from `packages/lib/src/types.ts` or `packages/lib/src/domains/types.ts`.

---

## 2. Manual Type Drift

Two primary hand-written type files, neither referencing generated types:

### `packages/lib/src/types.ts` (~700 lines, 35+ entity interfaces)

| Entity | Field | Manual type | Generated type | Issue |
|--------|-------|-------------|----------------|-------|
| `Student` | `is_demo` | `boolean \| null` | `boolean` (non-null) | Nullable mismatch |
| `Student` | ~30 columns | absent (`date_of_birth`, `father_name`, `school_id`, `freezes_available`, `promotion_status`, …) | present in DB | STALE |
| `Student` | `last_device_hash`, `device_change_count` | present | absent from DB | ORPHANED |
| `Subject` | `display_order`, `icon`, `color`, `is_active` | non-null | nullable | Nullable mismatch |
| `FeatureFlag` | `wave`, `metadata`, `target_environments`, … | absent | present in DB | STALE |
| `BloomProgression` | Shape | per-level rows with `mastery: number` | per-concept rows with 6 separate mastery columns | **MAJOR STRUCTURAL CONFLICT** |
| `AuditLog` | `status` | `'success' \| 'failure' \| 'denied'` (non-null) | `string \| null` | Type and nullability conflict |
| `AdminUser` | `email` | `string \| null` | `string` (non-null) | Nullable mismatch |

`packages/lib/src/domains/types.ts` (~730 lines) defines a parallel camelCase entity set with duplicate `Student`, `TopicMastery`, `KnowledgeGap`, `AdminUser`, etc. — no cross-reference to generated types or the snake_case types in `types.ts`.

---

## 3. Grade Encoding Violations (P5 rule from CLAUDE.md)

**Rule:** Grades MUST be strings `"6"` through `"12"`, never integers. Canonical constant: `packages/lib/src/constants.ts:3` — `export const GRADES = ['6','7','8','9','10','11','12'] as const`.

### SQL schema violations (live, in production)

| File | Columns | Type |
|------|---------|------|
| `supabase/migrations/00000000000000_baseline_from_prod.sql:12352-12353` | `narrative_templates.min_grade`, `narrative_templates.max_grade` | `integer` (DEFAULT 6/10) |
| `supabase/migrations/20260816000007_create_get_learning_source_rpc.sql:20` | `p_grade` RPC parameter | `integer` (later fixed by 20260820000101 to `text`) |

`narrative_templates.min_grade/max_grade` remain integers in the database — confirmed by generated types: `max_grade: number`, `min_grade: number`.

### TypeScript type violations

| File | Line | Violation |
|------|------|-----------|
| `packages/ui/src/navigation/nav-config.ts` | 465 | `grade?: number` in `StudentNavCapabilities` — comment acknowledges P5 but violates it |

### parseInt/Number() call sites (22+ production files)

| File | Line | Code |
|------|------|------|
| `supabase/functions/_shared/mol/use-cases.ts` | 124 | `parseInt(context.grade \|\| '0', 10)` |
| `supabase/functions/_shared/mol/classifier.ts` | 48 | `parseInt(grade, 10) \|\| 0` |
| `supabase/functions/ncert-solver/index.ts` | 835 | `parseInt(grade) \|\| 9` |
| `supabase/functions/bulk-question-gen/index.ts` | 219 | `Number(grade)` |
| `supabase/functions/bulk-non-mcq-gen/index.ts` | 197–198 | `Number(grade)` |
| `packages/lib/src/exam-engine.ts` | 72, 211 | `parseInt(grade) \|\| 9` (×2) |
| `packages/lib/src/quiz-engine.ts` | 377 | `parseInt(grade) \|\| 9` |
| `packages/lib/src/ncert-solver.ts` | 165 | `parseInt(q.grade)` (×2 inline) |
| `packages/lib/src/foxy/math-step-density.ts` | 32 | `Number.parseInt(grade, 10)` |
| `packages/lib/src/ai/validation/output-guard.ts` | 149 | `parseInt(context.grade, 10)` |
| `packages/lib/src/ai/validation/content-guard.ts` | 60 | `parseInt(grade, 10)` |
| `packages/lib/src/learn/build-rhythm-queue.ts` | 266 | `parseInt(String(...grade), 10)` |
| `packages/lib/src/sanitize.ts` | 112 | `typeof grade === 'string' ? parseInt(grade, 10) : grade` |
| `packages/ui/src/navigation/DesktopSidebar.tsx` | 46 | `parseInt((auth as any)?.student?.grade ?? '6', 10)` |
| `packages/ui/src/navigation/MobileBottomNav.tsx` | 87 | `parseInt(student?.grade ?? '6', 10)` |
| `packages/ui/src/navigation/NavMoreSheet.tsx` | 82 | `parseInt(student?.grade ?? '6', 10)` |
| `packages/ui/src/navigation/TabletNavRail.tsx` | 138 | `parseInt(student?.grade ?? '6', 10)` |
| `apps/host/src/app/api/content/diagram/route.ts` | 155 | `Number.parseInt(grade, 10) >= 11` |
| `apps/host/src/app/(student)/profile/page.tsx` | 446–447 | `parseInt(student.grade)`, `parseInt(editGrade)` |
| `apps/host/src/app/api/school-admin/reports/route.ts` | 156 | `parseInt(a.grade) - parseInt(b.grade)` |
| `apps/host/src/app/api/teacher/remediation/route.ts` | 168–169 | `Number(match[1])` → numeric range check |
| `apps/host/src/app/api/super-admin/institutions/bulk-onboard/route.ts` | 163–164 | `Number(row.grade_range_min/max)` |

**Assessment:** The P5 rule is pervasively violated. Every layer of the stack (Edge Functions, shared lib, UI components, API routes) parses grades to integers for numeric comparisons. The enforcement at the boundary (P5 check in sanitize.ts) is correct, but internal contracts use integers throughout.

---

## 4. Role/Permission Hardcoding

**6+ conflicting role type definitions**, none sourced from the `roles` DB table:

| File | Line | Type name | Roles included |
|------|------|-----------|----------------|
| `packages/lib/src/types.ts` | 573 | `RoleName` | student, parent, teacher, **tutor**, admin, super_admin |
| `packages/lib/src/constants.ts` | 100 | `UserRole` | student, teacher, **guardian**, institution_admin, **none** |
| `packages/lib/src/AuthContext.tsx` | 27 | `UserRole` | student, teacher, **guardian**, institution_admin, **none** |
| `packages/lib/src/identity/constants.ts` | 29 | `VALID_ROLES` | student, teacher, **parent**, institution_admin |
| `supabase/functions/account-purge/index.ts` | 46 | `AccountRole` | student, teacher, **parent** |
| `packages/lib/src/middleware-helpers.ts` | 28 | `MiddlewareRole` | student, teacher, guardian, institution_admin, admin, super_admin |
| `supabase/functions/_shared/security/types.ts` | 2 | `SecurityRole` | student, parent, teacher, school_admin, internal_service |

Key conflicts:
- **"tutor"** exists only in `types.ts:RoleName` — not in the DB or any other definition
- **"guardian" vs "parent"** — `constants.ts`/`AuthContext` use "guardian"; `identity/constants.ts`/`account-purge` use "parent" for the same role
- **"none"** is not a DB role but appears in application role types
- Role-to-table mapping (`role === 'guardian' ? 'guardians' : 'students'`) is duplicated in at least 6 files

---

## 5. Feature Flag Drift

**140 declared flags**, 41 enabled in production, 99 disabled. Flag posture canary watches only ~40 of 140.

**DB-15 (NOT-STARTED):** 3 flags documented OFF but reportedly ON in production:
- `ff_adaptive_remediation_v1`
- `ff_adaptive_loops_bc_v1`
- `ff_school_pulse_v1`

**24 flags** where `defaultEnabled` differs from `productionEnabled` (all in `feature-flag-matrix.overrides.json`).

**Dual evaluator divergence (intentional but risky):**
- Web evaluator (`packages/lib/src/feature-flags.ts`): fails **OPEN** without userId
- Edge evaluator (`supabase/functions/_shared/mol/feature-flag.ts`): fails **CLOSED** without student_id
- Comment on Edge evaluator line 71–75 says "INTENTIONAL divergence... Do not 'align' the two"
- Same flag can evaluate to different values on web vs Edge — a class of silent bugs

---

## 6. Summary of New Findings

| ID | Severity | Finding |
|----|----------|---------|
| SOT-01 | P2 | Generated types are dead — all app code uses hand-written types that drift freely |
| SOT-02 | P2 | `BloomProgression` manual type has fundamentally wrong shape vs DB schema |
| SOT-03 | P2 | `narrative_templates.min_grade/max_grade` are INTEGER columns — P5 violation at schema level |
| SOT-04 | P2 | 22+ files parse grade strings to integers — pervasive P5 violation throughout stack |
| SOT-05 | P2 | 6+ conflicting `RoleName`/`UserRole` definitions; "tutor" role exists nowhere except `types.ts` |
| SOT-06 | P2 | "guardian" vs "parent" naming split across role definitions |
| SOT-07 | P2 | DB-15: 3 feature flags documented OFF are reportedly ON in production — NOT-STARTED |
| SOT-08 | P3 | Dual feature flag evaluator with different fail-open/fail-closed semantics |
| SOT-09 | P3 | Feature flag canary watches only 40/140 flags — structural blind spot |
| SOT-10 | P3 | Generated types regeneration not automated — 3 days stale after 7 migrations |
