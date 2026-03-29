# Alfanumrik Learning OS — Non-Negotiable Product Rules

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

## Product Invariants
These rules cannot be overridden by any agent. Violating any of them is a blocking defect.

### P1: Score Accuracy
```
score_percent = Math.round((correct_answers / total_questions) * 100)
```
This formula is the single source of truth. It must produce identical results in `submitQuizResults()`, `QuizResults.tsx`, and the `atomic_quiz_profile_update()` RPC. No agent may change it without a product decision from the user.

### P2: XP Economy
```
xp_earned = (correct * XP_RULES.quiz_per_correct)
          + (score_percent >= 80 ? XP_RULES.quiz_high_score_bonus : 0)
          + (score_percent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
```
All XP constants live in `src/lib/xp-rules.ts`. No XP value may be hardcoded anywhere else. Daily quiz cap: 200 XP. Level threshold: 500 XP.

### P3: Anti-Cheat
Three checks, enforced both client-side and server-side:
1. Minimum 3 seconds average per question
2. Not all answers the same index (if >3 questions)
3. Response count equals question count

### P4: Atomic Quiz Submission
Quiz results MUST be written via `atomic_quiz_profile_update()` RPC (single Postgres transaction). Separate INSERT + UPDATE is a fallback only, logged as a warning.

### P5: Grade Format
Grades are strings: `"6"` through `"12"`. Never integers. In database columns, RPCs, API parameters, and TypeScript types.

### P6: Question Quality
Every question served to a student must have: non-empty `question_text` (no `{{` or `[BLANK]`), exactly 4 distinct non-empty `options`, `correct_answer_index` 0-3, non-empty `explanation`, valid `difficulty` and `bloom_level`.

### P7: Bilingual UI
All user-facing text supports Hindi (`hi`) and English (`en`) via `AuthContext.isHi`. Technical terms (CBSE, XP, Bloom's) are not translated.

### P8: RLS Boundary
Client-side code NEVER bypasses Row Level Security. `supabase-admin.ts` (service role) is server-only. Every new table has RLS enabled with policies in the same migration.

### P9: RBAC Enforcement
API routes use `authorizeRequest(request, 'permission.code')` from `src/lib/rbac.ts`. Client-side `usePermissions()` is UI convenience only, not a security boundary.

### P10: Bundle Budget
Shared JS < 160 kB. Individual pages < 260 kB. Middleware < 120 kB. Target: Indian 4G mobile (2-5 Mbps).

## Agent System
Agent definitions: `.claude/agents/`. Skills: `.claude/skills/`.

**Authority chain**: orchestrator decomposes → specialist agents implement/review → quality verifies conformance → orchestrator approves handoff.

**Ownership rule**: Each concern has exactly one owning agent. If two agents disagree, the owning agent's decision stands. If ownership is unclear, orchestrator decides.

| Concern | Owner | Reviewer |
|---|---|---|
| Score calculation, XP, answer correctness, scorecards, progress mapping | assessment | quality (conformance only) |
| Database schema, RLS, migrations, RBAC, middleware, deployment | cto | quality (conformance only) |
| Pages, components, API route implementation, styling, state | fullstack | quality, assessment (if quiz-related) |
| Test coverage, regression catalog, edge cases | testing | quality (conformance only) |
| Readability, duplication, naming, architecture conformance | quality | — |
| Task breakdown, review gates, handoffs, conflict resolution | orchestrator | — |

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
