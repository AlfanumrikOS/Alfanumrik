# Alfanumrik Learning OS

K-12 EdTech platform for CBSE students (grades 6-12) in India. Alfanumrik provides an AI-powered learning experience with adaptive quizzes, an AI tutor (Foxy), progress tracking, exam simulations, and a gamified XP system -- all built for Indian school networks on low-bandwidth connections.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16.2 (App Router), React 18, Tailwind CSS 3.4, SWR |
| Backend | Next.js API routes + Supabase Edge Functions (Deno) |
| Database | Supabase PostgreSQL with RLS, RBAC (6 roles, 71 permissions), pgvector |
| Auth | Supabase Auth (email/PKCE), JWT auto-refresh via middleware |
| Payments | Razorpay (INR subscriptions) |
| AI | Claude Haiku via Edge Functions (Foxy tutor, NCERT solver, quiz generator) |
| Mobile | Flutter 3.16+ / Dart 3.2+ with Riverpod and GoRouter |
| Monitoring | Sentry (client/server/edge), Vercel Analytics |
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
    api/            # Backend API routes (32+ endpoints)
    dashboard/      # Student dashboard
    foxy/           # AI tutor chat interface
    learn/          # Learning content browser
    parent/         # Parent portal (5 pages)
    teacher/        # Teacher portal (6 pages)
    school-admin/   # School admin portal (B2B)
    super-admin/    # Super admin panel (17 pages)
  components/       # Shared React components
    quiz/           # Quiz engine components
    ui/             # Design system primitives
    xp/             # XP and gamification widgets
  lib/              # Shared utilities, clients, and business logic
supabase/
  functions/        # Deno Edge Functions (24 functions)
  migrations/       # PostgreSQL migrations (160+ files)
mobile/             # Flutter mobile app
docs/               # Operational documentation
e2e/                # Playwright E2E test specs
```

## Multi-Portal Architecture

Alfanumrik serves five distinct user roles, each with dedicated routes:

| Portal | Route | Purpose |
|--------|-------|---------|
| Student | `/dashboard`, `/foxy`, `/learn`, `/progress`, `/leaderboard`, `/exams` | Learning, quizzes, AI tutor, progress tracking |
| Parent | `/parent/*` | Child monitoring, linked student progress |
| Teacher | `/teacher/*` | Class management, student reports, assignments |
| School Admin | `/school-admin/*` | B2B school management, analytics, billing |
| Super Admin | `/super-admin/*` | Platform operations, user management, CMS, diagnostics |

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

## License

Proprietary. All rights reserved.