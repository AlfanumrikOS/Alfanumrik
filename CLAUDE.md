# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

### Web (Next.js)

Standard npm scripts (`npm run dev`/`build`/`lint`/`test`, etc.) — see `package.json` for the full list. Two non-obvious ones:
- `npm run type-check` runs `--workspaces --if-present`, which does **not** cover workspace-less dirs (e.g. repo-root `scripts/`) — that's what `npm run type-check:scripts` is for separately.
- Run a single test with `npx vitest run <path-to-file>` (test files live under `apps/host/src/__tests__/`, `packages/*/src/__tests__/`, `supabase/functions/**/__tests__/` — see the Testing section below).

### Mobile (Flutter)

Standard Flutter CLI from `mobile/` (`flutter pub get`, `run`, `build apk`, `analyze`, `test`) — see `mobile/pubspec.yaml`.

### Supabase Edge Functions (Deno)

Standard `supabase` CLI (`functions serve`/`deploy`, `db push`, `migration new`) — see `supabase --help`.

## Architecture Overview

**Alfanumrik Learning OS** — K-12 EdTech platform for CBSE students (grades 6-12) in India.

### Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16.2 (App Router), React 18, Tailwind 3.4, SWR |
| Backend | Next.js API routes (`apps/host/src/app/api/`) + Supabase Edge Functions (Deno, not Node.js) |
| Database | Supabase PostgreSQL with RLS, RBAC (6 roles, 71 permissions), pgvector for RAG |
| Auth | Supabase Auth (email/PKCE), JWT auto-refresh via middleware |
| Payments | Razorpay (INR subscriptions) |
| AI | Claude Haiku via Supabase Edge Functions (`ncert-solver`, `quiz-generator`, `cme-engine`) plus the Foxy Next.js route `apps/host/src/app/api/foxy/route.ts`.<br><br>**Foxy model routing (corrected 2026-08-31 — the entry below had drifted stale since the 2026-08-26 swap):** Claude-primary (`claude-haiku-4-5` → `claude-sonnet-4`), with OpenAI (`gpt-4o-mini` → `gpt-4o`) as the automatic fallback tier — CEO-approved quality-driven provider swap BACK to Claude, 2026-08-26 (reverses the 2026-08-02 OpenAI-primary swap that this line previously described). Source of truth: `MODEL_FALLBACK_ORDER` in `supabase/functions/grounded-answer/config.ts` (`MODEL_ROUTE_REV = 4`; mirrored from `LEGACY_FALLBACK_ORDER` in `packages/lib/src/ai/gateway/registry.ts`). A rollback path back to OpenAI-primary exists behind `ff_foxy_openai_primary_rollout_v1` (seeded at 0% rollout) — confusingly, its target array is still named `CLAUDE_PRIMARY_FALLBACK_ORDER` in both files (a leftover name from before the 2026-08-26 swap; its *contents* are OpenAI-primary, not Claude-primary — do not trust the identifier, read the array).<br><br>**Foxy:** the `foxy-tutor` Edge Function was retired 2026-07-01. Both web and mobile now POST to `/api/foxy` (`mobile/lib/core/constants/api_constants.dart:99-106` defaults `FOXY_ENDPOINT` to `'api'`; the `_sendViaEdge` branch in `mobile/lib/data/repositories/chat_repository.dart` is documented dead code retained so old APKs pinned to `'edge'` fail predictably).<br>**`foxy-tutor` deleted 2026-09-05** (CEO-approved, Gate-2 cleanup) — retired 66 days by then, well past any reasonable observation window for its 2026-07-01 tombstone. The prior caution here about already-installed APKs still calling it was a real, accepted risk at deletion time, not a blocker: any such APK now gets a connection failure instead of the structured 410 the tombstone previously returned.<br><br>**Quiz generators:** `quiz-generator/` is the only generator on disk; `quiz-generator-v2/` is archived under `supabase/functions/_archive/`.<br>⚠️ **LIVE LESSON — on-disk ≠ deployed.** `quiz-generator-v2` was once documented as "never live"; it was in fact deployed and ACTIVE in production (reached v35), as was `enhanced-quiz-generator` (a duplicate with no source in git). Both were tombstoned with structured 410s on 2026-07-13 (see `docs/runbooks/edge-function-drift-report.md`). **Always verify deployed state with `supabase functions list` before asserting it.** |
| Mobile | Flutter 3.16+ / Dart 3.2+, Riverpod, GoRouter — in `/mobile` (shared API contract) |
| Monitoring | Sentry (client/server/edge), Vercel Analytics |
| Deployment | Vercel (bom1/Mumbai region), GitHub Actions CI/CD |

### Key Architectural Patterns

**Path aliases** (declared in `apps/host/tsconfig.json` — there is **no root `tsconfig.json`**, so these resolve relative to `apps/host/`, verified 2026-07-17):
- `@/*` → `./src/*` = **`apps/host/src/*`** (NOT a repo-root `src/`, which does not exist)
- `@alfanumrik/lib/*` → `packages/lib/src/*` — canonical shared lib
- `@alfanumrik/ui/*` → `packages/ui/src/*` — canonical shared components

**Multi-portal app** with dedicated routes and APIs:
- Student: `/dashboard`, `/foxy` (AI tutor), `/learn`, `/progress`, `/leaderboard`, `/exams`, `/simulations`, `/dive` + `/dive/history` (Pedagogy v2 Wave 2 weekly Curiosity Dive), `/synthesis` (Pedagogy v2 Wave 3 monthly Synthesis)
- Parent: `/parent/*`
- Teacher: `/teacher/*`
- Super Admin: `/super-admin/*` (pages), `/api/super-admin/*` (API routes)
- Internal Admin: `/internal/admin/*` (pages), backed by `/api/internal/admin/*` (14 routes as of 2026-09-05 — `ai-monitor`, `bulk-action`, `command-center`, `content`, `feature-flags`, `logs`, `reports`, `revenue`, `schools`, `stats`, `support`, `support/metrics`, `users`, `users/[id]`; supersedes the stale "12 routes" figure from the 2026-08-12 directory listing, which predated `support/metrics`). **Not** `/api/v1/admin/*` — that path also exists but is a separate, narrower surface (`audit-logs`, `roles` only) and does not back the `/internal/admin` pages. Corrected 2026-08-12 (F12 audit) after this doc previously stated `/api/v1/admin/*` was the Internal Admin API. **Support tickets specifically, corrected 2026-09-05**: `/super-admin/support/tickets` (Phase 2 of the super-admin mission-control overhaul, shipped 2026-08-16 the same night as Phase 0/1 — this doc previously called it "scheduled for Phase 2" for three weeks after it had already landed) is a **complete, live capability-parity implementation** consuming the same `/api/internal/admin/support` API verbatim — it is the current working ticket queue, not an interim bridge. `/internal/admin`'s own `SupportTab` UI still exists as the legacy path (only the *support* tab of its 10 tabs has a `/super-admin` equivalent so far; the other 9 do not yet, so `/internal/admin` itself cannot be retired). `/super-admin/support` (plain, without `/tickets`) is a *different* page (user-activity/diagnostics lookups) and still does not show ticket content. See `docs/superpowers/specs/2026-08-16-super-admin-mission-control-design.md` (roadmap; §5 notes Phase 1 is NOT complete — only 3 of ~100 routes migrated to `authorizeOperator`) and `docs/superpowers/specs/2026-08-16-phase2-support-console-parity.md` (the parity analysis for the tickets page specifically).

**Three Supabase clients** (use the right one):
- `packages/lib/src/supabase.ts` — client-side, respects RLS
- `packages/lib/src/supabase-server.ts` — server components/middleware, respects RLS
- `packages/lib/src/supabase-admin.ts` — server-only, bypasses RLS (service role). **Never import in client code.**

**State management**: SWR for remote data. `AuthContext` (React Context) for auth state and `isHi` language toggle. No Redux/Zustand.

**Middleware** (`apps/host/src/proxy.ts`) (renamed from middleware.ts for Next.js 16; build-enforced by scripts/auth-guard.js): Auth validation, rate limiting (Upstash Redis with in-memory fallback), bot detection, request ID tracing, feature flags. Runs on every request.

**RBAC**: Server-side enforcement via `authorizeRequest(request, 'permission.code')` in API routes. Client-side `usePermissions()` hook is UI convenience only, not a security boundary.

**Supabase Edge Functions** (`supabase/functions/`): Deno runtime — uses `Deno.serve()`, ES module imports, no `node_modules`. Each function is a directory with `index.ts`.

**Do not quote a function count from memory — measure it:**
```bash
find supabase/functions -maxdepth 2 -name index.ts | wc -l   # functions ON DISK
ls -d supabase/functions/*/ | wc -l                          # dirs (= functions + _shared/ + _archive/)
```
As of 2026-07-28 that reads **47 on disk / 49 dirs**. This number has drifted every time it was written down (it has read 29, then 48, then 47), which is why the command is now the source of truth.

⚠️ **"On disk" is NOT "deployed" — these genuinely differ here and the difference has burned us.** `quiz-generator-v2` and `enhanced-quiz-generator` were both live in production with no matching source on disk until they were tombstoned on 2026-07-13. For any claim about what is actually *running*, run `supabase functions list` — never infer deployment state from the filesystem.

**Database migrations**: `supabase/migrations/` ordered by timestamp. Every new table must have RLS enabled and policies in the same migration file.

**`/quiz` route**: `/quiz` is a live, heavily-linked page (quiz orchestrator) — it does NOT redirect. `next.config.js`'s `headers()` includes `/quiz` in a shared route group (authenticated, per-student pages: dashboard/foxy/quiz/progress/review/study-plan/leaderboard/simulations/profile/notifications/reports/scan/exams/help) that gets a `Cache-Control: private, max-age=60, stale-while-revalidate=300` header (`private`, not `public`, since 2026-09-02 — P2-11 launch audit fix, matches the convention already used for equivalent authenticated content elsewhere, e.g. the school-admin reports API); there is no redirect entry for `/quiz` in `next.config.js`'s `redirects()`.

**Sentry tunnel**: Client errors route through `/monitoring` to bypass ad-blockers (configured in `next.config.js` Sentry options).

### Styling

Tailwind with custom brand tokens — see `tailwind.config.js` (fonts, brand colors, custom animations).

## Critical Development Rules

These are commonly violated and cause bugs:

1. **Grades are strings**, never integers. Use `"6"` through `"12"` everywhere — database, RPCs, APIs, TypeScript types.

2. **XP values live only in `packages/lib/src/xp-rules.ts`**. No hardcoded XP numbers anywhere else.

3. **Score formula is fixed**: `Math.round((correct / total) * 100)`. Must match in `submitQuizResults()`, `QuizResults.tsx`, and `atomic_quiz_profile_update()` RPC.

4. **Quiz submission is atomic** via `atomic_quiz_profile_update()` RPC — never split into separate DB operations.

5. **Anti-cheat**: Minimum 3s average per question, no all-same-answer if >3 questions, response count must equal question count. Enforced both client-side and server-side.

6. **Bilingual**: All user-facing text must support Hindi/English via `AuthContext.isHi`. Technical terms (CBSE, XP, Bloom's) are not translated.

7. **Bundle budget**: targets Indian 4G (2-5 Mbps). **The enforced caps are the constants in `scripts/check-bundle-size.mjs` — read them, do not quote a remembered number:**
   ```bash
   grep -nE '^const CAP_' scripts/check-bundle-size.mjs
   ```
   As of 2026-07-28: `CAP_SHARED_KB = 297`, `CAP_PAGE_KB = 260`, `CAP_MIDDLEWARE_KB = 120`. `CAP_SHARED_KB` is the authoritative layout-inclusive first-load total and has been ratcheted upward many times for framework/gzip baseline drift (the script header carries the full change log and per-raise rationale). P10's aspirational 160 kB baseline is a *goal*, not the gate — do not reject a change for exceeding 160 kB while `CAP_SHARED_KB` is higher.

8. **Payment integrity**: Razorpay webhook signature must be verified before processing. Subscription status changes written atomically with payment records.

9. **AI safety**: Responses from foxy-tutor/ncert-solver must be age-appropriate (grades 6-12), stay within CBSE scope, and respect daily usage limits per plan.

10. **No PII in logs**: Logger (`packages/lib/src/logger.ts`) redacts password, token, email, phone, and API keys. Never log student-identifiable data to Sentry or console.

## Testing

- **Unit tests**: Vitest with JSDOM. Tests live under `apps/host/src/__tests__/`, `packages/*/src/__tests__/`, and `supabase/functions/**/__tests__/`. Setup file: `apps/host/src/__tests__/setup.ts`.
- **Never quote a test count from memory — the pass/fail signal is vitest's own summary line.** To size the suite:
  ```bash
  # test FILES on disk
  find apps packages supabase e2e -type f \( -name '*.test.ts' -o -name '*.test.tsx' \
    -o -name '*.spec.ts' -o -name '*.spec.tsx' \) | grep -v node_modules | wc -l
  ```
  As of 2026-07-28 that reads **1,285 files**. The total *test case* count is only obtainable by running the suite (`npm test`) — `npx vitest list` does not finish collection on `apps/host` within 500s, so treat any written-down case count as unverified.
- **Coverage thresholds (current → aspirational target, reconciled 2026-04-27):**
  - Global: 35% statements / 30% branches / 35% functions / 35% lines → 60% (TODO(testing): real coverage is ~37%; ratchet upward by adding hook + util + server-helper tests — see `vitest.config.ts` lines 60-68)
  - `src/lib/xp-rules.ts`: 90% statements / 75% branches / 90% functions / 90% lines → 90%/90%/90%/90% (TODO(assessment): branches relaxed; need daily-cap clamp, perfect-score combo, streak-bonus edge cases — see `vitest.config.ts` lines 73-82)
  - `src/lib/cognitive-engine.ts`: 65% all metrics → 80% all metrics (TODO(assessment): need IRT 3PL Newton-Raphson convergence path, SM-2 schedule decay, error-classification branches — file is 1412 LOC, see `vitest.config.ts` lines 83-92)
  - `src/lib/exam-engine.ts`: 80% all metrics → 80% all metrics (at target)
  - Authoritative source: `vitest.config.ts`. If the table above disagrees with the config, the config wins and this doc is stale.
- **E2E tests**: Playwright, specs in `e2e/` (`ls e2e/*.spec.ts | wc -l` → **30** as of 2026-07-28). 30s timeout, 1 retry, trace on first retry.
- **CI pipeline** (`.github/workflows/ci.yml`): parallel jobs at t=0 — secret scan; lint + type-check + auth gate; 4 unit-test shards → coverage-merge fan-in; edge-function Deno tests; integration tests; build + bundle size gates; E2E (PRs) — all fanned into the CI Gate, then post-deploy health check (main).

## Environment Variables

Required for production (validated in `next.config.js` on Vercel):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `SUPER_ADMIN_SECRET`

Optional: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`

Email credentials are set as Supabase Edge Function secrets, not in `.env`.

## ESLint Notes

- `@typescript-eslint/no-explicit-any` is off (legacy)
- `no-console` warns except for `console.warn` and `console.error`
- Lint is **not** checked during `next build` (checked separately via `npm run lint`)

## Product Rules & Agent System

See `.claude/CLAUDE.md` for the full product constitution:
- 14 product invariants (P1-P14) that cannot be violated
- 10-agent auto-delegation system with domain ownership
- Enforcement hooks (`guard.sh`, `bash-guard.sh`, `review-chain.sh`, `post-edit-check.sh`) in `.claude/hooks/`
- **`.claude/hooks/verify-hook-patterns.sh` — run this after ANY hook edit or directory move.** It asserts every hook is executable + LF-terminated and that every ownership/review-chain path pattern matches at least one real tracked file. It exists because the monorepo migration silently killed 17 of 34 patterns (all anchored to a repo-root `src/` that no longer exists) *and* every hook carried CRLF endings that made the shebang resolve to `bash\r` — so enforcement was 0/34 while still looking authoritative. A pattern that matches nothing is indistinguishable from one that has nothing to match yet; this script is what tells them apart.
- Review chain requirements by change type
- Approval gates and autonomous operating loop

## Key File Map

> **MONOREPO PATH CORRECTION — added 2026-07-17 (monorepo migration; verified via Glob/Read on 2026-07-17).** The inline `src/…` paths in the table below (and elsewhere in this doc, plus older specs/runbooks) are STALE pre-monorepo aliases. This repo is now a monorepo (`apps/*` + `packages/*`) and there is **no `src/` at the repo root**. The *Area* labels, ownership, and every rule below remain accurate — only the path prefixes moved. Translate as follows:
>
> | Doc path (stale) | Actual location |
> |---|---|
> | `src/app/…` | `apps/host/src/app/…` — root `src/app/**` no longer exists. Student pages live under the `(student)` route group, e.g. the quiz page is `apps/host/src/app/(student)/quiz/page.tsx`. |
> | `src/app/api/…` | `apps/host/src/app/api/…` (e.g. Foxy route `apps/host/src/app/api/foxy/route.ts`) |
> | `src/lib/<x>` | source of truth (canonical implementation) at `packages/lib/src/<x>`; `apps/host/src/lib/<x>.ts` DOES exist but is a thin **2-line auto-generated re-export stub** (`export * from '../../../../packages/lib/src/<name>'`). **Edit `packages/lib/src/`, never the stub.** Import via the `@alfanumrik/lib/*` alias. Applies to `xp-rules`, `xp-config`, `cognitive-engine`, `razorpay`, `feature-flags`, `logger`, `analytics`, etc. |
> | `src/components/<x>` | shared UI moved to `packages/ui/src/<x>` (the `@alfanumrik/ui` package — canonical implementation); `apps/host/src/components/<x>` is a thin re-export stub. Quiz components (`QuizSetup`, `QuizResults`, `FeedbackOverlay`) live at `packages/ui/src/quiz/`. |
> | `src/proxy.ts`, `src/types/*` | `apps/host/src/proxy.ts`, `apps/host/src/types/*` |
> | `supabase/migrations/`, `supabase/functions/` | **UNCHANGED — still at repo ROOT.** They did NOT move under `apps/host/` (`apps/host/supabase/**` does not exist). |
>
> **This drift was not only cosmetic.** The enforcement hooks in `.claude/hooks/` were never re-pointed after the migration, so 17 of their 34 ownership / review-chain path patterns were anchored to a repo-root `src/` that no file can match — P14 was structurally unenforced for XP/scoring constants, payment code, RBAC/auth, the RLS-bypassing admin client, and the whole super-admin surface. Repaired 2026-07-28 and pinned by `.claude/hooks/verify-hook-patterns.sh`. **If you move a directory, run that script.** Anywhere you see a `^src/`-anchored path in a doc, spec, or script, treat it as stale and translate it with the table above.

| Area | Location |
|---|---|
| Quiz engine | `apps/host/src/app/(student)/quiz/page.tsx`, `packages/ui/src/quiz/` |
| MCQ option primitives (canonical) | `packages/lib/src/quiz/options.ts` — the single `parseOptions()` + `OPTION_LETTERS`. Every surface that renders a four-option MCQ imports from here; `parseOptions` had drifted into 7 copies and `OPTION_LETTERS` into 7 more across `apps/host` and `packages/ui` before consolidation. Do not fork or inline a local variant. |
| Scoring & XP | `packages/lib/src/xp-rules.ts` |
| Exam engine | `packages/lib/src/exam-engine.ts` |
| Cognitive engine | `packages/lib/src/cognitive-engine.ts` |
| NCERT ingestion pipeline | `scripts/ncert-ingestion/` (repo root) — see `scripts/ncert-ingestion/CLAUDE.md` for the full pipeline stages, the npm-script cwd mismatch, and the paid-API warning. |
| Pedagogy v2 — content-rules resolver (persona × layer × slot) | `packages/lib/src/learn/pedagogy-content-rules.ts` |
| Pedagogy v2 — daily-rhythm orchestrator (5 SRS + 1 ZPD + reflection) | `packages/lib/src/learn/daily-rhythm-orchestrator.ts` |
| Pedagogy v2 — weekly-dive orchestrator + streak | `packages/lib/src/learn/weekly-dive-orchestrator.ts`, `packages/lib/src/learn/weekly-streak.ts` |
| Pedagogy v2 — monthly-synthesis orchestrator + Claude prompt | `packages/lib/src/learn/monthly-synthesis-orchestrator.ts`, `packages/lib/src/ai/workflows/synthesis-summary.ts` |
| Pedagogy v2 — wrong-answer remediation (Eedi pattern) | `packages/lib/src/learn/wrong-answer-remediation.ts`, `packages/ui/src/quiz/MisconceptionExplainer.tsx` |
| Pedagogy v2 — student-visible surfaces | `apps/host/src/app/dive/`, `apps/host/src/app/synthesis/`, `packages/ui/src/dive/`, `packages/ui/src/synthesis/`. ⚠️ The dashboard renderer `packages/ui/src/dashboard/sections/DailyRhythmQueue.tsx` was **deleted** in the 2026-08 orphan consolidation — it had zero importers and was never mounted by the current Alfa OS dashboard, which renders `packages/ui/src/dashboard/os/TodaysMission.tsx` off `/api/v2/today` instead. **Only the renderer is gone, not the feature:** the `DailyRhythmQueue` *interface* and `composeDailyRhythm()` in `packages/lib/src/learn/daily-rhythm-orchestrator.ts` are still live, `/api/rhythm/today` is still served, and `ff_pedagogy_v2_daily_rhythm` is still enabled globally (migration `20260621000001_enable_core_student_flags.sql`; `packages/lib/src/flags/defaults.ts`). A future daily-rhythm surface re-mounts against the same orchestrator. |
| Pedagogy v2 — API routes | `apps/host/src/app/api/rhythm/today/`, `apps/host/src/app/api/dive/{state,start,artifact,history}/`, `apps/host/src/app/api/synthesis/{state,parent-share}/`, `apps/host/src/app/api/learn/remediation/` |
| Pedagogy v2 — Edge Function (monthly synthesis builder, daily-cron trigger) | `supabase/functions/monthly-synthesis-builder/`, `supabase/functions/daily-cron/` (`triggerMonthlySynthesis` step) |
| Adaptive program — Phase A Loop A (closed loop) | `adaptive_interventions` table + RLS (migration `20260619000200_adaptive_interventions.sql`), flag seed `20260619000300_seed_ff_adaptive_remediation_v1.sql` (OFF), teacher-dedupe index `20260619000400_teacher_remediation_dedupe_index.sql`. Cron worker `apps/host/src/app/api/cron/adaptive-remediation/route.ts` (+ `_lib/subject-match.ts`), triggered thin from `daily-cron` (`triggerAdaptiveRemediation` step). Pure modules `packages/lib/src/learn/remediation-queue-adapter.ts`, `packages/lib/src/learn/recovery-evaluation.ts`. Gated by `ff_adaptive_remediation_v1`. (Loops B/C run on the same substrate — see the next row.) |
| Adaptive program — Phase A Loops B & C (inactivity + at-risk concentration) | Same `adaptive_interventions` substrate, extended additively by migration `20260619000500_adaptive_interventions_extend_trigger_signal.sql` (widens `trigger_signal` CHECK + relaxes `chapter_number` CHECK to `>= 0` for Loop B's `_inactivity`/chapter-0 sentinel) + flag seed `20260619000600_seed_ff_adaptive_loops_bc_v1.sql` (`ff_adaptive_loops_bc_v1`, OFF). Pure modules `packages/lib/src/learn/adaptive-loops-rules.ts` (B/C constants + planners + cross-loop arbiter), `packages/lib/src/learn/inactivity-return-evaluation.ts`, `packages/lib/src/learn/concentration-resolution-evaluation.ts`. B/C inject/verify branches live in the existing Loop A cron worker `apps/host/src/app/api/cron/adaptive-remediation/route.ts`. 6 new event kinds (`system.engagement_{nudged,returned,escalated}`, `system.concentration_{escalated,resolved,reescalated}`) in `packages/lib/src/state/events/registry.ts`. Gated by `ff_adaptive_loops_bc_v1`. |
| Student Pulse | `packages/lib/src/pulse/`, `packages/ui/src/pulse/`, `apps/host/src/app/api/pulse/{me,school,class/[classId],student/[id]}`. `canAccessStudent` is the single cross-role data boundary. Gated by `ff_school_pulse_v1` (seed `20260619000100_seed_ff_school_pulse_v1.sql`, OFF). |
| Auth context | `packages/lib/src/AuthContext.tsx` |
| RBAC | `packages/lib/src/rbac.ts`, `packages/lib/src/usePermissions.ts` |
| Supabase clients | `packages/lib/src/supabase.ts`, `supabase-server.ts`, `supabase-admin.ts` |
| Middleware | `apps/host/src/proxy.ts` (renamed from middleware.ts for Next.js 16; build-enforced by scripts/auth-guard.js) |
| Payments | `packages/lib/src/razorpay.ts`, `apps/host/src/app/api/payments/` |
| AI Edge Functions | `apps/host/src/app/api/foxy/route.ts` (Foxy Next.js route — active; replaced `foxy-tutor` Edge Function which was retired 2026-07-01), `supabase/functions/ncert-solver/`, `quiz-generator/`, `cme-engine/` (no `quiz-generator-v2/` — archived). Foxy modes: `learn`, `explain`, `practice`, `revise`, `doubt`, `homework`, `explorer` (Pedagogy v2 Wave 2). |
| Marking-authenticity forensic view | `supabase/migrations/20260504100400_marking_audit_view.sql` → `public.marking_audit_last_30d`. Service-role-only forensic read model for the super-admin Marking Integrity dashboard. Runbook: `docs/runbooks/forensic-quiz-investigation.md` |
| Non-AI Edge Functions | `supabase/functions/daily-cron/`, `queue-consumer/`, `send-auth-email/`, `send-welcome-email/`, `session-guard/`, `scan-ocr/`, `identity/`, `bulk-question-gen/`, `embed-diagrams/`, `embed-ncert-qa/`, `embed-questions/`, `extract-diagrams/`, `extract-ncert-questions/`, `generate-answers/`, `generate-concepts/`, `generate-embeddings/`, `nep-compliance/`, `parent-portal/`, `parent-report-generator/`, `teacher-dashboard/`, `whatsapp-notify/`, `alert-deliverer/`. CORRECTION 2026-08-16 (Phase 0 super-admin audit): `export-report/` does not exist on disk (`ls supabase/functions/` has no such directory) and was removed from this list — do not re-add without verifying it was actually re-created. |
| Feature flags | `packages/lib/src/feature-flags.ts` |
| Structured logger | `packages/lib/src/logger.ts` |
| Migrations | `supabase/migrations/` — see `supabase/CLAUDE.md` for the exact recount commands (the number drifts constantly) and the schema-reproducibility runbook. |
| NCERT corpus (do not re-ingest before checking) | **27,778 chunks in `rag_content_chunks`** — measured read-only against the production project on **2026-08-11**. This supersedes the `~16,006` figure that sat here from the 2026-07 audits, which was **73% low**; that number is exactly what anyone would use to scope or fund a re-ingestion, and understating it makes re-ingestion look more necessary than it is. **Do not quote this one from memory either — re-measure it:** `GET /rest/v1/rag_content_chunks?select=id&limit=1` with a service-role `apikey` + `Authorization` and the request header `Prefer: count=exact`, then read the total after the `/` in the `Content-Range` response header (`0-0/27778`). Chapter coverage was **750 of 761 `cbse_syllabus` rows (~98.6%)** at the 2026-07 audits and was **not** re-measured on 2026-08-11 — treat it as unverified. The corpus **exists** — before funding or scoping any re-ingestion, read `/api/super-admin/grounding/coverage` and the `ingestion_gaps` view. `cbse_syllabus.rag_status` is `'ready'` only when `chunk_count >= 50` AND `verified_question_count >= 40`, so a chapter can be fully ingested and still read `'partial'` purely because its questions are unverified — `'partial'` does **not** imply missing content. |
| CI/CD | `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml` |
| Operational docs | `docs/` (RBAC matrix, backup/restore, admin ops, architecture docs) |
| Pedagogy v2 specs / plans / runbooks | `docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md` (strategic), `docs/superpowers/plans/2026-05-08-*` + `2026-05-09-*` (Wave 1-3), `docs/superpowers/runbooks/2026-05-09-pedagogy-v2-wave-1-rollout.md` |
| Adaptive program + Pulse specs / runbooks | `docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`, `docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`, `docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md`; runbooks `docs/runbooks/adaptive-remediation-rollout.md` (Loop A) + `docs/runbooks/adaptive-program-rollout.md` (program-level: Loops A+B+C + Pulse). |
| RAG retrieval-quality eval-harness (B1) | CLI `eval/rag/harness/cli.ts` at the **repo root** (`eval/` is NOT inside `apps/host/`); core modules runner `eval/rag/harness/run-eval.ts`, metrics `metrics.ts`, verdict `verdict.ts`, golden-set schema `golden-schema.ts`, relevance judge `relevance-judge.ts`. Data: `eval/rag/golden/` (seed-queries + README), baseline `eval/rag/baseline/ncert-baseline-v1.json`. Tests `apps/host/src/__tests__/eval/rag/`. **`npm run eval:rag:harness` is declared only in `apps/host/package.json`, NOT the root** — the root exposes `eval:teacher:harness` but has no `eval:rag:harness`, so running it from the repo root fails. ⚠️ Unresolved (2026-07-17): the `apps/host` script body is `npx tsx eval/rag/harness/cli.ts`, which resolves relative to `apps/host/` where no `eval/` dir exists — the declaration and the file location disagree. Verify before relying on it. Offline read-only measurement harness (sub-project B1); pinned by REG-140. Spec `docs/superpowers/specs/2026-06-13-rag-retrieval-quality-design.md`; plan `docs/superpowers/plans/2026-06-13-rag-eval-harness.md`; runbook `docs/runbooks/2026-06-14-rag-eval-harness-operation.md`. |

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
