# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

### Web (Next.js)
```bash
npm run dev              # Dev server at localhost:3000
npm run build            # Production build
npm run type-check       # TypeScript validation (tsc --noEmit)
npm run lint             # ESLint on src/ (.ts/.tsx)
npm test                 # Vitest unit tests
npm run test:watch       # Vitest in watch mode
npm run test:coverage    # Vitest with V8 coverage
npm run test:e2e         # Playwright E2E (auto-starts dev server unless CI)
npm run test:e2e:ui      # Playwright with interactive UI
npm run analyze          # Bundle analysis (ANALYZE=true next build)
```

Run a single test: `npx vitest run src/__tests__/path/to/file.test.ts`

### Mobile (Flutter)
```bash
cd mobile
flutter pub get          # Install dependencies
flutter run              # Run on connected device/emulator
flutter build apk        # Build Android APK
flutter analyze          # Dart static analysis
flutter test             # Run Flutter tests
```

### Supabase Edge Functions (Deno)
```bash
supabase functions serve <name> --env-file .env.local   # Local dev
supabase functions deploy <name>                         # Deploy single function
supabase db push                                         # Apply pending migrations
supabase migration new <name>                            # Create new migration
```

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
| AI | Claude Haiku via Supabase Edge Functions (ncert-solver, quiz-generator, cme-engine + non-AI functions) and the Foxy Next.js route (`apps/host/src/app/api/foxy/route.ts` — `foxy-tutor` Edge Function retired 2026-07-01 for WEB; ⚠️ 2026-07-13: the function is still deployed AND still invoked by the Flutter app (mobile/lib/data/repositories/chat_repository.dart) — repoint mobile before deleting it. CORRECTION 2026-07-20 (verified in-source): the "still invoked by the Flutter app" half of the 2026-07-13 note is SUPERSEDED — `mobile/lib/core/constants/api_constants.dart:99-106` defaults `FOXY_ENDPOINT` to `'api'`, so mobile now POSTs to the Next.js `/api/foxy` route; the `_sendViaEdge` branch in chat_repository.dart (~lines 120-173) is documented dead code kept only so already-installed APKs pointed at 'edge' fail predictably. The deletion caution STANDS: old installed APKs may still call the deployed `foxy-tutor` until forced upgrade — verify invocation metrics (Supabase Edge Function logs / `supabase functions list`) before deleting the deployed function). `quiz-generator/` is the only generator on disk; `quiz-generator-v2/` is archived under `supabase/functions/_archive/`. CORRECTION 2026-07-13: the prior claim that v2 was "never live" was false — it WAS deployed and ACTIVE in production (reached v35) until it was tombstoned with a structured 410 on 2026-07-13 (see docs/runbooks/edge-function-drift-report.md execution log). `enhanced-quiz-generator` (a second live duplicate with no source in git) was tombstoned the same day. |
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
- Internal Admin: `/internal/admin/*` (pages), `/api/v1/admin/*` (API routes)

**Three Supabase clients** (use the right one):
- `packages/lib/src/supabase.ts` — client-side, respects RLS
- `packages/lib/src/supabase-server.ts` — server components/middleware, respects RLS
- `packages/lib/src/supabase-admin.ts` — server-only, bypasses RLS (service role). **Never import in client code.**

**State management**: SWR for remote data. `AuthContext` (React Context) for auth state and `isHi` language toggle. No Redux/Zustand.

**Middleware** (`apps/host/src/proxy.ts`) (renamed from middleware.ts for Next.js 16; build-enforced by scripts/auth-guard.js): Auth validation, rate limiting (Upstash Redis with in-memory fallback), bot detection, request ID tracing, feature flags. Runs on every request.

**RBAC**: Server-side enforcement via `authorizeRequest(request, 'permission.code')` in API routes. Client-side `usePermissions()` hook is UI convenience only, not a security boundary.

**Supabase Edge Functions** (`supabase/functions/`): Deno runtime — uses `Deno.serve()`, ES module imports, no `node_modules`. Each function is a directory with `index.ts`. **48 functions on disk** (verified 2026-07-17: 50 dirs = 48 functions + `_shared/` + `_archive/`, each function has an `index.ts`). The count previously read "29" — that was stale, not a deployment claim; see the drift note in `.claude/CLAUDE.md`.

**Database migrations**: `supabase/migrations/` ordered by timestamp. Every new table must have RLS enabled and policies in the same migration file.

**Route redirect**: `/quiz` redirects to `/foxy` (configured in `next.config.js`).

**Sentry tunnel**: Client errors route through `/monitoring` to bypass ad-blockers (configured in `next.config.js` Sentry options).

### Styling

Tailwind with custom brand tokens in `tailwind.config.js`:
- Fonts: Plus Jakarta Sans, Sora
- Brand colors: `orange` (#F97316), `purple` (#7C3AED), `cream`, `warm`
- Custom animations: `float`, `scale-in`, `slide-up`, `fade-in`, `bounce-in`

## Critical Development Rules

These are commonly violated and cause bugs:

1. **Grades are strings**, never integers. Use `"6"` through `"12"` everywhere — database, RPCs, APIs, TypeScript types.

2. **XP values live only in `packages/lib/src/xp-rules.ts`**. No hardcoded XP numbers anywhere else.

3. **Score formula is fixed**: `Math.round((correct / total) * 100)`. Must match in `submitQuizResults()`, `QuizResults.tsx`, and `atomic_quiz_profile_update()` RPC.

4. **Quiz submission is atomic** via `atomic_quiz_profile_update()` RPC — never split into separate DB operations.

5. **Anti-cheat**: Minimum 3s average per question, no all-same-answer if >3 questions, response count must equal question count. Enforced both client-side and server-side.

6. **Bilingual**: All user-facing text must support Hindi/English via `AuthContext.isHi`. Technical terms (CBSE, XP, Bloom's) are not translated.

7. **Bundle budget**: Shared JS < 175 kB (temporary; baseline 160 kB — see P10 in `.claude/CLAUDE.md` for the cap-raise rationale and follow-up tracking), pages < 260 kB, middleware < 120 kB — targets Indian 4G (2-5 Mbps).

8. **Payment integrity**: Razorpay webhook signature must be verified before processing. Subscription status changes written atomically with payment records.

9. **AI safety**: Responses from foxy-tutor/ncert-solver must be age-appropriate (grades 6-12), stay within CBSE scope, and respect daily usage limits per plan.

10. **No PII in logs**: Logger (`packages/lib/src/logger.ts`) redacts password, token, email, phone, and API keys. Never log student-identifiable data to Sentry or console.

## Testing

- **Unit tests**: Vitest with JSDOM. Tests in `src/__tests__/`. Setup file: `src/__tests__/setup.ts`.
- **Coverage thresholds (current → aspirational target, reconciled 2026-04-27):**
  - Global: 35% statements / 30% branches / 35% functions / 35% lines → 60% (TODO(testing): real coverage is ~37%; ratchet upward by adding hook + util + server-helper tests — see `vitest.config.ts` lines 60-68)
  - `src/lib/xp-rules.ts`: 90% statements / 75% branches / 90% functions / 90% lines → 90%/90%/90%/90% (TODO(assessment): branches relaxed; need daily-cap clamp, perfect-score combo, streak-bonus edge cases — see `vitest.config.ts` lines 73-82)
  - `src/lib/cognitive-engine.ts`: 65% all metrics → 80% all metrics (TODO(assessment): need IRT 3PL Newton-Raphson convergence path, SM-2 schedule decay, error-classification branches — file is 1412 LOC, see `vitest.config.ts` lines 83-92)
  - `src/lib/exam-engine.ts`: 80% all metrics → 80% all metrics (at target)
  - Authoritative source: `vitest.config.ts`. If the table above disagrees with the config, the config wins and this doc is stale.
- **E2E tests**: Playwright, specs in `e2e/`. 30s timeout, 1 retry, trace on first retry.
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
- Enforcement hooks (guard.sh, bash-guard.sh, review-chain.sh, post-edit-check.sh)
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

| Area | Location |
|---|---|
| Quiz engine | `apps/host/src/app/(student)/quiz/page.tsx`, `packages/ui/src/quiz/` |
| Scoring & XP | `packages/lib/src/xp-rules.ts` |
| Exam engine | `packages/lib/src/exam-engine.ts` |
| Cognitive engine | `packages/lib/src/cognitive-engine.ts` |
| NCERT ingestion pipeline | `scripts/ncert-ingestion/` (repo root). PDF → `pdf-parse` → chapter-split → ~400-token chunks → `rag_content_chunks` (`source='ncert_2025'`) → Voyage `voyage-3` embeddings (1024-d, `embed-chunks.ts`). Entry points: `discover.ts`, `ingest-local.ts` (local folder), `storage-ingest.ts` (Supabase Storage bucket `ncert-books`), `validate.ts`, `rollback.ts`. npm scripts are declared in **`apps/host/package.json`**, not the root: `ncert:discover`, `ncert:ingest`, `ncert:embed`, `ncert:validate`, `ncert:pipeline` (= `ncert:ingest && ncert:validate` — note it does **not** run `ncert:embed`). Source PDFs are gitignored; they live in Supabase Storage bucket `ncert-books`. **`ncert:embed` calls the paid Voyage API — never run it casually.** See `scripts/ncert-ingestion/README.md`. ⚠️ **Open question (2026-07-17, do not assert either side):** this pipeline is present and live on disk, but `docs/runbooks/ingest-ncert-french-revolution.md:467` claims the existing 16,006 chunks were produced by "a legacy tool no longer present in the codebase." Both can be true (a retired tool built the corpus; this pipeline is its successor). Provenance of the *existing* chunks is unconfirmed. ⚠️ Also unresolved: the `ncert:*` script bodies reference `scripts/ncert-ingestion/…` and `./data/NCERT books`, which exist only at the **repo root**, while the scripts are declared in `apps/host/package.json` (whose cwd has no `scripts/ncert-ingestion/` or `data/`) — the declarations and the file locations disagree. Verify cwd before running. |
| Pedagogy v2 — content-rules resolver (persona × layer × slot) | `packages/lib/src/learn/pedagogy-content-rules.ts` |
| Pedagogy v2 — daily-rhythm orchestrator (5 SRS + 1 ZPD + reflection) | `packages/lib/src/learn/daily-rhythm-orchestrator.ts` |
| Pedagogy v2 — weekly-dive orchestrator + streak | `packages/lib/src/learn/weekly-dive-orchestrator.ts`, `packages/lib/src/learn/weekly-streak.ts` |
| Pedagogy v2 — monthly-synthesis orchestrator + Claude prompt | `packages/lib/src/learn/monthly-synthesis-orchestrator.ts`, `packages/lib/src/ai/workflows/synthesis-summary.ts` |
| Pedagogy v2 — wrong-answer remediation (Eedi pattern) | `packages/lib/src/learn/wrong-answer-remediation.ts`, `packages/ui/src/quiz/MisconceptionExplainer.tsx` |
| Pedagogy v2 — student-visible surfaces | `apps/host/src/app/dive/`, `apps/host/src/app/synthesis/`, `packages/ui/src/dive/`, `packages/ui/src/synthesis/`, `packages/ui/src/dashboard/sections/DailyRhythmQueue.tsx` |
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
| Non-AI Edge Functions | `supabase/functions/daily-cron/`, `queue-consumer/`, `send-auth-email/`, `send-welcome-email/`, `session-guard/`, `scan-ocr/`, `export-report/`, `identity/`, `bulk-question-gen/`, `embed-diagrams/`, `embed-ncert-qa/`, `embed-questions/`, `extract-diagrams/`, `extract-ncert-questions/`, `generate-answers/`, `generate-concepts/`, `generate-embeddings/`, `nep-compliance/`, `parent-portal/`, `parent-report-generator/`, `teacher-dashboard/`, `whatsapp-notify/`, `alert-deliverer/` |
| Feature flags | `packages/lib/src/feature-flags.ts` |
| Structured logger | `packages/lib/src/logger.ts` |
| Migrations | `supabase/migrations/` — root holds the `00000000000000_baseline_from_prod.sql` baseline **+ 409 timestamped migrations** (410 `.sql` files total; latest `20260716120000_seed_ff_foxy_math_format_v2.sql`, verified 2026-07-17). The pre-baseline chain is archived under `_legacy/`, which `supabase db push` skips. |
| NCERT corpus (do not re-ingest before checking) | **~16,006 chunks in `rag_content_chunks`, covering 750 of 761 `cbse_syllabus` rows (~98.6%)** as of the 2026-07 audits. The corpus **exists** — before funding or scoping any re-ingestion, read `/api/super-admin/grounding/coverage` and the `ingestion_gaps` view. `cbse_syllabus.rag_status` is `'ready'` only when `chunk_count >= 50` AND `verified_question_count >= 40`, so a chapter can be fully ingested and still read `'partial'` purely because its questions are unverified — `'partial'` does **not** imply missing content. |
| CI/CD | `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml` |
| Operational docs | `docs/` (RBAC matrix, backup/restore, admin ops, architecture docs) |
| Pedagogy v2 specs / plans / runbooks | `docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md` (strategic), `docs/superpowers/plans/2026-05-08-*` + `2026-05-09-*` (Wave 1-3), `docs/superpowers/runbooks/2026-05-09-pedagogy-v2-wave-1-rollout.md` |
| Adaptive program + Pulse specs / runbooks | `docs/superpowers/specs/2026-06-12-rbac-conformance-and-student-pulse-design.md`, `docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`, `docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md`; runbooks `docs/runbooks/adaptive-remediation-rollout.md` (Loop A) + `docs/runbooks/adaptive-program-rollout.md` (program-level: Loops A+B+C + Pulse). |
| RAG retrieval-quality eval-harness (B1) | CLI `eval/rag/harness/cli.ts` at the **repo root** (`eval/` is NOT inside `apps/host/`); core modules runner `eval/rag/harness/run-eval.ts`, metrics `metrics.ts`, verdict `verdict.ts`, golden-set schema `golden-schema.ts`, relevance judge `relevance-judge.ts`. Data: `eval/rag/golden/` (seed-queries + README), baseline `eval/rag/baseline/ncert-baseline-v1.json`. Tests `apps/host/src/__tests__/eval/rag/`. **`npm run eval:rag:harness` is declared only in `apps/host/package.json`, NOT the root** — the root exposes `eval:teacher:harness` but has no `eval:rag:harness`, so running it from the repo root fails. ⚠️ Unresolved (2026-07-17): the `apps/host` script body is `npx tsx eval/rag/harness/cli.ts`, which resolves relative to `apps/host/` where no `eval/` dir exists — the declaration and the file location disagree. Verify before relying on it. Offline read-only measurement harness (sub-project B1); pinned by REG-140. Spec `docs/superpowers/specs/2026-06-13-rag-retrieval-quality-design.md`; plan `docs/superpowers/plans/2026-06-13-rag-eval-harness.md`; runbook `docs/runbooks/2026-06-14-rag-eval-harness-operation.md`. |
