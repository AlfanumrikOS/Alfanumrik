---
name: release-gates
description: Sequential pre-push gates including type-check, lint, test, build, domain review, and secrets scan.
user-invocable: false
---

# Skill: Release Gates

Sequential gates that must pass before pushing code. Orchestrator enforces the sequence. Quality agent runs Gates 1-4. Domain agents run Gate 5.

**Boundary vs. the other two verification skills:** this skill is the automatic, per-change, pre-push sequence -- it runs on essentially every task and stays that way. For a manual, full-platform, read-only production-readiness sweep, use `alfanumrik-release-audit` instead (it defers back to this skill for Gates 1-4 rather than re-deriving them). For re-verifying one specific prior session's claimed change, use `.claude/commands/audit-change.md`. Do not blend the three.

## Gate 1: Type Compilation

Both commands are required. `npm run type-check` fans out to workspaces only; `npm run type-check:scripts` covers repo-root `scripts/` (no workspace, own `tsconfig.scripts.json`).
```bash
npm run type-check
npm run type-check:scripts
```
- Exit code 0 required from both
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
- All tests pass. Do not assert a test count from this file -- it rots. Read
  vitest's own summary line from the run you just did.
- No `.skip` without comment and TODO
- Regression catalog gap check: if the change touches a product invariant area, report whether the corresponding regression tests exist. Do NOT claim "regression tests pass" for tests that don't exist.
  For the current catalog total, read `.claude/regression/00-header.md` -- it is
  the authoritative source.

## Gate 4: Build
```bash
npm run build
```
- Exit code 0 required
- Bundle limits: read the enforced caps from source, never from this file:
  ```bash
  grep -nE '^const CAP_' scripts/check-bundle-size.mjs
  ```
  - Shared JS: within `CAP_SHARED_KB`
  - Individual page: within `CAP_PAGE_KB`
  - Middleware: within `CAP_MIDDLEWARE_KB`

  If the per-page report shows every page at 0.0 kB, or reports zero pages
  measured, the gate is broken and this is a FAIL.

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
Full checklist (SECURITY DEFINER/search_path, least privilege, explicit grants, forward-only migrations) lives in `supabase-patterns`' Security & Governance Review section -- do not re-derive it here. Quick pre-push confirmation only:
- [ ] RLS enabled on new tables, policies present in the same migration
- [ ] No service role key exposed to client
- [ ] API routes use `authorizeRequest()` / `authorizeAdmin()`

### 5c: AI-Engineer Review (if AI Edge Functions/prompts/RAG changed)
- [ ] AI responses age-appropriate (P12)
- [ ] No unfiltered LLM output to students
- [ ] Responses stay within CBSE curriculum scope
- [ ] Usage limits enforced per plan
- [ ] Circuit breaker implemented
- [ ] No PII sent to the model provider

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

### 5g: Student-Data Review (if student PII, consent, or safeguarding paths changed)
See `alfanumrik-student-safety` for the full checklist -- do not restate it here. Confirm it was walked when applicable.

## Gate 6: Pre-Push Checks
```bash
git diff --cached --name-only | grep -iE '\.env|secret|credential' && echo "BLOCKED: secrets in staging"
```
- [ ] No `.env` or credential files staged
- [ ] No hardcoded secrets (grep for `sk_`, `rzp_live_`, `eyJ`, `service_role`)
- [ ] Commit message: `type(scope): description`

## Gate Summary (copy for PR descriptions)
```
## Release Gates
- [ ] Gate 1: type-check -- PASS (workspaces)
- [ ] Gate 1: type-check:scripts -- PASS (repo-root scripts/)
- [ ] Gate 2: lint -- PASS
- [ ] Gate 3: tests -- PASS ([n]/[n]) | Catalog: [n] exist, gaps: [list areas]
- [ ] Gate 4: build -- PASS (shared: [n] kB)
- [ ] Gate 5a: assessment review -- PASS / N/A
- [ ] Gate 5b: architect review -- PASS / N/A (security detail: see supabase-patterns)
- [ ] Gate 5c: ai-engineer review -- PASS / N/A
- [ ] Gate 5d: backend review (payments) -- PASS / N/A
- [ ] Gate 5e: ops review -- PASS / N/A
- [ ] Gate 5f: testing review -- PASS / N/A
- [ ] Gate 5g: student-data review -- PASS / N/A
- [ ] Gate 6: pre-push -- PASS
```

## Deployment Pipeline
```
Push to develop/staging -> CI (gates 1-4) -> Vercel preview -> health check
Push to main -> CI (gates 1-4) -> Vercel production -> health check -> GitHub release tag
```

## Rollback
1. Identify bad commit via Sentry or health check failure
2. Revert via Vercel dashboard (instant rollback)
3. If migration involved: write compensating migration (never DROP in panic)
4. Add regression test for the failure mode
