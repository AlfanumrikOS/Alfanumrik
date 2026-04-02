# Security Controls Inventory

Last verified: 2026-04-02
Source files: `next.config.js`, `src/middleware.ts`, `src/lib/logger.ts`, `src/lib/rbac.ts`, `src/lib/admin-auth.ts`, `sentry.client.config.ts`, `sentry.server.config.ts`

## Control Categories

### 1. Authentication

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| Supabase Auth (PKCE email flow) | `src/lib/supabase.ts`, `src/lib/AuthContext.tsx` | Credential theft, session fixation | Exists |
| Session cookie refresh | Middleware Layer 0: refreshes Supabase session on every request | Expired sessions, stale auth state | Exists |
| Protected route redirect | Middleware Layer 0.6: redirects unauthenticated users to login | Unauthorized page access | Exists |
| Super admin auth | `src/lib/admin-auth.ts`: session token + `admin_users` table lookup | Unauthorized admin access | Exists |
| Internal admin secret | Middleware Layer 2.1: `SUPER_ADMIN_SECRET` via header or query param | Legacy admin route access | Exists (legacy routes only) |
| Timing-safe secret comparison | `timingSafeEqual()` in middleware | Timing attacks on secret comparison | Exists |
| Session guard Edge Function | `supabase/functions/session-guard/` | Session hijacking | Exists |

### 2. Authorization

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| RBAC permission system | `src/lib/rbac.ts`: `authorizeRequest()` on API routes | Privilege escalation | Exists |
| Row Level Security (RLS) | 235+ policies across all tables | Direct database access bypass | Exists |
| Resource ownership checks | `canAccessStudent()`, `canAccessImage()`, `canAccessReport()` | Cross-user data access | Exists |
| Super admin bypass | `super_admin` role bypasses permission checks (not RLS) | -- (by design) | Exists |
| Permission cache | 5-minute in-memory TTL with invalidation | Performance (not security) | Exists |
| Audit logging | `logAudit()` records denied access to `audit_logs` table | Unauthorized access detection | Exists |
| Admin audit trail | `logAdminAudit()` records admin actions to `admin_audit_log` | Admin abuse detection | Exists |

### 3. Transport Security

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| HSTS | Middleware: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` | SSL stripping, downgrade attacks | Exists |
| HTTPS enforcement | `next.config.js` CSP: `upgrade-insecure-requests` | Mixed content, eavesdropping | Exists |
| TLS termination | Vercel edge (automatic) | Man-in-the-middle | Exists (Vercel managed) |

### 4. Input Validation

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| UUID validation | `isValidUUID()` in `admin-auth.ts` | SQL injection via malformed IDs | Exists |
| Request body validation | Per-route validation in API handlers | Injection, unexpected data | Partial (no schema validation library) |
| Bot/scanner blocking | Middleware Layer 2: blocks `/wp-*`, `.php`, `.env`, `.git`, `..` paths | Automated scanning, path traversal | Exists |

### 5. Rate Limiting

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| General rate limit | 200 requests/minute per IP | DDoS, brute force | Exists |
| Parent portal rate limit | 20 requests/minute per IP | Brute force on parent login | Exists |
| Admin route rate limit | 60 requests/minute per IP | Admin endpoint abuse | Exists |
| Distributed rate limiting | Upstash Redis (Ratelimit sliding window) | Cross-instance rate limit bypass | Exists |
| In-memory fallback | Local Map with 10K entry cap | Rate limiting when Redis unavailable | Exists |
| Health endpoint exemption | `/api/v1/health` bypasses rate limiting | Prevents uptime monitors from being blocked | Exists |

### 6. HTTP Security Headers

All headers set in both middleware (`addSecurityHeaders`) and `next.config.js` `headers()`:

| Header | Value | Threat Mitigated | Status |
|--------|-------|------------------|--------|
| `X-Frame-Options` | `DENY` | Clickjacking | Exists |
| `Content-Security-Policy: frame-ancestors` | `'none'` | Clickjacking (CSP version) | Exists |
| `X-Content-Type-Options` | `nosniff` | MIME type sniffing | Exists |
| `X-XSS-Protection` | `1; mode=block` | XSS (legacy browsers) | Exists |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referer header leakage | Exists |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(self)` | Unauthorized API access | Exists |
| `X-Request-Id` | UUID per request | Request tracing | Exists |

### 7. Content Security Policy

Defined in `next.config.js`:

| Directive | Value | Purpose |
|-----------|-------|---------|
| `default-src` | `'self'` | Restrict all resource loading to same origin |
| `script-src` | `'self' 'unsafe-inline' 'strict-dynamic' https://checkout.razorpay.com` | Allow Razorpay checkout scripts |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | Allow Google Fonts stylesheets |
| `font-src` | `'self' https://fonts.gstatic.com` | Allow Google Fonts files |
| `img-src` | `'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com` | Allow Supabase storage and Google avatars |
| `connect-src` | `'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io https://checkout.razorpay.com https://api.razorpay.com` | Allow API connections |
| `frame-src` | `https://api.razorpay.com https://checkout.razorpay.com` | Allow Razorpay iframes |
| `frame-ancestors` | `'none'` | Prevent embedding |
| `base-uri` | `'self'` | Prevent base tag hijacking |
| `form-action` | `'self'` | Prevent form submission to external URLs |
| `upgrade-insecure-requests` | (present) | Auto-upgrade HTTP to HTTPS |

**Note:** `unsafe-inline` is required by Next.js for inline scripts/styles. `strict-dynamic` mitigates the risk for modern browsers.

### 8. CORS

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| Origin allowlist | Middleware: specific origins, not wildcard `*` | Cross-origin request abuse | Exists |
| Allowed origins | `alfanumrik.com`, `www.alfanumrik.com`, `alfanumrik.vercel.app`, `alfanumrik-ten.vercel.app`, localhost (dev only) | -- | Exists |
| Vary header | `Vary: Origin` on API responses | CDN cache poisoning | Exists |
| Preflight handling | OPTIONS requests return 204 with correct headers | Browser CORS preflight | Exists |

### 9. API Security

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| API auth check | Middleware Layer 0.5: checks Authorization header or session cookie on `/api/v1/*` | Unauthenticated API access | Exists |
| No-cache headers | `Cache-Control: no-store` on API responses | Cached personalized data | Exists |
| Rate limit headers | `X-RateLimit-Limit`, `X-RateLimit-Remaining` on API responses | Client-side rate awareness | Exists |
| Payment webhook verification | Razorpay signature verification before processing (P11) | Webhook spoofing | Exists |
| Service role isolation | `supabase-admin.ts` server-only, never imported in client (P8) | Service role key exposure | Exists |

### 10. Data Privacy (P13)

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| PII redaction in logs | `logger.ts`: redacts password, token, email, phone, api_key, etc. | PII exposure in log aggregation | Exists |
| Sentry PII filtering | `beforeSend` blocks events in development; error serialization strips stacks | PII in error monitoring | Exists |
| Student data access rules | RLS + `canAccessStudent()`: own, linked, assigned, or admin | Unauthorized student data access | Exists |

### 11. Build and Deploy Security

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| Env var validation | `next.config.js`: throws if required env vars missing in production | Misconfigured deploys | Exists |
| `poweredByHeader: false` | `next.config.js` | Server technology fingerprinting | Exists |
| Source map hiding | `hideSourceMaps: true` in Sentry config | Source code exposure | Exists |
| Sentry tunnel route | `/monitoring` route bypasses ad blockers | Error reporting gaps | Exists |
| npm security audit | CI step: `npm audit --audit-level=high` | Vulnerable dependencies | Exists (continue-on-error) |

### 12. Monitoring and Detection

| Control | Implementation | Threat Mitigated | Status |
|---------|---------------|------------------|--------|
| Sentry client errors | `sentry.client.config.ts` with production filtering | Client-side error detection | Exists |
| Sentry server errors | `sentry.server.config.ts` | Server-side error detection | Exists |
| Sentry edge errors | `sentry.edge.config.ts` | Edge function error detection | Exists |
| Structured logging | `src/lib/logger.ts` with JSON output | Incident investigation | Exists |
| Request ID correlation | Middleware sets `X-Request-Id` UUID | Cross-layer tracing | Exists |
| Health endpoint | `/api/v1/health` checks DB + auth | Availability monitoring | Exists |

## Gaps and Aspirational Controls

| Gap | Description | Priority |
|-----|-------------|----------|
| No schema validation library | API routes validate manually, no Zod/Yup | Medium |
| `npm audit` not blocking | `continue-on-error: true` in CI | Medium |
| No WAF | No Web Application Firewall beyond middleware | Low (Vercel provides basic DDoS protection) |
| No DAST scanning | No automated penetration testing | Medium |
| No CSP nonce | Uses `unsafe-inline` instead of nonces | Low (mitigated by `strict-dynamic`) |
| No automated alert thresholds | Sentry alerts not configured for error rate spikes | Medium |
| Permission cache not distributed | In-memory cache means different Vercel instances may have stale permissions | Low (5-minute TTL limits impact) |
| No IP-based admin lockdown | Admin panel accessible from any IP with valid session | Low |
| Service worker scope | `sw.js` cached with no-cache headers but scope is `/` | Low |
