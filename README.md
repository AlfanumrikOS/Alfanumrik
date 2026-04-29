# Alfanumrik Learning OS

**v2.0.0** | K-12 EdTech platform for CBSE students (grades 6-12) in India.

Alfanumrik provides an AI-powered learning experience with adaptive quizzes, an AI tutor (Foxy), progress tracking, exam simulations, interactive science/math simulations, and a gamified XP system -- all built for Indian school networks on low-bandwidth connections.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16.2 (App Router), React 18, Tailwind CSS 3.4, SWR |
| Backend | Next.js API routes (179 endpoints) + Supabase Edge Functions (29 functions, Deno) |
| Database | Supabase PostgreSQL with RLS (440+ policies), RBAC (6 roles, 71 permissions), pgvector |
| Auth | Supabase Auth (email/PKCE), JWT auto-refresh via middleware |
| Payments | Razorpay (INR subscriptions) |
| AI | Claude via Edge Functions (Foxy tutor, NCERT solver, quiz generator, cognitive mastery engine) |
| Mobile | Flutter 3.16+ / Dart 3.2+ with Riverpod and GoRouter |
| Monitoring | Sentry (client/server/edge), Vercel Analytics, structured JSON logging |
| Deployment | Vercel (bom1/Mumbai region), GitHub Actions CI/CD |

## Quick Start

### Prerequisites

- Node.js 20+
- npm 9+
- Git

### Setup

```bash
git clone <repository-url>
cd alfanumrik
npm install
```

Copy the environment template and fill in your credentials:

```bash
cp .env.example .env.local
```

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL` -- Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` -- Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` -- Supabase service role key (server-only)
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` -- Payment processing
- `SUPER_ADMIN_SECRET` -- Admin panel authentication

Start the development server:

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build (runs auth guard first) |
| `npm run type-check` | TypeScript validation (`tsc --noEmit`) |
| `npm run lint` | ESLint on `src/` (.ts/.tsx files) |
| `npm test` | Run Vitest unit tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with V8 coverage |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run analyze` | Bundle analysis (`ANALYZE=true next build`) |

## Project Structure

```
src/
  app/              # Next.js App Router pages and API routes
    api/            # Backend API routes (179 endpoints)
    dashboard/      # Student dashboard
    foxy/           # AI tutor chat interface
    learn/          # Learning content browser
    simulations/    # Interactive science/math simulations (119 components)
    parent/         # Parent portal (6 pages)
    teacher/        # Teacher portal (8 pages)
    school-admin/   # School admin portal (B2B)
    super-admin/    # Super admin panel (43 pages)
  components/       # Shared React components
    quiz/           # Quiz engine components
    ui/             # Design system primitives
    xp/             # XP and gamification widgets
  lib/              # Shared utilities, clients, and business logic
supabase/
  functions/        # Deno Edge Functions (29 functions)
  migrations/       # PostgreSQL migrations (358 files)
mobile/             # Flutter mobile app
docs/               # Operational documentation
e2e/                # Playwright E2E test specs (26 specs)
```

1,168 TypeScript source files across the codebase.

## Multi-Portal Architecture

Alfanumrik serves five distinct user roles, each with dedicated routes:

| Portal | Route | Purpose |
|--------|-------|---------|
| Student | `/dashboard`, `/foxy`, `/learn`, `/progress`, `/leaderboard`, `/exams`, `/simulations` | Learning, quizzes, AI tutor, progress tracking, simulations |
| Parent | `/parent/*` | Child monitoring, linked student progress |
| Teacher | `/teacher/*` | Class management, student reports, assignments |
| School Admin | `/school-admin/*` | B2B school management, analytics, billing |
| Super Admin | `/super-admin/*` | Platform operations, user management, CMS, diagnostics |

## AI Features

Alfanumrik integrates Claude-powered AI across the learning experience:

- **Foxy AI Tutor** -- CBSE curriculum-aligned conversational tutor that provides step-by-step guidance, adapts to the student's grade level, and enforces age-appropriate responses.
- **NCERT Solver** -- Breaks down NCERT textbook questions with detailed, syllabus-accurate explanations.
- **Quiz Generator** -- AI-powered adaptive quiz creation that generates questions matched to the student's proficiency and Bloom's taxonomy level.
- **Cognitive Mastery Engine (CME)** -- BKT/IRT-based learner modeling that tracks knowledge state per topic, identifies gaps, and recommends next steps.
- **RAG Pipeline** -- pgvector embeddings over NCERT content and question banks for retrieval-augmented generation, powering accurate and grounded AI responses.

All AI responses are filtered for age-appropriateness (grades 6-12), scoped to the CBSE curriculum, and subject to daily usage limits per subscription plan.

## Interactive Simulations

119 interactive science and math simulations built as React components, covering topics across the CBSE curriculum. Simulations provide visual, hands-on learning experiences for concepts that benefit from interactive exploration.

## Testing

| Tool | Scope | Count |
|------|-------|-------|
| Vitest | Unit tests | 4,928 tests across ~230 files |
| Playwright | End-to-end tests | 26 specs |

Coverage thresholds enforced in CI:

- **Global**: 60% minimum
- **`xp-rules.ts`**: 90% minimum
- **`cognitive-engine.ts`**, **`exam-engine.ts`**: 80% minimum

Run tests:

```bash
npm test                 # Unit tests
npm run test:coverage    # Unit tests with coverage report
npm run test:e2e         # E2E tests (auto-starts dev server)
```

## Security

- **Row-Level Security (RLS)** on every database table (440+ policies) ensuring data isolation
- **RBAC** with 6 roles and 71 permissions, enforced server-side via `authorizeRequest()`
- **Rate limiting** via Upstash Redis with in-memory fallback for local development
- **Bot detection** in middleware to block automated abuse
- **PII redaction** in all structured logs -- passwords, tokens, emails, phone numbers, and API keys are never logged
- **Razorpay webhook signature verification** before processing any payment event
- **Sentry tunnel** routing to bypass ad-blockers without exposing DSN

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) -- Production architecture, scaling strategy, security layers
- [docs/](./docs/) -- Operational runbooks, RBAC matrix, backup procedures, launch checklist
- [docs/b2b/](./docs/b2b/) -- B2B school platform architecture and data model
- [.claude/CLAUDE.md](./.claude/CLAUDE.md) -- Product invariants, agent system, and development rules

## Deployment

The application deploys to Vercel in the Mumbai (bom1) region, optimized for Indian users.

- **Preview deploys** are created automatically for pull requests
- **Production deploys** trigger on push to `main`
- **CI pipeline** (GitHub Actions): secret scan, type-check, lint, test, build, bundle size check, E2E (PRs), post-deploy health check

Edge Functions deploy separately to Supabase. Database migrations are applied via `supabase db push`.

## Mobile App

The Flutter mobile app lives in `/mobile` and shares the same API contract as the web frontend.

```bash
cd mobile
flutter pub get
flutter run
```

## Contributing

Development is governed by product invariants defined in [.claude/CLAUDE.md](./.claude/CLAUDE.md). Key requirements:

- **14 product invariants** (P1-P15) that cannot be violated -- covering score accuracy, XP economy, anti-cheat, atomic quiz submission, grade format, question quality, bilingual UI, RLS boundaries, RBAC enforcement, bundle budget, payment integrity, AI safety, data privacy, and review chain completeness.
- **10-agent auto-delegation system** with domain ownership boundaries enforced by pre/post-edit hooks.
- **Review chain requirements** -- changes to critical files trigger mandatory downstream reviews (e.g., scoring changes require testing, AI, backend, frontend, and mobile review).
- **Release gates** -- type-check, lint, tests, build, and domain review must all pass before merge.

## Recent Highlights (April 2026)

- **Phase A/B/C quiz authenticity** -- server-authoritative shuffle, DB CHECK constraints, options-versioning + integrity hash (PRs #447, #449, #452)
- **AI quiz-generator validation oracle** -- deterministic + LLM-grader gate catching hallucinations before bank insert (PRs #454, #460)
- **Server-authoritative quiz mobile cutover** -- Flutter app on `submit_quiz_results_v2` + `/api/foxy` SSE route (PR #453)
- **IRT 2PL nightly calibration + Misconception curator** -- Foxy moat phases 0-5 active in production
- **Schema-reproducibility fix workflow** -- `gh workflow run schema-reproducibility-fix.yml -f step=...` automation in place; final TOC-driven topo-sort scheduled for next sprint

## License

MIT License -- see [LICENSE](./LICENSE) file.