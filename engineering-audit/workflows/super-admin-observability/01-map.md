# Cycle 6 — Super-Admin & Observability — 01 MAP

Scope: the admin request lifecycle (auth/secret gate → permission check → handler → DB → response) and the observability pipeline (log → redact → sink; event → analytics; error → Sentry beforeSend → tunnel). Analysis only.

Sampling note: the super-admin surface is large — 119 route files under `src/app/api/super-admin/**` (grown from the constitution's "75") plus 2 under `src/app/api/v1/admin/**` and 14 under `src/app/api/internal/admin/**`. A `Grep` for the auth-gate tokens (`authorizeAdmin|authorizeRequest|requireAdminSecret|x-admin-secret`) matched **all 119** super-admin route files. I then read 10 routes in full (the highest-blast-radius + representative): `feature-flags`, `students/[id]/impersonate`, `reports`, `rbac`, `observability/export`, `analytics`, `login`, `bulk-actions/plan-change`, `v1/admin/roles`, `internal/admin/bulk-action`. A full 119-route line-by-line sweep is a follow-up (see 02-gap-analysis SAO-7).

---

## 1. Admin request lifecycle

There are **three distinct auth gates** in the admin surface. All sampled routes place the gate as the FIRST statement of the handler, BEFORE any DB I/O (P9-compliant).

### Gate A — Session + admin-level gate (`/api/super-admin/**`)
`authorizeAdmin(request, requiredLevel)` — `src/lib/admin-auth.ts:100-230`.

Flow:
1. Config presence check → 500 if `SUPABASE_URL`/`SERVICE_ROLE_KEY` missing (`admin-auth.ts:106-113`).
2. Extract access token from `Authorization: Bearer` header or `sb-*-auth-token` cookie (chunked-cookie aware) (`admin-auth.ts:117-156`).
3. No token → 401 `ADMIN_NO_TOKEN` (`admin-auth.ts:158-159`).
4. Verify token against GoTrue `/auth/v1/user` → 401 on failure (`admin-auth.ts:163-169`).
5. Look up `admin_users` by `auth_user_id`, `is_active=true`, via service role (`admin-auth.ts:178-192`). Empty → 403 `ADMIN_NOT_FOUND`. **No JWT fail-soft fallback** (removed Phase G.2, `admin-auth.ts:95-99`).
6. **Level enforcement**: `hasMinimumLevel(admin.admin_level, requiredLevel)` (`admin-auth.ts:47-51`, `198`). The 6-tier ladder `support<analyst<content_manager<finance<admin<super_admin` (`admin-auth.ts:28-45`). `requiredLevel` is a REQUIRED param (the `='support'` default was deliberately removed, `admin-auth.ts:88-93`) so no call site silently inherits the floor.
7. Returns `{authorized, userId, adminId, email, name, adminLevel}`.

**P9 gate sits at step 5-6.** Sampled tiers:
| Route | GET | mutation |
|---|---|---|
| `feature-flags` (`route.ts:19,65,140,237`) | support | super_admin (POST/PATCH/DELETE) |
| `rbac` (`route.ts:60,146`) | support | super_admin (all RBAC mutations) |
| `students/[id]/impersonate` (`route.ts:11,67,142`) | support | super_admin (start), admin (end) |
| `bulk-actions/plan-change` (`route.ts:24`) | — | super_admin |
| `reports` export (`route.ts:28`) | support | — |
| `observability/export` (`route.ts:36`) | support | — |
| `analytics` (`route.ts:37`) | support | — |

### Gate B — RBAC permission gate (`/api/v1/admin/**`)
`authorizeRequest(request, 'permission.code')` — e.g. `v1/admin/roles/route.ts:13,51,152` uses `'role.manage'`. Returns `{authorized, userId, errorResponse}`; route returns `errorResponse` on deny BEFORE DB I/O. This is the canonical P9 path described in `.claude/CLAUDE.md` P9.

### Gate C — Shared-secret gate (`/api/internal/admin/**`)
`requireAdminSecret(request)` — `src/lib/admin-auth.ts:404-416`.
- Reads `x-admin-secret` HEADER ONLY (never URL param) (`admin-auth.ts:405`).
- Missing `SUPER_ADMIN_SECRET` env → 503 (`admin-auth.ts:407-409`).
- Compares via `secureEqual(provided, expected)` — **constant-time** (`src/lib/secure-compare.ts:16-23`), avoiding the timing-leak of `!==`.
- Returns 401 on mismatch, `null` on success.
- Confirmed ordering: `internal/admin/bulk-action/route.ts:40-43` calls `requireAdminSecret` and returns the denial BEFORE `getSupabaseAdmin()` and any query. Pinned by REG-116 (internal-admin secret gate) and REG-119 (high-blast-radius gate pins).

### Login (`/api/super-admin/login/route.ts`)
Server-side login (Phase G.7). Per-IP Upstash rate limit (10/5min, in-memory fallback) → Zod body validation → per-email lockout (`checkLockout`, 5 fails/15min) → GoTrue password grant → `admin_users` membership confirm. Generic `INVALID_CREDENTIALS` message (no user-enumeration). Password is verified by GoTrue, not by app-level string compare, so no constant-time concern here. Every attempt audited via `logAdminAuditByUserId`.

### Audit trail (mandatory for mutations)
`logAdminAudit` / `logAdminAuditByUserId` (`admin-auth.ts:245-380`) dual-write to canonical `audit_logs` (actor_type='admin') AND legacy `admin_audit_log`, fire-and-forget via `Promise.allSettled`. Every sampled mutation (feature-flag create/update/delete, RBAC grant/revoke/impersonate/delegate, plan-change, impersonation start/end, report export) writes an audit row. Feature-flag writes ALSO call `invalidateFlagCache()` (`feature-flags/route.ts:119,218,262`) + emit a `logOpsEvent` deploy event.

---

## 2. Observability pipeline

### 2a. Structured logging (log → redact → sink)
`src/lib/logger.ts`:
- `createEntry` (`logger.ts:53-72`) attaches timestamp/env/version, then runs `redactPII(meta)` on ALL caller metadata (`logger.ts:67`) before assembling the entry. **P13 redactor sits here.**
- Levels gated by `MIN_LEVEL` (info in prod, debug in dev) (`logger.ts:47-50`).
- `emit` (`logger.ts:74-90`) writes JSON to console (sink = stdout → Vercel log drain).
- `logger.error` (`logger.ts:108-142`) ALSO forwards to Sentry via `captureException`/`captureMessage` with `extra: meta` — that payload is independently scrubbed at the Sentry `beforeSend` boundary (see 2c). Error objects are trimmed to name/message/5-line stack (`logger.ts:130-139`).

### 2b. Event analytics (event → redact → backends)
`src/lib/analytics.ts`:
- `track()` (`analytics.ts:140-180`): `logger.debug` (self-redacting, dev-only) → `redactPII(properties)` (`analytics.ts:152`) → fans out to Vercel Analytics (`analytics.ts:156-164`) and PostHog legacy + typed paths (`analytics.ts:170-178`). **P13 redactor sits at line 152, BEFORE either backend sees properties.**
- `identifyUser()` (`analytics.ts:210-219`): hashes the auth UUID via `hashUserIdForAnalytics` before any PostHog `identify` — never sends raw UUID.
- Event type map (`analytics.ts:59-131`) is product-shape only (subject, score, grade, plan) — no email/phone/name keys by design.

### 2c. Error monitoring (error → beforeSend redact → tunnel)
Three Sentry configs, each with a `beforeSend` that drops all non-production events and scrubs PII:
- **Client** `sentry.client.config.ts:26-33` → delegates to `redactSentryEvent` (`src/lib/sentry-client-redact.ts:69-143`): keep only `user.id`; strip auth/cookie/x-api-key headers; drop `request.cookies` + `request.data` wholesale; `sanitizeUrl` on `request.url`; walk breadcrumbs (redactPII + sanitizeUrl on url/to/from + message URL scrub); drop `extra`/`contexts` entries whose key matches `/email|phone|token|password|secret|key|cookie|auth/i` then `redactPII` the rest; `redactPII` on tags.
- **Server** `sentry.server.config.ts:26-94` and **Edge** `sentry.edge.config.ts:26-87`: parity logic inline — `user={id}`; delete authorization/cookie/set-cookie/x-api-key headers; delete cookies; `redactPII(request.data)`; `sanitizeUrl(request.url)`; breadcrumb walk; `redactPII` on extra/contexts/tags.
- **Redactor core** `supabase/functions/_shared/redact-pii.ts:37-95` (re-exported via `src/lib/ops-events-redactor.ts`): key-based `[REDACTED]` replacement over a `SENSITIVE_KEYS` set (passwords/tokens/secrets/api-keys/auth headers + email/phone/parent_phone/full_name/first_name/last_name/school_name/school_address + razorpay/card/upi). Recursive, circular-safe.
- **Tunnel**: client events route through `/monitoring` (next.config.js Sentry option) to bypass ad-blockers. Pinned by REG-49.

### 2d. Feature-flag evaluation (read path)
`src/lib/feature-flags.ts`:
- `loadFlags()` (`feature-flags.ts:78-104`): service-role fetch of `feature_flags`, cached 5 min. **Fail-safe: any non-array/malformed body coerces to `[]`** (`feature-flags.ts:97-98`) so every flag falls back to its default.
- `isFeatureEnabled()` (`feature-flags.ts:112-154`): unknown flag → false (`:122`); disabled → false; then env → role → institution → rollout-% scoping. Default-OFF posture is structural.
- Write path is Gate-A-gated in `super-admin/feature-flags/route.ts` (super_admin for create/patch/delete) + audited + `invalidateFlagCache()`.

---

## 3. Where the invariant guards sit (summary)

| Guard | Location | Invariant |
|---|---|---|
| Session+level gate | `admin-auth.ts:100-230` (`authorizeAdmin`) | P9 |
| RBAC permission gate | `authorizeRequest` (callers in `v1/admin/**`) | P9 |
| Constant-time secret gate | `admin-auth.ts:404-416` + `secure-compare.ts:16-23` | P9 |
| Log redactor | `logger.ts:67` → `redact-pii.ts:74-95` | P13 |
| Analytics redactor | `analytics.ts:152` + hashed identify `:216` | P13 |
| Sentry beforeSend redactors | client/server/edge configs + `sentry-client-redact.ts` | P13 |
| Flag default-OFF + fail-safe | `feature-flags.ts:97-98,122` | (ops safety) |
| Audit trail | `admin-auth.ts:245-380` (dual-write) | P9/audit |
