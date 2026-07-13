# Alfanumrik Learning OS

Alfanumrik Learning OS is a K-12 EdTech platform for CBSE students in grades 6-12 in India. It brings quizzing, an AI tutor, progress tracking, exams, and simulations together into a single learning operating system, with dedicated portals for **students, parents, teachers, and administrators**. The platform is bilingual (Hindi/English), built for Indian mobile networks, and ships as both a Next.js web application and a Flutter mobile app that share a common API contract.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2 (App Router), React 18, Tailwind CSS 3.4, SWR |
| Backend | Next.js API routes (`apps/host/src/app/api/`) + Supabase Edge Functions (Deno runtime, `Deno.serve()`) |
| Database | Supabase PostgreSQL with Row Level Security (440+ policies), RBAC (6 roles, 71 permissions), pgvector for RAG |
| Auth | Supabase Auth (email/PKCE), JWT auto-refresh via middleware (`apps/host/src/proxy.ts`) |
| Payments | Razorpay (INR subscriptions — monthly recurring + yearly one-time) |
| AI | Claude (Haiku) via Supabase Edge Functions (`ncert-solver`, `quiz-generator`, `cme-engine`) and the Foxy AI-tutor Next.js route (`apps/host/src/app/api/foxy/route.ts`), backed by NCERT-grounded RAG |
| Mobile | Flutter 3.16+ / Dart 3.2+, Riverpod, GoRouter (in `/mobile`, shares the web API contract) |
| Monitoring | Sentry (client / server / edge), Vercel Analytics, structured logging |
| Deployment | Vercel (bom1 / Mumbai region), GitHub Actions CI/CD |

## Architecture Overview

The repository is an **npm workspace monorepo**. The Next.js web application lives in the `apps/host` workspace, shared code lives in `packages/lib` and `packages/ui`, and the Supabase, mobile, and documentation trees sit at the repo root. Within the web app, the `@/*` path alias maps to `apps/host/src/*`.

**Multi-portal application.** A single app serves four audiences through dedicated routes and APIs:

| Portal | Routes | APIs |
|---|---|---|
| Student | `/dashboard`, `/foxy`, `/learn`, `/progress`, `/leaderboard`, `/exams`, `/simulations` | `/api/*` |
| Parent | `/parent/*` | `/api/*` |
| Teacher | `/teacher/*` | `/api/*` |
| Super Admin | `/super-admin/*` | `/api/super-admin/*` |
| Internal Admin | `/internal/admin/*` | `/api/v1/admin/*` |

**Three Supabase clients** (use the right one for the context):

- `apps/host/src/lib/supabase.ts` — client-side; respects RLS.
- `apps/host/src/lib/supabase-server.ts` — server components / middleware; respects RLS.
- `apps/host/src/lib/supabase-admin.ts` — server-only; bypasses RLS via the service role. Never import in client code.

**Supabase Edge Functions** (`supabase/functions/`) run on the Deno runtime (`Deno.serve()`, ES module imports, no `node_modules`). Each function is a directory with its own `index.ts`, covering AI (NCERT solver, quiz generation, CME engine), email, cron jobs, OCR, reporting, and more.

**Middleware** (`apps/host/src/proxy.ts`) runs on every request: auth validation and JWT refresh, rate limiting (Upstash Redis with in-memory fallback), bot detection, request-ID tracing, and feature-flag evaluation.

**Security model.** Authorization is enforced server-side in API routes; the client-side permissions hook is a UI convenience, not a security boundary. Every table has RLS enabled with policies covering the student / parent / teacher / admin access patterns. Student data is accessible only to the student, their linked parent, their assigned teacher, or an admin acting through the service role.

## Getting Started / Local Development

**Prerequisites:** Node.js 20.x (`>=20 <23`), npm, and the [Supabase CLI](https://supabase.com/docs/guides/cli). For mobile work you also need the Flutter SDK (3.16+ / Dart 3.2+).

Install dependencies from the repo root (this installs all workspaces):

```bash
npm install
```

### Web (Next.js)

Root-level scripts run against the workspaces (`dev`/`build` target `apps/host`; `lint`/`type-check`/`test` run across all workspaces):

```bash
npm run dev          # Dev server at http://localhost:3000
npm run build        # Production build
npm run type-check   # TypeScript validation (tsc --noEmit)
npm run lint         # ESLint on the web app source
npm test             # Vitest unit tests
```

Scripts that are defined only in the web workspace can be run with `-w apps/host`:

```bash
npm run test:e2e -w apps/host        # Playwright E2E suite
npm run test:watch -w apps/host      # Vitest in watch mode
npm run test:coverage -w apps/host   # Vitest with V8 coverage
npm run analyze -w apps/host         # Bundle analysis (ANALYZE=true next build)
```

Run a single unit test:

```bash
npm test -w apps/host -- src/__tests__/path/to/file.test.ts
```

### Mobile (Flutter)

```bash
cd mobile
flutter pub get      # Install dependencies
flutter run          # Run on a connected device / emulator
flutter build apk    # Build an Android APK
flutter analyze      # Dart static analysis
flutter test         # Flutter tests
```

### Supabase Edge Functions (Deno)

```bash
supabase functions serve <name> --env-file .env.local   # Local dev for one function
supabase functions deploy <name>                         # Deploy a single function
supabase db push                                         # Apply pending migrations
supabase migration new <name>                            # Create a new migration
```

## Environment Variables

Set these in the web app's local env file (for example `apps/host/.env.local`) for development, and in your hosting provider's environment for production. **Never commit real values** — the list below is variable names only.

**Required (production):**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public, RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-only, bypasses RLS) |
| `RAZORPAY_KEY_ID` | Razorpay API key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signing secret |
| `SUPER_ADMIN_SECRET` | Super-admin authentication secret |

**Optional:**

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Rate-limiting store (falls back to in-memory if unset) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error monitoring DSN |

> Email credentials are configured as **Supabase Edge Function secrets**, not in the web app's `.env` files.

## Testing

- **Unit tests** — [Vitest](https://vitest.dev) with JSDOM. Tests live in `apps/host/src/__tests__/`. Run with `npm test` (or `npm run test:coverage -w apps/host` for coverage).
- **E2E tests** — [Playwright](https://playwright.dev). Specs live in `e2e/`. Run with `npm run test:e2e -w apps/host`.
- **CI pipeline** — GitHub Actions runs secret scanning, type-check, lint, unit tests, an auth gate, the production build, a bundle-size check, and E2E on pull requests, followed by a post-deploy health check on `main`.

## Project Structure

```
apps/host/                 Next.js web application (the main app)
  src/app/                 App Router pages + API routes (per portal)
  src/components/          React components
  src/lib/                 Shared logic: xp-rules, rbac, feature-flags,
                           logger, and the three Supabase clients
  src/proxy.ts             Middleware (auth, rate limiting, feature flags)
  src/__tests__/           Vitest unit tests
packages/lib/              Shared library workspace (@alfanumrik/lib)
packages/ui/               Shared UI workspace (@alfanumrik/ui)
supabase/functions/        Deno Edge Functions (AI, email, cron, OCR, reports)
supabase/migrations/       SQL migrations (RLS + RBAC in every table migration)
mobile/                    Flutter mobile app (shared API contract)
docs/                      Operational docs (RBAC matrix, backup/restore, admin ops)
e2e/                       Playwright E2E specs
```

## Design Principles

A few product constraints are treated as non-negotiable invariants across the codebase:

- **Bilingual UI** — all user-facing text supports Hindi and English; technical terms (CBSE, XP, Bloom's) are not translated.
- **Built for Indian 4G** — strict bundle budgets for shared JS, pages, and middleware target 2-5 Mbps networks.
- **Fixed score formula** — `Math.round((correct / total) * 100)`, applied identically on the client, on submission, and in the database RPC.
- **Centralized XP economy** — all XP constants live in `src/lib/xp-rules.ts`; no hardcoded XP values elsewhere.
- **Atomic quiz submission** — quiz results are written through a single-transaction RPC, never split into separate operations.
- **Anti-cheat** — enforced both client-side and server-side (minimum average time per question, no all-same-answer patterns, response count must equal question count).
- **Grades are strings** — `"6"` through `"12"`, never integers, everywhere (database, RPCs, APIs, TypeScript).

## Contributing / Repository Conventions

This is a private repository. Before making changes, read **`CLAUDE.md`** (root) and **`.claude/CLAUDE.md`** — together they define the full development rules, the product invariants (P1-P15) that cannot be violated, the build and testing workflow, and the review conventions used across the codebase. Additional operational runbooks and architecture notes live under `docs/` and in root-level docs such as `ARCHITECTURE.md` and `LAUNCH_CHECKLIST.md`.
