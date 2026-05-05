# ADR-001: Backend Architecture — Monolith vs Microservices vs Modular Monolith

**Status:** Accepted  
**Date:** 2026-04-08  
**Deciders:** Engineering Lead, CTO (Pradeep Sharma)  
**Supersedes:** N/A  
**Review Date:** 2026-07-08 (post-launch retrospective)

---

## Context

Alfanumrik is an adaptive learning platform for CBSE students (Grades 6–12) built on **Next.js (App Router), Supabase (PostgreSQL + Auth), Supabase Edge Functions, and Voyage-based RAG**. The platform must:

- Serve **100K+ concurrent students** at national scale
- Enforce strict **RBAC** (Student / Parent / Teacher / Admin roles)
- Deliver **adaptive learning paths** driven by a real-time ML engine (BKT → DKT)
- Serve **NCERT content exclusively via RAG** — no static fallbacks
- Support **~30-day launch timeline** with a 5-engineer team
- Comply with **India's DPDP Act 2023** for minor data protection
- Maintain **zero ghost routes** and full audit logging on all admin actions

The core tension: move fast to launch vs. building an architecture that holds at 100K+ users without a painful rewrite.

---

## Decision

**Adopt a Modular Monolith deployed as a Next.js App Router application, with Supabase Edge Functions as the seam for compute-intensive or latency-sensitive workloads (ML adaptation engine, RAG retrieval).**

Module boundaries are enforced at the code level now, so individual modules can be extracted into standalone services later without a rewrite.

---

## Options Considered

### Option A: Pure Microservices

Decompose into independent services from day one: Auth Service, Content Service, Assessment Service, ML Adaptation Service, Analytics Service, Dashboard Service.

| Dimension | Assessment |
|---|---|
| Complexity | **High** — 6+ services, inter-service contracts, distributed tracing |
| Launch Speed | **Slow** — DevOps overhead dominates a 5-person team |
| Scalability | **High** — each service scales independently |
| Team Familiarity | **Low** — adds Kubernetes/service mesh learning curve |
| RBAC Enforcement | **Hard** — must be re-validated at every service boundary |
| Data Consistency | **Hard** — distributed transactions, eventual consistency risk |

**Pros:**
- Independent deployability per domain
- Failure isolation (ML engine crash doesn't take down quiz delivery)
- Clear team ownership as the org grows

**Cons:**
- 5-engineer team will spend 40%+ time on infra, not product
- Cross-service RBAC creates security gaps if not done carefully
- Distributed debugging is significantly harder (no single log stream)
- Premature for current scale — over-engineering at launch

---

### Option B: Traditional Monolith (Single Next.js App, Everything Inline)

All business logic — auth, content delivery, assessment, ML, analytics — lives in Next.js API routes or Server Actions with no domain separation.

| Dimension | Assessment |
|---|---|
| Complexity | **Low** — single deploy, single codebase |
| Launch Speed | **Fast** |
| Scalability | **Low** — no horizontal decomposition; single point of failure |
| Team Familiarity | **High** |
| RBAC Enforcement | **Medium** — centralized, but spaghetti risk is high |
| Data Consistency | **Easy** — single DB transaction |

**Pros:**
- Fastest path to launch
- Simple debugging and observability
- Single deploy pipeline

**Cons:**
- Will not scale to 100K+ without major surgery
- No module boundaries → code rot is almost guaranteed under shipping pressure
- ML adaptation engine cannot be independently scaled or versioned
- Feature flags and A/B experiments become entangled with core logic

---

### Option C: Modular Monolith + Selective Edge Functions ✅ SELECTED

A single Next.js App Router application with **strict internal module boundaries** (enforced by folder structure and import rules), plus **Supabase Edge Functions** deployed at the seam for:
- ML Adaptation Engine (BKT/DKT computation)
- RAG content retrieval (Voyage embedding + vector search)
- Webhook handlers (Razorpay, notification triggers)

| Dimension | Assessment |
|---|---|
| Complexity | **Medium** — one deploy target + edge function deploys |
| Launch Speed | **Fast** — no service mesh or orchestration needed |
| Scalability | **High** — Next.js on Vercel autoscales; Edge Functions scale independently |
| Team Familiarity | **High** — existing stack |
| RBAC Enforcement | **Strong** — enforced in one place (middleware layer) |
| Data Consistency | **Easy** — Supabase RLS + single Postgres instance |

**Pros:**
- Ships in 30 days without infra debt
- Module boundaries today → extract to microservices later with minimal rework
- RBAC enforced at Next.js middleware before any route executes — no silent failures
- Edge Functions give independent scaling for the heaviest workloads (RAG, ML)
- Single Supabase project = unified RLS policies, unified auth, unified logs
- Vercel + Supabase = proven 100K+ scale without custom Kubernetes

**Cons:**
- Still a shared codebase — discipline required to not break module contracts
- Edge Function cold starts (mitigated by Supabase's warm pool)
- Inter-module calls are in-process, not over the network → harder to detect coupling violations without linting rules

---

## Module Boundaries (Enforced Architecture)

```
src/
├── modules/
│   ├── auth/           ← User, session, RBAC, token validation
│   ├── content/        ← NCERT chapter fetch, RAG retrieval (calls Edge Fn)
│   ├── assessment/     ← Quiz engine, answer submission, IRT scoring
│   ├── adaptation/     ← BKT model, next-concept selector (calls Edge Fn)
│   ├── analytics/      ← Event logging, dashboard aggregation
│   ├── payments/       ← Razorpay integration, subscription state
│   └── notifications/  ← Push/email trigger logic
├── app/                ← Next.js App Router (pages call modules only)
├── middleware.ts       ← RBAC enforcement — runs before every route
└── supabase/
    └── functions/      ← Edge Functions: rag-retrieval, ml-adaptation, webhooks
```

**Hard rules:**
1. `app/` routes import from `modules/` only — never from another `app/` route
2. Modules do not import from each other directly; they communicate via the database or event queue
3. `middleware.ts` validates JWT + role on every request — no route is public by default
4. No business logic in Edge Functions — they call module services; no inline logic

---

## Trade-off Analysis

| Concern | Modular Monolith Decision |
|---|---|
| 100K+ scale | Vercel autoscaling + Supabase connection pooling (PgBouncer) handles it; Edge Functions scale to 0→∞ |
| RBAC / Security | Single middleware enforces auth + role. Supabase RLS as second layer. Zero silent failures |
| ML Engine isolation | Deployed as Supabase Edge Function — independent cold-start budget and crash isolation from UI |
| RAG content purity | RAG retrieval is an Edge Function; zero path to static/fallback content exists in the module contract |
| Data integrity | Single Postgres instance with transactions. No eventual consistency risk |
| Audit logging | All admin actions flow through `auth` module which writes to `audit_logs` table before execution |
| Payments | `payments` module is isolated — Razorpay webhook hits Edge Function, idempotency key validated before any DB write |
| Future microservice extraction | Module = future service. Contract is already defined. Extract when team > 15 engineers or a module's load justifies it |

---

## Consequences

**What becomes easier:**
- Onboarding new engineers — clear module ownership, no distributed systems knowledge required
- Debugging — single log stream in Vercel + Supabase dashboard
- RBAC audits — one middleware file to review
- Compliance (DPDP) — data subject requests handled in `auth` module; no cross-service data hunting

**What becomes harder:**
- Preventing module coupling without automated enforcement (add ESLint import boundary rules)
- Independent deployment of a single module (all ship together except Edge Functions)
- Load testing individual modules in isolation

**What we'll need to revisit:**
- At 50K+ DAU: evaluate extracting `adaptation/` (ML) and `analytics/` into standalone services
- At 100K+ DAU: evaluate read replicas for analytics queries to avoid contention on the primary DB
- When ML moves to DKT (LSTM): the Edge Function budget may need upgrading; evaluate dedicated ML inference endpoint (e.g., Vertex AI or SageMaker)
- Quarterly: review Supabase RLS policies and audit logs for drift

---

## Action Items

1. [ ] Add ESLint `import/no-restricted-paths` rules to enforce module boundary contracts
2. [ ] Instrument `middleware.ts` with structured logging — every auth check emits to `audit_logs`
3. [ ] Deploy `rag-retrieval` and `ml-adaptation` as Supabase Edge Functions with separate env vars and cold-start monitoring
4. [ ] Set up PgBouncer connection pooling in Supabase dashboard (transaction mode, pool size 20)
5. [ ] Write integration tests for each module's public API surface — no mocked DB
6. [ ] Document module contracts in `/docs/modules/` — input/output types and invariants
7. [ ] Set Vercel function timeout to 10s max; any workload exceeding this must move to Edge Function or background job
8. [ ] Create `feature_flags` table in Supabase; all new features are gated — no direct production rollouts
9. [ ] Add load test milestone at 10K simulated users before launch (k6 or Artillery)
10. [ ] Schedule architecture review at 2026-07-08 — reassess module extraction needs based on production load data

---

## References

- Alfanumrik Adaptive Learning OS1 — Skill Manifest (System Architecture section)
- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Next.js App Router Architecture](https://nextjs.org/docs/app)
- India DPDP Act 2023 — Data Protection for Minors
- Sam Newman, *Building Microservices* — Chapter 3: Decomposing the Monolith
