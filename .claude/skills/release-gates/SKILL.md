# Skill: Release Gates

Use this skill before any push, merge, or deployment. These gates are mandatory and sequential — a failure at any gate blocks progression to the next.

## Gate 1: Code Compilation
```bash
npm run type-check
```
**Pass criteria**: Exit code 0, zero TypeScript errors.
**Common failures**:
- Missing types on new Supabase query results
- Implicit `any` from untyped third-party returns
- Grade passed as `number` instead of `string`

## Gate 2: Lint
```bash
npm run lint
```
**Pass criteria**: Exit code 0, no errors (warnings acceptable).
**Common failures**:
- `console.log` left in production code
- Unused imports after refactoring
- Missing React Hook dependency arrays

## Gate 3: Unit Tests
```bash
npm test
```
**Pass criteria**: All tests pass. Currently 175 tests across 7 files.
**Mandatory test coverage for changed areas**:
- Quiz scoring changes → test XP calculation, anti-cheat
- API route changes → test auth, response shape, errors
- RBAC changes → test permission checks, role hierarchy
- New utility functions → test happy path + error path

## Gate 4: Build
```bash
npm run build
```
**Pass criteria**: Exit code 0, no build errors.
**Bundle size limits**:
- Shared JS (first-load): **< 160 kB** (currently ~155 kB)
- Individual page max: **< 260 kB** (largest: /foxy at ~254 kB)
- Middleware: **< 120 kB** (currently ~109 kB)

## Gate 5: Security Scan
Manual checks (no automated tool yet):
- [ ] No `.env`, `.env.local`, or credential files in staged changes (`git diff --cached --name-only | grep -i env`)
- [ ] No hardcoded secrets (search for `sk_`, `rzp_live_`, `eyJ`, `service_role`)
- [ ] No `dangerouslySetInnerHTML` without `sanitize()` from `src/lib/sanitize.ts`
- [ ] No new API routes missing `authorizeRequest()` call
- [ ] New migrations have RLS enabled on new tables
- [ ] No `SECURITY DEFINER` functions without documented justification

## Gate 6: Quiz Integrity (if quiz-related changes)
Only required when changes touch quiz, scoring, XP, or assessment files.
- [ ] Score formula matches: `ROUND((correct / total) * 100)`
- [ ] XP uses `XP_RULES` constants, not hardcoded numbers
- [ ] `submitQuizResults()` calls `atomic_quiz_profile_update()` RPC
- [ ] Anti-cheat checks intact (3s minimum, pattern detection, count match)
- [ ] Timer uses `useRef`, not `useState`
- [ ] Results display uses same formula as submission

## Gate 7: Database Safety (if migration changes)
Only required when changes include SQL migrations.
- [ ] Migration is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`)
- [ ] RLS enabled: `ALTER TABLE x ENABLE ROW LEVEL SECURITY`
- [ ] RLS policies cover: student own, parent linked, teacher assigned
- [ ] No `DROP TABLE` or `DROP COLUMN` without rollback plan
- [ ] Indexes on columns used in WHERE/JOIN/ORDER BY
- [ ] File named: `YYYYMMDDHHMMSS_descriptive_name.sql`

## Gate 8: E2E Smoke (pre-deployment)
```bash
npm run test:e2e
```
**Pass criteria**: All Playwright tests pass.
**Current coverage**: Landing page, auth page, static pages, health endpoint, protected route redirects.

## Deployment Pipeline
```
Push to develop/staging → CI runs Gates 1-4 → Vercel preview deploy → health check
Push to main → CI runs Gates 1-4 → Vercel production deploy → health check → GitHub release tag
```

## Rollback Procedure
If a production deployment causes issues:
1. Identify the bad commit via Sentry error reports or health check failure
2. Revert via Vercel dashboard (instant rollback to previous deployment)
3. If database migration is involved: apply a compensating migration (never DROP in panic)
4. Post-mortem: add regression test for the failure mode

## CI/CD Files
| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | PR checks: lint, type-check, test, build |
| `.github/workflows/deploy-staging.yml` | Preview deploys on develop/staging branches |
| `.github/workflows/deploy-production.yml` | Production deploy on main, creates release tag |
| `vercel.json` | Region (bom1), function timeouts (30s API, 15s SSR) |

## Gate Summary Checklist (copy-paste for PRs)
```
## Release Gates
- [ ] Gate 1: `npm run type-check` — PASS
- [ ] Gate 2: `npm run lint` — PASS
- [ ] Gate 3: `npm test` — PASS ([n]/[n])
- [ ] Gate 4: `npm run build` — PASS (shared: [n] kB)
- [ ] Gate 5: Security scan — PASS
- [ ] Gate 6: Quiz integrity — PASS / N/A
- [ ] Gate 7: Database safety — PASS / N/A
- [ ] Gate 8: E2E smoke — PASS
```
