# Incident Response Plan

Last verified: 2026-04-02
Source files: `src/app/api/v1/health/route.ts`, `sentry.client.config.ts`, `sentry.server.config.ts`, `src/middleware.ts`, `docs/ops/rollback-plan.md`

## Severity Classification

| Severity | Definition | Examples | Response Time |
|----------|-----------|----------|---------------|
| **SEV-1 Critical** | Platform completely unusable for all users | Database down, auth service down, health check returns `unhealthy` | Immediate (< 15 min) |
| **SEV-2 Major** | Core feature broken for many users | Quiz submission failing, payment processing broken, AI tutor returning errors | Within 1 hour |
| **SEV-3 Minor** | Feature degraded but workarounds exist | Leaderboard not updating, study plan generation slow, single subject content missing | Within 4 hours |
| **SEV-4 Low** | Cosmetic or edge case issues | UI alignment bug, Hindi translation missing on one page, minor log noise | Next business day |

## Detection Sources

| Source | What It Catches | Current Status |
|--------|----------------|----------------|
| Health endpoint (`/api/v1/health`) | Database and auth connectivity | Exists, returns healthy/degraded/unhealthy |
| CI health check | Post-deploy failures on main branch | Exists, 3 retries with 15s intervals |
| Sentry (client) | JavaScript errors, unhandled rejections | Exists, 10% trace sampling, filters noisy errors |
| Sentry (server) | API route errors, server-side exceptions | Exists, 10% trace sampling |
| Sentry session replay | Visual reproduction of user-facing bugs | Exists, 1% sessions / 100% on error |
| Structured logger | All server-side events with PII redaction | Exists, JSON format, auto-Sentry on error level |
| Vercel Analytics | Performance metrics, Web Vitals | Exists |
| User reports | Issues not caught by automated monitoring | Manual triage via support tickets |
| Rate limiter | Abuse detection via 429 responses | Exists, Upstash Redis with in-memory fallback |

**Aspirational (not yet implemented):**
- Automated alerting on error rate thresholds (Sentry alerts or Betterstack)
- Synthetic monitoring (Checkly probes)
- Database connection pool monitoring
- Automated SEV classification

## Incident Response Process

### Step 1: Detect and Classify
1. Identify the issue from detection source
2. Classify severity using the table above
3. For SEV-1/SEV-2: proceed immediately to Step 2
4. For SEV-3/SEV-4: create a tracking task, proceed when appropriate

### Step 2: Assess Impact
1. Check health endpoint: `curl https://alfanumrik.vercel.app/api/v1/health`
2. Check Sentry error dashboard for volume and affected users
3. Check Vercel deployment history for recent changes
4. Determine: Is this a code issue, infrastructure issue, or third-party issue?

### Step 3: Mitigate

**If caused by a recent deployment:**
1. Rollback via Vercel dashboard (instant, no rebuild)
2. Verify health endpoint returns `healthy`
3. Monitor Sentry for error rate reduction
4. Document the bad commit for post-incident review

**If caused by a feature:**
1. Disable via feature flag if the feature is flag-gated
2. Flag changes take effect within 5 minutes (cache TTL)
3. If not flag-gated, consider emergency deploy with the feature disabled

**If caused by Supabase outage:**
1. Check Supabase status page (status.supabase.com)
2. The app will serve cached content where possible
3. Quiz submissions and writes will fail -- nothing to do until Supabase recovers
4. Communicate to users if the outage is extended

**If caused by Razorpay outage:**
1. Payment processing will fail but existing subscriptions remain active
2. No immediate action needed -- Razorpay webhooks will retry
3. Monitor for webhook replay after the outage

**If caused by rate limiting / DDoS:**
1. Check middleware rate limit counters
2. Upstash Redis rate limiter works across all Vercel instances
3. If the attack exceeds middleware capacity, use Vercel's DDoS protection or Cloudflare

### Step 4: Communicate

**Internal communication:**
- SEV-1: Notify via primary communication channel immediately
- SEV-2: Notify within 1 hour
- SEV-3/SEV-4: Track in task management

**User communication (aspirational):**
- Currently no in-app status page or incident notification system
- For extended outages, consider status updates via email to affected users
- Super admin panel shows system status but is not user-facing

### Step 5: Resolve
1. Implement the fix (code change, config change, or wait for third-party recovery)
2. Verify fix via health endpoint and Sentry error rate
3. If a code change was made, follow normal release process (PR, CI, merge)
4. Update feature flag if the feature was disabled as mitigation

### Step 6: Post-Incident Review
1. Document the timeline: detection, classification, mitigation, resolution
2. Identify root cause
3. List action items:
   - Add regression test for the failure mode
   - Add monitoring for the gap that allowed the issue
   - Improve detection time if it was slow
4. Update runbooks if new operational procedures were discovered

## Escalation Paths

| Issue Domain | Primary Responder | Escalation |
|-------------|-------------------|------------|
| Database / Supabase | architect | Supabase support |
| Auth / RBAC | architect | Supabase support |
| Payment / Razorpay | backend | Razorpay support |
| AI / Claude API | ai-engineer | Anthropic support |
| Quiz scoring / XP | assessment | architect (if DB-related) |
| Frontend / UI | frontend | -- |
| Deployment / Vercel | architect + ops | Vercel support |
| Security incident | architect | -- (user approval for response) |

## Incident Tracking

Currently tracked via:
- Sentry issues (automated error grouping)
- Super admin audit log (admin actions)
- Git commit history (code changes)

**Aspirational:**
- Dedicated incident tracking system
- Automated post-incident report generation
- SLA tracking against response time targets

## Communication Templates

### SEV-1 Internal Alert
```
INCIDENT: [brief description]
SEVERITY: SEV-1 (Critical)
IMPACT: [what is broken, how many users affected]
STATUS: Investigating / Mitigating / Resolved
HEALTH: [health endpoint status]
LAST DEPLOY: [commit hash, time]
NEXT UPDATE: [time]
```

### Post-Incident Summary
```
INCIDENT: [brief description]
DURATION: [start time] to [end time] ([duration])
IMPACT: [users affected, feature unavailability]
ROOT CAUSE: [what caused it]
MITIGATION: [what was done]
RESOLUTION: [final fix]
ACTION ITEMS:
- [ ] [action 1]
- [ ] [action 2]
```
