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

### 5b: CTO Review (if migration/middleware/auth files changed)
- [ ] Migration is idempotent
- [ ] RLS enabled on new tables
- [ ] RLS policies cover student/parent/teacher patterns
- [ ] No service role key exposed to client
- [ ] No SQL injection vectors
- [ ] API routes use `authorizeRequest()`

### 5c: Testing Review (if test files changed or new coverage needed)
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
- [ ] Gate 3: tests — PASS ([n]/[n])
- [ ] Gate 4: build — PASS (shared: [n] kB)
- [ ] Gate 5a: assessment review — PASS / N/A
- [ ] Gate 5b: cto review — PASS / N/A
- [ ] Gate 5c: testing review — PASS / N/A
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
