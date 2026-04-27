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
| Backend | Next.js API routes (`src/app/api/`) + Supabase Edge Functions (Deno, not Node.js) |
| Database | Supabase PostgreSQL with RLS, RBAC (6 roles, 71 permissions), pgvector for RAG |
| Auth | Supabase Auth (email/PKCE), JWT auto-refresh via middleware |
| Payments | Razorpay (INR subscriptions) |
| AI | Claude Haiku via 29 Edge Functions (foxy-tutor, ncert-solver, quiz-generator, quiz-generator-v2, cme-engine + 24 non-AI functions) |
| Mobile | Flutter 3.16+ / Dart 3.2+, Riverpod, GoRouter — in `/mobile` (shared API contract) |
| Monitoring | Sentry (client/server/edge), Vercel Analytics |
| Deployment | Vercel (bom1/Mumbai region), GitHub Actions CI/CD |

### Key Architectural Patterns

**Path alias**: `@/*` maps to `./src/*` (tsconfig paths).

**Multi-portal app** with dedicated routes and APIs:
- Student: `/dashboard`, `/foxy` (AI tutor), `/learn`, `/progress`, `/leaderboard`, `/exams`, `/simulations`
- Parent: `/parent/*`
- Teacher: `/teacher/*`
- Super Admin: `/super-admin/*` (pages), `/api/super-admin/*` (API routes)
- Internal Admin: `/internal/admin/*` (pages), `/api/v1/admin/*` (API routes)

**Three Supabase clients** (use the right one):
- `src/lib/supabase.ts` — client-side, respects RLS
- `src/lib/supabase-server.ts` — server components/middleware, respects RLS
- `src/lib/supabase-admin.ts` — server-only, bypasses RLS (service role). **Never import in client code.**

**State management**: SWR for remote data. `AuthContext` (React Context) for auth state and `isHi` language toggle. No Redux/Zustand.

**Middleware** (`src/middleware.ts`): Auth validation, rate limiting (Upstash Redis with in-memory fallback), bot detection, request ID tracing, feature flags. Runs on every request.

**RBAC**: Server-side enforcement via `authorizeRequest(request, 'permission.code')` in API routes. Client-side `usePermissions()` hook is UI convenience only, not a security boundary.

**Supabase Edge Functions** (`supabase/functions/`): Deno runtime — uses `Deno.serve()`, ES module imports, no `node_modules`. Each function is a directory with `index.ts`.

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

2. **XP values live only in `src/lib/xp-rules.ts`**. No hardcoded XP numbers anywhere else.

3. **Score formula is fixed**: `Math.round((correct / total) * 100)`. Must match in `submitQuizResults()`, `QuizResults.tsx`, and `atomic_quiz_profile_update()` RPC.

4. **Quiz submission is atomic** via `atomic_quiz_profile_update()` RPC — never split into separate DB operations.

5. **Anti-cheat**: Minimum 3s average per question, no all-same-answer if >3 questions, response count must equal question count. Enforced both client-side and server-side.

6. **Bilingual**: All user-facing text must support Hindi/English via `AuthContext.isHi`. Technical terms (CBSE, XP, Bloom's) are not translated.

7. **Bundle budget**: Shared JS < 160 kB, pages < 260 kB, middleware < 120 kB — targets Indian 4G (2-5 Mbps).

8. **Payment integrity**: Razorpay webhook signature must be verified before processing. Subscription status changes written atomically with payment records.

9. **AI safety**: Responses from foxy-tutor/ncert-solver must be age-appropriate (grades 6-12), stay within CBSE scope, and respect daily usage limits per plan.

10. **No PII in logs**: Logger (`src/lib/logger.ts`) redacts password, token, email, phone, and API keys. Never log student-identifiable data to Sentry or console.

## Testing

- **Unit tests**: Vitest with JSDOM. Tests in `src/__tests__/`. Setup file: `src/__tests__/setup.ts`.
- **Coverage thresholds (current → aspirational target, reconciled 2026-04-27):**
  - Global: 35% statements / 30% branches / 35% functions / 35% lines → 60% (TODO(testing): real coverage is ~37%; ratchet upward by adding hook + util + server-helper tests — see `vitest.config.ts` lines 60-68)
  - `src/lib/xp-rules.ts`: 90% statements / 75% branches / 90% functions / 90% lines → 90%/90%/90%/90% (TODO(assessment): branches relaxed; need daily-cap clamp, perfect-score combo, streak-bonus edge cases — see `vitest.config.ts` lines 73-82)
  - `src/lib/cognitive-engine.ts`: 65% all metrics → 80% all metrics (TODO(assessment): need IRT 3PL Newton-Raphson convergence path, SM-2 schedule decay, error-classification branches — file is 1412 LOC, see `vitest.config.ts` lines 83-92)
  - `src/lib/exam-engine.ts`: 80% all metrics → 80% all metrics (at target)
  - Authoritative source: `vitest.config.ts`. If the table above disagrees with the config, the config wins and this doc is stale.
- **E2E tests**: Playwright, specs in `e2e/`. 30s timeout, 1 retry, trace on first retry.
- **CI pipeline** (`.github/workflows/ci.yml`): secret scan → type-check → lint → test → auth gate → build → bundle size check → E2E (PRs) → post-deploy health check (main).

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

| Area | Location |
|---|---|
| Quiz engine | `src/app/quiz/page.tsx`, `src/components/quiz/` |
| Scoring & XP | `src/lib/xp-rules.ts` |
| Exam engine | `src/lib/exam-engine.ts` |
| Cognitive engine | `src/lib/cognitive-engine.ts` |
| Auth context | `src/lib/AuthContext.tsx` |
| RBAC | `src/lib/rbac.ts`, `src/lib/usePermissions.ts` |
| Supabase clients | `src/lib/supabase.ts`, `supabase-server.ts`, `supabase-admin.ts` |
| Middleware | `src/middleware.ts` |
| Payments | `src/lib/razorpay.ts`, `src/app/api/payments/` |
| AI Edge Functions | `supabase/functions/foxy-tutor/`, `ncert-solver/`, `quiz-generator/`, `quiz-generator-v2/`, `cme-engine/` |
| Non-AI Edge Functions | `supabase/functions/daily-cron/`, `queue-consumer/`, `send-auth-email/`, `send-welcome-email/`, `session-guard/`, `scan-ocr/`, `export-report/`, `identity/`, `bulk-question-gen/`, `embed-diagrams/`, `embed-ncert-qa/`, `embed-questions/`, `extract-diagrams/`, `extract-ncert-questions/`, `generate-answers/`, `generate-concepts/`, `generate-embeddings/`, `nep-compliance/`, `parent-portal/`, `parent-report-generator/`, `teacher-dashboard/`, `whatsapp-notify/`, `alert-deliverer/` |
| Feature flags | `src/lib/feature-flags.ts` |
| Structured logger | `src/lib/logger.ts` |
| Migrations | `supabase/migrations/` |
| CI/CD | `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml` |
| Operational docs | `docs/` (RBAC matrix, backup/restore, admin ops, architecture docs) |
