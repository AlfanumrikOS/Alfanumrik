# Subject Governance — Replace Ad-Hoc Subject Lists with a DB-Backed Governance Layer

## Summary

Students were seeing subjects not valid for their grade or subscription plan because the platform had **no subject governance schema**. Grade→subject rules lived as hardcoded TypeScript constants (`src/lib/constants.ts:GRADE_SUBJECTS`, duplicated in `mobile/.../grade_subjects.dart`). Plan→subject rules existed **only as marketing strings** in `plans.ts`. `students.preferred_subject` and `students.selected_subjects` were free-form with zero constraints. `PATCH /api/student/preferences set_selected_subjects` wrote arbitrary arrays verbatim. **Only `/learn` was correctly gated.**

This PR introduces a governance schema (`grade_subject_map`, `plan_subject_access`, `student_subject_enrollment`, `legacy_subjects_archive`), a service layer (`src/lib/subjects.ts` + `useAllowedSubjects` hook), DB-level enforcement (trigger + FK), defense-in-depth API validation, and an auditable data-cleanup migration. Every student-facing UI surface now reads subjects from the single governance contract.

## By the numbers

- **51 commits** on `feat/subject-governance` since base `bd74ddf`
- **8 new migrations** (4 schema + RPCs + trigger + seed, 3 data cleanup, 1 follow-up RLS fix)
- **4 new DB tables**, 4 column additions, 2 new RPCs, 1 trigger (FK added `NOT VALID`, validated in enable migration)
- **17 canonical subjects** with Hindi names + `subject_kind` classification (`cbse_core` | `cbse_elective` | `platform_elective`)
- **1 new service module** (`src/lib/subjects.ts`) + typed hook + `GET /api/student/subjects`
- **17 API routes** hardened with `validateSubjectWrite` / `validateSubjectsBulk`
- **7 Edge Functions** hardened (foxy-tutor, ncert-solver, quiz-generator, cme-engine, parent-portal, teacher-dashboard, export-report) + new `_shared/subjects-validate.ts`
- **1 security fix**: `/api/concept-engine` `chapter`/`search` actions now require `content.read` authz (was unauthenticated)
- **~27 UI surfaces** migrated to `useAllowedSubjects()` hook
- **1 new ESLint rule** (`alfanumrik/no-raw-subject-imports`) enforcing the single-source contract
- **5 new super-admin pages** (subjects master, grade-map, plan-access, violations, student detail) + 7 new admin APIs
- **1 Flutter mobile migration** (deleted `grade_subjects.dart`, added `subjectsProvider`)
- **18 new regression test cases** + **3 Playwright E2E scenarios** + **6 regression-catalog entries**
- **Tests: 2250/2250 pass** (0 failures)
- **Type-check: clean** | **Lint: 0 errors** (26 pre-existing warnings unchanged)

## Test plan

- [ ] **Supabase staging**: `supabase db push` to apply migrations 01→04 (schema + RPCs + trigger DISABLED + seed)
- [ ] **Verify seed**: `SELECT grade, stream, COUNT(*) FROM grade_subject_map GROUP BY 1,2` → expect the seed distribution (6→6, 7→6, 8→6, 9→7, 10→7, 11 sci/com/hum + 12 sci/com/hum)
- [ ] **Verify plan allowlists**: `SELECT plan_code, COUNT(*) FROM plan_subject_access GROUP BY 1` → free=5, starter=10, pro=16, unlimited=17
- [ ] **Deploy preview** to Vercel; smoke-test `/api/student/subjects` returns correct intersection for a grade-6 free-plan test user
- [ ] **Apply F1 (detection) to staging**: review `admin_audit_log` for `subject.legacy_violation.detected` row count; record the distribution
- [ ] **Apply F2 (repair) to staging**: spot-check 5 affected students — their enrollment matches `get_available_subjects`, archive populated, no `preferred_subject` dropped unnecessarily
- [ ] **Apply F3 (enable) to staging**: confirm trigger active (try inserting an invalid enrollment; expect 23514 `check_violation`); confirm `question_bank.subject_fk` validated
- [ ] **E2E staging**: run `npm run test:e2e -- subject-governance.spec.ts` — 3 scenarios pass
- [ ] **Legacy-user UX on staging**: pick 3 archived-repair students, log in as them, see ReselectBanner if enrollment empty, pick subjects, dashboard updates
- [ ] **Production rollout**: apply F1 → 24h audit review → F2 → 24h parent-portal `stale_subjects` drops to 0 → F3 → merge + deploy app
- [ ] **Mobile Play Store build**: run `flutter analyze` + `flutter test` on mobile CI; smoke-test subject picker on Android (cold-start → `/api/student/subjects` → correct intersection)

## Critical rollout sequence (DO NOT SHIP OUT OF ORDER)

```
1. Merge this PR to main
2. supabase db push (migrations 01-04 apply: schema + RPCs + trigger DISABLED + seed)
3. Vercel production deploy of the app picks up new code
   — new code reads from the seeded DB governance tables
   — old code paths (legacy `selected_subjects`) keep working because trigger is still DISABLED
4. Observe production for 2-4 hours; parent-portal `stale_subjects` response field should start populating for affected users
5. Apply migration 05 (detect) — writes audit rows, no user impact
6. Wait 24h; ops reviews violation distribution in admin_audit_log
7. Apply migration 06 (repair) — moves invalid subjects to legacy_subjects_archive, syncs enrollment cache
8. Wait 24h; confirm parent-portal stale_subjects field empty for all students
9. Apply migration 07 (enable) — turns on enforcement trigger; validates question_bank.subject FK
10. Apply migration 08 (RLS fix) — closes the P8 gap on legacy_subjects_archive (safe to apply earlier if preferred)
```

Applying 05-07 before the Vercel deploy **will not break anything** (the new code is backward-compatible with the legacy free-form `selected_subjects` while the governance tables populate), but the staged sequence above minimizes observable anomalies and gives ops a 24h checkpoint per data-moving step.

## Known follow-ups (not in this PR)

1. **RBAC permission `super_admin.subjects.manage`** — not added to `src/lib/rbac.ts` registry. New admin routes currently use `authorizeAdmin` (existing session pattern). Follow-up: architect adds the permission + tightens routes in one sweep. Requires user approval per CLAUDE.md.
2. **`exec_admin_query` RPC** — violations API has a per-student RPC fallback (capped at `limit*5`). For production scale, add a `SECURITY DEFINER` admin-only `exec_admin_query(text, anyarray)` to enable the fast CTE path.
3. **Teacher-scoped subjects service** — 5 teacher-portal files + `AuthScreen.tsx` retain compat imports with justified `eslint-disable` lines. A `useTeacherAllowedSubjects()` backed by `teachers.subjects_taught` would eliminate these.
4. **P10 Turbopack reconciliation** — independently discovered during this PR's quality gate: Shared JS 168 kB and Middleware 133.1 kB are over budget on **both `main` and this branch** (branch delta: +0.3 kB, noise level). The old CI bundle-size check was measuring a 221-byte stub after the Next.js 16 / Turbopack migration, masking the regression. Separate architect task: slim the Upstash Redis / `@supabase/ssr` middleware imports or recalibrate P10 for Turbopack chunking. Requires user approval (P10 is a product invariant).
5. **`src/app/super-admin/students/[id]/page.tsx`** was cherry-created on this branch (originally on `feature/observability-console`). Resolve merge conflict when that branch lands.
6. **`src/app/api/quiz/ncert-questions/route.ts`** was listed in the plan but does not exist on this branch (likely on `main` only). Placeholder test added; Phase C validation pattern is ready to apply when the file re-enters the branch.
7. **Compat-shim removal** — `src/lib/constants.ts` currently re-exports static fallbacks with `@deprecated` JSDoc + dev-only console.warn. Remove in the next release after all consumers (including mobile) have migrated.

## Files changed — high-level

**New** (~50 files)
- 8 SQL migrations in `supabase/migrations/`
- 5 service / hook / type files in `src/lib/`
- 1 new API route (`/api/student/subjects`)
- 5 super-admin pages + 7 APIs
- 4 new components (StreamStep, SubjectStep, ReselectBanner, useSubjectLookup helper)
- 9 new test files (unit, integration, regression, E2E, provider)
- 3 new Dart files (mobile)
- 1 ESLint plugin
- 1 regression catalog

**Modified**
- ~17 API routes (subject validation added)
- 7 Edge Functions (subject validation added)
- ~20 UI files (pickers migrated to hook)
- `src/lib/constants.ts` → compat shim
- `.eslintrc.json` (plugin registered)
- 3 Flutter screens

**Deleted**
- `mobile/lib/core/constants/grade_subjects.dart`

## Review chain (per P14)

- ✅ **architect** — schema + RLS + FK + trigger + RPCs (Phases A, F, plus the RLS fix)
- ✅ **backend** — 17 API routes + admin APIs + security fix on concept-engine (Phases B, C, E, I)
- ✅ **frontend** — 27 UI surfaces + onboarding stream step + banner + compat shim + ESLint rule + admin pages (Phases D, E)
- ✅ **assessment** — canonical 17-subject list + grade×stream×plan matrix + CBSE correctness
- ✅ **ai-engineer** — 7 Edge Functions hardened including parent-portal stale-subject filtering (Phase C6)
- ✅ **ops** — super-admin governance surface (requirements)
- ✅ **mobile** — Flutter provider migration (Phase G)
- ✅ **testing** — 18 regression cases + 3 E2E scenarios + catalog entries (Phase H)
- ✅ **quality** — full review; 3 blockers raised, 2 fixed, 1 acknowledged as pre-existing platform issue (Phase I)

## Spec + plan

- Spec: `docs/superpowers/specs/2026-04-15-subject-governance-design.md`
- Plan: `docs/superpowers/plans/2026-04-15-subject-governance.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)