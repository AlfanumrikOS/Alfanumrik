# Alfanumrik Security and Compliance Overview

Last updated: 2026-04-16

This document provides a comprehensive overview of the security posture, data handling practices, and compliance readiness of the Alfanumrik Learning OS platform. It is intended for enterprise sales, school IT administrators, and compliance officers evaluating Alfanumrik for institutional deployment.

---

## 1. Data Residency

All production data is stored and processed within India.

| Component | Provider | Region |
|---|---|---|
| Database (PostgreSQL) | Supabase | ap-south-1 (Mumbai) |
| Application hosting | Vercel | bom1 (Mumbai) |
| Edge Functions | Supabase Edge (Deno Deploy) | ap-south-1 |
| CDN / static assets | Vercel Edge Network | Mumbai PoP + global CDN |
| Rate limiting cache | Upstash Redis | ap-south-1 |

Student data never leaves Indian infrastructure. AI inference calls to Anthropic Claude are made from Indian Edge Function instances; no student PII is sent in these requests (only anonymized curriculum queries).

---

## 2. Encryption

### At Rest
- **Database**: Supabase PostgreSQL uses AES-256 encryption for data at rest, managed by AWS RDS encryption.
- **Backups**: All database backups are encrypted at rest using AES-256.
- **File storage**: Supabase Storage uses AES-256 server-side encryption.

### In Transit
- **TLS 1.3**: All client-server communication uses TLS 1.3 (minimum TLS 1.2).
- **HSTS**: Strict-Transport-Security header enforced across all domains.
- **Certificate management**: Automated via Vercel (Let's Encrypt).

### Secrets Management
- Environment variables stored in Vercel's encrypted environment variable store.
- Supabase Edge Function secrets stored in Supabase's encrypted secrets store.
- No secrets in source code (CI pipeline includes automated secret scanning).

---

## 3. Authentication

Alfanumrik uses Supabase Auth with the following configuration:

| Feature | Implementation |
|---|---|
| Flow | PKCE (Proof Key for Code Exchange) |
| Token type | JWT with auto-refresh |
| Session management | HTTP-only cookies via Next.js middleware |
| Email verification | Required before account activation |
| Password policy | Minimum 8 characters, enforced by Supabase Auth |
| Session refresh | Automatic JWT refresh in middleware on every request |
| Session expiry | Configurable; default 1 hour access token, 7 day refresh token |

### Multi-factor Authentication
MFA is supported via Supabase Auth's TOTP implementation and can be enabled per institution.

### Onboarding Security
- 3-layer profile creation failsafe ensures no orphaned auth accounts
- Email verification links use dynamic SITE_URL (never hardcoded)
- Auth callback routes handle both PKCE and token_hash flows

---

## 4. Authorization

### Role-Based Access Control (RBAC)

Alfanumrik implements a comprehensive RBAC system with 11 roles and 71+ permissions.

**Roles hierarchy**:
| Role | Scope | Description |
|---|---|---|
| student | Own data | Learner account |
| parent | Linked children | Guardian with approved link |
| teacher | Assigned classes | School teacher |
| institution_admin | School-wide | School administrator |
| tutor | Assigned students | Private tutor |
| admin | Platform | Internal admin |
| super_admin | Global | Platform owner |

**Enforcement layers**:
1. **Server-side (mandatory)**: `authorizeRequest(request, 'permission.code')` in every API route
2. **Database (mandatory)**: Row Level Security policies on every table
3. **Client-side (convenience only)**: `usePermissions()` hook for UI rendering; never a security boundary

### Row Level Security (RLS)

Every table has RLS enabled with policies covering four access patterns:
1. **Student reads own**: `auth_user_id = auth.uid()`
2. **Parent reads linked child**: via `guardian_student_links WHERE status = 'approved'`
3. **Teacher reads assigned class**: via `class_enrollments` -> `classes`
4. **Admin access**: service role bypasses RLS (server-only, never exposed to client)

Current coverage: 150+ RLS policies across all tables.

### School-Level Data Isolation

B2B school tenants achieve isolation through:
- Every school-admin query is scoped to `school_id` resolved from the authenticated user
- RLS policies use `get_admin_school_id()` function to enforce school boundaries
- Cross-school data access is structurally impossible through normal query paths
- Service role operations always include explicit `school_id` WHERE clauses

---

## 5. Audit Logging

All administrative actions are logged with full context for compliance and incident investigation.

### What is Logged
| Field | Description |
|---|---|
| actor_id | Auth user ID of the person performing the action |
| action | What was done (e.g., `teacher.invited`, `api_key.revoked`) |
| resource_type | Type of resource affected (e.g., `teacher`, `student`, `api_key`) |
| resource_id | ID of the affected resource |
| metadata | Additional context (JSON) |
| ip_address | Source IP (from x-forwarded-for header) |
| timestamp | ISO 8601 timestamp |

### Tracked Actions
- Teacher invitation and deactivation
- Student invitation and deactivation
- School branding updates
- Announcement publication
- Exam scheduling
- Content approval
- API key generation and revocation
- Data exports
- Settings changes

### Audit Log Retention
Audit logs are retained indefinitely for the lifetime of the school account. After account closure, audit logs are retained for 90 days per the data retention policy.

### Audit Log Access
School administrators can view their school's audit log through the School Admin Portal. Logs from one school are never visible to another school's administrators.

---

## 6. PII Protection (P13)

Alfanumrik follows strict PII handling rules:

### Logger Redaction
The structured logger (`src/lib/logger.ts`) automatically redacts:
- `password`
- `token`
- `email`
- `phone`
- API keys (patterns: `sk_`, `rzp_`, `eyJ`)

### Data Export Compliance
- Student data exports include name and grade but redact email and phone
- No student-identifiable data in Sentry error reports
- No PII in client-side console logs

### Access Controls
Student data is accessible only to:
1. The student themselves
2. Their linked parent (with approved guardian link)
3. Their assigned teacher (via class enrollment)
4. School admin (via school association)
5. Platform admin (via service role, for support)

---

## 7. Data Retention

| Data Type | Active Account | After Churn | After Deletion |
|---|---|---|---|
| Student profile | Indefinite | 90 days | Purged with audit trail |
| Quiz results | Indefinite | 90 days | Purged |
| Learning progress | Indefinite | 90 days | Purged |
| Audit logs | Indefinite | 90 days post-account closure | Purged |
| Payment records | Indefinite | 7 years (financial compliance) | Retained |
| AI conversation history | 90 days rolling | Purged immediately | Purged |

School administrators can request a full data export before account closure.

---

## 8. Monitoring and Incident Response

### Monitoring Stack
| Component | Tool | Purpose |
|---|---|---|
| Error tracking | Sentry (client/server/edge) | Real-time error detection |
| Performance | Vercel Analytics | Page load times, Web Vitals |
| Uptime | Health check endpoint (`/api/health`) | Automated uptime monitoring |
| Logging | Structured JSON logging | Log aggregation and search |
| Database health | Supabase dashboard | Connection pool, query performance |

### SLO Targets
- API availability: 99.9% uptime
- API latency: p95 < 500ms
- Error rate: < 0.1% of requests
- Database connection pool: < 80% utilization

### Incident Response Process
1. **Detection**: Sentry alert or health check failure triggers notification
2. **Triage**: Ops team assesses severity (P0-P3)
3. **Mitigation**: Vercel instant rollback for application issues; compensating migration for database issues
4. **Resolution**: Root cause analysis and permanent fix
5. **Post-mortem**: Documented with action items

### Circuit Breaker
AI Edge Functions implement a circuit breaker pattern:
- Opens after 3 consecutive failures
- Half-open retry after 60 seconds
- Prevents cascade failures when external AI APIs are degraded

---

## 9. Payment Security (P11)

### Razorpay Integration
- **PCI DSS Level 1**: Razorpay handles all card data; Alfanumrik never stores card numbers
- **Webhook verification**: Every payment webhook signature is verified using HMAC-SHA256 before processing
- **Atomic updates**: Subscription status changes are written atomically with payment records
- **Idempotency**: Duplicate payment webhooks are detected and safely ignored
- **Reconciliation**: Automated reconciliation script for detecting split-brain states

### Payment Data Handling
- No card numbers stored in Alfanumrik's database
- Only Razorpay payment_id and subscription_id are stored
- Payment amounts stored in paise (INR smallest unit) for precision

---

## 10. Application Security

### Content Security Policy (CSP)
Strict CSP headers configured in `next.config.js`:
- Script sources restricted to self and trusted CDNs
- No inline scripts (nonce-based where required)
- Frame ancestors restricted

### Additional Security Headers
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: camera, microphone, geolocation restricted

### Input Validation
- All user input validated before processing
- Parameterized queries only (no SQL string interpolation)
- HTML sanitization for any user-generated content

### Bot Protection
Middleware-level bot detection blocks:
- Known bad user agents
- Automated scanning tools
- Excessive request patterns (rate limiting via Upstash Redis)

### Rate Limiting
- Per-IP rate limiting on all API routes
- Stricter limits on authentication endpoints
- In-memory fallback when Redis is unavailable

---

## 11. CI/CD Security

### Pipeline (GitHub Actions)
1. **Secret scanning**: Automated scan for leaked credentials
2. **Type checking**: TypeScript compilation (`tsc --noEmit`)
3. **Linting**: ESLint static analysis
4. **Unit tests**: 2,511 tests across 84 files
5. **Auth gate**: Verifies authentication patterns
6. **Build verification**: Production build succeeds
7. **Bundle size check**: Ensures size budgets are met
8. **E2E tests**: Playwright end-to-end tests on PRs
9. **Health check**: Post-deploy verification on production

### Deployment
- Preview deployments for every pull request
- Production deployment only from `main` branch
- Vercel platform handles zero-downtime deployments
- Instant rollback capability via Vercel dashboard

---

## 12. Third-Party Services and Certifications

| Service | Usage | Certification |
|---|---|---|
| Supabase | Database, Auth, Storage, Edge Functions | SOC 2 Type II |
| Vercel | Application hosting, CDN | SOC 2 Type II |
| Razorpay | Payment processing | PCI DSS Level 1 |
| Anthropic (Claude) | AI tutoring, question generation | SOC 2 Type II |
| Sentry | Error monitoring | SOC 2 Type II |
| Upstash | Rate limiting (Redis) | SOC 2 Type II |
| GitHub | Source code, CI/CD | SOC 2 Type II |

---

## 13. Compliance Readiness

### Indian Data Protection
Alfanumrik is designed to comply with Indian data protection requirements:
- All data stored in India (Mumbai region)
- Consent-based data collection during onboarding
- Data minimization: only necessary data collected
- Right to access: data export feature for schools and students
- Right to erasure: account deletion with data purge after retention period
- Breach notification: incident response process with notification procedures

### Educational Data
- Age-appropriate content verified (grades 6-12, CBSE curriculum)
- Parental consent mechanism via guardian linking
- Student data accessible only to authorized educators and parents
- No behavioral advertising or data monetization

---

## 14. Contact

For security inquiries, vulnerability reports, or compliance questions:
- Email: ceo@alfanumrik.com
- Response time: 24 hours for security issues, 48 hours for compliance queries
