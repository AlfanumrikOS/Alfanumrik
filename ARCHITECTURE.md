# Alfanumrik — Production Architecture (5,000+ Concurrent Students)

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│  Mobile (PWA) · Desktop Browser · Parent Portal · Teacher Portal │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS (TLS 1.3)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EDGE LAYER (Vercel)                            │
│  ┌──────────┐  ┌───────────┐  ┌─────────────┐  ┌────────────┐  │
│  │ CDN/Edge │  │ Middleware │  │ Rate Limiter │  │ Bot Guard  │  │
│  │  Cache   │  │ (Auth+Sec)│  │  (IP-based)  │  │ (Scanner   │  │
│  │  (ISR)   │  │           │  │              │  │  blocking) │  │
│  └──────────┘  └───────────┘  └─────────────┘  └────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
┌────────────────┐ ┌──────────┐ ┌──────────────────┐
│  Next.js App   │ │ API Routes│ │ Supabase Edge    │
│  (SSR/SSG)     │ │ /api/v1/* │ │ Functions (Deno) │
│                │ │           │ │                  │
│ • Dashboard    │ │ • Admin   │ │ • foxy-tutor     │
│ • Quiz Engine  │ │ • Upload  │ │ • quiz-generator │
│ • Study Plans  │ │ • Exams   │ │ • export-report  │
│ • Simulations  │ │ • Perf.   │ │ • daily-cron     │
│ • Foxy Chat    │ │ • Classes │ │ • queue-consumer │
│ • Leaderboard  │ │ • Perf.   │ │ • send-auth-email│
└────────────────┘ └──────────┘ └──────────────────┘
          │              │              │
          └──────────────┼──────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATA LAYER                                    │
│                                                                  │
│  ┌──────────────────────┐  ┌─────────────────────────────────┐  │
│  │   Supabase (Postgres) │  │  Supabase Realtime              │  │
│  │                       │  │  • Quiz live updates             │  │
│  │  • 40+ tables         │  │  • Leaderboard changes           │  │
│  │  • 148+ RLS policies  │  │  • Notification delivery         │  │
│  │  • pgvector (RAG)     │  │                                  │  │
│  │  • BRIN + B-tree idx  │  │  ┌────────────────────────────┐  │  │
│  │  • SM-2 / BKT / IRT   │  │  │  Supabase Storage          │  │  │
│  │                       │  │  │  • Student uploads (10MB)   │  │  │
│  └──────────────────────┘  │  │  • Assignment images         │  │  │
│                             │  └────────────────────────────┘  │  │
│  ┌──────────────────────┐  └─────────────────────────────────┘  │
│  │   External AI APIs    │                                       │
│  │  • Claude Haiku (chat)│  ┌─────────────────────────────────┐  │
│  │  • Razorpay (Payments) │  │  External Services               │  │
│  │  • RAG embeddings     │  │  • Resend (email)                │  │
│  └──────────────────────┘  │  • Vercel Analytics               │  │
│                             │  • Vercel Speed Insights          │  │
│                             └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | Next.js 14 (App Router) | SSR + ISR + Edge middleware |
| **UI** | Tailwind CSS + custom components | Zero runtime CSS, 7 dependencies |
| **State** | SWR + React Context | Stale-while-revalidate for flaky networks |
| **Auth** | Supabase Auth (PKCE) | Email/password + OAuth, RLS integration |
| **Database** | PostgreSQL (Supabase) | RLS, pgvector, JSONB, BRIN indexes |
| **Edge Functions** | Deno (Supabase) | AI tutor, quiz gen, email hooks |
| **AI** | Claude Haiku | Low-latency, cost-effective tutoring |
| **Payments** | Razorpay | INR payments with order+verify+webhook |
| **Hosting** | Vercel | Auto-scaling, edge network, ISR |
| **Email** | Resend | Transactional emails (auth, reports) |
| **Monitoring** | Vercel Analytics + custom logging | Performance + error tracking |
| **PWA** | Service Worker v3 | Offline-first for Indian networks |

## 3. Scaling Strategy for 5,000 Concurrent Students

### 3.1 Request Volume Estimation

```
5,000 concurrent students
× ~1 request/3 seconds (active browsing)
= ~1,667 requests/second peak

Breakdown by type:
├── Page loads (SSR/ISR):     ~400 req/s  → Vercel Edge Cache handles
├── API reads (SWR cached):   ~600 req/s  → Supabase + SWR dedup
├── API writes (quiz submit):  ~200 req/s  → Supabase direct
├── Foxy AI chat:              ~100 req/s  → Edge function → Claude
├── Realtime (WebSocket):      ~300 conn   → Supabase Realtime
└── Static assets:             ~67 req/s   → CDN (immutable cache)
```

### 3.2 Database Scaling

**Current indexes (optimized):**
- BRIN on `audit_logs.created_at` (time-series)
- B-tree on all `student_id` foreign keys
- Partial index on `knowledge_gaps` WHERE NOT is_resolved
- Composite on `question_bank(source, board_year)`
- Covering indexes on hot-path queries

**Connection management:**
- Supabase Pro: 60 direct + 200 pooled connections (Supavisor)
- Edge functions use pooled connections (transaction mode)
- SWR deduplication reduces DB hits by ~70%

**Capacity at 5K concurrent:**
```
200 pooled connections × 50ms avg query = 4,000 queries/sec ✓
Peak API writes: 200/sec × 2 queries each = 400 queries/sec ✓
Headroom: 90% (well within limits)
```

### 3.3 AI/Chat Scaling

**Bottleneck:** Claude API rate limits + latency (~2-5s per response)

**Mitigations (already implemented):**
1. Claude Haiku model (fastest, cheapest)
2. Concise system prompts (~150 tokens)
3. Fire-and-forget DB writes (don't block response)
4. Per-student rate limit: 30 msg/min
5. Daily limits by plan (50/200/1000)

**Capacity at 5K concurrent:**
```
~100 AI requests/sec peak
Claude API: ~1000 req/min on Haiku tier
Per-request: 150 input + ~300 output tokens
Monthly cost: ~$200-400 at 5K students
```

### 3.4 Frontend Performance

**Already optimized for Indian 4G networks:**
- SWR with stale-while-revalidate (show cached data instantly)
- Service Worker with cache-first for assets
- Code splitting: 8 simulations loaded dynamically
- Skeleton screens for perceived performance
- Background sync for offline queue
- gzip compression enabled
- Immutable cache headers for `_next/static/`

### 3.5 Vercel Auto-Scaling

```
Serverless Functions:
├── Default: scales to 1000 concurrent executions
├── Max duration: 60s (Pro plan)
├── Memory: 1024MB per function
└── Cold start: <100ms (Node.js)

Edge Middleware:
├── Runs on every request
├── <1ms overhead
└── Global edge network (Mumbai PoP for India)

ISR (Incremental Static Regeneration):
├── Static pages: cached at edge
├── Revalidation: on-demand or timed
└── Zero compute for repeat requests
```

## 4. Security Architecture

```
┌──────────────────────────────────────────────┐
│              DEFENSE IN DEPTH                 │
│                                               │
│  Layer 1: Network                             │
│  ├── HTTPS + HSTS (1 year, preload)          │
│  ├── CSP (strict, no unsafe-eval)            │
│  ├── CORS allowlist (4 domains)              │
│  └── Bot/scanner blocking                    │
│                                               │
│  Layer 2: Application                         │
│  ├── Rate limiting (60 req/min general)      │
│  ├── 5 req/min for parent login              │
│  ├── Input validation (file type/size/date)  │
│  ├── XSS protection headers                  │
│  └── Request ID tracing                      │
│                                               │
│  Layer 3: Authentication                      │
│  ├── Supabase PKCE flow                      │
│  ├── JWT tokens (auto-refresh)               │
│  ├── Session cookies (server-side)           │
│  └── Role detection (student/parent/teacher) │
│                                               │
│  Layer 4: Authorization (RBAC)               │
│  ├── 6 roles, 71 permissions                 │
│  ├── Hierarchy-based access                  │
│  ├── Resource ownership checks               │
│  └── 5-minute permission cache               │
│                                               │
│  Layer 5: Database (RLS)                      │
│  ├── 148+ row-level security policies        │
│  ├── Student isolation (own data only)       │
│  ├── Guardian access (linked children)       │
│  ├── Teacher access (assigned students)      │
│  └── Service role for edge functions         │
│                                               │
│  Layer 6: Anti-Cheat                          │
│  ├── Min 3s per quiz question                │
│  ├── Pattern detection (same-option)         │
│  ├── State machine enforcement               │
│  ├── Server-side XP only                     │
│  └── Grade/board lock after first quiz       │
└──────────────────────────────────────────────┘
```

## 5. Monitoring & Observability

```
┌─────────────────────────────────────────────┐
│            OBSERVABILITY STACK               │
│                                              │
│  Metrics:                                    │
│  ├── Vercel Analytics (Web Vitals)          │
│  ├── Vercel Speed Insights (Core Vitals)    │
│  ├── Custom /api/v1/health endpoint         │
│  └── Edge function latency tracking         │
│                                              │
│  Logging:                                    │
│  ├── Structured JSON logs (lib/logger.ts)   │
│  ├── Request ID correlation                 │
│  ├── Audit trail (audit_logs table)         │
│  └── AI tutor logs (ai_tutor_logs table)    │
│                                              │
│  Error Tracking:                             │
│  ├── ErrorBoundary (sendBeacon)             │
│  ├── API error responses (structured)       │
│  ├── Edge function error handling           │
│  └── Service health checks                  │
│                                              │
│  Alerting:                                   │
│  ├── Vercel deployment notifications        │
│  ├── Supabase usage alerts                  │
│  ├── Daily cron health check                │
│  └── Error rate threshold alerts            │
└─────────────────────────────────────────────┘
```

## 6. Cost Estimation (5,000 Students)

| Service | Tier | Monthly Cost |
|---------|------|-------------|
| Vercel | Pro | $20 |
| Supabase | Pro | $25 |
| Claude API (Haiku) | Pay-per-use | ~$300 |
| Razorpay (Payments) | Live | Usage-based |
| Resend (Email) | Free tier | $0 |
| Domain + DNS | Annual | ~$2/mo |
| **Total** | | **~$352/mo** |

## 7. Future Scaling (50,000+ Students)

| Concern | Solution |
|---------|----------|
| DB connections | Supabase Team plan (500 pooled) or self-hosted PgBouncer |
| AI rate limits | Claude Batch API for non-real-time, multi-region edge functions |
| Global latency | Vercel Edge Config for feature flags, regional Supabase read replicas |
| Cost optimization | Response caching (Redis/Upstash), prompt compression, model routing |
| Realtime at scale | Supabase Realtime channels with topic-based subscriptions |
| Data volume | Table partitioning (by month for audit_logs, quiz_sessions) |
| Search | pgvector + RAG pipeline already in place, add embedding cache |
| CDN | Move static assets to Cloudflare R2 if Vercel bandwidth limits hit |

## 8. Deployment Pipeline

```
Developer Push → GitHub Actions CI
                 ├── Type Check (tsc --noEmit)
                 ├── Lint (next lint)
                 ├── Unit Tests (vitest)
                 ├── Build (next build)
                 └── ✅ All pass?
                      ├── Preview Deploy (PR) → Vercel Preview
                      └── Production Deploy (main) → Vercel Production
                           ├── Edge Functions Deploy (Supabase)
                           ├── Migration Check
                           └── Health Check (POST-deploy)
```

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Claude API outage | Chat unusable | Low | Graceful degradation, cached responses |
| Supabase downtime | App unusable | Low | Service Worker offline mode, local queue |
| Indian network flaky | Poor UX | High | SWR cache, PWA, background sync |
| DDoS attack | App down | Medium | Vercel DDoS protection, rate limiting |
| Data breach | Critical | Low | RLS + RBAC + encryption + audit logs |
| Cost spike (AI) | Budget | Medium | Daily limits, plan-based throttling |
| Cold start latency | Slow first load | Medium | Edge runtime, ISR pre-rendering |

## 10. Production Checklist

- [x] RLS policies on all tables (148+)
- [x] RBAC with 71 permissions
- [x] Security headers (CSP, HSTS, X-Frame)
- [x] Rate limiting (middleware)
- [x] Bot/scanner blocking
- [x] Input validation
- [x] Anti-cheat mechanisms
- [x] Audit logging
- [x] PWA + Service Worker
- [x] SWR caching layer
- [x] Error boundary + beacon
- [x] Usage tracking + daily limits
- [x] CORS allowlist
- [x] Env var validation
- [x] Compression enabled
- [x] Cache headers for static assets
- [x] Code splitting for simulations
- [x] Skeleton loading screens
- [x] Foxy tutor edge function
- [x] CI/CD pipeline (GitHub Actions)
- [x] Health check endpoint
- [x] Structured logging
- [x] Load testing scripts
- [x] Production deployment docs
