# Alfanumrik Architecture: Current State

**Last verified**: 2026-04-02
**Version**: 2.0.0

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.1 |
| React | React + ReactDOM | 18.3.1 |
| Language | TypeScript | 5.4.5 |
| Styling | Tailwind CSS | 3.4.4 |
| Data Fetching | SWR | 2.4.1 |
| Database | Supabase (Postgres + Auth + Storage) | supabase-js 2.49.1, @supabase/ssr 0.9.0 |
| Rate Limiting | Upstash Redis (@upstash/ratelimit + @upstash/redis) | ratelimit 2.0.8, redis 1.37.0 |
| Payments | Razorpay (INR, monthly recurring + yearly one-time) | Server-side integration |
| Error Monitoring | Sentry (@sentry/nextjs) | 10.45.0 |
| Analytics | Vercel Analytics + Speed Insights | analytics 2.0.1, speed-insights 2.0.0 |
| PDF Processing | pdf-parse | 2.4.5 |
| Testing (Unit) | Vitest | 4.1.0 |
| Testing (Component) | @testing-library/react + jest-dom | react 16.3.2, jest-dom 6.9.1 |
| Testing (E2E) | Playwright | 1.58.2 |
| Testing (DOM) | jsdom | 29.0.1 |
| Build Analysis | @next/bundle-analyzer | 16.2.1 |
| Node.js | (CI environment) | 20.x |
| Mobile | Flutter + Riverpod | /mobile directory |
| Deployment | Vercel (bom1/Mumbai region) | — |
| CI/CD | GitHub Actions (3 workflows) | — |

## Layer Diagram

```
                       +---------------------------+
                       |      CDN / Vercel Edge     |
                       | (bom1 Mumbai, HSTS, CSP)   |
                       +---------------------------+
                                    |
                       +---------------------------+
                       |    Next.js Middleware       |
                       | Session refresh, security   |
                       | headers, rate limiting,     |
                       | bot blocking, CORS          |
                       +---------------------------+
                                    |
              +---------------------+---------------------+
              |                                           |
    +-------------------+                     +-------------------+
    |  Next.js Pages    |                     |  Next.js API      |
    |  (60 pages)       |                     |  Routes (35)      |
    |  App Router SSR   |                     |  /api/v1/*, /api/ |
    +-------------------+                     |  super-admin/*    |
              |                               +-------------------+
              |                                        |
              +---------------------+------------------+
                                    |
                       +---------------------------+
                       |  Supabase Edge Functions   |
                       |  (15 functions, Deno)      |
                       |  AI: foxy-tutor, ncert-    |
                       |  solver, quiz-generator,   |
                       |  cme-engine                |
                       +---------------------------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
    +-------------------+ +-------------------+ +-------------------+
    |  Supabase Postgres | | Supabase Auth    | |  Supabase Storage  |
    |  RLS (440+ policies)| | Email/PKCE      | |  Textbook content  |
    |  1 baseline +      | | 6 roles          | |                    |
    |  post-baseline at  | |                  | |                    |
    |  migrations/ root; | |                  | |                    |
    |  349 archived in   | |                  | |                    |
    |  _legacy/          | |                  | |                    |
    |  timestamped/      | |                  | |                    |
    +-------------------+ +-------------------+ +-------------------+
              |
    +-------------------+
    |  External Services |
    |  - Razorpay (INR)  |
    |  - Claude API      |
    |  - Upstash Redis   |
    |  - Sentry          |
    +-------------------+
```

## Page Inventory (60 pages)

### Public / Marketing (11 pages)
| Path | Purpose |
|---|---|
| `/welcome` | Landing page (unauthenticated root redirects here) |
| `/about` | About page |
| `/contact` | Contact form |
| `/for-parents` | Parent marketing |
| `/for-schools` | School/institution marketing |
| `/for-teachers` | Teacher marketing |
| `/pricing` | Pricing plans |
| `/product` | Product overview |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/research` | Research methodology |

### Authentication (2 pages)
| Path | Purpose |
|---|---|
| `/login` | Student/teacher login |
| `/auth/reset` | Password reset |

### Student Core (14 pages)
| Path | Purpose |
|---|---|
| `/dashboard` | Student home dashboard |
| `/quiz` | Quiz orchestrator (core learning loop) |
| `/learn` | Learning content browser |
| `/foxy` | AI tutor (Foxy) chat interface |
| `/progress` | Progress tracking |
| `/review` | Spaced repetition review |
| `/study-plan` | Personalized study plan |
| `/leaderboard` | Gamification leaderboard |
| `/exams` | Exam prep mode |
| `/simulations` | Interactive simulations |
| `/scan` | OCR assignment scanner |
| `/reports` | Student reports |
| `/notifications` | Notification center |
| `/profile` | Student profile |

### Student Extended (5 pages)
| Path | Purpose |
|---|---|
| `/billing` | Subscription management |
| `/help` | Help center |
| `/demo` | Product demo |
| `/hpc` | High-performance computing (advanced) |
| `/stem-centre` | STEM exploration center |
| `/security` | Security settings |

### Parent Portal (5 pages)
| Path | Purpose |
|---|---|
| `/parent` | Parent dashboard / login |
| `/parent/children` | Linked children view |
| `/parent/reports` | Child progress reports |
| `/parent/profile` | Parent profile |
| `/parent/support` | Support tickets |

### Teacher Portal (6 pages)
| Path | Purpose |
|---|---|
| `/teacher` | Teacher dashboard |
| `/teacher/classes` | Class management |
| `/teacher/students` | Student roster |
| `/teacher/reports` | Class analytics |
| `/teacher/profile` | Teacher profile |
| `/teacher/worksheets` | Worksheet generation |

### Super Admin Panel (14 pages)
| Path | Purpose |
|---|---|
| `/super-admin` | Control room (stats, deployments, health) |
| `/super-admin/login` | Admin authentication |
| `/super-admin/users` | User management |
| `/super-admin/cms` | Content management system |
| `/super-admin/content` | Content seeding/bulk ops |
| `/super-admin/logs` | Audit trail |
| `/super-admin/flags` | Feature flag management |
| `/super-admin/institutions` | School/institution directory |
| `/super-admin/diagnostics` | System diagnostics |
| `/super-admin/learning` | Learning analytics |
| `/super-admin/reports` | Business reports / CSV export |
| `/super-admin/subscriptions` | Subscription analytics |
| `/super-admin/support` | Support ticket management |
| `/super-admin/workbench` | Admin workbench |
| `/super-admin/demo` | Demo account management |

## API Route Inventory (35 routes)

### Public (1 route)
| Route | Methods | Purpose |
|---|---|---|
| `/api/v1/health` | GET | Health check (DB + Auth connectivity) |

### Error Reporting (1 route)
| Route | Methods | Purpose |
|---|---|---|
| `/api/error-report` | POST | Client-side error reporting |

### Payments (6 routes)
| Route | Methods | Purpose |
|---|---|---|
| `/api/payments/subscribe` | POST | Initiate Razorpay subscription |
| `/api/payments/verify` | POST | Verify payment after completion |
| `/api/payments/webhook` | POST | Razorpay webhook receiver |
| `/api/payments/status` | GET | Current subscription status |
| `/api/payments/cancel` | POST | Cancel subscription |
| `/api/payments/setup-plans` | POST | Initialize plan configuration |

### V1 API (8 routes)
| Route | Methods | Purpose |
|---|---|---|
| `/api/v1/admin/audit-logs` | GET | Admin audit log retrieval |
| `/api/v1/admin/roles` | GET/POST | Role management |
| `/api/v1/child/[id]/progress` | GET | Child progress (parent access) |
| `/api/v1/child/[id]/report` | GET | Child report (parent access) |
| `/api/v1/class/[id]/analytics` | GET | Class analytics (teacher access) |
| `/api/v1/exam/create` | POST | Create exam session |
| `/api/v1/leaderboard` | GET | Leaderboard data |
| `/api/v1/performance` | GET | Performance metrics |
| `/api/v1/study-plan` | GET/POST | Study plan CRUD |
| `/api/v1/upload-assignment` | POST | OCR assignment upload |

### Super Admin API (17 routes)
| Route | Methods | Purpose |
|---|---|---|
| `/api/super-admin/analytics` | GET | Engagement, revenue, retention metrics |
| `/api/super-admin/cms` | GET/POST/PUT/DELETE | Topic/question/asset CRUD |
| `/api/super-admin/content` | POST | Content seeding, bulk operations |
| `/api/super-admin/content-coverage` | GET | Content gap analysis |
| `/api/super-admin/demo-accounts` | GET/POST | Demo account management |
| `/api/super-admin/deploy` | GET | Deployment info |
| `/api/super-admin/feature-flags` | GET/POST/PUT/DELETE | Feature flag CRUD |
| `/api/super-admin/institutions` | GET/POST/PUT | School directory management |
| `/api/super-admin/logs` | GET | Audit log retrieval |
| `/api/super-admin/observability` | GET | System health and diagnostics |
| `/api/super-admin/platform-ops` | POST | Backup/restore operations |
| `/api/super-admin/reports` | GET | CSV exports, business reports |
| `/api/super-admin/roles` | GET/POST | Role assignment |
| `/api/super-admin/stats` | GET | System statistics |
| `/api/super-admin/support` | GET/POST | Support ticket management |
| `/api/super-admin/test-accounts` | POST | Test user creation |
| `/api/super-admin/users` | GET/POST/PUT | User management |

## Edge Function Inventory (15 functions)

### AI Functions (4)
| Function | Purpose |
|---|---|
| `foxy-tutor` | AI tutor chat (Claude Haiku), CBSE curriculum scoped |
| `ncert-solver` | NCERT textbook problem solver |
| `quiz-generator` | AI-powered quiz question generation |
| `cme-engine` | Cognitive Mastery Engine (adaptive learning) |

### Automation Functions (4)
| Function | Purpose |
|---|---|
| `daily-cron` | Daily scheduled tasks (notifications, cleanup) |
| `queue-consumer` | Background job queue processor |
| `export-report` | Async report generation |
| `session-guard` | Session validation and cleanup |

### Communication Functions (2)
| Function | Purpose |
|---|---|
| `send-auth-email` | Authentication emails (confirm, reset) |
| `send-welcome-email` | Onboarding welcome email |

### Portal Functions (2)
| Function | Purpose |
|---|---|
| `parent-portal` | Parent-specific data aggregation |
| `teacher-dashboard` | Teacher-specific data aggregation |

### Utility Functions (2)
| Function | Purpose |
|---|---|
| `scan-ocr` | Document/assignment OCR processing |
| `nep-compliance` | NEP (National Education Policy) compliance checks |

### Shared
| Function | Purpose |
|---|---|
| `_shared` | Shared utilities across Edge Functions |

## Database (190 SQL Migrations)

Migrations span from 2026-03-07 to 2026-04-01. Key table groups identified from migration names:

### Core Student Data
- `students` — Student profiles, grade, preferences
- `student_learning_profiles` — Learning state, mastery levels
- `student_subscriptions` — Payment/plan status
- `student_notes` — Student-created notes

### Sessions and Activity
- `quiz_sessions` — Quiz attempts with scores, timing
- `chat_sessions` — AI tutor conversation history
- `onboarding_responses` — Initial student profiling

### Content and Curriculum
- `curriculum_topics` — CBSE topic hierarchy
- `question_bank` — Assessment questions (text, options, difficulty, Bloom's)
- `chapters` — Textbook chapters
- `cms_assets` — CMS managed content

### Gamification
- `leaderboard` related tables
- XP system tables
- `experiment_observations` — STEM lab observations

### Users and Access
- `teachers` — Teacher profiles
- `guardians` — Parent/guardian profiles
- `guardian_student_links` — Parent-child relationship with approval flow
- `admin_users` — Super admin accounts
- `user_roles` — RBAC role assignments
- `admin_audit_log` — Admin action audit trail

### AI and Adaptive Learning
- RAG pipeline tables (vector embeddings, syllabus content)
- Cognitive learner model tables
- Misconception remediation tables
- Adaptive difficulty engine tables
- Diagnostic assessment tables

### Infrastructure
- `feature_flags` — Feature flag configuration
- `task_queue` — Background job queue
- `rate_limiting` — Rate limit tracking
- `schools` — Institution directory
- `deployment_history` — Deploy tracking
- `backup_status` — Backup verification

### Pedagogy
- NEP/NIPUN alignment schema
- TARL (Teaching at the Right Level) tables
- Spaced repetition tables
- Learning graph (6-level depth model)
- Cognitive learning loop (8-step)

## Third-Party Integrations

| Service | Purpose | Configuration |
|---|---|---|
| Supabase | Database, Auth, Storage, Edge Functions | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Razorpay | Payment processing (INR) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Upstash Redis | Distributed rate limiting | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Sentry | Error monitoring (client + server + edge) | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| Vercel | Hosting, CDN, serverless (bom1/Mumbai) | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN` |
| Claude API | AI (Haiku model via Edge Functions) | Configured in Edge Function env |
| Google Fonts | Typography | CSP allowlisted |

## Environment Variables

### Public (client-accessible)
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking DSN |

### Server-only (never exposed to client)
| Variable | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin access (bypasses RLS) |
| `SUPER_ADMIN_SECRET` | Admin panel gate secret |
| `RAZORPAY_KEY_ID` | Razorpay API key |
| `RAZORPAY_KEY_SECRET` | Razorpay API secret |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification |
| `UPSTASH_REDIS_REST_URL` | Redis endpoint for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth token |

### Vercel-provided (automatic)
| Variable | Purpose |
|---|---|
| `VERCEL_ENV` | Environment (production/preview/development) |
| `VERCEL_REGION` | Deployment region |
| `VERCEL_DEPLOYMENT_ID` | Current deployment ID |
| `VERCEL_GIT_COMMIT_SHA` | Current commit hash |
| `VERCEL_GIT_COMMIT_REF` | Current branch |
| `VERCEL_GIT_COMMIT_MESSAGE` | Commit message |
| `VERCEL_GIT_COMMIT_AUTHOR_LOGIN` | Commit author |
| `SENTRY_ORG` | Sentry organization slug |
| `SENTRY_PROJECT` | Sentry project slug |

## Current Test Coverage

### Unit Tests (Vitest)
- **26 test files**, estimated **722 test cases** (based on `it()` count)
- Test environment: jsdom
- Coverage provider: v8, targeting `src/lib/**`
- Coverage thresholds (aspirational, not enforced in CI yet):
  - Global: 60% (statements, branches, functions, lines)
  - `xp-rules.ts`: 90%
  - `cognitive-engine.ts`: 80%
  - `exam-engine.ts`: 80%

### Test File Inventory
| File | `it()` Count | Domain |
|---|---|---|
| `score-accuracy.test.ts` | 40 | Quiz scoring (P1) |
| `xp-calculation.test.ts` | 38 | XP economy (P2) |
| `xp-rules.test.ts` | 37 | XP rules (P2) |
| `api-quiz-flow.test.ts` | 36 | Quiz API flow |
| `rbac.test.ts` | 35 | RBAC (P9) |
| `quiz-scoring.test.ts` | 31 | Score formulas |
| `foxy-safety.test.ts` | 30 | AI safety (P12) |
| `question-quality.test.ts` | 29 | Question validation (P6) |
| `grade-format.test.ts` | 28 | Grade as string (P5) |
| `scoring.test.ts` | 27 | Scoring logic |
| `quiz-submission.test.ts` | 27 | Atomic submission (P4) |
| `foxy-tutor-logic.test.ts` | 27 | AI tutor logic |
| `ncert-solver.test.ts` | 26 | NCERT solver |
| `quiz-generator-logic.test.ts` | 25 | Quiz generation |
| `feedback-engine.test.ts` | 25 | Feedback engine |
| `smoke.test.tsx` | 24 | Component smoke tests |
| `cognitive-load.test.ts` | 23 | Cognitive load |
| `anti-cheat.test.ts` | 23 | Anti-cheat (P3) |
| `exam-engine.test.ts` | 40 | Exam engine |
| `auth-admin.test.ts` | 19 | Admin auth |
| `security.test.ts` | 19 | Security checks |
| `payment.test.ts` | 18 | Payment flow (P11) |
| `admin-control-plane.test.ts` | 12 | Admin control plane |
| `api.test.ts` | 8 | API smoke tests |
| `india.test.ts` | 7 | India-specific locale |
| `cognitive-engine.test.ts` | 70 | Cognitive engine (deep) |

### E2E Tests (Playwright)
- **16 spec files** covering smoke tests, navigation, accessibility, SEO, auth flows, API health, payment ops, school admin, observability, and more
- Timeout: 30s with 1 retry
- Targets `http://localhost:3000` (dev server auto-started outside CI)

### What Is Not Tested
- No integration tests against a real Supabase instance
- No E2E tests for authenticated flows (quiz, dashboard, payment)
- Coverage thresholds not enforced in CI (aspirational only)
- Regression catalog: 35 defined, implementation coverage gaps in quiz scoring and payment areas
