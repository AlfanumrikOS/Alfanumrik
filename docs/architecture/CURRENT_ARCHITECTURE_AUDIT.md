# Current architecture audit (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0` at commit `b24211c`.
**Method:** direct inventory of the repo (file counts, API routes, Edge
Functions, migrations, domain modules) cross-referenced with the
Phase 1 damage audit recorded in
[`../stabilization-phase-0-memo.md`](../stabilization-phase-0-memo.md).

This document describes what is **actually deployed today**, not what
could be or should be. See
[`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md)
for the forward plan.

## 1. Stack

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | Next.js 16.2 App Router + React 18 + Tailwind 3.4 + SWR | [`package.json`](../../package.json), [`next.config.js`](../../next.config.js), [`tailwind.config.js`](../../tailwind.config.js) |
| API | Next.js API routes (`src/app/api/`) | **169** `route.ts` files as of 2026-04-24 (find count) |
| Auth | Supabase Auth (email / PKCE), JWT auto-refresh, device session tracking | [`src/middleware.ts`](../../src/middleware.ts), [`src/lib/AuthContext.tsx`](../../src/lib/AuthContext.tsx) |
| Database | Supabase PostgreSQL + RLS + RBAC + pgvector | **309** migration files in [`supabase/migrations/`](../../supabase/migrations/) |
| Edge Functions | Supabase Edge Functions (Deno runtime) | **33** directories in [`supabase/functions/`](../../supabase/functions/) (32 functions + `_shared` utils module) |
| Payments | Razorpay (INR, monthly recurring + yearly one-time) | [`src/app/api/payments/`](../../src/app/api/payments/), [`src/lib/razorpay.ts`](../../src/lib/razorpay.ts) |
| AI | Claude Haiku (primary) + Sonnet fallback via Edge Functions or `/api/foxy` Next route | `supabase/functions/{foxy-tutor, ncert-solver, quiz-generator, quiz-generator-v2, cme-engine, grounded-answer}/`, [`src/app/api/foxy/route.ts`](../../src/app/api/foxy/route.ts) |
| Mobile | Flutter + Riverpod + GoRouter | [`mobile/`](../../mobile/) |
| Monitoring | Sentry (client/server/edge) + Vercel Analytics + structured logger | [`sentry.*.config.ts`](../../), [`src/lib/logger.ts`](../../src/lib/logger.ts) |
| Hosting | Vercel (bom1/Mumbai) | [`vercel.json`](../../vercel.json) |

**Uncertainty:** the numbers 151 / 29 / 265 in
[`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) are outdated. Re-verified
on 2026-04-24: 169 routes, 32 Edge Functions (+1 `_shared` module),
309 migrations.

## 2. Routing tree

### 2.1 Frontend portals (App Router)

46 top-level route segments under `src/app/`. They cluster into five
role-scoped portals and a set of cross-cutting public / marketing
routes. Middleware in [`src/middleware.ts`](../../src/middleware.ts)
enforces auth and role-based redirects before the page renders.

| Portal | Entry points | Evidence |
|---|---|---|
| Student | `/dashboard`, `/foxy`, `/learn`, `/quiz` (redirects to `/foxy`), `/progress`, `/leaderboard`, `/exams`, `/mock-exam`, `/simulations`, `/pyq`, `/review`, `/scan`, `/study-plan`, `/challenge`, `/hpc`, `/stem-centre`, `/diagnostic` | `src/app/<name>/page.tsx` for each |
| Parent | `/parent/*` | `src/app/parent/` (6 pages) |
| Teacher | `/teacher/*` | `src/app/teacher/` (8 pages) |
| School admin (tenant) | `/school-admin/*` | `src/app/school-admin/` — 16 sub-pages as of today |
| Super admin | `/super-admin/*` | `src/app/super-admin/` (24 pages per CLAUDE.md; not re-counted) |
| Internal admin | `/internal/admin/*` | `src/app/internal/admin/` |
| Public / marketing | `/`, `/about`, `/contact`, `/demo`, `/for-parents`, `/for-schools`, `/for-teachers`, `/help`, `/pricing`, `/privacy`, `/product`, `/research`, `/schools`, `/security`, `/terms`, `/welcome`, `/join` | direct `src/app/*/page.tsx` |
| Auth + onboarding | `/auth/*`, `/login`, `/onboarding` | [`src/app/auth/`](../../src/app/auth/), [`src/app/onboarding/page.tsx`](../../src/app/onboarding/page.tsx) |

**`/quiz` is redirected to `/foxy` at the `next.config.js` level.** The
legacy `src/app/quiz/page.tsx` still compiles but is not reachable from
the production URL.

### 2.2 API routes (server)

169 route files under `src/app/api/`. Top-level namespaces:

| Namespace | Purpose | Auth model |
|---|---|---|
| `/api/auth/*` | Profile bootstrap, repair, onboarding status, device session registration | session cookie |
| `/api/oauth/*` | OAuth authorize / token | — |
| `/api/payments/*` | Razorpay order creation, verify, subscribe, cancel, status, webhook | session cookie (routes) / HMAC signature (webhook) |
| `/api/foxy` | Grounded AI tutor (new Next route, replacing `foxy-tutor` Edge Function) | session cookie |
| `/api/concept-engine` | Cognitive model facade (BKT/IRT/SM2) | session cookie |
| `/api/embedding` | Voyage embedding proxy | service key |
| `/api/diagnostic/*` | Diagnostic session start / complete | session cookie |
| `/api/exam/*` | Exam chapter lookup | session cookie |
| `/api/notifications/whatsapp` | Outbound WhatsApp notification | internal |
| `/api/parent/*` | Parent portal server endpoints | session cookie |
| `/api/v1/*` | V1 API surface — exam / school / student / admin | mix of session + `authorizeRequest()` |
| `/api/internal/admin/*` | Internal ops endpoints | `authorizeRequest()` — internal only |
| `/api/super-admin/*` | Super admin panel backend | `authorizeRequest()` + `SUPER_ADMIN_SECRET` guard |
| `/api/cron/*` | Vercel cron targets (school-operations, evaluate-alerts) | Vercel cron header |
| `/api/client-error`, `/api/error-report` | Client-side error relay to Sentry (via `/monitoring` tunnel) | anon |
| `/api/support/ticket`, `/api/support/ai-issue` | User-facing support intake | session cookie |

**Known P9 gap:** payment routes use session auth only
(`getAuthedUserFromRequest`), not `authorizeRequest('payment.manage')`.
Pre-existing, tracked in [`RISK_REGISTER.md`](./RISK_REGISTER.md).

### 2.3 Edge Functions (Supabase / Deno)

32 Deno functions in `supabase/functions/`:

| Category | Functions |
|---|---|
| AI-first | `foxy-tutor`, `ncert-solver`, `ncert-question-engine`, `quiz-generator`, `quiz-generator-v2`, `cme-engine`, `grounded-answer` |
| RAG ingestion | `extract-ncert-questions`, `extract-diagrams`, `embed-ncert-qa`, `embed-questions`, `embed-diagrams`, `generate-embeddings`, `generate-answers`, `generate-concepts`, `verify-question-bank`, `coverage-audit`, `bulk-question-gen` |
| Messaging | `send-auth-email`, `send-welcome-email`, `whatsapp-notify`, `alert-deliverer` |
| Scheduled / background | `daily-cron`, `queue-consumer`, `session-guard`, `scan-ocr` |
| Reporting | `parent-portal`, `parent-report-generator`, `teacher-dashboard`, `export-report` |
| Compliance / misc | `nep-compliance`, `identity` (thin identity proxy, single-file on `origin/main`) |

**`foxy-tutor` vs `/api/foxy` split-brain (tracked):** the legacy
Edge Function last changed 2026-04-18; the new Next.js route advanced
significantly (grounded pipeline, cognitive context, quota refund).
Both are reachable today. Mobile still targets `foxy-tutor`.
Deprecation scheduled via feature flag
`ff_grounded_ai_foxy` (seeded in
[`supabase/migrations/20260418100800_feature_flags.sql`](../../supabase/migrations/20260418100800_feature_flags.sql)).

## 3. Data layer

### 3.1 Migrations

309 files in `supabase/migrations/` with timestamped filenames. Apply
strictly by timestamp. Latest applied (on `origin/main`, as of
2026-04-24):
`20260418140000_study_path_integrity_guards.sql`.

Latest on this branch (not yet applied):
`20260424120000_atomic_subscription_activation_rpc.sql` (see
[`../stabilization-phase-0-memo.md`](../stabilization-phase-0-memo.md)).

### 3.2 RLS posture

440+ policies (per [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md); not
re-counted). Every table that holds user data has RLS enabled. Client
code goes through either [`src/lib/supabase.ts`](../../src/lib/supabase.ts)
(browser) or [`src/lib/supabase-server.ts`](../../src/lib/supabase-server.ts)
(server components / middleware), both respecting RLS.
[`src/lib/supabase-admin.ts`](../../src/lib/supabase-admin.ts) uses the
service role and bypasses RLS; importing it from client code violates
P8 and is flagged by [`guard.sh`](../../.claude/hooks/guard.sh).

### 3.3 Critical RPCs

| RPC | File | Invariants |
|---|---|---|
| `atomic_quiz_profile_update(student_id, subject, xp, total, correct, time_seconds)` | `supabase/migrations/20260325160000_atomic_quiz_profile_update.sql`, updated at `supabase/migrations/20260329210000_fix_rpc_signatures_and_add_xp.sql` | P1, P2, P4 |
| `activate_subscription(...)` / `atomic_subscription_activation(...)` | `supabase/migrations/20260414120000_payment_subscribe_atomic_fix.sql` / `supabase/migrations/20260424120000_atomic_subscription_activation_rpc.sql` | P11 |
| `bootstrap_user_profile(...)` | `supabase/migrations/20260402100000_robust_auth_onboarding_system.sql` | P15 |
| `get_user_role(user_id)` | same file, `sync_user_roles_for_user(user_id)`, `admin_repair_user_onboarding(user_id, role)` | P9, P15 |
| `check_and_record_usage(student_id, feature)` | quota enforcement for Foxy | P12 |

### 3.4 Known schema quirks

- **Heavy `SET search_path = public` on SECURITY DEFINER functions.**
  [`supabase/migrations/20260408000009_fix_search_path_on_secdef_functions.sql`](../../supabase/migrations/20260408000009_fix_search_path_on_secdef_functions.sql)
  is a 40-line DO-loop that pins `search_path = public` on **every
  postgres-owned SECDEF function in the `public` schema, discovered
  at runtime** (no hard-coded function list). Any schema move that
  relocates `students` / `teachers` / `guardians` must re-run an
  equivalent loop post-move, or every SECDEF function that touches
  those tables silently fails. The abandoned identity extraction
  attempted a 4-function hotfix and broke on exactly this — see the
  damage audit.
- **Blast-radius of a hypothetical rename of `students` / `teachers`
  / `guardians`:** RLS policy predicates + policy `USING` / `WITH
  CHECK` bodies across migrations:
  - **5 files** fully-qualify `FROM public.students` (e.g.
    [`supabase/migrations/20260417700000_fix_student_id_rls_policies.sql`](../../supabase/migrations/20260417700000_fix_student_id_rls_policies.sql),
    [`supabase/migrations/20260408000002_foxy_sessions_and_messages.sql`](../../supabase/migrations/20260408000002_foxy_sessions_and_messages.sql))
    and must be explicitly rewritten.
  - **48 additional files** reference unqualified `FROM students` in
    policy bodies or functions — these resolve via the session-role
    `search_path`, which in turn depends on the role-level override
    set by the rename migration itself. Fragile.
  - Total: ~53 files would need coordinated patching for a rename.
- **Role-level `search_path` overrides do not apply to SECURITY
  DEFINER functions.** `ALTER ROLE ... SET search_path` only affects
  regular (invoker) queries. SECDEF functions use their own
  `proconfig` pin. A common mistake.

## 4. Auth and onboarding flow

P15 is the #1 user acquisition path. The 3-layer failsafe described
in [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md):

1. **Client insert** (deprecated — removed during onboarding
   refactor; see comment at
   [`src/lib/AuthContext.tsx:526`](../../src/lib/AuthContext.tsx))
2. **`/api/auth/bootstrap`** server endpoint, calling the
   `bootstrap_user_profile` RPC (idempotent, `ON CONFLICT`)
3. **`AuthContext` runtime fallback** — seeds role from
   `user_metadata.role` if neither layer 1 nor 2 succeeded

The `send-auth-email` Edge Function is required to return HTTP 200 on
every code path (Supabase aborts signup on non-200). Verification
links must embed `SITE_URL` from the Edge Function's environment, not
a hardcoded host.

Email / PKCE flow is handled at:

- [`src/app/auth/callback/route.ts`](../../src/app/auth/callback/route.ts)
- [`src/app/auth/confirm/route.ts`](../../src/app/auth/confirm/route.ts)

Onboarding supports three roles end-to-end: student (grade + board +
preferred language), teacher (school + subjects), parent (phone +
link code).

## 5. AI / RAG pipeline (current state)

Active pipeline as of `origin/main` (after
[`feat/grounded-rag`](../../) merged on 2026-04-18):

```
student query
  → Next route /api/foxy
  → callGroundedAnswer(...)
  → Edge Function grounded-answer
      ├─ coverage precheck (cbse_syllabus + alternatives suggestion)
      ├─ Voyage embedding (with retry + timeout)
      ├─ retrieval + scope verification (defense in depth)
      ├─ Claude Haiku call (Sonnet fallback on failure)
      ├─ strict-mode second Haiku pass (grounding check)
      ├─ confidence scoring + citation extraction
      ├─ 3-state circuit breaker (closed/open/half-open)
      └─ in-memory LRU cache
  → grounded_ai_traces row written (privacy-redacted)
  → client renders (UnverifiedBanner / AlternativesGrid / HardAbstainCard)
```

Feature flag `ff_grounded_ai_foxy` gates the new pipeline; default
false — disabled installations fall through to the legacy
intent-router path at `src/app/api/foxy/route.ts:834`.

Zombie code to remove (identified in the audit): the resurrected
`circuitBreakerState`, `recordApiFailure`, `recordApiSuccess`,
`shouldAttemptApiCall` at
[`src/app/api/foxy/route.ts:102-139`](../../src/app/api/foxy/route.ts)
are never called — the real circuit breaker lives in
`supabase/functions/grounded-answer/circuit.ts`.

## 6. Quiz flow (current state)

Entry: `/quiz` → redirect → `/foxy` → quiz mode. The standalone
legacy `src/app/quiz/page.tsx` still exists but is not reachable in
prod routing.

The score formula lives in three places that must stay in sync
(P1 invariant):

- `submitQuizResults()` (client)
- [`src/components/quiz/QuizResults.tsx`](../../src/components/quiz/QuizResults.tsx)
- `atomic_quiz_profile_update()` RPC

Anti-cheat (P3) enforced in both client and server:

- ≥ 3 s average per question
- not all-same-answer if > 3 questions
- response count = question count

XP is owned by [`src/lib/xp-rules.ts`](../../src/lib/xp-rules.ts); no
hardcoded XP anywhere else (P2). Daily cap 200 XP from quizzes, level
threshold 500 XP. Verified by
[`.claude/hooks/post-edit-check.sh`](../../.claude/hooks/post-edit-check.sh)
(warns on hardcoded numeric XP outside that file).

## 7. Payment flow (current state)

| Stage | Endpoint / function | Invariant |
|---|---|---|
| Plan / pricing read | `/api/payments/status`, `/api/payments/setup-plans` | — |
| Order creation | `/api/payments/create-order/route.ts` | P11 |
| Subscription creation | `/api/payments/subscribe/route.ts` | P11 |
| Verify + activate (client-initiated) | `/api/payments/verify/route.ts` — HMAC SHA-256 timing-safe signature check **before any DB write**; RPC failure → 503 (not 200) | P11 (verified by audit) |
| Webhook (Razorpay-initiated) | `/api/payments/webhook/route.ts` — `verifyRazorpaySignature` at lines 168–181, before `JSON.parse` | P11 |
| Cancel | `/api/payments/cancel/route.ts` | P11 |

**Known tracked risk (P11):** if primary `activate_subscription` RPC
fails, the webhook falls back to two-statement write of `students` +
`student_subscriptions`, which can split-brain if the second statement
fails. The new
[`supabase/migrations/20260424120000_atomic_subscription_activation_rpc.sql`](../../supabase/migrations/20260424120000_atomic_subscription_activation_rpc.sql)
adds `atomic_subscription_activation` as a single-transaction fallback.
The route is not yet wired to call it — deferred to a follow-up
branch behind a feature flag.

## 8. Coupling hotspots (candidates for modularization, not extraction)

| Symptom | Evidence | Domain impact |
|---|---|---|
| Business logic in UI | Scoring formula duplicated between `QuizResults.tsx`, `submitQuizResults()`, RPC | P1, hard to refactor |
| Scattered authorisation | Permission checks inlined in individual API routes rather than centralized | P9 |
| Direct cross-domain table access from API routes | e.g. payment routes read `students` and write `student_subscriptions`; analytics reads quiz tables directly | P8 boundary adherence OK, but testability is poor |
| Synchronous quiz → XP → analytics cascade | `submitQuizResults()` triggers profile update RPC which updates three tables; one failure cascades | P2, P4 |
| Two Foxy code paths live simultaneously | `supabase/functions/foxy-tutor/index.ts` + `src/app/api/foxy/route.ts` | AI contract drift |
| Pre-existing /foxy bundle > cap | 331.7 kB gzipped vs 260 kB cap, surfaced by [`scripts/check-bundle-size.mjs`](../../scripts/check-bundle-size.mjs) | P10 |

Modularization response to each is described in
[`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md).

## 9. What is NOT in scope for this document

- **Speculative architecture** (service mesh, API gateway,
  Kubernetes, CQRS, event-sourced core). None are deployed. They
  appear in the abandoned v0 docs; they do not belong here unless
  and until someone proposes them in
  [`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md)
  with a cost / ROI case.
- **Future multi-region deployment.** Vercel region is single (`bom1`
  / Mumbai). Supabase region is inferred from DB connection — not
  explicitly multi-region. No replica infrastructure exists.
- **Service-to-service authentication.** Not applicable — we run one
  Next.js app plus 32 Supabase-hosted Edge Functions. All auth is
  user-session or service-role.
