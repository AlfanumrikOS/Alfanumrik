# Alfanumrik Learning OS — Non-Negotiable Product Rules

## What This Is
Indian K-12 EdTech platform (CBSE grades 6-12). Next.js 14 + Supabase + Razorpay. 219 source files, 160+ SQL migrations, 12 Supabase Edge Functions, Flutter mobile app. Serves students, parents, teachers, and administrators.

## Architecture Quick Reference
| Layer | Technology |
|---|---|
| Frontend | Next.js 14.2 App Router, React 18, Tailwind 3.4, SWR |
| Backend | Next.js API routes (32 routes) + Supabase Edge Functions (12 functions) |
| Auth | Supabase Auth (email/PKCE), session cookies via middleware |
| Database | Supabase Postgres, RLS (148+ policies), RBAC (6 roles, 71 permissions) |
| AI | Claude API (Haiku) via Edge Functions: foxy-tutor, ncert-solver, quiz-generator, cme-engine |
| Payments | Razorpay (INR, monthly recurring + yearly one-time) |
| Deployment | Vercel (bom1/Mumbai), GitHub Actions CI/CD (3 workflows) |
| Testing | Vitest (175 tests), Playwright E2E |
| Monitoring | Sentry (client/server/edge), Vercel Analytics, structured logging |
| Mobile | Flutter + Riverpod (/mobile) |
| Offline | Service worker, localStorage cache, background sync |

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
| Payments | `src/lib/razorpay.ts`, `src/app/api/payments/` |
| AI Edge Functions | `supabase/functions/foxy-tutor/`, `ncert-solver/`, `quiz-generator/`, `cme-engine/` |
| Non-AI Edge Functions | `supabase/functions/daily-cron/`, `queue-consumer/`, `send-*-email/`, `session-guard/`, `scan-ocr/`, `export-report/` |
| Super admin panel | `src/app/super-admin/` (10 pages), `src/app/api/super-admin/` (12 routes) |
| Parent portal | `src/app/parent/` (5 pages) |
| Teacher portal | `src/app/teacher/` (6 pages) |
| Notifications | `src/app/notifications/page.tsx`, daily-cron Edge Function |
| Migrations | `supabase/migrations/` (160+ files) |
| CI/CD | `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml` |
| Mobile | `mobile/` (Flutter app) |
| SEO/PWA | `src/app/sitemap.ts`, `public/manifest.json`, `public/sw.js`, `src/components/JsonLd.tsx` |
| Docs | `docs/` (5 operational docs), root `ARCHITECTURE.md`, `LAUNCH_CHECKLIST.md` |

## Product Invariants
These rules cannot be overridden by any agent. Violating any is a blocking defect.

### P1: Score Accuracy
```
score_percent = Math.round((correct_answers / total_questions) * 100)
```
Identical results in `submitQuizResults()`, `QuizResults.tsx`, and the `atomic_quiz_profile_update()` RPC. No agent may change this formula without user approval.

### P2: XP Economy
```
xp_earned = (correct * XP_RULES.quiz_per_correct)
          + (score_percent >= 80 ? XP_RULES.quiz_high_score_bonus : 0)
          + (score_percent === 100 ? XP_RULES.quiz_perfect_bonus : 0)
```
All XP constants in `src/lib/xp-rules.ts`. No hardcoded XP values elsewhere. Daily quiz cap: 200 XP. Level: 500 XP.

### P3: Anti-Cheat
Three checks, client-side and server-side: (1) minimum 3s avg per question, (2) not all same answer index if >3 questions, (3) response count equals question count.

### P4: Atomic Quiz Submission
Quiz results via `atomic_quiz_profile_update()` RPC (single transaction). Separate operations only as logged fallback.

### P5: Grade Format
Grades are strings `"6"` through `"12"`. Never integers. In database, RPCs, APIs, and TypeScript.

### P6: Question Quality
Every served question: non-empty text (no `{{`/`[BLANK]`), exactly 4 distinct non-empty options, `correct_answer_index` 0-3, non-empty explanation, valid difficulty and bloom_level.

### P7: Bilingual UI
All user-facing text supports Hindi and English via `AuthContext.isHi`. Technical terms (CBSE, XP, Bloom's) not translated.

### P8: RLS Boundary
Client code never bypasses RLS. `supabase-admin.ts` is server-only. Every new table gets RLS + policies in the same migration.

### P9: RBAC Enforcement
API routes use `authorizeRequest(request, 'permission.code')`. Client `usePermissions()` is UI convenience, not security.

### P10: Bundle Budget
Shared JS < 160 kB. Pages < 260 kB. Middleware < 120 kB. Target: Indian 4G (2-5 Mbps).

### P11: Payment Integrity
Razorpay webhook signature MUST be verified before processing any payment event. Subscription status changes MUST be written atomically with the payment record. Never grant plan access without verified payment.

### P12: AI Safety
AI responses (foxy-tutor, ncert-solver) MUST be age-appropriate for grades 6-12. No unfiltered LLM output to students. Responses must stay within CBSE curriculum scope. Daily usage limits enforced per plan.

### P13: Data Privacy
No PII in client-side logs or Sentry events. Logger redacts: password, token, email, phone, API keys. Student data accessible only to: the student, their linked parent, their assigned teacher, or admin via service role.

## Agent System
9 agents organized in three tiers:

**Builders** (implement): architect, frontend, backend, assessment, ai-engineer
**Verifiers** (review): testing, quality
**Operator** (run): ops

Coordinated by: **orchestrator**

### Ownership Table
| Concern | Owner | Reviewer |
|---|---|---|
| Database schema, migrations, RLS, RBAC | architect | quality |
| Middleware, auth infra, deployment, CI/CD, scaling | architect | quality |
| Student/parent/teacher pages, components, styling | frontend | quality; assessment if quiz-related |
| Marketing pages, SEO, PWA, mobile coordination | frontend | quality |
| Client state (AuthContext, SWR), i18n | frontend | quality |
| API route handlers (/api/v1/, /api/payments/) | backend | architect (auth); quality |
| Non-AI Edge Functions (email, cron, queue, OCR) | backend | architect (infra); quality |
| Razorpay payments, webhooks, subscription lifecycle | backend | architect (security); quality |
| Notification engine, daily cron jobs | backend | quality |
| Score calculation, XP economy, anti-cheat rules | assessment | testing; quality |
| Bloom's taxonomy, CBSE content, exam timing rules | assessment | quality |
| Cognitive model behavior (what it should do) | assessment | ai-engineer (feasibility) |
| Question bank content quality | assessment | quality |
| Scorecard data contracts, learner progress mapping | assessment | quality |
| AI Edge Functions (foxy, ncert, quiz-gen, cme) | ai-engineer | assessment (correctness); quality |
| RAG pipeline, prompt templates, Claude API usage | ai-engineer | quality |
| AI rate limiting, circuit breakers, streaming | ai-engineer | architect (infra); quality |
| Super admin panel (pages + APIs) | ops | quality |
| Feature flags, health checks, monitoring config | ops | architect (infra); quality |
| Documentation (docs/), operational runbooks | ops | quality |
| Support tooling, test account management | ops | quality |
| Analytics/reporting APIs | ops | quality |
| Unit tests, E2E tests, regression catalog | testing | quality |
| Code readability, type safety, architecture conformance | quality | — |
| Task breakdown, gates, reporting, escalation | orchestrator | — |

### User Approval Required For
- Changes to product invariants P1-P13
- New subscription plans or pricing changes
- RBAC role or permission additions
- Migrations that drop tables or columns
- AI model or provider changes
- Changes to the agent system itself

### Autonomous Decisions (no user approval needed)
- Bug fixes within existing behavior
- Test additions
- Code refactoring that doesn't change behavior
- Documentation updates
- Feature flag toggles
- Performance optimizations within existing architecture

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
