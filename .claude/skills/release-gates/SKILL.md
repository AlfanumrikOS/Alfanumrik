---
name: release-gates
description: Sequential pre-push gates including type-check, lint, test, build, domain review, and secrets scan.
---

# Skill: Release Gates

Sequential gates that must pass before pushing code. Orchestrator enforces the sequence. Quality agent runs Gates 1-4. Domain agents run Gate 5. Orchestrator runs Gate 6.

## Gate 1: Type Compilation
```bash
npm run type-check
```
- Exit code 0 required
- No `any` in new code
- No `@ts-ignore` without `// Reason:` comment

## Gate 2: Lint
```bash
npm run lint
```
- Exit code 0 required
- No `console.log` (warn/error OK)

## Gate 3: Unit Tests
```bash
npm test
```
- All tests pass (currently 175 across 7 files)
- No `.skip` without comment and TODO
- **Regression catalog gap check**: if the change touches a product invariant area, report whether the corresponding regression tests exist. Do NOT claim "regression tests pass" for tests that don't exist. Current catalog status: 4/35 exist (11%). Critical gaps: quiz scoring (0/8), payment (0/4).

## Gate 4: Build
```bash
npm run build
```
- Exit code 0 required
- Bundle limits:
  - Shared JS: < 160 kB (currently ~155 kB)
  - Individual page: < 260 kB (max: /foxy ~254 kB)
  - Middleware: < 120 kB (currently ~109 kB)

## Gate 5: Domain Review
Conditional. Required when change touches a domain agent's files.

### 5a: Assessment Review (if quiz/scoring/progress files changed)
- [ ] Score formula matches CLAUDE.md P1
- [ ] XP formula matches CLAUDE.md P2
- [ ] Anti-cheat matches CLAUDE.md P3
- [ ] Atomic submission matches CLAUDE.md P4
- [ ] Scorecard values from server response, not recalculated
- [ ] Grade format is string (CLAUDE.md P5)

### 5b: Architect Review (if migration/middleware/auth files changed)
- [ ] Migration is idempotent
- [ ] RLS enabled on new tables
- [ ] RLS policies cover student/parent/teacher patterns
- [ ] No service role key exposed to client
- [ ] No SQL injection vectors
- [ ] API routes use `authorizeRequest()`

### 5c: AI-Engineer Review (if AI Edge Functions/prompts/RAG changed)
- [ ] AI responses age-appropriate (P12)
- [ ] No unfiltered LLM output to students
- [ ] Responses stay within CBSE curriculum scope
- [ ] Usage limits enforced per plan
- [ ] Circuit breaker implemented
- [ ] No PII sent to Claude API

### 5d: Backend Review (if payment flow changed)
- [ ] Webhook signature verified before processing (P11)
- [ ] Subscription status change atomic with payment record
- [ ] No plan access without verified payment
- [ ] Grace period for past_due

### 5e: Ops Review (if admin panel/monitoring changed)
- [ ] Admin routes require super admin auth
- [ ] Feature flag changes logged to audit trail
- [ ] Documentation updated if operational procedures changed

### 5f: Testing Review (if test files changed or new coverage needed)
- [ ] Regression catalog tests present and passing
- [ ] Edge cases from testing agent's catalog covered
- [ ] No weakened assertions

## Gate 6: Pre-Push Checks
```bash
# Secrets check
git diff --cached --name-only | grep -iE '\.env|secret|credential' && echo "BLOCKED: secrets in staging"

# Commit message format
# Must match: type(scope): description
# Types: feat, fix, refactor, test, docs, chore, perf
```
- [ ] No `.env` or credential files staged
- [ ] No hardcoded secrets (grep for `sk_`, `rzp_live_`, `eyJ`, `service_role`)
- [ ] Commit message: `type(scope): description`

## Gate Summary (copy for PR descriptions)
```
## Release Gates
- [ ] Gate 1: type-check — PASS
- [ ] Gate 2: lint — PASS
- [ ] Gate 3: tests — PASS ([n]/[n]) | Catalog: [n]/35 exist, gaps: [list areas]
- [ ] Gate 4: build — PASS (shared: [n] kB)
- [ ] Gate 5a: assessment review — PASS / N/A
- [ ] Gate 5b: architect review — PASS / N/A
- [ ] Gate 5c: ai-engineer review — PASS / N/A
- [ ] Gate 5d: backend review (payments) — PASS / N/A
- [ ] Gate 5e: ops review — PASS / N/A
- [ ] Gate 5f: testing review — PASS / N/A
- [ ] Gate 6: pre-push — PASS
```

## Deployment Pipeline
```
Push to develop/staging → CI (gates 1-4) → Vercel preview → health check
Push to main → CI (gates 1-4) → Vercel production → health check → GitHub release tag
```

## Rollback
1. Identify bad commit via Sentry or health check failure
2. Revert via Vercel dashboard (instant rollback)
3. If migration involved: write compensating migration (never DROP in panic)
4. Add regression test for the failure mode
