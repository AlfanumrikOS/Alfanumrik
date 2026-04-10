# Alfanumrik Security Posture: Current Risks

**Last verified**: 2026-04-02
**Classification**: Internal use only

## What Is Implemented

### HTTP Security Headers (next.config.js + middleware)
| Header | Value | Status |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | ACTIVE -- forces HTTPS for 2 years |
| `X-Frame-Options` | `DENY` | ACTIVE -- prevents clickjacking |
| `Content-Security-Policy` | Strict policy with allowlisted domains | ACTIVE -- see details below |
| `X-Content-Type-Options` | `nosniff` | ACTIVE -- prevents MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | ACTIVE -- legacy browser XSS filter |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ACTIVE -- limits referrer leakage |
| `Permissions-Policy` | camera, microphone, geolocation disabled; payment self-only | ACTIVE |
| `X-Powered-By` | Removed (`poweredByHeader: false`) | ACTIVE |

### Content Security Policy (CSP) Details
- `default-src 'self'`
- `script-src 'self' 'unsafe-inline' 'strict-dynamic' https://checkout.razorpay.com`
- `connect-src` allowlists: Supabase, Sentry, Razorpay
- `frame-src` allowlists: Razorpay checkout only
- `frame-ancestors 'none'`
- `upgrade-insecure-requests` enforced

**Risk**: `'unsafe-inline'` is required by Next.js for inline scripts/styles. This is mitigated by `'strict-dynamic'` which tells modern browsers to only trust scripts loaded by already-trusted scripts.

### Rate Limiting (middleware)
| Scope | Limit | Backend | Status |
|---|---|---|---|
| General (all routes) | 200 req/min per IP | Upstash Redis (distributed) | ACTIVE |
| Parent portal | 20 req/min per IP | Upstash Redis (distributed) | ACTIVE |
| Admin routes | 60 req/min per IP | Upstash Redis (distributed) | ACTIVE |
| Fallback | In-memory Map (10,000 entries max) | Local process memory | ACTIVE (when Redis unavailable) |

IP extraction chain: `x-vercel-forwarded-for` -> `cf-connecting-ip` -> `x-forwarded-for` -> `x-real-ip` -> `'unknown'`.

### Authentication and Authorization
| Layer | Mechanism | Status |
|---|---|---|
| Auth provider | Supabase Auth (email/PKCE flow) | ACTIVE |
| Session management | Middleware refreshes session cookie on every request | ACTIVE |
| API auth | Authorization header or Supabase session cookie required for `/api/v1/*` (except health) | ACTIVE |
| Protected pages | Middleware redirects unauthenticated users from protected routes | ACTIVE |
| Super admin gate | `SUPER_ADMIN_SECRET` checked in middleware for `/internal/admin*` paths | ACTIVE |
| Admin auth | `authorizeAdmin()` verifies Supabase token + `admin_users` table lookup | ACTIVE |
| RBAC | `authorizeRequest()` checks role permissions via `user_roles` table | ACTIVE |
| RLS | 148+ Postgres policies on all tables | ACTIVE |
| Admin audit | `logAdminAudit()` records admin actions with IP, details | ACTIVE |

### Data Privacy (P13)
| Control | Status |
|---|---|
| PII redaction in logger | ACTIVE -- redacts: password, token, secret, authorization, cookie, email, phone, api_key, access_token, refresh_token, service_role_key |
| Sentry filtering | ACTIVE -- `beforeSend` drops events in non-production; noisy errors filtered |
| Client-side Sentry | ACTIVE -- 10% transaction sampling, 1% session replay, 100% error replay |
| Service role isolation | ACTIVE -- `supabase-admin.ts` is server-only, never imported client-side |

### Bot/Scanner Blocking (middleware)
Blocked paths: `/wp-*`, `/phpmy*`, `*.php`, `*.env`, `/.git*`, `/admin` (non-internal), `/cgi-bin`, path traversal (`..`).

### CORS
Origin allowlist (not wildcard): `alfanumrik.com`, `www.alfanumrik.com`, `alfanumrik.vercel.app`, `alfanumrik-ten.vercel.app`. Localhost added in development only.

## Risk Assessment

### HIGH RISK

#### H1: npm audit not enforced -- RESOLVED
- **Status**: RESOLVED (2026-04-02)
- **Resolution**: CI now runs `npm audit --audit-level=critical`. Critical vulnerabilities fail the build. High and below produce a CI warning annotation but do not block merges. The `continue-on-error: true` has been removed.
- **Previous state**: `npm audit --audit-level=high` ran with `continue-on-error: true`, meaning all audit failures were silently ignored.
- **Owner**: architect

#### H2: No MFA for admin accounts
- **Current**: Admin auth is Supabase email/password + `admin_users` table check
- **Impact**: Compromised admin password gives full system access
- **Likelihood**: Low-medium -- admin secret adds a layer, but password-only auth for admin is weak
- **Mitigation**: Enable Supabase MFA (TOTP) for admin users
- **Owner**: architect

#### H3: Super admin secret in query parameter
- **Current**: Admin pages accept `?secret=xxx` in URL for browser access
- **Impact**: Secret can leak via browser history, referrer headers, access logs
- **Likelihood**: Medium -- any admin accessing the panel leaves the secret in URL
- **Mitigation**: Switch to cookie-based admin session after initial secret verification
- **Owner**: architect + ops

### MEDIUM RISK

#### M1: In-memory rate limit fallback is per-instance
- **Current**: When Upstash Redis is unavailable, rate limiting falls back to in-memory Map
- **Impact**: Each Vercel serverless instance has its own counter -- attacker could exceed limits by hitting different instances
- **Likelihood**: Low -- Redis is the primary path; fallback only activates on Redis failure
- **Mitigation**: Acceptable risk. Monitor Redis availability. In-memory provides basic protection.
- **Owner**: ops

#### M4: CSP allows `unsafe-inline`
- **Current**: Required by Next.js for inline scripts/styles
- **Impact**: Reduces XSS protection compared to nonce-based CSP
- **Likelihood**: Low -- mitigated by `strict-dynamic`
- **Mitigation**: Move to nonce-based CSP when Next.js App Router supports it natively
- **Owner**: architect

#### M5: No secret rotation automation
- **Current**: Secrets (Supabase service role key, Razorpay keys, admin secret, Upstash tokens) are static
- **Impact**: Compromised secret remains valid indefinitely
- **Likelihood**: Low -- secrets are server-side only
- **Mitigation**: Document rotation procedures; implement rotation schedule
- **Owner**: ops + architect

### LOW RISK

#### L1: Health endpoint returns version info
- **Current**: `/api/v1/health` returns `version: "2.0.0"` and uptime
- **Impact**: Minor information disclosure
- **Likelihood**: Very low -- version alone is not exploitable
- **Mitigation**: Acceptable risk. Version info aids debugging.

#### L2: No request body size limits in middleware
- **Current**: Relies on Vercel's default body size limits (4.5 MB for serverless)
- **Impact**: Large payload attacks limited by Vercel defaults
- **Likelihood**: Very low
- **Mitigation**: Acceptable. Add explicit limits if abuse observed.

#### L3: Sentry tunnel route
- **Current**: `/monitoring` tunnel route bypasses ad-blockers for error reporting
- **Impact**: None -- this is by design to ensure error visibility
- **Mitigation**: None needed.

## Resolved Risks

#### M2: Rollout percentage not per-user (RESOLVED 2026-04-02)
- **Was**: Feature flag `rollout_percentage` between 1-99 was treated as fully enabled
- **Fix**: Implemented deterministic per-user rollout via `hashForRollout(userId, flagName)` in `src/lib/feature-flags.ts`. When `userId` is provided in `FlagContext`, the hash produces a stable 0-99 value that determines flag inclusion. Without `userId`, flags with percentage > 0 remain enabled for backward compatibility.

#### M3: Admin audit is best-effort (RESOLVED 2026-04-02)
- **Was**: `logAdminAudit()` in `src/lib/admin-auth.ts` used an empty catch block, silently swallowing failures
- **Fix**: Added structured logging via `logger.warn()` on audit insert failure, including admin ID, action, and entity context. Audit remains non-throwing (best-effort) but failures are now observable in logs.
- **Note**: The fix to `admin-auth.ts` is owned by the architect agent and was deferred for their implementation.

## What Is Missing (Not Yet Implemented)

| Item | Priority | Description |
|---|---|---|
| ~~Enforced npm audit~~ | ~~HIGH~~ | RESOLVED: critical-level enforcement added to CI (2026-04-02) |
| Admin MFA | HIGH | TOTP for admin user accounts |
| Admin session management | HIGH | Replace URL query param secret with secure cookie session |
| Penetration testing | MEDIUM | Pre-launch external security review |
| Secret rotation | MEDIUM | Documented rotation procedures and schedule |
| Per-user rate limits for AI | MEDIUM | AI endpoints (foxy-tutor, ncert-solver) should have per-user daily limits beyond plan limits |
| RLS policy audit automation | LOW | CI step to verify all tables have RLS enabled |
| Dependency update automation | LOW | Dependabot or Renovate for automated dependency PRs |
| SAST (Static Application Security Testing) | LOW | CodeQL or Semgrep in CI pipeline |
