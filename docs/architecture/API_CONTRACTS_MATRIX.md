# API contracts matrix (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0`.
**Purpose:** enumerate the **actual endpoints the platform serves
today**, with auth model and owning context, so that any future
internal refactor can verify it does not break an existing contract.

**Scope:** Next.js API routes under `src/app/api/` + Supabase Edge
Functions under `supabase/functions/`. Both surfaces are first-class
HTTP contracts. Nothing here is proposed — only what exists.

## Surface summary

| Surface | Count | Location |
|---|---|---|
| Next.js API routes | 169 | `src/app/api/**/route.ts` |
| Supabase Edge Functions | 32 | `supabase/functions/<name>/index.ts` |

## Auth models in use

| Model | How it's enforced | Where |
|---|---|---|
| **Session cookie** (Supabase Auth JWT) | `getAuthedUserFromRequest()` helper → validates cookie, returns `user` | Most `/api/*` routes; all user-initiated actions |
| **`authorizeRequest(permission)`** | Checks RBAC permissions table; mandated by P9 | All admin routes should use this; payment routes currently do not (pre-existing gap, tracked R3) |
| **HMAC signature** | `verifyRazorpaySignature()` timing-safe HMAC-SHA256 | `/api/payments/webhook`, `/api/payments/verify` |
| **`SUPER_ADMIN_SECRET` header** | Constant-time compare against env var | `/api/super-admin/*` |
| **Vercel cron header** | `x-vercel-cron: 1` or similar | `/api/cron/*` |
| **Service key (Bearer)** | Supabase service-role JWT | Edge Function ↔ Next service-role paths; internal endpoints |
| **Unauthenticated** | None (rate-limited at middleware) | Health checks, error reporting, marketing endpoints |

## Core contracts by context

The list below is **not exhaustive** (169 routes). It covers the
contracts most likely to be touched during modularization. The full
inventory can be regenerated from `find src/app/api -name route.ts`.

### B1. Identity & access

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/bootstrap` | POST | session cookie | Create / repair profile. Calls `bootstrap_user_profile` RPC. |
| `/api/auth/repair` | POST | session cookie | Re-run bootstrap if profile missing (3-layer P15 failsafe layer 2). |
| `/api/auth/onboarding-status` | GET | session cookie | Is onboarding complete? |
| `/api/auth/session` | POST | session cookie | Register / update device session row. |
| `/api/oauth/authorize`, `/api/oauth/token` | GET / POST | — | OAuth endpoints. |

Edge Functions:

| Function | Auth | Purpose |
|---|---|---|
| `send-auth-email` | internal (Supabase Auth calls it) | Verification / magic link email; MUST return 200 on every path (P15) |
| `identity` | service key | Thin identity proxy (single-file on main; the abandoned branch's expansion was dropped) |

### B2. Tenant / school

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/school/students` | GET / POST | authorizeRequest('school.read_students') | List / invite students for a school |
| `/api/v1/school/classes`, etc. | various | authorizeRequest | Class CRUD |
| `/api/internal/admin/*` | various | authorizeRequest (admin) | Internal operator actions |

### B3. Parent

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/parent/approve-link` | POST | session cookie | Accept a child link request |
| `/api/parent/profile` | GET / PATCH | session cookie | Guardian profile |
| `/api/parent/report` | GET | session cookie | Weekly / daily report for linked child |

Edge Functions: `parent-portal`, `parent-report-generator`,
`whatsapp-notify` (delivery), `alert-deliverer`.

### B4. Teacher

Next routes delegate to `supabase/functions/teacher-dashboard/`:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| (teacher-dashboard Edge Function) | POST | session cookie → service key | Classroom roster, per-student metrics |

### B5. Quiz

Historically served by `/api/quiz/*`. Today `/quiz` redirects to
`/foxy` (set in `next.config.js`). Server-side quiz logic:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/foxy` (quiz mode) | POST | session cookie | Unified entry when user selects quiz mode in Foxy |
| `/api/exam/chapters` | GET | session cookie | Chapter listing for exam selection |

Edge Functions: `quiz-generator`, `quiz-generator-v2`, `cme-engine`,
`verify-question-bank`, `bulk-question-gen`,
`ncert-question-engine`, `grounded-answer` (shared with Foxy).

### B6. Learning content

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/embedding` | POST | service key | Voyage embedding proxy |
| `/api/concept-engine` | POST | session cookie | Cognitive model facade (BKT/IRT/SM2) |
| `/api/student/chapters` | GET | session cookie | Allowed chapter list (filtered by `cbse_syllabus`) |

Edge Functions: `extract-ncert-questions`, `extract-diagrams`,
`embed-ncert-qa`, `embed-questions`, `embed-diagrams`,
`generate-embeddings`, `generate-answers`, `generate-concepts`,
`verify-question-bank`, `coverage-audit`.

### B7. Foxy AI

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/foxy` | POST | session cookie | New grounded tutor entry. Delegates to `grounded-answer` Edge Function when `ff_grounded_ai_foxy=true`. |

Edge Functions:
- `foxy-tutor` — legacy, mobile clients still hit this
- `grounded-answer` — RAG + Claude pipeline
- `ncert-solver` — step-by-step solver (routed through grounded-answer
  when `ff_grounded_ai_ncert_solver=true`)

**Contract note:** the `/api/foxy` response shape carries
`groundingStatus` + `traceId` fields (introduced by commit `7fa91fd`).
Any UI consumer must handle four states: `verified`, `unverified`,
`hard_abstain`, `fallback`.

### B8. Practice / review

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/review/*` | various | session cookie | SM-2 card management |
| `/api/study-plan/*` | various | session cookie | Plan generation |

### B9. Assessment / diagnostic

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/diagnostic/start` | POST | session cookie | Begin diagnostic session |
| `/api/diagnostic/complete` | POST | session cookie | Submit diagnostic responses; updates `concept_mastery` |
| `/api/concept-engine` | POST | session cookie | BKT/IRT/SM2 queries |

Edge Functions: `cme-engine`, `ncert-question-engine`.

### B10. Payments

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/payments/setup-plans` | GET | session cookie | Plan catalog |
| `/api/payments/create-order` | POST | session cookie | Razorpay order creation |
| `/api/payments/subscribe` | POST | session cookie | Begin subscription flow; response shape `{ razorpay_order_id, key_id, ... }` |
| `/api/payments/verify` | POST | session cookie + **HMAC body signature** | Client-initiated verification. On RPC failure returns 503 (not 200) so client retries. |
| `/api/payments/webhook` | POST | **HMAC body signature** via `verifyRazorpaySignature()` — checked FIRST, before JSON.parse | Razorpay-initiated event ingest |
| `/api/payments/status` | GET | session cookie | Current subscription status (⚠ `.single()` bug — throws 500 for free-tier users; tracked R4) |
| `/api/payments/cancel` | POST | session cookie | Cancel active subscription |

**Contract invariant (P11):** webhook signature must verify before
any DB read / write. Verified intact in the Phase 1 audit. No changes
on this branch.

### B11. Notifications

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/notifications/whatsapp` | POST | internal | Dispatch WhatsApp message |

Edge Functions: `send-auth-email`, `send-welcome-email`,
`whatsapp-notify`, `alert-deliverer`.

### B12. Analytics / reporting

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/client-error`, `/api/error-report` | POST | anon (rate-limited) | Client error relay to Sentry via `/monitoring` tunnel |
| `/api/super-admin/*` | various | authorizeRequest + SUPER_ADMIN_SECRET | Reporting dashboards (61 endpoints per `.claude/CLAUDE.md`) |
| `/api/cron/evaluate-alerts` | POST | Vercel cron | Alert rule evaluation |
| `/api/cron/school-operations` | POST | Vercel cron (now scheduled 02:00 daily, see commit `840f49f`) | Nightly school metrics |

Edge Functions: `daily-cron`, `queue-consumer`, `parent-report-generator`,
`export-report`, `nep-compliance`, `session-guard`.

### B13. Super admin / ops

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/super-admin/*` | various | SUPER_ADMIN_SECRET + authorizeRequest | Ops UI backend |
| `/api/support/ticket`, `/api/support/ai-issue` | POST | session cookie | User-submitted tickets |
| `/api/internal/admin/bulk-action` | POST | admin | Bulk user / data operations |

## Response envelope

**No global envelope is enforced today.** Most endpoints return
loosely-typed `NextResponse.json(...)`. Some recently refactored
routes use `{ success, data, error }` (e.g. the abandoned branch's
`subscribe` change — dropped in Option C to avoid silent mobile
contract break).

**Recommendation (not yet implemented):** standardise on
`ApiResponse<T>` from a shared types module in Phase 0 modularization.
Until then, shape is per-route.

## Error codes in flight

| Code | Meaning | Example |
|---|---|---|
| `VALIDATION_ERROR` | Bad input | most POST endpoints |
| `FORBIDDEN` | Auth failed | `authorizeRequest()` failure |
| `RATE_LIMITED` | Upstash / middleware throttle | middleware-injected |
| `NOT_FOUND` | Resource missing | read endpoints |
| `SERVICE_UNAVAILABLE` (503) | Downstream RPC failed; client should retry | `/api/payments/verify` on RPC failure (P11) |

Not all endpoints use these codes uniformly. A normalisation pass is a
Phase 0 modularization candidate (not on the critical path).

## Rate limiting

`src/middleware.ts` applies Upstash Redis rate limits with in-memory
fallback. Buckets include:

- Per-IP on marketing / unauth endpoints
- Per-user on `/api/foxy` (ties into P12 quota)
- Per-user on write endpoints

Actual bucket sizes are not repeated here; see middleware source.

## Contract invariants to enforce (P14 review chain)

When a contract changes, the following reviewers must approve:

| Change | Required reviewers |
|---|---|
| Response shape on any `/api/payments/*` route | backend, architect, mobile, testing |
| Response shape on any `/api/foxy` / `grounded-answer` | ai-engineer, assessment, testing |
| New `authorizeRequest(permission)` call added | architect, ops |
| New Vercel cron | architect, ops |
| New Edge Function | architect, ops (+ domain owner) |
| Removing any route | architect, mobile, frontend, testing |

The matrix is mirrored in [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md)
section P14. This document repeats it where it directly concerns
API contracts.

## Uncertainty / gaps

- **Full 169-route inventory** is not replicated here; low-value churn
  if kept in sync manually. Regenerate on demand.
- **OpenAPI specs** do not exist for any of our routes. A minimal
  `openapi.yaml` covering the critical P11 / P15 contracts is a
  worthwhile Phase 0 add-on.
- **Mobile client's exact consumer shape** is not verified here. The
  mobile repo under [`mobile/`](../../mobile/) should be audited
  whenever a response shape changes. The abandoned branch changed
  `subscribe` response shape without that audit — the break was
  caught by the Option C cleanup and reverted.
