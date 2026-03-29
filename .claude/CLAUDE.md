# Alfanumrik Learning OS — Claude Code Project Rules

## What This Is
Indian K-12 EdTech platform (CBSE grades 6-12). Next.js 14 + Supabase + Razorpay. 219 source files, 160+ SQL migrations, 12 Supabase Edge Functions, Flutter mobile app.

## Architecture Quick Reference
- **Frontend**: Next.js 14.2 App Router, React 18, Tailwind 3.4, SWR
- **Backend**: Next.js API routes (`src/app/api/`) + Supabase Edge Functions (`supabase/functions/`)
- **Auth**: Supabase Auth (email/PKCE), session cookies via middleware
- **Database**: Supabase Postgres with RLS (148+ policies), RBAC (6 roles, 71 permissions)
- **Payments**: Razorpay (INR, monthly recurring + yearly one-time)
- **Deployment**: Vercel (bom1/Mumbai), GitHub Actions CI/CD
- **Testing**: Vitest (175 tests), Playwright E2E
- **Monitoring**: Sentry (client/server/edge), Vercel Analytics
- **Mobile**: Flutter + Riverpod (`/mobile`)

## Critical File Map
| Area | Files |
|---|---|
| Quiz orchestrator | `src/app/quiz/page.tsx` |
| Quiz components | `src/components/quiz/QuizSetup.tsx`, `QuizResults.tsx`, `FeedbackOverlay.tsx` |
| Scoring & XP | `src/lib/xp-rules.ts` |
| Exam timing/presets | `src/lib/exam-engine.ts` |
| Cognitive engine | `src/lib/cognitive-engine.ts` |
| Feedback engine | `src/lib/feedback-engine.ts` |
| Auth context | `src/lib/AuthContext.tsx` |
| RBAC | `src/lib/rbac.ts`, `src/lib/usePermissions.ts` |
| Supabase clients | `src/lib/supabase.ts`, `supabase-server.ts`, `supabase-admin.ts` |
| Admin auth | `src/lib/admin-auth.ts` |
| Feature flags | `src/lib/feature-flags.ts` |
| Middleware | `src/middleware.ts` |
| Payments | `src/app/api/payments/` |
| Super admin | `src/app/super-admin/`, `src/app/api/super-admin/` |
| Edge functions | `supabase/functions/` (foxy-tutor, quiz-generator, cme-engine, etc.) |
| Migrations | `supabase/migrations/` |
| CI/CD | `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml` |

## Non-Negotiable Rules

### 1. Quiz Integrity
- Quiz scoring MUST use the `atomic_quiz_profile_update()` RPC. Never update XP/profiles with separate queries.
- XP values MUST come from `src/lib/xp-rules.ts` constants. Never hardcode XP numbers elsewhere.
- Minimum 3 seconds per question enforced. Anti-cheat checks (pattern detection, response count validation) must remain.
- Exam timing uses `calculateExamConfig()` from `src/lib/exam-engine.ts`. Do not invent timing logic.

### 2. CBSE Alignment
- Grades are strings: `"6"` through `"12"`. Never use integers in the database or RPCs.
- Subjects use snake_case codes: `math`, `science`, `physics`, `chemistry`, `biology`, `english`, `hindi`, `social_studies`, `economics`, `accountancy`, `business_studies`, `political_science`, `history_sr`, `geography`, `computer_science`, `coding`.
- Bloom's taxonomy levels: `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create`. The cognitive engine tracks all six.
- Question bank entries MUST have: `question_text`, `options` (exactly 4), `correct_answer_index` (0-3), `explanation`, `difficulty`, `bloom_level`.

### 3. Database Safety
- NEVER bypass RLS in client-side code. Service role client (`supabase-admin.ts`) is server-side only.
- Every new table MUST have RLS enabled with explicit policies before merge.
- New migrations MUST be idempotent (use `IF NOT EXISTS`, `CREATE OR REPLACE`).
- Test migrations against the existing 160+ chain. Do not assume a clean database.

### 4. Security
- RBAC checks: API routes use `authorizeRequest(request, 'permission.code')` from `src/lib/rbac.ts`.
- Client-side permission checks use `usePermissions()` hook (UI gating only, not security boundary).
- Super admin routes require `SUPER_ADMIN_SECRET` via header (`x-admin-secret`), never query params in production.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.

### 5. Code Standards
- TypeScript strict mode. Zero `any` types in new code.
- All user-facing text must support Hindi (`en`/`hi`). Check `AuthContext.isHi`.
- No console.log in production code (console.warn and console.error are OK).
- API routes return consistent shape: `{ success: boolean, data?: T, error?: string }`.
- New pages must handle loading, error, and empty states.

### 6. Testing Requirements
- All quiz/scoring changes require unit tests in `src/__tests__/`.
- API route changes require corresponding test coverage.
- Run `npm run type-check && npm test` before committing.
- E2E smoke tests (`e2e/smoke.spec.ts`) must pass.

### 7. Performance
- Bundle size: keep shared JS under 160 kB. Individual pages under 260 kB.
- SWR for client data fetching. No raw `fetch` in components.
- Images: AVIF/WebP via Next.js Image, remote patterns for Supabase storage.
- Target: Indian 4G mobile (optimize for 2-5 Mbps).

## Agent System
This repository uses a multi-agent structure. Agent definitions live in `.claude/agents/`. Skills live in `.claude/skills/`. Agents must follow the review gates and output formats defined in their respective files.

## Build Commands
```
npm run dev          # Local dev server
npm run build        # Production build
npm run type-check   # TypeScript validation
npm test             # Vitest (175 tests)
npm run test:e2e     # Playwright E2E
npm run lint         # ESLint
npm run analyze      # Bundle analysis
```
