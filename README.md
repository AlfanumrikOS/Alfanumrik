# Alfanumrik Learning OS

**v2.0.0** | K-12 EdTech platform for CBSE students (grades 6-12) in India.

Alfanumrik provides an AI-powered learning experience with adaptive quizzes, an AI tutor (Foxy), progress tracking, exam simulations, interactive science/math simulations, and a gamified XP system -- all built for Indian school networks on low-bandwidth connections.

The product is structured around the **Three-Speed Learning Rhythm** (Pedagogy v2): a daily 15-minute mastery loop, a weekly 60-minute Curiosity Dive with Foxy, and a monthly Synthesis milestone with parent-shareable bilingual summaries. See `docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md` for the spec.

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
| Student | `/dashboard`, `/foxy`, `/learn`, `/progress`, `/leaderboard`, `/exams`, `/simulations`, `/dive`, `/dive/history`, `/synthesis` | Learning, quizzes, AI tutor, progress tracking, simulations, weekly Curiosity Dive, monthly Synthesis |
| Parent | `/parent/*` | Child monitoring, linked student progress |
| Teacher | `/teacher/*` | Class management, student reports, assignments |
| School Admin | `/school-admin/*` | B2B school management, analytics, billing |
| Super Admin | `/super-admin/*` | Platform operations, user management, CMS, diagnostics |

## AI Features

Alfanumrik integrates Claude-powered AI across the learning experience:

- **Foxy AI Tutor** -- CBSE curriculum-aligned conversational tutor with seven modes (`learn`, `explain`, `practice`, `revise`, `doubt`, `homework`, `explorer`). Adapts to grade level, persona, and pedagogical context; enforces age-appropriate responses.
- **NCERT Solver** -- Breaks down NCERT textbook questions with detailed, syllabus-accurate explanations.
- **Quiz Generator** -- AI-powered adaptive quiz creation that generates questions matched to the student's proficiency and Bloom's taxonomy level.
- **Cognitive Mastery Engine (CME)** -- BKT/IRT-based learner modeling that tracks knowledge state per topic, identifies gaps, and recommends next steps.
- **RAG Pipeline** -- pgvector embeddings over NCERT content and question banks for retrieval-augmented generation, powering accurate and grounded AI responses.
- **Monthly Synthesis Summary** -- Claude Haiku generates a bilingual (EN+HI) one-page parent-share summary from the student's monthly mastery delta + weekly artifacts. Lazy-filled on first view; cached on the synthesis row.

All AI responses are filtered for age-appropriateness (grades 6-12), scoped to the CBSE curriculum, and subject to daily usage limits per subscription plan.

## Pedagogy v2 — Three-Speed Learning Rhythm

The product is organized around three nested time-scales, each with its own surface and persona-adaptive content:

| Speed | Surface | What it is |
|-------|---------|------------|
| **Daily** (~15 min) | `/dashboard` (rhythm queue) | 5 SRS reviews + 1 ZPD problem (productive-failure flipped: attempt before tutorial) + 1 reflection prompt |
| **Weekly** (~60 min) | `/dive` (picker + Foxy explorer + artifact composer), `/dive/history` (journal) | One curiosity dive per ISO week — phenomenon, weak-topic repair, or own-topic exploration. Produces one editable artifact per week |
| **Monthly** | `/synthesis` (ritual + parent-share card), `/hpc` (chip) | Auto-aggregated mastery delta + weekly artifact compilation + bilingual parent-share via WhatsApp (parent opt-in) |

All three surfaces are flag-gated and persona-adaptive (six personas: `improve_basics`, `pass_comfortably`, `school_topper`, `board_topper`, `competitive_exam`, `olympiad`). The pedagogy itself implements 15+ cognitive-science principles via `src/lib/cognitive-engine.ts` (SM-2 spaced repetition, IRT 3PL ability estimation, Bayesian Knowledge Tracing, Bloom's taxonomy progression, productive failure, retrieval practice, metacognitive prompts, and more).

Pedagogy v2 reference docs:
- Strategic spec: `docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md`
- Implementation plans: `docs/superpowers/plans/2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md`, `2026-05-09-pedagogy-v2-wave-1b-rhythm-data-and-surface.md`, `2026-05-09-pedagogy-v2-wave-2-weekly-dive.md`, `2026-05-09-pedagogy-v2-wave-3-monthly-synthesis.md`
- Rollout runbook: `docs/superpowers/runbooks/2026-05-09-pedagogy-v2-wave-1-rollout.md`

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

## Recent Highlights (May 2026)

- **Pedagogy v2 — Three-Speed Learning Rhythm shipped end-to-end** (PRs #635-#647). Daily / weekly / monthly rhythm layers all live on production behind feature flags; covers productive-failure flip on `/learn`, distractor micro-explainer (Eedi pattern) in quiz wrong-answer surfaces, weekly Curiosity Dive with Foxy explorer mode + artifact composer, monthly Synthesis with Claude Haiku bilingual parent-share, and persona-aware content selection across all three layers.
- **Foxy explorer mode added** -- new `FoxyMode` for self-directed weekly dives. Socratic-led but allows direct exposition when student is stuck (key differentiator from `homework` mode), RAG-grounded.
- **Three new pure-function orchestrators** -- `daily-rhythm-orchestrator`, `weekly-dive-orchestrator`, `monthly-synthesis-orchestrator` -- compose existing engines into the rhythm, each fully unit-tested.

## Earlier Highlights (April 2026)

- **Phase A/B/C quiz authenticity** -- server-authoritative shuffle, DB CHECK constraints, options-versioning + integrity hash (PRs #447, #449, #452)
- **AI quiz-generator validation oracle** -- deterministic + LLM-grader gate catching hallucinations before bank insert (PRs #454, #460)
- **Server-authoritative quiz mobile cutover** -- Flutter app on `submit_quiz_results_v2` + `/api/foxy` SSE route (PR #453)
- **IRT 2PL nightly calibration + Misconception curator** -- Foxy moat phases 0-5 active in production
- **Schema-reproducibility fix workflow** -- `gh workflow run schema-reproducibility-fix.yml -f step=...` automation in place; final TOC-driven topo-sort scheduled for next sprint

## License

Proprietary. All rights reserved.