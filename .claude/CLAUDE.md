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

### P14: Review Chain Completeness
When a critical file is modified, mandatory downstream reviewers must be invoked before the task can be marked complete. The PostToolUse hook (`review-chain.sh`) injects reminders automatically. Orchestrator validates at Gate 5. Quality rejects if chains are incomplete. The full matrix is defined in `.claude/skills/review-chains/SKILL.md`.

Summary of mandatory chains:
| Change | Making Agent | Must Review |
|---|---|---|
| Grading/XP constants | assessment | testing, ai-engineer, backend, frontend |
| Learner-state rules | assessment | ai-engineer, frontend, testing |
| AI tutor behavior | ai-engineer | assessment, testing |
| RAG/retrieval | ai-engineer | assessment, testing |
| Quiz generation | ai-engineer | assessment, testing |
| RBAC/auth | architect | backend, frontend, ops, testing |
| Payment flow | backend | architect, testing |
| Deployment config | architect | ops, testing |
| Anti-cheat thresholds | assessment + architect | backend, testing |
| Notification types | backend | frontend, ops |
| Super-admin reporting APIs | backend (per ops) | frontend, ops, assessment (if learner), testing |
| CMS workflow | backend (per ops) | assessment, frontend, testing |
| Admin user/role APIs | backend (per ops/architect) | architect, frontend, testing |
| Feature flag API | ops or backend | ops, testing |
| Super-admin pages | frontend | ops, testing |

## Enforcement Mechanisms
- **PreToolUse hook** (`guard.sh`): Blocks wrong agents from writing to critical files
- **PostToolUse hook** (`review-chain.sh`): Injects mandatory review reminders after critical file writes
- **Gate 5** (orchestrator): Validates all review chains are complete before allowing push
- **Quality final review**: Rejects if review chains were skipped
- **Agent prompt rules**: Advisory layer for cases not covered by hooks

## Agent System
9 agents. Each domain in the product has exactly one owner.

**Builders**: architect, frontend, backend, assessment, ai-engineer
**Verifiers**: testing, quality
**Operator**: ops
**Coordinator**: orchestrator

### Domain Ownership (30 domains → 9 agents)

| # | Domain | Owner | Reviewer | Approver |
|---|---|---|---|---|
| 1 | Founder/CEO decision support | orchestrator (synthesizes metrics for user) | — | user |
| 2 | Product strategy | orchestrator (surfaces options, user decides) | — | user |
| 3 | Project management | orchestrator | — | — |
| 4 | CTO / architecture | architect | quality | user (for breaking changes) |
| 5 | Backend engineering | backend | architect (auth); quality | — |
| 6 | Frontend engineering | frontend | quality; assessment (quiz UI) | — |
| 7 | Full-stack integration | orchestrator (validates contracts in handoffs) | quality | — |
| 8 | Database engineering | architect | quality | user (for DROP ops) |
| 9 | Supabase architecture | architect | quality | — |
| 10 | RBAC and auth | architect | quality | user (for role/perm additions) |
| 11 | Security and privacy | architect | quality | — |
| 12 | DevOps | architect | quality | — |
| 13 | Deployment and release engineering | architect | quality; ops (operational impact) | — |
| 14 | Testing and QA | testing | quality | — |
| 15 | Performance and scalability | architect (infra) + quality (code) | — | — |
| 16 | Analytics and reporting | ops | quality | — |
| 17 | Super admin reporting system | ops | quality | — |
| 18 | AI/LLM orchestration | ai-engineer | assessment (correctness); quality | user (model changes) |
| 19 | Vector embeddings | ai-engineer | quality | — |
| 20 | RAG pipeline | ai-engineer | assessment (retrieval correctness); quality | — |
| 21 | Retrieval quality | ai-engineer (implementation) + assessment (validation) | quality | — |
| 22 | Learning graph / learner state | assessment (rules) + ai-engineer (implementation) | quality | — |
| 23 | CBSE pedagogy and academic correctness | assessment | quality | user (new subject additions) |
| 24 | Assessment / grading / progress logic | assessment | testing; quality | user (P1-P6 changes) |
| 25 | Parent-student mapping | backend (server logic) + frontend (UI) + architect (schema/RLS) | quality | — |
| 26 | Notifications / communication | backend | quality | — |
| 27 | Support / grievances / escalation | ops | quality | — |
| 28 | UX audit | quality | — | — |
| 29 | Content QA | assessment | quality | — |
| 30 | Monitoring / incidents / rollback readiness | ops | architect (infra); quality | — |

### Reporting Chain
```
User (Founder/CEO)
  │
  │  Receives from orchestrator:
  │  ├─ Product health    (ops: users, DAU/MAU, quiz completion, revenue)
  │  ├─ System health     (ops: error rate, uptime, health check, latency)
  │  ├─ Release readiness (quality: gate status, test count, bundle sizes)
  │  ├─ Risk register     (orchestrator: blockers, high-risk changes pending)
  │  ├─ Academic integrity (assessment: scoring accuracy, content coverage gaps)
  │  ├─ AI health         (ai-engineer: API success rate, circuit breaker, RAG quality)
  │  └─ Support status    (ops: open tickets, resolution time, top issues)
  │
  └── orchestrator (synthesizes all agent reports)
        ├── architect     → schema changes, security assessments, deploy status
        ├── frontend      → files changed, UI states, i18n, mobile impact
        ├── backend       → API changes, payment impact, notification changes
        ├── assessment    → scoring accuracy, grading consistency, content coverage
        ├── ai-engineer   → AI changes, prompt changes, safety, RAG quality
        ├── testing       → test results, regression catalog, coverage gaps
        ├── quality       → checks passed/failed, review findings, UX audit, verdict
        └── ops           → system metrics, user metrics, revenue, support, flags
```

### Super Admin Reporting Visibility
The super admin panel (ops-owned) exposes:
| Category | Source | Metrics |
|---|---|---|
| Product health | ops + assessment | Active users, signups, DAU/MAU, quiz completion, avg score |
| Learner metrics | assessment + ai-engineer | Topics mastered, Bloom's distribution, knowledge gaps, XP velocity |
| Revenue | backend + ops | Active subs, MRR, churn, plan distribution, payment failures |
| System health | architect + ops | Health endpoint, error rate, latency, DB connections, memory |
| AI health | ai-engineer | Claude API success rate, circuit breaker state, response time, RAG hit rate |
| Release readiness | quality + testing | Gate status, test count, regression results, bundle sizes |
| Content coverage | assessment | Questions per subject/grade, gap analysis, Bloom's per topic |
| Support | ops | Open tickets, resolution time, top issue categories |

### User Approval Required For
- Changes to product invariants P1-P13
- New subscription plans or pricing changes
- RBAC role or permission additions
- Migrations that drop tables or columns
- AI model or provider changes
- New CBSE subject additions
- Changes to the agent system itself

### Autonomous Decisions (no user approval needed)
- Bug fixes within existing behavior
- Test additions
- Code refactoring that doesn't change behavior
- Documentation updates
- Feature flag toggles
- Performance optimizations within existing architecture
- Content quality fixes (fixing a wrong answer, improving an explanation)

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
