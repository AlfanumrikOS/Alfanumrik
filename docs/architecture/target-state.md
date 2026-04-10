# Alfanumrik Architecture: Target State

**Last updated**: 2026-04-02
**Status**: Planning document. Items marked [IMPLEMENTED] exist today; all others are targets.

## Production-Grade Architecture Goals

### 1. Reliability
- **Target**: 99.5% uptime (measured monthly)
- [IMPLEMENTED] Health check endpoint (`/api/v1/health`) with DB + Auth probes
- [IMPLEMENTED] Post-deploy health check in CI/CD
- [PLANNED] Automated alerting on health degradation (Betterstack or equivalent)
- [PLANNED] Synthetic monitoring (Checkly) for critical user flows (login, quiz, payment)

### 2. Performance
- **Target latency**: p95 < 500ms for API routes, p95 < 2s for page loads (Indian 4G, 2-5 Mbps)
- [IMPLEMENTED] Vercel deployment in bom1/Mumbai (low latency for India)
- [IMPLEMENTED] Bundle budget: Shared JS < 160 kB, pages < 260 kB, middleware < 120 kB
- [IMPLEMENTED] Static asset caching (1 year immutable for _next/static)
- [IMPLEMENTED] Service worker for offline resilience
- [PLANNED] Real User Monitoring (RUM) dashboards with p50/p95/p99 breakdowns
- [PLANNED] Database query performance monitoring (slow query logging)
- [PLANNED] CDN cache hit rate tracking

### 3. Security
- [IMPLEMENTED] HSTS with preload, CSP, X-Frame-Options DENY, X-Content-Type-Options
- [IMPLEMENTED] RLS on all tables (148+ policies)
- [IMPLEMENTED] RBAC with 6 roles, 71 permissions
- [IMPLEMENTED] Rate limiting (Upstash Redis distributed + in-memory fallback)
- [IMPLEMENTED] Bot/scanner path blocking in middleware
- [IMPLEMENTED] PII redaction in structured logger
- [PLANNED] OWASP dependency scanning enforced (npm audit currently continue-on-error)
- [PLANNED] Penetration testing before public launch
- [PLANNED] SOC 2 Type I readiness (data handling documentation)

### 4. Observability
- [IMPLEMENTED] Sentry error monitoring (client 10% sampling, server, edge)
- [IMPLEMENTED] Structured JSON logging with PII redaction
- [IMPLEMENTED] Request ID correlation via middleware
- [IMPLEMENTED] Vercel Analytics + Speed Insights
- [PLANNED] Centralized log aggregation (Vercel log drain to Betterstack/Datadog)
- [PLANNED] Custom dashboards: error rate, API latency percentiles, queue health
- [PLANNED] Distributed tracing across Next.js -> Edge Functions -> Supabase
- [PLANNED] SLO tracking (error budget, latency budget)

## Folder Structure Target

Current structure is functional. Target refinements:

```
src/
  app/                    # Next.js App Router pages + API routes
    api/
      v1/                 # Versioned public API [IMPLEMENTED]
      payments/           # Payment routes [IMPLEMENTED]
      super-admin/        # Admin API [IMPLEMENTED]
    (portals)/            # Role-specific pages
      parent/             # [IMPLEMENTED]
      teacher/            # [IMPLEMENTED]
      super-admin/        # [IMPLEMENTED]
  components/             # Shared React components [IMPLEMENTED]
    quiz/                 # Quiz-specific components [IMPLEMENTED]
  lib/                    # Core business logic [IMPLEMENTED]
    __tests__/            # Unit tests co-located with lib [PARTIALLY - 1 file]
  __tests__/              # Top-level test files [IMPLEMENTED - 25 files]
supabase/
  functions/              # Edge Functions [IMPLEMENTED]
  migrations/             # SQL migrations [IMPLEMENTED - 190]
e2e/                      # Playwright specs [IMPLEMENTED - 4 files]
mobile/                   # Flutter app [IMPLEMENTED]
docs/                     # Documentation [IMPLEMENTING]
```

Target: Move `src/__tests__/*.test.ts` to `src/lib/__tests__/` for co-location with the code they test. This is a low-priority refactor.

## API Contract Standardization

### Current State
- V1 API routes (`/api/v1/*`) exist but response shapes are not formally documented
- Super admin routes follow a loose convention

### Target
- [PLANNED] All V1 API responses follow a standard envelope:
  ```json
  {
    "data": { ... },
    "error": null,
    "meta": { "requestId": "...", "timestamp": "..." }
  }
  ```
- [PLANNED] Error responses follow a standard shape:
  ```json
  {
    "data": null,
    "error": { "code": "AUTH_REQUIRED", "message": "..." },
    "meta": { "requestId": "..." }
  }
  ```
- [PLANNED] OpenAPI spec generation from route handlers
- [PLANNED] Shared TypeScript types between web and mobile (Flutter codegen)

## Security Posture Target

See `docs/security/current-risks.md` for detailed assessment.

| Area | Current | Target |
|---|---|---|
| Headers | HSTS, CSP, X-Frame, X-Content-Type, XSS, Referrer, Permissions | Same (sufficient) |
| Auth | Supabase PKCE, middleware session refresh | Add MFA for admin users |
| RLS | 148+ policies on all tables | Automated RLS audit in CI |
| Rate Limiting | Upstash Redis (200/min general, 20/min parent, 60/min admin) | Per-user rate limits for AI endpoints |
| Secrets | Server-only env vars, PII redaction in logs | Secret rotation automation |
| Dependencies | npm audit (continue-on-error in CI) | npm audit enforced (no high/critical) |
| CORS | Origin allowlist (4 origins) | Same (sufficient) |
| CSP | Strict with necessary exceptions (unsafe-inline for Next.js) | Nonce-based CSP when Next.js supports it |

## Observability Target

| Signal | Current | Target |
|---|---|---|
| Errors | Sentry (10% sample) | Sentry (100% errors, 10% transactions) |
| Logs | console.log/warn/error (structured JSON) | Log drain to aggregation service |
| Metrics | Vercel Analytics (page views, vitals) | Custom business metrics dashboard |
| Traces | None | Sentry Performance or OpenTelemetry |
| Alerts | None (manual health check in CI) | PagerDuty/Betterstack for health degradation |
| Uptime | CI post-deploy check only | External synthetic monitor (5-min interval) |

## Performance Targets

### Bundle Budget (enforced)
| Asset | Current | Budget | Status |
|---|---|---|---|
| Shared JS | ~155 kB | < 160 kB | [IMPLEMENTED] |
| Largest page (/foxy) | ~254 kB | < 260 kB | [IMPLEMENTED] |
| Middleware | ~109 kB | < 120 kB | [IMPLEMENTED] |

### Latency Targets (not yet measured)
| Metric | Target | Status |
|---|---|---|
| API p50 | < 200ms | [PLANNED] |
| API p95 | < 500ms | [PLANNED] |
| Page load p50 (India 4G) | < 1.5s | [PLANNED] |
| Page load p95 (India 4G) | < 3s | [PLANNED] |
| Health check | < 3s (timeout) | [IMPLEMENTED] |
| Quiz submission (atomic RPC) | < 1s | [PLANNED] |

### Database Performance
| Metric | Target | Status |
|---|---|---|
| Connection pool | Supabase default (managed) | [IMPLEMENTED] |
| Performance indexes | Added per recent migrations | [IMPLEMENTED] |
| Slow query monitoring | < 500ms per query | [PLANNED] |

## Testing Targets

### Unit Tests (Vitest)
| Metric | Current | Target |
|---|---|---|
| Test files | 26 | 40+ |
| Test cases | ~722 | 900+ |
| Coverage (global) | Unmeasured (60% threshold aspirational) | 70% enforced in CI |
| Coverage (xp-rules.ts) | 90% threshold defined | 90% enforced |
| Coverage (cognitive-engine.ts) | 80% threshold defined | 80% enforced |
| Coverage (exam-engine.ts) | 80% threshold defined | 80% enforced |
| Regression catalog | 35 defined, partial coverage | 35/35 (100%) |

### Integration Tests
| Metric | Current | Target |
|---|---|---|
| API route integration | 0 | 15+ (one per critical route) |
| Database integration | 0 | 10+ (RLS policy verification) |
| Payment flow integration | 0 | 5+ (webhook + subscription lifecycle) |

### E2E Tests (Playwright)
| Metric | Current | Target |
|---|---|---|
| Spec files | 4 | 12+ |
| Authenticated flows | 0 | 6+ (student, parent, teacher, admin) |
| Payment flow | 0 | 1+ (Razorpay test mode) |
| Mobile viewport | 0 | 4+ (key flows on 360px) |

### CI Enforcement
| Gate | Current | Target |
|---|---|---|
| Type check | Enforced | Same |
| Lint | Enforced | Same |
| Unit tests | Enforced | Same + coverage thresholds |
| Build | Enforced | Same + bundle size assertions |
| npm audit | continue-on-error | Enforced (no high/critical) |
| E2E | Not in CI | Enforced on PR (preview deploy) |
