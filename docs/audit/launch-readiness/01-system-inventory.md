# 01 — System Inventory

**Audit date:** 2026-08-29
**Branch:** main
**Commit:** b04e725d17dd68f2ac2cc232668d7f85fb57b1dd

---

## 1. Repository Structure

| Component | Path | Description |
|-----------|------|-------------|
| Monorepo root | `/` | pnpm workspaces, Node >=22.0.0 <23.0.0 |
| Host app | `apps/host/` | Next.js 16.2 App Router — primary web application |
| Shared library | `packages/lib/` | `@alfanumrik/lib` — shared utilities, types, business logic |
| UI library | `packages/ui/` | `@alfanumrik/ui` — shared React components |
| ESLint plugin | `eslint-plugin-alfanumrik/` | Custom linting rules |
| Supabase | `supabase/` | Migrations, config, edge functions, seed data |
| Docs | `docs/` | Architecture, audits, ADRs |
| CI/CD | `.github/workflows/` | 29 GitHub Actions workflow files |

## 2. Scale Counts

| Metric | Count | Source |
|--------|-------|--------|
| Database tables | 427 | `pg_class` live query |
| RLS policies | 440+ | `pg_policies` live query |
| RBAC roles | 11 | `roles` table |
| RBAC permissions | 71 | `role_permissions` table |
| API routes (route.ts) | 410 | File system glob |
| Edge Function directories | 49 (on disk) / ~102 (deployed) | File system / Supabase dashboard |
| Migrations | 632 | `supabase/migrations/` directory |
| Test files | 1,542 | File system glob |
| Vercel cron jobs | 19 | `vercel.json` |
| pg_cron jobs | 6 | Supabase config |
| RAG content chunks | 27,778 | `rag_content_chunks` table |
| Questions in question_bank | 12,826+ | `question_bank` table |
| GitHub Actions workflows | 29 | `.github/workflows/` directory |

## 3. Infrastructure

| Service | Provider | Region | Purpose |
|---------|----------|--------|---------|
| Database | Supabase PostgreSQL 17 | — | Primary data store, RLS, RPC |
| Auth | Supabase Auth (GoTrue) | — | Email/PKCE authentication |
| Edge Functions | Supabase (Deno runtime) | — | Server-side logic (grounded-answer, etc.) |
| Storage | Supabase Storage | — | File uploads, avatars |
| Realtime | Supabase Realtime | — | Live updates, presence |
| Hosting | Vercel | bom1 (Mumbai) | Next.js deployment |
| CDN | Vercel Edge Network | Global | Static assets, ISR |
| Caching | Redis (via Supabase/custom) | — | RBAC cache, session cache |
| AI — Primary | OpenAI (gpt-4o-mini, gpt-4o) | — | Foxy AI tutor |
| AI — Fallback | Anthropic Claude | — | Secondary AI fallback |
| AI — Embeddings | Voyage AI (voyage-3, 1024d) | — | RAG vector embeddings |
| Payments | Razorpay | India | INR subscriptions |
| Email | Mailgun | — | Transactional email |
| Error tracking | Sentry | — | Error monitoring |
| Analytics | PostHog | — | Product analytics |
| Vector search | pgvector (Supabase) | — | RAG similarity search |

## 4. Key Configuration

| Setting | Value | Source |
|---------|-------|--------|
| Supabase project ref | `shktyoxqhundlvkiwguu` | config.toml, .env.local |
| PostgreSQL version | 17 | config.toml |
| JWT expiry | 3600s | config.toml |
| Node.js version | >=22.0.0 <23.0.0 | package.json (engine-strict) |
| Vercel region | bom1 (Mumbai) | vercel.json |
| daily-cron verify_jwt | false | config.toml |
| Bundle budget | Configured | Three-layer gate with vacuity detection |

## 5. Path Aliases

| Alias | Resolution |
|-------|------------|
| `@/*` | `apps/host/src/*` |
| `@alfanumrik/lib/*` | `packages/lib/src/*` |
| `@alfanumrik/ui/*` | `packages/ui/src/*` |

## 6. Three Supabase Clients

| Client | RLS | Purpose |
|--------|-----|---------|
| Client-side (`createBrowserClient`) | Enforced | Browser-initiated queries; user context |
| Server-side (`createServerClient`) | Enforced | SSR/API with user's JWT; server components |
| Admin (`createAdminClient`) | **Bypassed** | Service-role key; admin operations, cron, Edge Functions |

## 7. Data Gaps

The following inventories could not be completed due to agent failures:
- Full table-by-table schema analysis (schema inventory agent failed)
- Source-of-truth drift analysis (agent failed)
- Duplicate/dead code inventory (agent failed)
- Privacy/consent flow mapping (agent failed)
