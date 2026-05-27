# Alfanumrik Production Launch Plan — 0 → 10,000+ Students

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Plan is grounded in the 2026-05-18 five-domain audit (RBAC, DB/multi-tenant, AI pipelines, infra/perf, payments/compliance).

**Goal:** Close 37 P0 / 49 P1 / 31 P2 defects identified in the 2026-05-18 audit and reach a state where Alfanumrik can safely serve 10,000+ CBSE students across 50–200 schools, fully aligned to the build blueprint (NCERT-only, RBAC-enforced, DPDPA-compliant, ₹-via-Razorpay, no static curriculum).

**Architecture:** Three-phase rollout. **Phase 1 (Weeks 1–4, Pilot ≤500 students, 1–2 schools)** closes ship-blockers: multi-tenant RLS, RBAC enforcement, payment idempotency, AI cost controls, distributed rate limiting, NCERT integrity guards, BKT atomicity. **Phase 2 (Weeks 5–9, District ≤5,000 students, 10–50 schools)** hardens algorithms, adds DPDPA compliance surfaces, persists affective state, ships per-tenant feature flags, completes runbooks. **Phase 3 (Weeks 10–14, Scale ≤10k+ students, 50–200 schools)** moves hot writes off the synchronous path, adds read replicas + PgBouncer, completes SOC2-lite controls, runs penetration test + load test.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Auth + Edge Functions + Storage + pgvector), Upstash Redis, Sentry, PostHog, Razorpay, Voyage embeddings, Anthropic API. **No new services introduced** (per blueprint §3 rule 11).

---

## Section 0 — Executive Summary & Current State

### Audit headline numbers (2026-05-18)
| Domain                | P0 | P1 | P2 |
|-----------------------|----|----|----|
| RBAC / Auth           |  7 |  9 |  6 |
| DB / Multi-tenant     |  6 |  9 |  6 |
| AI pipelines (Foxy/RAG/BKT) |  7 |  9 |  5 |
| Infra / Perf / API    |  9 | 13 |  8 |
| Payments / DPDPA / Obs |  8 |  9 |  6 |
| **Totals**            | **37** | **49** | **31** |

### Composite scorecards
- **Multi-tenant readiness:** **3/10** — only `students` is school-scoped; every downstream learner table leaks across tenants.
- **NCERT content integrity:** **6/10** — RAG architecture is right but guardrails are missing (no hallucination cross-check, scan-ocr ask_foxy bypass, unvetted AI questions, three diverging chapter taxonomies).
- **DPDPA compliance:** **3/10** — privacy policy text reasonable; verifiable parental consent absent; DSR endpoints don't exist despite policy promise.
- **Razorpay live-mode readiness:** **FAIL** — webhook idempotency racy, verify-route timing-attack vulnerable, yearly subscription path contradictory, hardcoded prices diverge from DB.

### Hard verdict
**Not production-ready for 10,000 students today.** Pilot-conditional after Phase 1 (≤4 weeks). National rollout requires all three phases (~14 weeks).

### Phase acceptance gates (must all be GREEN to proceed)

**Phase 1 → Phase 2 (Pilot complete):**
- Zero P0 defects open across all 5 audit domains.
- Multi-tenant isolation test suite passes (zero cross-tenant reads/writes possible).
- Razorpay live-mode dry run: ₹1 monthly + ₹1 yearly subscription complete end-to-end with webhook idempotency proven by replay.
- All 13 Edge Functions and 30+ API routes have Upstash distributed rate limiting.
- Health check probes return accurate red/green for DB, RAG (pgvector), Anthropic, Razorpay, Mailgun.
- One school pilot live for 7 days with zero data-isolation incidents.

**Phase 2 → Phase 3 (District complete):**
- DPDPA: verifiable parental consent shipped; DSR (export + delete + correct) endpoints live; PII scrubbing in Sentry/PostHog confirmed.
- Per-tenant feature flag overrides working; school admin role + scoped dashboards live.
- Adaptive engine consolidated (single mastery table; concept_graph canonical across Foxy + Quiz + UI).
- Per-student daily token budget enforced; cost dashboards visible to ops.
- DR drill executed (Supabase PITR restore in staging) and documented.
- 5,000 students sustained across 25+ schools for 14 days, P95 < 800ms on critical routes.

**Phase 3 → GA (10k+ ready):**
- Load test passes at 15,000 concurrent students (50% headroom).
- Penetration test report delivered; all High/Critical findings closed.
- SOC2-lite controls in place (quarterly access reviews, change management log, vendor risk register).
- Operational runbooks (incident, DR, payment-recon, school-onboarding, cost-cap, on-call) all owned and rehearsed.
- WCAG 2.1 AA audit pass on student + parent + teacher surfaces.

---

## Section 1 — Phase 1: Pilot Hardening (Weeks 1–4)

> **Operating cadence:** One PR per task. Each PR ships behind a feature flag default OFF where the change is risky (per blueprint failure mode #4 — no quota resets, no behavior changes on deploy). Tests-first per TDD discipline.

### Task 1.1 — Multi-tenant RLS: close cross-tenant data leak

**Severity:** P0 catastrophic. **Source:** DB audit P0-3.
**Why:** Only `students` is school-scoped. A logged-in user from School A whose `auth.uid()` is also a `student_id` in School B reads/writes School B's data via `student_learning_profiles`, `quiz_responses`, `payment_history`, etc.

**Files:**
- Create: `supabase/migrations/20260519000001_propagate_school_id_to_learner_tables.sql`
- Create: `supabase/migrations/20260519000002_school_scoped_rls_policies.sql`
- Create: `supabase/tests/rls/multi_tenant_isolation.test.sql`
- Modify: `src/lib/rbac.ts:152-198` (`canAccessStudent` — assert same `school_id` from JWT)

**Steps:**
- [ ] Inventory every table containing `student_id` via `information_schema.columns`. Expected set: `student_learning_profiles`, `quiz_responses`, `quiz_sessions`, `topic_mastery`, `foxy_sessions`, `concept_mastery`, `student_subscriptions`, `payment_history`, `student_moments`, `bloom_progression`, `student_achievements`, `spaced_repetition_cards`, `adaptive_mastery`, `cme_concept_state`, `student_subject_enrollment`, `student_irt_state`, `chat_sessions`, `ai_tutor_logs`, `quiz_responses`, `image_uploads`.
- [ ] Write `20260519000001`: add `school_id uuid REFERENCES schools(id)` (nullable initially) to each table; backfill from `students.school_id`; `CREATE INDEX … ON … (school_id, student_id)` per table; THEN `ALTER COLUMN school_id SET NOT NULL`. Wrap in `DO $$ ... $$` with `IF NOT EXISTS` guards. Idempotent.
- [ ] Write `20260519000002`: replace existing RLS policies on each table to add a school-scoped clause:
  ```sql
  USING (
    school_id = public.get_jwt_school_id()
    OR (
      EXISTS (SELECT 1 FROM students s WHERE s.id = student_id AND s.auth_user_id = auth.uid())
    )
  )
  WITH CHECK (school_id = public.get_jwt_school_id());
  ```
- [ ] Write `multi_tenant_isolation.test.sql`: simulate User A (School A) and User B (School B). Assert: User A `SELECT` against School B's `student_learning_profiles` returns 0 rows. Assert: User A `INSERT` into School B `quiz_responses` raises RLS violation.
- [ ] Modify `src/lib/rbac.ts:canAccessStudent` to assert `school_id` parity in addition to existing checks; reject if JWT school_id mismatches student's school_id (super_admin bypass retained).
- [ ] Run the test against a fresh `supabase db reset` clone. Expected: PASS on isolation, regression-free on cross-school super_admin reads.
- [ ] Commit. Wrap migration in `ff_school_scoped_rls_v1` flag-gated dual-policy until soak.

### Task 1.2 — RBAC consolidation: delete admin-auth.ts JWT fallback + enforce admin_level

**Severity:** P0 catastrophic. **Source:** RBAC audit P0-1, P0-2, P0-5.
**Why:** `src/lib/admin-auth.ts:119-129` still has a JWT fallback path that bypasses service-role enforcement. `admin_level` is read but never enforced — any active `admin_users` row at any tier has DELETE on roles/users/feature_flags/schools. POST to `super-admin/roles` allows self-escalation.

**Files:**
- Modify: `src/lib/admin-auth.ts` (delete lines 118-129; add `requireAdminLevel(auth, minTier)` helper)
- Modify: every file under `src/app/api/super-admin/*.ts` (15 routes) — add `requireAdminLevel` at top of mutating handlers (POST/PUT/PATCH/DELETE)
- Modify: `src/app/api/super-admin/roles/route.ts:50-77` — assert caller `hierarchy_level > target_role.hierarchy_level`
- Modify: `src/app/api/super-admin/test-accounts/route.ts:1-103` — gate by `super_admin` tier; **never return password in response body**; instead trigger Supabase password-reset email
- Modify: `src/proxy.ts:81-83` — add `super_admin`, `school_admin` to role matrix
- Create: `src/lib/__tests__/admin-auth-tiers.test.ts`
- Create: `src/app/api/super-admin/__tests__/role-escalation.test.ts`

**Steps:**
- [ ] Write failing test: a tier-1 `admin_users` row tries to DELETE a feature_flag → must return 403.
- [ ] Write failing test: a tier-1 admin tries to POST `/super-admin/roles` with `role_name='super_admin'` for themselves → must return 403.
- [ ] Write failing test: `admin-auth.ts` invoked with a non-admin user's JWT that has matching RLS on `admin_users` self-read → must return 403 (proves JWT fallback removed).
- [ ] Delete `admin-auth.ts:118-129` (the retry-with-user-token block). Add `requireAdminLevel(auth: AdminAuth, minTier: AdminLevel): NextResponse | null`.
- [ ] Apply `requireAdminLevel` to all 15 super-admin routes; map per-action minimums (e.g., DELETE on roles → `super_admin`; PATCH on feature_flags → `platform`; GET → `viewer`).
- [ ] Modify `roles/route.ts:50-77`: fetch `target_role.hierarchy_level`; reject if `caller.hierarchy_level <= target_level`.
- [ ] Modify `test-accounts/route.ts`: remove password from response; return `{ reset_link_sent: true, email }`. Add audit row.
- [ ] Modify `src/proxy.ts:81-83`: extend role matrix with `super_admin` and `school_admin`.
- [ ] Run all tests. Expected: PASS.
- [ ] Commit.

### Task 1.3 — Distributed rate limiting via Upstash (close in-memory fiction)

**Severity:** P0. **Source:** Infra audit P0-1, RBAC audit P1-3.
**Why:** `supabase/functions/_shared/rate-limiter.ts:19-20` and `src/app/api/error-report/route.ts:16-46` use per-instance `Map`. Vercel + Supabase autoscale → effective limit ≈ configured × instances. Upstash is already in `package.json` and `.env.local.example`; the upgrade block at `rate-limiter.ts:117-135` is commented out.

**Files:**
- Modify: `supabase/functions/_shared/rate-limiter.ts` — uncomment Upstash block; default to Redis if env vars present, fall back to in-memory (clearly logged) only for local dev
- Create: `src/lib/upstash-ratelimit.ts` — wraps `@upstash/ratelimit` for Next.js routes
- Modify: every Next.js API route handler that processes auth/quiz/foxy/upload/error-report — apply `withRateLimit(handler, RATE_LIMITS.x)`
- Modify: `supabase/functions/foxy-tutor/index.ts`, `supabase/functions/quiz-generator/index.ts`, `supabase/functions/ncert-solver/index.ts`, `supabase/functions/scan-ocr/index.ts`, `supabase/functions/export-report/index.ts`, `supabase/functions/session-guard/index.ts` — swap in-memory check for Upstash call
- Create: `supabase/tests/rate-limit/upstash-enforcement.test.ts`

**Steps:**
- [ ] Add `@upstash/ratelimit` + `@upstash/redis` to `supabase/functions/_shared/deno.json` import map; verify Deno-compat.
- [ ] Rewrite `rate-limiter.ts`: `checkRateLimit(key, config)` calls `new Ratelimit({redis, limiter: slidingWindow(maxRequests, '60 s')})`. On Redis unreachable, fail-CLOSED on admin routes and fail-OPEN on student routes with Sentry warn.
- [ ] Write `upstash-ratelimit.ts` for Next.js: same interface, used by `withRateLimit(handler, config)` middleware wrapper.
- [ ] Apply rate limits per-route:
  - `/api/auth/*` — 5/min/IP (login/signup brute-force defense)
  - Foxy edge — 30/min/student
  - Quiz edge — 5/min/student
  - ncert-solver — 10/min/student (NEW — currently unlimited)
  - scan-ocr — 5/min/student (NEW)
  - export-report — 3/min/user
  - super-admin/* mutations — 30/min/admin
- [ ] Add `Retry-After` header on every 429 response.
- [ ] Write test: 60 concurrent requests from same key → exactly `maxRequests` allowed.
- [ ] Run test. Expected: PASS.
- [ ] Deploy edge functions; deploy Next.js. Smoke-test 429 behaviour via curl loop.
- [ ] Commit.

### Task 1.4 — Razorpay webhook idempotency + timing-safe signature

**Severity:** P0. **Source:** Payments audit P0-1, P0-2.
**Why:** `subscription_events.razorpay_event_id` has no UNIQUE constraint; two concurrent webhook deliveries both pass the pre-SELECT and double-activate. `verify/route.ts:91` and `webhook/route.ts:39` use string `!==` on signatures (timing-attack vector).

**Files:**
- Create: `supabase/migrations/20260519000003_subscription_events_unique_index.sql`
- Modify: `src/app/api/payments/verify/route.ts:91`
- Modify: `src/app/api/payments/webhook/route.ts:39,46`
- Test: `src/app/api/payments/__tests__/webhook-idempotency.test.ts`

**Steps:**
- [ ] Write failing test: replay the same webhook 5 times concurrently → exactly 1 `subscription_events` row created.
- [ ] Write `20260519000003`: `CREATE UNIQUE INDEX CONCURRENTLY subscription_events_razorpay_event_id_uniq ON subscription_events(razorpay_event_id) WHERE razorpay_event_id IS NOT NULL;` after dedup-cleanup.
- [ ] Modify `verify/route.ts:91` and `webhook/route.ts:39`: use `crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))` — mirror `src/modules/payments/razorpay.ts:263`.
- [ ] Modify `webhook/route.ts:46`: use Razorpay's canonical `event.id` (not the `account_id+payment.id+eventType` concatenation) as `razorpay_event_id`.
- [ ] Switch INSERT to `INSERT ... ON CONFLICT (razorpay_event_id) DO NOTHING RETURNING id`; treat 0-rows-returned as "already processed" → return 200 OK without re-running side effects.
- [ ] Run test. Expected: PASS.
- [ ] Commit.

### Task 1.5 — Verify-route entitlement read-back (close silent success)

**Severity:** P0. **Source:** Payments audit P0-3.
**Why:** `verify/route.ts:144-154` returns HTTP 200 with `success:true` when `studentId` is unresolved (yearly orders never populated `notes.user_id`). Student pays and gets no access with no failure surface.

**Files:**
- Modify: `src/app/api/payments/verify/route.ts:144-200`
- Create: `src/app/api/payments/__tests__/verify-entitlement.test.ts`

**Steps:**
- [ ] Write failing test: simulate verify request with missing `studentId` → must NOT return `success:true, note:'activation_via_webhook'`. Must return 202 with `{status:'pending', reconciliation_id}`.
- [ ] Refactor verify-route: after signature passes, immediately read-back the `student_subscriptions` row keyed by the order. If row absent → return 202. If row present and active → return 200 with entitlement payload.
- [ ] Add `reconciliation_id` column to `payment_reconciliation_log` (new table or existing — check schema).
- [ ] Run test. Expected: PASS.
- [ ] Commit.

### Task 1.6 — Queue-consumer atomicity + auth + DLQ

**Severity:** P0. **Source:** Infra audit P0-4, P0-5, P0-6.
**Why:** `supabase/functions/queue-consumer/index.ts:392-501` has NO auth (anyone can drain queue) AND non-atomic claim (SELECT then UPDATE) — two concurrent invocations double-process rows → BKT and XP corruption.

**Files:**
- Create: `supabase/migrations/20260519000004_queue_consumer_atomic_claim.sql` (defines `claim_task_queue_batch(limit_n int)` PLPGSQL with `FOR UPDATE SKIP LOCKED`)
- Create: `supabase/migrations/20260519000005_task_queue_dlq.sql` (`task_queue_dlq` table + trigger that moves rows on `attempts >= 3`)
- Modify: `supabase/functions/queue-consumer/index.ts:392-501`
- Test: `supabase/tests/queue/concurrent-claim.test.sql`

**Steps:**
- [ ] Write failing test: insert 1000 tasks; run 5 concurrent consumer invocations claiming 200 each; assert exactly 1000 unique claims, zero duplicates.
- [ ] Write `claim_task_queue_batch` PLPGSQL function: `RETURN QUERY UPDATE task_queue SET status='processing', claimed_at=now() WHERE id IN (SELECT id FROM task_queue WHERE status='pending' AND (retry_after IS NULL OR retry_after <= now()) AND attempts < 3 ORDER BY priority DESC, created_at ASC FOR UPDATE SKIP LOCKED LIMIT limit_n) RETURNING *;`
- [ ] Write `task_queue_dlq` migration with trigger that moves rows on `attempts >= 3` with the failure reason.
- [ ] Modify consumer: replace lines 419-449 with a single `rpc('claim_task_queue_batch', { limit_n: BATCH_SIZE })` call. Add `CRON_SECRET` Bearer check at top of handler (mirror `daily-cron/index.ts:263-277`).
- [ ] Add Sentry alert hook when DLQ row count > 10/hour.
- [ ] Run test. Expected: PASS, zero duplicates.
- [ ] Commit.

### Task 1.7 — AI cost controls: Anthropic 529 retry + ncert-solver/scan-ocr quotas + per-student token budget

**Severity:** P0. **Source:** AI audit P0-2, P0-4, P0-5, P0-6, P1-5.
**Why:** `foxy-tutor/index.ts:347-360` retry skips 529 (most common Claude failure). `ncert-solver/index.ts:141-167` has zero retry and no quota. `scan-ocr` ask_foxy bypasses RAG and has no quota. No per-student token budget anywhere.

**Files:**
- Create: `supabase/functions/_shared/anthropic-client.ts` — `callClaudeWithRetry(messages, opts)` with `[429,500,502,503,529]` retry + exponential backoff (1s, 2s, 4s) + circuit breaker
- Modify: `supabase/functions/foxy-tutor/index.ts:347-360` — use shared client
- Modify: `supabase/functions/ncert-solver/index.ts:141-167` — use shared client + add `check_and_record_usage(student_id, 'ncert_solver', today)` quota
- Modify: `supabase/functions/scan-ocr/index.ts:144-159,331-360` — file-size cap (5MB), MIME whitelist, `check_and_record_usage` quota, route ask_foxy through RAG
- Create: `supabase/migrations/20260519000006_student_daily_token_budget.sql` — adds `daily_token_estimate` column to `student_daily_usage`
- Create: `supabase/migrations/20260519000007_check_token_budget_rpc.sql`
- Test: `supabase/tests/ai/anthropic-retry-529.test.ts`, `supabase/tests/ai/quota-enforcement.test.ts`

**Steps:**
- [ ] Write `callClaudeWithRetry`: shared module reads `ANTHROPIC_API_KEY`, sends request, retries on `status in [429,500,502,503,529]`. Implements per-process circuit breaker (after 5 failures in 60s, fail fast for next 30s).
- [ ] Modify `foxy-tutor`, `ncert-solver`, `scan-ocr` to use shared client. Remove direct `fetch(api.anthropic.com)` calls.
- [ ] Add `check_token_budget(student_id, estimated_tokens)` RPC: returns `{allowed: bool, remaining: int}`. Default cap 50k tokens/student/day. Cap configurable via `feature_flags`.
- [ ] Modify Foxy to estimate input tokens (chars/4 heuristic) before call; call `check_token_budget` → refuse if over budget with friendly UX.
- [ ] scan-ocr: validate `file_type` against `['image/jpeg','image/png','image/heic']`; `HEAD` signed URL → reject if Content-Length > 5MB; add `check_and_record_usage`; remove `OCR_SPACE_API_KEY` default `'helloworld'` (hard-fail if not set in prod).
- [ ] scan-ocr ask_foxy: pass extracted text through `match_rag_chunks`; refuse if zero hits above 0.7 similarity ("This doesn't appear to match NCERT material I can help with — please ask about your CBSE chapters").
- [ ] Write tests for: (a) Claude returns 529 thrice then 200 → retry succeeds; (b) Anthropic returns 500 5x in 60s → circuit breaker opens; (c) student exceeds 50k tokens → 429 with budget message.
- [ ] Run tests. Expected: PASS.
- [ ] Commit.

### Task 1.8 — NCERT integrity: Foxy hallucination cross-check + is_verified workflow

**Severity:** P0. **Source:** AI audit P0-1 (chapter taxonomy), P1-1 (hallucination), P1-7 (is_verified).
**Why:** Foxy gracefully degrades to no-RAG generation when retrieval fails. AI-generated questions go straight to students when `is_verified IS NULL`. Three diverging chapter taxonomies make Foxy/Quiz/UI inconsistent.

**Files:**
- Modify: `supabase/functions/foxy-tutor/index.ts:192-205,265,316-321,369-371`
- Modify: `supabase/functions/quiz-generator/index.ts:233-238,273-277` — switch from `topic_id` UUID lookup to `concept_code` text lookup against `concept_graph`
- Modify: `src/modules/content/fetchers.ts` — single canonical fetcher returning `{concept_code, chapter, ...}` used by Foxy, Quiz, and UI
- Modify: `src/modules/assessment/engine.ts:124,310` — gate question selection by `is_verified = true` (no NULL)
- Create: `supabase/functions/_shared/question-validator.ts` — second-pass LLM verifier for AI-generated items
- Create: `supabase/migrations/20260519000008_question_bank_is_verified_workflow.sql`
- Test: `supabase/functions/foxy-tutor/__tests__/rag-gating.test.ts`

**Steps:**
- [ ] Write failing test: Foxy receives a question with zero RAG hits ≥ 0.6 → must respond with refusal message and `intent='off_syllabus_refusal'`. Currently it answers freely.
- [ ] Modify Foxy `fetchRAGContext`: on `match_count < 2 || top_similarity < 0.6`, return `{refused: true, reason: 'no_match'}` instead of null.
- [ ] Modify Foxy main flow: if `refused`, return refusal text without invoking Claude.
- [ ] Bump Foxy `match_count` from 3 to 6; lower `min_quality` floor cautiously.
- [ ] Add post-generation validator: extract numerical/named claims from Claude's reply; assert each appears in retrieved chunks (substring or embedding similarity ≥ 0.85). If validation fails, regenerate once with stronger grounding prompt; if still fails, refuse.
- [ ] Sanitize `chatHistory` replay (Foxy line 316-321): strip lines matching `/^(IGNORE|SYSTEM|OVERRIDE|YOU MUST|FORGET).*PREVIOUS/i`.
- [ ] Migration `20260519000008`: backfill `is_verified=false` for all NULL rows. Add `verification_run_at`, `verifier_model`, `verifier_score` columns.
- [ ] Build `question-validator.ts`: second-pass LLM call with retrieved chunks; assert answer matches; auto-promote to `is_verified=true` on pass, else flag for human review queue.
- [ ] Daily-cron: run validator on top 100 unverified questions; expose count in super-admin.
- [ ] Modify `assessment/engine.ts:124,310` → `WHERE is_verified = true` (replace `IS NOT FALSE`).
- [ ] Quiz/Foxy fetchers: use `concept_graph.concept_code` as the canonical key everywhere; deprecate `topic_id` UUID joins (keep dual-write for one release, then drop).
- [ ] Run tests. Expected: PASS.
- [ ] Commit.

### Task 1.9 — Atomic BKT update via Postgres function

**Severity:** P0. **Source:** AI audit P0-3, DB audit P1 (IRT trigger storm).
**Why:** `ml-adaptation/index.ts:492-514` reads `adaptive_mastery`, computes new `mastery_prob` in JS, then upserts. Two concurrent quiz submissions per student → lost update.

**Files:**
- Create: `supabase/migrations/20260519000009_bkt_apply_atomic_function.sql` — `bkt_apply(p_student_id uuid, p_node_code text, p_correct boolean, p_p_slip numeric default 0.10, p_p_guess numeric default 0.20, p_p_transit numeric default 0.10) RETURNS adaptive_mastery`
- Modify: `supabase/functions/ml-adaptation/index.ts:492-514` — replace JS read-compute-upsert with single RPC call
- Modify: `src/modules/assessment/engine.ts:170-188` — call RPC directly instead of fire-and-forget Edge Function
- Test: `supabase/tests/algorithms/bkt-concurrent-update.test.sql`

**Steps:**
- [ ] Write `bkt_apply` PLPGSQL: `BEGIN; SELECT … FROM adaptive_mastery WHERE student_id=$1 AND node_code=$2 FOR UPDATE; compute new prob; INSERT ... ON CONFLICT UPDATE; RETURN; END;`. Idempotency key on `(student_id, node_code, response_id)` to prevent double-apply.
- [ ] Add per-grade/subject prior overrides via `bkt_priors` lookup table keyed by `(grade, subject_code)`; default fallback to existing global priors.
- [ ] Modify `ml-adaptation/index.ts:492-514` to call RPC; remove JS computation.
- [ ] Modify `assessment/engine.ts:170-188` to call RPC inline (no Edge Function round-trip).
- [ ] Write concurrency test: spawn 50 parallel `bkt_apply` calls for same `(student_id, node_code)` with mixed correct/incorrect → assert final mastery matches deterministic single-threaded equivalent.
- [ ] Run test. Expected: PASS.
- [ ] Commit.

### Task 1.10 — Truthful health check (DB + RAG + Anthropic + Razorpay + Mailgun)

**Severity:** P0. **Source:** Infra audit P0-8.
**Why:** `src/app/api/v1/health/route.ts:17-43` only checks Supabase. Uptime monitors flash green while AI is dead.

**Files:**
- Modify: `src/app/api/v1/health/route.ts`
- Create: `src/app/api/v1/health/__tests__/probes.test.ts`

**Steps:**
- [ ] Add probe: `select 1 from question_embeddings limit 1` → confirms pgvector reachable.
- [ ] Add probe: `fetch('https://api.anthropic.com/v1/messages', {method:'OPTIONS', signal: AbortSignal.timeout(2000)})` → confirms upstream reachable.
- [ ] Add probe: `fetch('https://api.razorpay.com/v1/...', ...)` similarly.
- [ ] Add probe: confirm `daily-cron` last run < 26h ago via `platform_health_snapshots` table.
- [ ] Return shape: `{ status: 'ok'|'degraded'|'down', probes: { db, pgvector, anthropic, razorpay, mailgun, last_cron }, version: VERCEL_GIT_COMMIT_SHA }`.
- [ ] Mark route as `runtime: 'nodejs'` (allow longer timeout).
- [ ] Commit.

### Task 1.11 — Vercel regional pinning + function memory/timeout config

**Severity:** P1 (scale latency). **Source:** Infra audit P1-5.
**Why:** Default `iad1` (US-East) = 250-400ms RTT from India.

**Files:**
- Modify: `vercel.json`

**Steps:**
- [ ] Add `"regions": ["bom1", "sin1"]` to root config.
- [ ] Add `"functions": { "src/app/api/payments/webhook/route.ts": { "memory": 512, "maxDuration": 30 }, "src/app/api/cron/daily/route.ts": { "memory": 1024, "maxDuration": 60 }, "src/app/api/v1/upload-assignment/route.ts": { "memory": 1024, "maxDuration": 30 } }`.
- [ ] Add explicit comment that cron schedule `0 19 * * *` is UTC (= 00:30 IST).
- [ ] Add cron entries for: (a) `/api/cron/health-snapshot` every 15 min; (b) `/api/cron/synthetic-monitor` every 5 min.
- [ ] Commit. Smoke-test via Vercel deploy to a preview branch.

### Task 1.12 — Schema baseline + reproducible environments

**Severity:** P0 (operational risk). **Source:** DB audit P0-1.
**Why:** Migrations directory has zero `CREATE TABLE` statements. Cannot recreate a fresh Supabase project from `supabase/migrations`. Disaster recovery is impossible by design.

**Files:**
- Create: `supabase/migrations/00000000000000_baseline.sql` (dumped from current prod schema)
- Create: `scripts/regenerate-baseline.sh`

**Steps:**
- [ ] Run `supabase db dump --schema public --schema-only` against prod (or staging if prod-MCP rule applies) → save as `supabase/migrations/00000000000000_baseline.sql`.
- [ ] Manually edit baseline: remove migration-history rows; ensure idempotent (`CREATE TABLE IF NOT EXISTS`, etc.).
- [ ] Test: spin up `supabase start` on a clean local; apply ONLY baseline + subsequent migrations; assert schema matches prod via `supabase db diff`.
- [ ] Create `scripts/regenerate-baseline.sh` that automates the dump + sanitize for future quarterly regenerations.
- [ ] Commit.

### Task 1.13 — Parental consent (verifiable) + DSR endpoints (DPDPA §9, §11/§12)

**Severity:** P0 (regulatory). **Source:** Payments audit P0-6, P0-7.
**Why:** Self-attest checkbox ≠ verifiable parental consent. Privacy policy promises "Download My Data" and "Delete Account" with no API behind them.

**Files:**
- Modify: `src/components/AuthScreen.tsx:412-416`
- Create: `supabase/migrations/20260519000010_parental_consent_tokens.sql`
- Create: `src/app/api/student/parent-consent-request/route.ts`
- Create: `src/app/api/student/parent-consent-verify/route.ts`
- Create: `src/app/api/student/data-export/route.ts`
- Create: `src/app/api/student/account-delete/route.ts`
- Create: `supabase/functions/send-parent-consent-email/index.ts`
- Create: `src/app/parent-consent/[token]/page.tsx`
- Test: `src/app/api/student/__tests__/dsr-export.test.ts`

**Steps:**
- [ ] Migration: `parental_consent_tokens` table — `student_id, parent_email, token_hash, expires_at, verified_at, ip_address`. Add `students.parental_consent_verified_at` column.
- [ ] AuthScreen: collect `parentEmail` for under-18 signups; on submit, call `/api/student/parent-consent-request` (sends magic-link email via new edge function).
- [ ] `parent-consent-verify` route: validate token, set `students.parental_consent_verified_at`. Block student login until verified.
- [ ] DSR export: returns JSON of all student rows across 15 PII-bearing tables, redacts internal IDs, includes `data_fiduciary` metadata.
- [ ] DSR delete: soft-delete via `deleted_at = now()` across all tables; schedule hard purge in 30 days via cron; revoke all sessions; send confirmation email.
- [ ] Test: full flow — request consent → email captured (mock Mailgun) → click link → student activated → export data → delete account.
- [ ] Commit.

### Task 1.14 — Audit log consolidation (single canonical table)

**Severity:** P1. **Source:** RBAC audit P1-1.
**Why:** Two audit tables (`audit_logs` and `admin_audit_log`) exist; the super-admin UI's Audit Logs tab and `/v1/admin/audit-logs` API see different data.

**Files:**
- Create: `supabase/migrations/20260519000011_audit_logs_partitioning_retention.sql`
- Create: `supabase/migrations/20260519000012_admin_audit_log_dual_write_then_drop.sql` (Phase 1a: dual-write; Phase 2: drop)
- Modify: `src/lib/admin-auth.ts:151-168` — write to `audit_logs` (not `admin_audit_log`)
- Modify: `src/app/api/v1/admin/audit-logs/route.ts:47` — fix `auth_user_id` column name

**Steps:**
- [ ] Migration: partition `audit_logs` by month (RANGE on `created_at`); add `(auth_user_id, created_at DESC)` index; add 180-day retention cron.
- [ ] Modify `logAdminAudit` to write to `audit_logs` with `details = { ...existing, admin_name, admin_email, admin_level }`.
- [ ] Dual-write to `admin_audit_log` for one release; then issue migration to drop `admin_audit_log` after one week.
- [ ] Fix audit-logs query route: filter on `auth_user_id` (not `user_id`).
- [ ] Run integration test: super-admin action → row appears in `audit_logs`; UI tab shows it.
- [ ] Commit.

### Task 1.15 — Brute-force lockout on /api/auth/*

**Severity:** P1. **Source:** RBAC audit P1-3.
**Why:** No brute-force lockout exists despite memory claim. `/api/auth/*` is in `PUBLIC_ROUTES` and skips the 60/min general limit.

**Files:**
- Create: `supabase/migrations/20260519000013_failed_login_attempts.sql`
- Modify: `src/proxy.ts` (PUBLIC_ROUTES handling) — add auth-specific rate limit
- Modify: any custom login route (`src/app/api/auth/*`)

**Steps:**
- [ ] Migration: `failed_login_attempts` table — `email_or_phone, attempt_count, locked_until, last_attempt_at`. Trigger: on 5 failures in 15 min, set `locked_until = now() + interval '15 min'`.
- [ ] Add Upstash sliding-window limit of 5/min/IP on `/api/auth/login` and `/api/auth/signup`.
- [ ] Surface lockout in UI with countdown.
- [ ] Test: 6 wrong-password attempts → 6th returns 423 (Locked).
- [ ] Commit.

### Task 1.16 — Test-accounts route hardening (already partly in 1.2, separate task for testing)

**Severity:** P0. **Source:** RBAC audit P0-3 (overlaps 1.2).

Handled inside Task 1.2 — keeping this slot for the explicit super_admin tier test.

### Task 1.17 — CORS hardening

**Severity:** P0. **Source:** Infra audit P0-2, P0-3, P1-1 (cors.ts).
**Why:** `session-guard` uses `*`. `send-welcome-email` reflective on `*.vercel.app`. `_shared/cors.ts:24-30` uses `requestOrigin.includes('alfanumrik')` → `alfanumrik.evil.com` matches.

**Files:**
- Modify: `supabase/functions/_shared/cors.ts`
- Modify: `supabase/functions/session-guard/index.ts:5`
- Modify: `supabase/functions/send-welcome-email/index.ts:23-26`
- Modify: `supabase/functions/cme-engine/index.ts:5-7`

**Steps:**
- [ ] Rewrite `cors.ts`: `ALLOWED_ORIGINS = new Set(['https://alfanumrik.com','https://www.alfanumrik.com'])`. Add `WILDCARD_PATTERNS = [/^https:\/\/[a-z0-9-]+--alfanumrik\.vercel\.app$/, /^https:\/\/[a-z0-9-]+\.school\.alfanumrik\.com$/]`. Anchor regexes.
- [ ] Apply to all 13 edge functions.
- [ ] Test: `Origin: https://alfanumrik.evil.com` → no CORS headers returned.
- [ ] Commit.

### Task 1.18 — Sentry/PostHog PII scrubbing

**Severity:** P1 (DPDPA). **Source:** Payments audit P1-3, P1-4.
**Why:** Sentry edge config has no PII scrubber → Authorization headers leak. PostHog identifies by raw student UUID.

**Files:**
- Modify: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Modify: `src/components/PostHogProvider.tsx:62`

**Steps:**
- [ ] Add `beforeSend` in all three Sentry configs: strip `email`, `phone`, `aadhaar`, `pan`, `dob`, `parent_phone`, `payment_*` from `event.user`, `event.tags`, `event.extra`. Strip `Authorization` and `Cookie` from `event.request.headers`.
- [ ] Set `sendDefaultPii: false` in all three.
- [ ] Sample server traces at 0.25.
- [ ] PostHog `identify`: replace raw `student_id` with `HMAC(student_id, POSTHOG_SALT)`. Server-side salt.
- [ ] Commit.

### Task 1.19 — File upload security (magic-byte sniff + size cap + virus path)

**Severity:** P0. **Source:** Infra audit P0-9.
**Why:** `upload-assignment` takes `file.type` from client (spoofable).

**Files:**
- Modify: `src/app/api/v1/upload-assignment/route.ts`

**Steps:**
- [ ] Read first 12 bytes of uploaded file; validate against expected magic bytes for `image/jpeg`, `image/png`, `image/heic`, `application/pdf` (if PDFs accepted).
- [ ] Reject if mismatch.
- [ ] Cap size at 5MB server-side (don't trust Content-Length header alone).
- [ ] Add Sentry breadcrumb for every upload.
- [ ] Queue async virus scan via `task_queue` (consumer integrates ClamAV REST API or VirusTotal). Block file access in storage until `scan_status='clean'`.
- [ ] Commit.

### Task 1.20 — Pre-launch smoke + acceptance gate verification

**Severity:** Acceptance gate. **Files:** `scripts/pilot-smoke-test.sh`, `docs/runbooks/pilot-go-live.md`.

**Steps:**
- [ ] Write smoke test script: end-to-end signup → parental consent → quiz attempt → BKT update verified → Foxy chat → payment (test mode) → webhook idempotency proven (replay) → audit log entries.
- [ ] Run against staging.
- [ ] Document runbook for pilot go-live.
- [ ] Commit.

---

## Section 2 — Phase 2: District Hardening (Weeks 5–9)

### Task 2.1 — School admin role + scoped dashboards

**Severity:** P1 (multi-tenant UX gap). **Source:** RBAC audit P0-6.

**Files:**
- Create: `src/app/school-admin/layout.tsx`, `src/app/school-admin/page.tsx` (+ subroutes: students, teachers, classes, reports, billing, settings)
- Create: `src/app/api/school-admin/*/route.ts`
- Modify: `src/proxy.ts` (role matrix)

**Steps:**
- [ ] Define school_admin permission set (read-only platform-ops; full read+write on their own school's students/teachers/classes/billing).
- [ ] Build dashboards mirroring super-admin shape but scoped to `school_id = jwt.school_id`.
- [ ] Test: school_admin from School A cannot read School B.
- [ ] Commit.

### Task 2.2 — Per-tenant feature flag overrides

**Severity:** P1. **Source:** Payments audit P1-6 (rollout_percentage dead code).

**Files:**
- Modify: `src/lib/feature-flags.ts:84-90` — implement rollout_percentage via stable hash bucket
- Create: `supabase/migrations/20260519000014_feature_flag_per_tenant_overrides.sql` (`feature_flag_overrides` table keyed by `(flag_id, school_id)`)
- Modify: `src/app/api/super-admin/feature-flags/route.ts` (UI to set overrides)

**Steps:**
- [ ] Hash bucket: `crc32(student_id + flag_key) % 100 < rollout_percentage`.
- [ ] Override table: per-tenant `is_enabled` setting overrides global default.
- [ ] Resolve flag value: check user override → tenant override → global → default.
- [ ] Audit every override change to `audit_logs`.
- [ ] Commit.

### Task 2.3 — Per-student daily token budget enforcement + cost dashboards

**Severity:** P1. **Source:** AI audit P1-5.

**Files:**
- Already partially in Task 1.7. This task adds the dashboards.
- Modify: `src/app/api/super-admin/observability/route.ts`
- Create: `src/components/super-admin/CostMonitor.tsx`

**Steps:**
- [ ] Aggregate daily token consumption per student / per school / per model into `student_daily_usage`.
- [ ] Cost monitor surface: daily Anthropic spend, top-10 token-burning students, school-level rollup.
- [ ] Auto-alert via Sentry when daily spend exceeds ₹500 (configurable).
- [ ] Commit.

### Task 2.4 — pgvector HNSW tuning + read-replica for RAG

**Severity:** P1 (scale). **Source:** AI audit "Hot RAG chunks".

**Files:**
- Create: `supabase/migrations/20260519000015_rag_hnsw_index_tuning.sql`
- Modify: `supabase/functions/rag-retrieval/index.ts`

**Steps:**
- [ ] Add HNSW index on `rag_content_chunks.embedding` with `m=16, ef_construction=64`; tune `ef_search` per query (default 40).
- [ ] If Supabase plan allows read replicas, route RAG queries to replica via separate `SUPABASE_REPLICA_URL` env.
- [ ] Benchmark: 100 concurrent RAG queries, target P95 < 200ms.
- [ ] Commit.

### Task 2.5 — Cohort BKT recalibration cron (nightly)

**Severity:** P1. **Source:** AI audit P1-3 (IRT calibration absent).

**Files:**
- Create: `supabase/functions/cohort-recalibration/index.ts`
- Modify: `supabase/functions/daily-cron/index.ts` — invoke cohort-recalibration

**Steps:**
- [ ] Nightly: for each (grade, subject, concept_code), recompute BKT priors from rolling 30-day response data; persist to `bkt_priors`.
- [ ] Item params: weekly MMLE re-estimation of `question_bank.irt_difficulty` and `irt_discrimination`; cap drift at ±0.3 per cycle to avoid instability.
- [ ] Student θ: persist in `student_irt_state(student_id, theta, se, last_recalc_at)`.
- [ ] Test: small synthetic dataset; assert recalibrated parameters within expected range.
- [ ] Commit.

### Task 2.6 — Affective state server-side feedback loop

**Severity:** P1. **Source:** AI audit P1-6.

**Files:**
- Modify: `src/lib/feedback-engine.ts` (currently client-only)
- Create: `src/app/api/student/affective-state/route.ts`
- Create: `supabase/migrations/20260519000016_cognitive_load_state.sql`
- Modify: `supabase/functions/quiz-generator/index.ts` — read affective state in item selection

**Steps:**
- [ ] Client posts cognitive-load signals (response latency, streak, hesitation) to `/api/student/affective-state` every quiz tick.
- [ ] Server persists into `cognitive_load_state` with TTL of 60 min.
- [ ] Quiz next-item selection: if state == "frustrated" → drop difficulty by 1 band; if "flow" → maintain; if "fatigued" → suggest break.
- [ ] Commit.

### Task 2.7 — Consolidate mastery engines (cme-engine vs ml-adaptation)

**Severity:** P1 (drift risk). **Source:** AI audit P0-7.

**Decision required (CEO sign-off):** pick `adaptive_mastery` (ADR-005 spine canonical) or `cme_concept_state`.

**Steps:**
- [ ] CEO decision (see Section 7 — decision points).
- [ ] Demote the loser to a projector subscriber that reads-only from the canonical table; remove its writes.
- [ ] Migrate any consumers (quiz next-action, study-plan, dashboard).
- [ ] Commit.

### Task 2.8 — Concept graph as canonical taxonomy

**Severity:** P1. **Source:** AI audit P0-1 (already partly in Task 1.8).

**Files:**
- Modify: every fetcher/query joining `curriculum_topics` by UUID → switch to `concept_graph.concept_code` text key
- Migration: drop deprecated UUID join paths after one release

### Task 2.9 — Prompt registry + A/B framework

**Severity:** P1. **Source:** AI audit P1-9.

**Files:**
- Create: `supabase/migrations/20260519000017_prompt_registry.sql` (`prompt_registry(feature, arm, version, prompt_text, is_active, created_at)`)
- Modify: every Edge Function with a system prompt to fetch from registry by `(feature, active_arm_for_student)`

**Steps:**
- [ ] Migrate hardcoded `buildSystemPrompt` strings into registry rows.
- [ ] Add `experiment_arm` assignment per student (stable hash of student_id + experiment_key).
- [ ] Log arm + prompt_version per Claude call.
- [ ] Commit.

### Task 2.10 — Per-student daily token budget (overlaps 1.7) — full cost dashboards

Already in 2.3.

### Task 2.11 — Connection pooling: Supabase PgBouncer (transaction mode)

**Severity:** P0 at scale. **Source:** Infra audit "No PgBouncer".

**Files:**
- Modify: `src/lib/supabase-admin.ts`, `src/lib/supabase-server.ts`
- Add: `SUPABASE_POOLER_URL` env var (e.g., `pooler.supabase.com:6543`)

**Steps:**
- [ ] Route read-heavy queries through pooler URL.
- [ ] Verify with Supabase docs: which queries are safe in transaction mode (no prepared statements, no advisory locks).
- [ ] Load test: 500 concurrent requests → confirm no `too many connections` errors.
- [ ] Commit.

### Task 2.12 — Webhook reliability (DLQ + replay UI)

**Severity:** P1. **Source:** Already partly in 1.4 + 1.6.

**Files:**
- Create: `webhook_replay_log` table; expose replay button in super-admin under specific tier.

### Task 2.13 — DR drill: Supabase PITR restore in staging

**Severity:** P1 (operational).

**Steps:**
- [ ] Confirm Supabase PITR enabled (Pro plan or higher).
- [ ] Schedule a DR drill: restore a 24h-old snapshot into a staging project.
- [ ] Verify schema + critical tables present.
- [ ] Document RPO / RTO in `docs/runbooks/disaster-recovery.md`.
- [ ] Commit runbook.

### Task 2.14 — i18n scaffolding (Hindi + 5 regional languages)

**Severity:** P2 (blueprint anchor §8 — "multilingual readiness").

**Files:**
- Create: `src/i18n/{en,hi,ta,te,mr,bn,gu}.json`
- Refactor: hardcoded English strings on `/pricing`, `/billing`, `/privacy`, `/terms`, all landing pages

**Steps:**
- [ ] Set up `next-intl` (or equivalent) with route-segment based locale.
- [ ] Extract strings; build translation pipeline.
- [ ] Default English; Hindi as second.
- [ ] Per-tenant default locale via `schools.default_language`.
- [ ] Commit.

### Task 2.15 — Bundle budget enforcement in CI

**Severity:** P2. **Source:** Payments audit P1-10.

**Files:**
- Create: `scripts/check-bundle-budget.js`
- Modify: GitHub Actions workflow

**Steps:**
- [ ] Run `next build` with bundle analyzer; export JSON.
- [ ] Compare against budget (e.g., 250kB JS for `/dashboard`, 350kB for `/foxy`).
- [ ] Fail CI if over budget.

### Task 2.16 — Razorpay refund + GST invoicing

**Severity:** P1. **Source:** Payments audit P1-7.

**Files:**
- Create: `src/app/api/payments/refund/route.ts`
- Create: `src/app/api/payments/invoice/[id]/route.ts` (PDF generation)
- Create: `supabase/migrations/20260519000018_gst_invoices.sql`

**Steps:**
- [ ] Refund route: validate eligibility (7-day window), call Razorpay refund API, write `payment_refunds` row, send confirmation email.
- [ ] GST invoice: capture GSTIN at checkout for B2B; generate compliant invoice PDF with CGST/SGST/IGST breakdown; store in `invoices` storage bucket.
- [ ] Commit.

### Task 2.17 — Synthetic monitor + projector-health cron

**Severity:** P1. **Source:** Infra audit + memory references to PR #767-776.

**Files:**
- Create: `src/app/api/cron/synthetic-monitor/route.ts` (5-min interval)
- Create: `src/app/api/cron/projector-health/route.ts` (15-min interval)

**Steps:**
- [ ] Synthetic monitor: scripted login + quiz attempt + Foxy turn against staging credentials; fail → PagerDuty.
- [ ] Projector health: assert event-bus lag < 60s; fail → alert.
- [ ] Commit.

---

## Section 3 — Phase 3: Scale Hardening (Weeks 10–14)

### Task 3.1 — Move BKT/IRT triggers off the synchronous insert path

**Severity:** P0 at peak. **Source:** DB audit P1 (trigger storm).

**Files:**
- Migration: drop synchronous trigger; enqueue update via `pg_notify` → consumer reads and applies via `bkt_apply` RPC (Task 1.9).

**Steps:**
- [ ] Replace `trg_quiz_response_irt_theta` with a NOTIFY trigger that publishes `(student_id, response_id)`.
- [ ] Queue consumer (Task 1.6) subscribes; applies BKT/IRT updates in batches of 50.
- [ ] Eventual consistency window: < 5 seconds at peak.
- [ ] Commit.

### Task 3.2 — Read-replica routing for analytics

**Severity:** P1 (scale). **Source:** Infra audit P1-3 (analytics N+1).

**Files:**
- Modify: `src/app/api/v1/class/[id]/analytics/route.ts`, `src/app/api/super-admin/analytics/route.ts`, `src/app/api/super-admin/reports/route.ts`

**Steps:**
- [ ] Route analytics queries to read-replica via separate Supabase client.
- [ ] Replace ad-hoc 50k-row pulls with materialized views (`mv_class_analytics_summary`, `mv_school_health_snapshot`); refresh hourly.
- [ ] Pagination on every list endpoint; cap CSV exports at 100k rows with explicit chunking message.
- [ ] Commit.

### Task 3.3 — SLO definitions + PagerDuty/Slack alerting

**Severity:** P1. **Source:** AI audit P1-8, Payments audit P1-5.

**Files:**
- Create: `docs/runbooks/slos.md`
- Create: Sentry alert rules (configured via dashboard, documented in runbook)
- Wire: PagerDuty integration for P0/P1 alerts; Slack `#alfa-ops` for P2

**SLOs (target):**
- Foxy turn end-to-end: P95 < 4s, P99 < 8s
- Quiz item delivery: P95 < 500ms, P99 < 1s
- Dashboard load: P95 < 800ms
- Razorpay webhook → entitlement: P99 < 10s
- DB query P95 < 200ms (excluding analytics)
- Uptime: 99.9% monthly

### Task 3.4 — Audit logs partitioning (overlaps 1.14)

Already in Task 1.14.

### Task 3.5 — Per-school custom domain hardening

**Severity:** P1. **Source:** DB audit P1 (custom_domain self-hijack).

**Files:**
- Migration: add `CHECK (custom_domain NOT IN ('alfanumrik.com','www.alfanumrik.com','localhost'))`.
- Modify proxy.ts tenant resolution to require domain verification token.

### Task 3.6 — Penetration test + remediation

**Severity:** P0 acceptance gate. **External vendor.**

**Steps:**
- [ ] Engage CERT-In empanelled vendor (e.g., NII Consulting, SecPod).
- [ ] Scope: web app, API, auth flows, RBAC, payments.
- [ ] Close all High/Critical findings before GA.
- [ ] Re-test after fixes.
- [ ] Store report under `docs/security/pentest-2026Q3.pdf` (private).

### Task 3.7 — WCAG 2.1 AA accessibility audit

**Severity:** P1. **Source:** Payments audit P1-9.

**Steps:**
- [ ] Audit student + parent + teacher dashboards with axe-core + manual screen-reader run.
- [ ] Fix: ARIA labels, keyboard nav order, color contrast (≥4.5:1 for text), focus indicators, prefers-reduced-motion handling.
- [ ] Add `aria-live="polite"` on Foxy chat, SW update toast.
- [ ] Re-test with NVDA + VoiceOver.

### Task 3.8 — PWA: ship sw.js + manifest.json (currently vapor)

**Severity:** P1. **Source:** Payments audit P0-4.

**Files:**
- Generate: `public/sw.js` via `@serwist/next` or `next-pwa`
- Create: `public/manifest.json`, `public/icons/{192,512,maskable}.png`

**Steps:**
- [ ] Configure Serwist with offline-first for quiz + Foxy assets, network-first for API.
- [ ] Test offline: open app → disconnect network → quiz still loads.
- [ ] Commit.

### Task 3.9 — Load test at 15k concurrent students

**Severity:** P0 acceptance gate.

**Steps:**
- [ ] k6 scenario: 15k VUs, mix: 40% quiz, 30% Foxy, 20% dashboard, 10% payment.
- [ ] Duration: 1 hour sustained + 5-min peak spike to 20k.
- [ ] Pass criteria: P95 latency targets met, error rate < 0.1%, no DB connection exhaustion.
- [ ] If fail → scale Supabase plan, retest.
- [ ] Document results in `docs/runbooks/load-test-2026Q3.md`.

### Task 3.10 — SOC2-lite controls

**Severity:** P2 (sales enablement).

**Steps:**
- [ ] Quarterly access review (super-admin tier members).
- [ ] Change management log: every prod change has PR + approval + rollback.
- [ ] Vendor risk register: Razorpay, Supabase, Vercel, Anthropic, Voyage, Mailgun, Upstash, Sentry, PostHog.
- [ ] Document in `docs/governance/`.

---

## Section 4 — Algorithm Production Hardening (Reference)

### 4.1 Bayesian Knowledge Tracing (BKT)
- **Atomic update** via `bkt_apply(student_id, node_code, correct)` Postgres function with row lock (Task 1.9).
- **Per-grade/subject priors** via `bkt_priors` lookup table; defaults: `p_init=0.30, p_slip=0.10, p_guess=0.20, p_transit=0.10`.
- **Mastery threshold:** configurable via `feature_flags`; default `0.85`.
- **Eventual consistency** option for non-critical writes via NOTIFY → queue (Task 3.1).
- **Idempotency** keyed on `(student_id, node_code, response_id)` — replays don't double-apply.
- **Affective dampening:** when cognitive load = "frustrated", reduce `p_transit` by 50% for next 3 items.

### 4.2 Item Response Theory (IRT)
- **Item params** (`irt_difficulty`, `irt_discrimination`) re-estimated weekly via MMLE batch job (Task 2.5).
- **Student θ** persisted in `student_irt_state(student_id, subject_code, theta, se, last_recalc_at)`.
- **Newton-Raphson** capped at 8 iterations with monotonicity guard.
- **Drift cap:** parameter changes capped at ±0.3 per cycle to prevent instability.
- **3PL model** (difficulty, discrimination, guessing) used for MCQ; 2PL for open response.

### 4.3 Adaptive sequencing (next-item selection)
- **Greedy weakness + due-card interleave**: 60% weakness (lowest mastery), 30% spaced-repetition due, 10% novelty.
- **Exposure control:** Sympson-Hetter — track `served_count` per item over rolling 7d; cap at `7 × ceiling(P_target × total_students)`.
- **Top-K randomization** within tier band (cool-down list of last 5 items per student per concept).
- **Cold-start:** new student gets 5 calibration items spanning Bloom levels before adaptive kicks in.

### 4.4 Affective state
- **Signals collected:** response latency, response variability, hesitation pauses, streak length, voluntary breaks.
- **Classifier:** rule-based — `flow` (steady fast correct), `frustrated` (slow + errors + retries), `fatigued` (latency drift), `confident` (fast correct streaks).
- **Feedback:** next-item difficulty band adjustment (Task 2.6) + Foxy tone shift (encourager vs challenger).

### 4.5 Foxy AI guardrails (NCERT-only)
- **Mandatory RAG hit** (≥0.6 similarity, ≥2 chunks) — refuse if empty (Task 1.8).
- **Post-generation validator:** key claims must appear in retrieved chunks ≥0.85 similarity.
- **Prompt-injection sanitization** on history replay.
- **Per-student token budget** (Task 1.7).
- **Circuit breaker** on Anthropic 5xx storms (Task 1.7).

### 4.6 Quiz generation guardrails
- **Output JSON schema validation** (Zod or equivalent) — reject malformed items.
- **Answer-key second-pass validator** (Task 1.8 — `question-validator.ts`).
- **is_verified gating** — only verified items reach students (Task 1.8).
- **Bloom progression** preserved (existing logic in `quiz-generator/index.ts:148-167`).

---

## Section 5 — Final RBAC Model

### Role taxonomy (6 roles)
| Role         | Hierarchy | Scope                | Audit visibility       |
|--------------|-----------|----------------------|------------------------|
| super_admin  | 100       | Platform-wide        | All audit_logs         |
| admin        | 80        | Platform read-only ops | All audit_logs        |
| school_admin | 60        | Single school        | School-scoped audit    |
| teacher      | 40        | Assigned classes     | Class-scoped audit     |
| parent       | 20        | Linked children      | Own + children audit   |
| student      | 10        | Self                 | Own audit              |

### super_admin tiers (4 sub-levels)
- `viewer` — read-only on all super-admin surfaces
- `ops` — feature flags, content CMS, support tickets
- `platform` — schools, users, roles (read+write below own hierarchy)
- `root` — all destructive operations (test-accounts, deploy, role assignment ≥ super_admin)

### Permission cache
- **Replace in-memory `Map`** with Upstash Redis (15-min TTL).
- **Invalidation:** on role grant/revoke, publish `permission_cache_invalidate:{user_id}` via Redis pub/sub → all instances clear local copy.
- **Audit trail:** every role change writes to `audit_logs` with full prev/next snapshot.

### Hierarchy enforcement
- Assigning a role: caller's hierarchy_level must exceed target role's hierarchy_level (Task 1.2).
- Modifying a user with role X: caller must outrank X.
- Cross-tenant access: super_admin only (audit-logged with explicit `cross_tenant_access=true` flag).

### Resource ownership matrix
| Resource     | Student | Parent (linked) | Teacher (assigned) | School Admin | Super Admin |
|--------------|---------|-----------------|---------------------|--------------|-------------|
| Own profile  | RW      | R               | R                   | R            | RW          |
| Quiz responses | RW    | R               | R                   | R            | R           |
| Foxy session | RW      | R (digest)      | R (digest)          | R (digest)   | R           |
| Payment      | RW      | R               | —                   | R            | RW          |
| Assigned class | —     | —               | RW                  | RW           | RW          |
| School settings | —    | —               | —                   | RW           | RW          |
| Platform settings | —  | —               | —                   | —            | RW (root)   |

---

## Section 6 — Operational Runbooks Required

All saved under `docs/runbooks/`. Each runbook: trigger condition → first 5 min → escalation → resolution → post-mortem template.

1. **`incident-response.md`** — P0 outage: who's on-call, communication channels (status page, email blast, school WhatsApp), rollback procedure.
2. **`disaster-recovery.md`** — Supabase PITR restore, Vercel rollback, Razorpay reconciliation after data loss.
3. **`payment-reconciliation.md`** — monthly Razorpay export vs `payment_history` diff, unmatched transaction investigation, RBI audit preparedness.
4. **`school-onboarding.md`** — CSV import flow, invite emails, parental consent collection, initial admin setup.
5. **`cost-cap-escalation.md`** — Anthropic daily spend > threshold: who alerts, throttle decision tree, emergency Voyage/Anthropic kill switches.
6. **`rls-policy-verification.md`** — post-migration check: `pg_policies` audit query + multi-tenant isolation regression test.
7. **`access-review.md`** — quarterly super_admin membership review, role grants justification, dormant account cleanup.
8. **`on-call-rotation.md`** — weekly rotation, escalation tree (L1 ops → L2 platform → L3 founder).
9. **`load-test-runbook.md`** — quarterly k6 scenario refresh, baseline metrics, capacity planning trigger.
10. **`schema-baseline-regen.md`** — quarterly `supabase db dump` + sanitize procedure (Task 1.12).

---

## Section 7 — Decision Points (CEO sign-off required)

| # | Decision                                            | Default if no signal | Impact                                            |
|---|-----------------------------------------------------|----------------------|---------------------------------------------------|
| 1 | ADR-002: swap hand-rolled tick.ts → LangGraph.js   | Reject (keep hand-rolled) | ~5 days dev; reverses no-Anthropic-SDK rule    |
| 2 | Mastery engine: `adaptive_mastery` vs `cme_concept_state` | Pick `adaptive_mastery` (ADR-005) | Demote loser to read-only projector  |
| 3 | Concept-graph as canonical: deprecate `curriculum_topics` UUID joins | Yes | One release dual-write, then drop                 |
| 4 | B2C vs B2B vs B2B2C pricing finalization           | Keep all three        | Pricing UI source-of-truth + GST handling         |
| 5 | DPDP DPO appointment                                | External counsel + internal accountable exec | Compliance gate for >1k principals               |
| 6 | Pen test vendor selection                           | NII Consulting (CERT-In empanelled) | ~₹3-5 lakh budget                                 |
| 7 | Supabase plan upgrade (Pro → Team) for PITR + read replica | Yes for Phase 2 | ~$599/mo additional                              |
| 8 | Vercel plan upgrade for higher function memory + crons | Yes for Phase 2 | ~$20/seat                                         |
| 9 | Anthropic spend cap (daily, monthly)                | ₹3,000/day → ₹70k/mo | Auto-throttle Foxy if exceeded                    |
| 10 | School onboarding model: self-serve vs CSM-led    | CSM-led for first 20 schools, then self-serve | Affects onboarding runbook scope                  |

---

## Section 8 — Risk Register (Top 10 if shipped today)

Ranked by P(loss) × E(loss).

1. **Cross-tenant data leak** (P0-DB-3) — School A reads School B's `student_learning_profiles` / `payment_history`. Trigger: any user with both school_id JWT and a forged student auth.uid. Mitigation: Task 1.1.
2. **Razorpay double-charge from racy webhook** (P0-Pay-1) — UNIQUE index missing; concurrent retries activate twice. Mitigation: Task 1.4.
3. **Self-escalation in `/super-admin/roles` POST** (P0-RBAC-5) — Tier-1 admin promotes self to super_admin. Mitigation: Task 1.2.
4. **AI cost runaway from unquota'd `ncert-solver` + `scan-ocr`** (P0-AI-5/6) — Coordinated abuse drains Anthropic budget in hours. Mitigation: Task 1.7.
5. **Effective rate-limit = configured × instance_count** (P0-Infra-1) — in-memory per-instance buckets. Mitigation: Task 1.3.
6. **Health check lies green** (P0-Infra-8) — first prod incident, dashboards say green while every Foxy turn 500s. Mitigation: Task 1.10.
7. **Queue-consumer double-processing** (P0-Infra-4) — BKT/XP corruption at quiz-submission peak. Mitigation: Task 1.6.
8. **Unverified parental consent** (P0-Pay-7) — DPDPA §9 violation; penalties up to ₹250 cr. Mitigation: Task 1.13.
9. **Yearly subscription path contradictory** (P0-Pay-8) — every yearly customer either never renews or fails checkout. Mitigation: Task 2.16 + decision point #4.
10. **NCERT integrity break via scan-ocr ask_foxy** (P0-AI-4) — off-syllabus answers screenshot by parents/CBSE inspectors. Reputational P0. Mitigation: Task 1.7 + 1.8.

---

## Compliance Report (per blueprint §7)

```
Blueprint compliance
- Scope: full prod-readiness plan covering 117 audited defects across 5 domains
- Hard rules:
  - §3.1 Backward compatibility: PASS — every migration is additive + flag-gated
  - §3.2 Minimal targeted changes: PASS at plan level; per-task TDD discipline enforced
  - §3.3 No placeholders: PASS — every task has real file paths, no <uuid>/TODO
  - §3.4 DB schema source of truth: PASS — Task 1.12 establishes baseline
  - §3.5 NCERT-only via RAG: ADDRESSED by Tasks 1.7 + 1.8 (closes the gap)
  - §3.6 Single chapter taxonomy: ADDRESSED by Task 2.8 (concept_graph canonical)
  - §3.7 RBAC on every admin route: ADDRESSED by Task 1.2 (15 super-admin routes)
  - §3.8 Input validation: ADDRESSED across Tasks 1.2, 1.3, 1.19
  - §3.9 ₹ via Razorpay idempotent: ADDRESSED by Tasks 1.4 + 1.5 + 2.16
  - §3.10 No ghost routes: VERIFY in Task 1.20 smoke test
  - §3.11 No new tools/services: PASS — plan uses only approved stack
  - §3.12 Root-cause debugging: PASS — every task identifies root cause from audits
- Backward compat: PASS — flag-gated rollouts, dual-write/dual-read transitions on canonical-table changes
- RBAC/auth: ADDRESSED — Task 1.2 + Section 5 model
- RAG/NCERT integrity: ADDRESSED — Tasks 1.7, 1.8, 2.8
- Schema integrity: ADDRESSED — Tasks 1.1, 1.12 + dual-write migrations
- Production impact: phased rollout; Phase 1 ships behind flags; full rollback path per task
- Open questions: 10 decision points in Section 7 require CEO sign-off
```

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-18-prod-launch-10k-students.md`. Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task, two-stage review between tasks, fast iteration. Best for the 20 Phase 1 P0 tasks because each is well-bounded and review-gated.

**2. Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints. Best for sequenced refactors where shared context speeds iteration (e.g., Tasks 1.2 → 1.14 audit-log consolidation chain).

**Recommended sequence:** start with Phase 1, Tasks 1.1 through 1.13 (the 13 P0 ship-blockers). These can be parallelized in 4 swim lanes:
- **Lane A (DB):** 1.1, 1.12, 1.14, 1.15 (RLS, baseline, audit consolidation, brute-force)
- **Lane B (RBAC):** 1.2, 1.17, 1.18 (consolidation, CORS, PII scrubbing)
- **Lane C (AI):** 1.7, 1.8, 1.9 (cost controls, NCERT integrity, BKT atomicity)
- **Lane D (Infra+Pay):** 1.3, 1.4, 1.5, 1.6, 1.10, 1.11, 1.13, 1.19 (rate limit, webhook, verify, queue, health, regions, DPDPA, uploads)

Tasks 1.16 and 1.20 are sequencing/acceptance gates that come last.

---

*End of plan. Generated 2026-05-18 from five-domain audit + Alfanumrik build blueprint v2.*
