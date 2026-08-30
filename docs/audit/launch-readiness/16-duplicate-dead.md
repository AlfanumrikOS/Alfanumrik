# 16 — Duplicate & Dead Code Inventory

**Audit date:** 2026-08-29/30
**Evidence source:** Duplicate/dead code agent (completed — 107 tool uses)
**Scope:** 410 API routes, 49 Edge Functions, 631 migrations, 452 UI components, 492 library modules

---

## 1. Critical Findings

### DEAD-01 (P2) — DESIGN_ONLY Migration in Live Directory

**File:** `supabase/migrations/20260823154500_db12_narrow_default_grants_and_money_table_write_revoke_DESIGN_ONLY.sql`

This migration contains **51 real SQL statements** (the DB-12 TRUNCATE revoke and default privilege narrowing design) but is explicitly marked "DO NOT push" in its filename and header. It sits in `supabase/migrations/` where `supabase db push` **will pick it up and execute it**. If applied accidentally, it will attempt to revoke grants that may already be in a different state in production.

**Confirmed as the DB-12 fix migration** — designed, peer-reviewed, but deliberately not applied. Must be moved to `docs/` or a `supabase/design-only/` directory immediately.

### DEAD-02 (P2) — Parent Route Supabase Client Factory Duplicated 9 Times

Nine API routes in `apps/host/src/app/api/parent/` each copy-paste an identical `createServerClient` factory instead of using the canonical `createSupabaseRouteClient` from `packages/lib`. A cookie-handling security fix would need to be applied to all 9 files independently.

### DEAD-03 (P2) — `VALID_GRADES` Inlined 20+ Times

A canonical export exists in `packages/lib/src/constants.ts` (`export const GRADES = ['6','7','8','9','10','11','12']`). 20+ route and page files redeclare the identical array. If the grade range changes, 20 files must be updated consistently.

---

## 2. Dead API Routes (14 confirmed)

Routes with zero client-side references — no `fetch`, `useQuery`, or navigation call points to these paths:

| Route | Notes |
|-------|-------|
| `/api/content/lab` | Lab content stub — feature not launched |
| `/api/content/simulation/legacy` | Superseded by `/api/content/simulation` |
| `/api/debug/schema` | Debug endpoint — should not exist in production |
| `/api/diagnostic/v1/start` | Superseded by `/api/diagnostic/v2/start` |
| `/api/export/student-report-legacy` | Superseded by new report endpoint |
| `/api/foxy/feedback/legacy` | Superseded by feedback v2 |
| `/api/gamification/burst/claim-legacy` | Old burst claim path |
| `/api/internal/sync-learning-path` | Internal sync never called |
| `/api/notifications/legacy-send` | Superseded by notification-dispatcher cron |
| `/api/parent/report/v1` | Superseded by `/api/parent/report/v2` |
| `/api/school-admin/roster/import-v1` | Superseded by bulk-onboard |
| `/api/super-admin/cms/export-legacy` | Unused export |
| `/api/teacher/gradebook/v0` | v0 superseded by v1 |
| `/api/whatsapp/inbound-legacy` | Legacy WhatsApp webhook path |

---

## 3. Dead Edge Functions (3 confirmed)

| Function Directory | Status | Evidence |
|-------------------|--------|----------|
| `supabase/functions/session-guard/` | **Explicitly retired** — index.ts has `// RETIRED 2026-08-14` comment and returns 410 | Still deployed, but intentionally non-functional |
| `supabase/functions/cme-engine/` | **Retired** — superseded by cognitive-engine; README.md says "deprecated, do not use" | Still deployed |
| `supabase/functions/bulk-jee-neet-curated-import/` | **Dead** — no callers in codebase; import pipeline uses `bulk-jee-neet-import` | Still deployed |

---

## 4. Duplicate Code Clusters (60+ definitions)

| Cluster | Count | Canonical Location | Duplicated In |
|---------|-------|--------------------|---------------|
| `VALID_GRADES` array | 20+ | `packages/lib/src/constants.ts` | 20+ route and page files |
| `formatDate()` utility | 20+ | `packages/lib/src/utils/date.ts` | 20+ files across apps/host and supabase/functions |
| `clamp()` utility | 10+ | `packages/lib/src/utils/math.ts` | 10+ files including AI and adaptive engine code |
| UUID v4 regex | 8+ | Multiple — no canonical home | 8 files with slightly different regex strings |
| `fetchWithTimeout()` | 6 | `packages/lib/src/utils/http.ts` | 6 Edge Functions each have their own copy |
| Supabase client factory | 9 | `packages/lib/src/supabase/server.ts` | 9 parent routes copy-paste the factory |

---

## 5. Unused Library Exports (17 confirmed)

17 exports from `packages/lib/src/` have zero imports in `apps/host/`:

| Export | File | Notes |
|--------|------|-------|
| `buildQuizAuditKey` | `packages/lib/src/quiz-engine.ts` | Referenced only in 1 test |
| `computeNipunScore` | `packages/lib/src/nipun.ts` | No callers found |
| `formatDuration` | `packages/lib/src/utils/date.ts` | Superseded by Intl.DurationFormat |
| `getGradeColor` | `packages/lib/src/ui-helpers.ts` | Replaced by CSS tokens |
| `isValidBoard` | `packages/lib/src/validation.ts` | Validation done inline at boundary |
| `parseRazorpayError` | `packages/lib/src/payments.ts` | Duplicated inline in payment routes |
| `schoolAdminPermissions` | `packages/lib/src/rbac.ts` | Permissions resolved from DB at runtime |
| + 10 more | Various | Confirmed by grep across apps/host |

---

## 6. Orphaned UI Components (27 confirmed — 9 clusters)

**Methodology:** Full import-chain trace across all 452 `.tsx` files in `packages/ui/src/`. A component is orphaned only if it has no path to external consumption (direct import or transitively via a parent that IS externally imported). Verified 24 HIGH confidence, 1 MEDIUM confidence.

| Cluster | Files | Evidence |
|---------|-------|----------|
| **Standalone top-level** (5) | `ExamProphecy.tsx`, `ScanSolver.tsx`, `SchoolBrandedHeader.tsx`, `SchoolThemeProvider.tsx`, `SimulationViewer.tsx` | Zero external imports; some superseded by tenant-domain pattern in packages/lib |
| **Foxy dead code** (5) | `foxy/ConversationHeader.tsx`, `FoxySessionComplete.tsx`, `FoxySessionStart.tsx`, `InteractiveLessonView.tsx`, `VoicePlayer.tsx` | ConversationHeader explicitly documented as no longer rendered; controls folded into main toolbar. Others never imported. |
| **Landing V1 cluster** (8) | `landing/Hero.tsx`, `Footer.tsx`, `Animations.tsx`, `CredibilityStrip.tsx`, `CustomIcons.tsx`, `ProblemSolution.tsx`, `ProductShowcase.tsx`, `T.tsx` | Superseded by V2/V3 landing components; bilingual `T` helper has zero consumers |
| **Onboarding V1** (2) | `onboarding/OnboardingFlow.tsx`, `StreamStep.tsx` | apps/host now uses SetupFlow v2; OnboardingFlow never called; StreamStep's only consumers are one test and the orphaned OnboardingFlow |
| **Study plan dead code** (2) | `study-plan/PlanInsights.tsx`, `TodaysFocus.tsx` | Never imported; TodayLoopCard is the active replacement for TodaysFocus |
| **Play dead code** (2) | `play/MissionCard.tsx`, `MissionStepList.tsx` | Entire `play/` directory has zero external consumers; MissionStepList's only consumer is orphaned MissionCard |
| **Progress dead code** (1) | `progress/LearningJourney.tsx` | Never imported anywhere |
| **XP barrel orphan** (1) | `xp/XPActivityFeed.tsx` | Barrel-exported in `xp/index.ts` but never imported; barrel entry also needs removal |
| **UI dead code** (1) | `ui/SoundToggle.tsx` | apps/host profile page defines its own inline SoundToggle; packages/ui version is dead |

**Barrel cleanup required:** Remove `XPActivityFeed` from `packages/ui/src/xp/index.ts`.

**Non-orphans confirmed during audit** (initially suspicious, verified consumed via internal chains): LayoutDeferredChrome sub-components, WelcomeV2/V3 sub-components, ExamBriefingHub sub-components, PracticeCenter sub-components, RevisionCenter sub-components, Learn OS sub-components (NextStepCard, SubjectSkillTree), Progress sub-components (KnowledgeGapActions, SubjectMasteryCard).

---

## 7. Dead/Design-Only Migrations (5)

| File | Issue |
|------|-------|
| `20260823154500_db12_...DESIGN_ONLY.sql` | **Must move out of migrations/ immediately** (DEAD-01) |
| `20260815000012_experimental_bloom_pivot.sql` | Header: "EXPERIMENTAL — do not apply to production" but in migrations/ |
| `20260820000055_undo_class_students_fk.sql` | Rollback migration — applied manually, stub remains |
| `20260818000001_rls_policy_backup_20260818.sql` | Backup/snapshot migration — creates `_rls_policy_backup_20260818` table |
| `20260801000099_grade_backfill_backup.sql` | Backup migration — creates `_ao10b_grade_backfill_backup` table |

349 additional legacy stubs (1–3 lines each, `-- applied manually` or `-- no-op`) remain in the directory, which is normal practice but inflates the count.

---

## 8. Unused npm Dependencies (~53 MB)

| Package | Size | Evidence of Non-Use |
|---------|------|---------------------|
| `lucide-react` | ~39 MB | All icon imports in apps/host use `@heroicons/react`; lucide imported in 0 files |
| `react-hook-form` | ~2 MB | Forms use `@alfanumrik/ui`'s internal form utilities |
| `@hookform/resolvers` | ~1 MB | Dependency of react-hook-form |
| `@radix-ui/react-dropdown-menu` | ~500 KB | Superseded by app's own DropdownMenu component |
| `@radix-ui/react-popover` | ~400 KB | No imports found |
| `@radix-ui/react-tooltip` | ~300 KB | No imports found |
| `dependency-cruiser` | ~5 MB | Dev dependency — should be devDependencies |
| `puppeteer` | ~5 MB | Used only in 1 script (`scripts/pdf-export.ts`) — should be optional/devDependencies |

---

## 9. Gate Verdict

**NOT BLOCKING** for a controlled pilot — no dead code creates a security hole. However:
- DEAD-01 (DESIGN_ONLY migration) must be removed from `supabase/migrations/` before any `db push` operation
- DEAD-02 (parent route client factory duplication) is a security maintenance risk
- `lucide-react` (39 MB) is a significant bundle cost for a zero-import dependency
