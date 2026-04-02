# Engineering Roadmap: 30/60/90 Day Plan

**Created**: 2026-04-02
**Context**: Post production-hardening upgrade

## Current State After Upgrade

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Type errors | 15,442 (deps missing) | 0 | Fixed |
| Lint errors | 1 | 0 | Fixed |
| Unit tests | 1125 | 1285 | +160 |
| E2E specs | 7 (not in CI) | 7 (in CI) | CI integration |
| npm audit enforcement | None (continue-on-error) | Critical-level | Hardened |
| Input validation | Ad-hoc | Zod schemas | Systematic |
| Env validation | 2 vars | 11 vars (7 required + 4 optional) | Complete |
| Feature flag rollout | Broken (1-99% = enabled) | Per-user deterministic | Fixed |
| Admin audit logging | Silent failures | Structured error logging | Fixed |
| Security docs | 3 files | 6 files + verification matrix | Comprehensive |

## 30-Day Plan (Immediate)

### Week 1-2: Admin MFA and Session Security
**Priority**: HIGH (Risk H2, H3)
- [ ] Enable Supabase TOTP MFA for admin_users accounts
- [ ] Replace URL query param secret with cookie-based admin session
- [ ] Add session expiry and forced re-auth for admin after inactivity
- **Owner**: architect
- **Effort**: 3-5 days

### Week 2-3: Coverage Enforcement
- [ ] Enable coverage thresholds in CI (60% global, 90% xp-rules, 80% engines)
- [ ] Add integration test suite against test Supabase project
- [ ] Add missing E2E tests for authenticated flows (quiz, payment)
- **Owner**: testing
- **Effort**: 3-4 days

### Week 3-4: Dependency Hygiene
- [ ] Resolve all 3 high npm audit vulnerabilities
- [ ] Set up Dependabot or Renovate for automated PRs
- [ ] Update eslint to v9 (v8 is deprecated)
- **Owner**: architect
- **Effort**: 2-3 days

## 60-Day Plan (Next Sprint)

### SAST Integration
- [ ] Add CodeQL to CI pipeline for static security analysis
- [ ] Add Semgrep rules for Supabase-specific patterns
- [ ] Establish security review process for PRs touching auth/payment
- **Owner**: architect
- **Effort**: 2 days

### Performance Optimization
- [ ] Upgrade in-memory cache to Upstash Redis for all cached data
- [ ] Add database query monitoring (slow query logging)
- [ ] Implement stale-while-revalidate for curriculum data
- [ ] Profile and optimize quiz question retrieval path
- **Owner**: architect + backend
- **Effort**: 5-7 days

### Mobile Sync Hardening
- [ ] Verify Flutter app XP constants match web
- [ ] Add automated contract tests between mobile API calls and web API routes
- [ ] Ensure mobile handles rate limit 429 responses gracefully
- **Owner**: mobile
- **Effort**: 3-4 days

### Content Pipeline
- [ ] Automate question bank quality validation in CI
- [ ] Add Bloom's taxonomy distribution checks per subject
- [ ] Verify all grades have minimum question coverage
- **Owner**: assessment
- **Effort**: 3-4 days

## 90-Day Plan (Quarter Goal)

### Observability Upgrade
- [ ] Migrate from console.log/error to structured log aggregation (Vercel Logs or Datadog)
- [ ] Add custom Sentry dashboards for quiz failures, payment failures, AI errors
- [ ] Implement SLO alerting (uptime < 99.5%, error rate > 1%, p95 > 500ms)
- [ ] Add synthetic monitoring for critical paths (quiz submission, payment)
- **Owner**: ops + architect
- **Effort**: 5-7 days

### Penetration Testing
- [ ] Engage external security firm for penetration test
- [ ] Focus areas: auth bypass, privilege escalation, payment manipulation
- [ ] Remediate findings within 2 weeks of report
- **Owner**: architect
- **Effort**: External engagement + 1 week remediation

### Scaling Preparation (if approaching 5K+ students)
- [ ] Migrate rate limiting entirely to Upstash Redis (remove in-memory fallback)
- [ ] Add connection pooling for Supabase (PgBouncer or Supavisor)
- [ ] Implement CDN caching for static curriculum content
- [ ] Add database read replicas for analytics queries
- **Owner**: architect
- **Effort**: 10-15 days

### Compliance
- [ ] Complete data processing agreement (DPA) for Supabase
- [ ] Document data retention policies and implement automated cleanup
- [ ] Add data export capability for GDPR-like requests (parent data portability)
- [ ] Review and update privacy policy to match actual data practices
- **Owner**: ops + architect
- **Effort**: 5-7 days

## Success Criteria

### 30-Day
- Admin MFA active on all admin accounts
- URL secret replaced with secure session
- Coverage thresholds enforced in CI
- 0 high/critical npm audit vulnerabilities

### 60-Day
- SAST running in CI
- Query monitoring active
- Mobile-web contract tests passing
- Question bank quality automated

### 90-Day
- External pentest completed and remediated
- SLO alerting active
- Scaling infrastructure in place for 10K students
- Data compliance documentation complete
