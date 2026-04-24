# Microservices extraction plan (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0`.
**TL;DR:** **we do not extract any microservices in 2026 unless a
concrete business driver appears.** The monolith + Edge Functions
topology is appropriate for today's scale (5k concurrent students,
Indian 4G). What this plan describes is **bounded-module
refactoring inside the monolith** — Phase 0 — that preserves every
option to extract later at a small marginal cost.

The abandoned v0 of this plan proposed extracting 3 services in the
first phase (Billing, Quiz, Foxy) before modularization was complete.
It also executed Identity extraction *first* — ignoring its own
documented risk ranking. This version corrects both mistakes:

1. Modularize first, inside the monolith.
2. Extract only when a specific operational constraint demands it.
3. If extraction ever happens, pay the cost in one phase per context,
   never batched.

## Why not extract now?

The brief's section 4 explicitly forbids rushing extraction. Four
concrete blockers exist today:

1. **No event bus.** Extracting any write-heavy context (quiz,
   payments, assessment) requires inserting a network boundary where
   today a Postgres transaction exists. Until we have at least the
   outbox-pattern skeleton from
   [`EVENT_CATALOG.md`](./EVENT_CATALOG.md) in place, a service
   boundary would degrade atomicity and reliability.
2. **332 SECURITY DEFINER functions are schema-pinned.** See risks
   R9 / R10 in [`RISK_REGISTER.md`](./RISK_REGISTER.md). Moving a
   single identity table breaks ~92 migration files worth of RPCs
   unless patched together — as the abandoned branch learned.
3. **No service-to-service auth.** We run one Next.js process +
   32 Supabase-hosted Edge Functions. Extracting a service means
   introducing API keys, TLS rotation, rate-limit sharing, and a
   deployment target. Today none of these exist — they would have
   to be built before the first service is useful.
4. **Volumes do not justify the cost.** Current traffic is served
   comfortably by the monolith + Vercel autoscale + Supabase Pro.
   Extraction pays off when a single context (a) scales
   independently on CPU / memory / GPU, (b) deploys independently
   on a faster cadence, or (c) fails independently. None of these
   pressures exist today for Alfanumrik.

## Phase 0: modularize inside the monolith (the actual plan)

Target: extend the existing `src/lib/domains/` pattern so that every
bounded context from [`DOMAIN_BOUNDARIES.md`](./DOMAIN_BOUNDARIES.md)
has a mediating module. Each phase is a small, reviewable branch
with a P14 review chain.

### Phase 0a — Identity module hardening (1 branch)

**Why first:** identity is cross-cutting; every other module reads
it. Hardening its contract first prevents accidental direct DB reads
from other phases.

**Scope:**
- Extend [`src/lib/domains/identity.ts`](../../src/lib/domains/identity.ts)
  with typed read APIs: `getStudentById`, `getTeachersForClass`,
  `getGuardiansForStudent`, etc.
- Migrate 5-10 highest-traffic call sites from direct
  `.from('students')` to the module
- Add ESLint `no-restricted-imports` rule to prevent
  `@/lib/supabase-admin` outside of `src/app/api/**` and
  `src/lib/domains/**`

**Not in scope:**
- Moving `students` / `teachers` / `guardians` to a different schema
- Introducing a new Edge Function
- Any RLS changes

**Risk:** Low. Module already exists and is proven.
**P14 chain:** architect, backend, frontend, testing.
**Rollback:** `git revert` the branch; module stays.

### Phase 0b — Tenant module (1 branch)

**Scope:** create [`src/lib/domains/tenant.ts`](../../src/lib/domains/)
mediating `schools`, `classes`, `class_students`, `class_teachers`.
Migrate school-admin API routes to use it.

**Risk:** Low.
**P14 chain:** architect, backend, frontend (school-admin portal), testing.

### Phase 0c — Relationship module (1 branch)

**Scope:** `src/lib/domains/relationship.ts` for
`guardian_student_links`. Migrate `/api/parent/*` routes.

**Risk:** Low. P15 onboarding impact must be validated (parent onboarding path).
**P14 chain:** architect, backend, frontend, testing (P15 E2E).

### Phase 0d — Content module + outbox table (1 branch)

**Scope:**
- `src/lib/domains/content.ts` for `question_bank`, `rag_content_chunks`,
  `cbse_syllabus`
- Create `public.domain_events` table per
  [`EVENT_CATALOG.md`](./EVENT_CATALOG.md)
- Reuse existing `supabase/functions/queue-consumer/` as the outbox
  worker
- Write the **first** event: E1 `quiz.completed` from
  `atomic_quiz_profile_update`
- Consume it **asynchronously** into analytics aggregates

**Risk:** Med. First real async boundary in the system.
**P14 chain:** architect, ai-engineer, backend, testing, ops.
**Kill switch:** feature flag `ff_domain_events_enabled`; default false.
**Rollback:** flip flag off; events queue up but don't process. Data
in the outbox table is discardable.

### Phase 0e — Practice / review module (1 branch)

**Scope:** `src/lib/domains/practice.ts` for SM-2 logic. Emit E8
`practice.completed` to outbox.

**Risk:** Low. Invariants P2 (XP).
**P14 chain:** assessment, backend, testing.

### Phase 0f — Assessment module (1 branch)

**Scope:** `src/lib/domains/assessment.ts` mediating `concept_mastery`,
`knowledge_gaps`, `diagnostic_sessions`. Pure refactor — `cme-engine`
Edge Function stays.

**Risk:** Med. Invariants P1, P4.
**P14 chain:** assessment, ai-engineer, testing.

### Phase 0g — Billing module + webhook atomic-RPC wiring (1 branch)

**Scope:**
- Reintroduce `src/lib/domains/billing.ts` (cleaner than the
  abandoned version; no dual-write / drift-detection noise)
- Wire webhook to call `atomic_subscription_activation` RPC (closes R5)
- Emit E2/E3/E4 payment events

**Risk:** Med. P11.
**P14 chain:** backend, architect, testing, mobile.
**Kill switch:** feature flag `ff_atomic_subscription_activation`.

### Phase 0h — Notifications module (1 branch)

**Scope:** `src/lib/domains/notifications.ts` as a single dispatch
point for in-app / email / WhatsApp. Consumer of E2/E5/E6.

**Risk:** Low. Additive; existing Edge Functions unchanged.
**P14 chain:** backend, frontend, ops.

### Phase 0i — Analytics module (1 branch)

**Scope:** `src/lib/domains/analytics.ts` as the only write path to
`student_analytics`, `usage_metrics`, `daily_activity`. Moves
polling-based aggregates to event-driven consumers of E1/E8.

**Risk:** Low.
**P14 chain:** ops, assessment, testing.

### Phase 0j — Ops module (1 branch)

**Scope:** `src/lib/domains/ops.ts` for feature flags, maintenance
banner, support tickets. Small consolidation pass.

**Risk:** Low.
**P14 chain:** ops, testing.

### Phase 0 success criteria

After 0a-0j, every bounded context has:

1. A single module in `src/lib/domains/` that owns read/write to its
   tables
2. No API route directly imports `supabase-admin` (enforced by
   ESLint) — it goes through a domain module
3. The outbox table is populated by E1/E2/E3/E5/E8 producers
4. At least one consumer of each high-value event (analytics gets
   E1/E8; notifications gets E2/E5/E6)
5. All existing invariants still pass; no regressions in Playwright
   E2E

**Estimated effort:** 10 branches at roughly 1-3 days each with review.
Total calendar time ~6-8 weeks at conservative pace, less if parallel
work is viable.

## Phase 1: conditional extraction (only if triggered)

The only scenarios in which extraction is worth paying the cost:

### Trigger E1 — Foxy scales independently and dominates cost

**Symptom:** Claude API spend becomes a top-3 cost line; Foxy
latency tail dominates site-wide p99.
**Response:** extract `grounded-answer` + `foxy-tutor` + quota
enforcement into a dedicated Deno Deploy project. The Edge Function
topology already supports this; we just move it out of Supabase
hosting into a separate deployment boundary.
**Not urgent today.**

### Trigger E2 — Billing needs PCI scope reduction

**Symptom:** Razorpay or a downstream auditor requires us to prove
the payment path is isolated from general application code (PCI
scope reduction).
**Response:** extract billing as a separate Vercel project or Supabase
Edge Function app; move all of `src/app/api/payments/*` behind an
internal gateway.
**Not urgent today** — Razorpay tokenises card data; we never touch
PAN. PCI scope is already minimal.

### Trigger E3 — Quiz scales non-linearly

**Symptom:** concurrent quiz load hits a hot-loop bottleneck that
horizontal Vercel scaling cannot absorb (DB connections, not compute).
**Response:** extract quiz-generator + cme-engine + question selection
into a dedicated service with its own DB pool / Supabase project.
**Not expected** at current projected load (< 50 k concurrent).

### Trigger E4 — Analytics swamps OLTP

**Symptom:** reporting queries block student-facing endpoints at the
DB level.
**Response:** read replica + route analytics there. Before extracting
analytics as a service, first try the replica approach.
**Plausible** in the 12-24 month horizon. Monitored via super-admin
dashboard latency; no action today.

### What extraction would cost (so we're honest)

Per service:
- 1-2 weeks of setup: deployment target, env secrets, CI/CD,
  observability, API keys, health checks, circuit breakers
- 1 week of contract hardening: freezing API shapes, writing contract
  tests, versioning events
- 1 week of migration: feature-flag dual-path, traffic cutover
- 2-4 weeks of ongoing operational overhead: on-call rotation, incident
  runbooks, cross-service debugging

Multiplied by the number of services, this is not free. The brief
explicitly warns against "30 tiny services". We're aligned.

## What we will NOT do

- **No 7-service extraction** as the abandoned plan proposed
- **No fictional subdomain architecture** (`billing.alfanumrik.com`,
  `quiz.alfanumrik.com` etc.)
- **No API Gateway** until we have > 3 services that need routing
- **No Kafka / SQS / RabbitMQ / Redis Streams.** Postgres outbox is
  sufficient at current scale
- **No CQRS / event sourcing.** Out of proportion to our writes
- **No multi-region until a named customer requires it**
- **No `SET SCHEMA`-based refactors** — banned by R9/R10 until
  proven safe by a matching SECDEF bulk-rewrite
- **No "just this once" bundled commits** that cross 5+ domains in
  one PR

## What we WILL watch for

- Foxy p99 latency (if > 5 s, pull scheduling forward)
- Claude API spend curve (if > 15 % of costs, trigger E1)
- Analytics query lock times (if > 100 ms blocking OLTP, trigger E4)
- Mobile / web contract drift (bake a contract test into CI)

These are the only signals that should change this plan. Everything
else is premature optimisation.

## Relation to the brief's extraction priority

The brief suggested this priority (section 6):
> Highest: Billing, CME Quiz, RAG / Content, Analytics, Admin /
> Audit / Ops.
> Second: Practice, Review, XP / Rewards, Notification.
> Third: Institution / Tenant, User / Relationship, Foxy.

This plan **honours the priority as modularization order** (see
Phase 0 sequence — content/billing/analytics come before practice/
notifications, and identity/tenant/relationship come earlier because
they are prerequisites for module discipline).

It **rejects the assumption** that the priority means "extract these
first". None of these need to be extracted today.

## Success criteria

Phase 0 complete ⇒ the platform is **extractable on demand** for
any context, at the cost of one focused 1-2 week project, with a
documented contract. That optionality is the real deliverable.

Extraction itself only happens when a trigger fires. We are not on
a timeline to reach that.
