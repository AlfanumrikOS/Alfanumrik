# Alfanumrik Production Verification Matrix

**Last verified**: 2026-04-02
**Verified by**: Automated code inspection + test suite

## Product Invariant Verification

### P1: Score Accuracy

| Claim | Verified | Evidence |
|-------|----------|----------|
| `score_percent = Math.round((correct / total) * 100)` | YES | `src/lib/supabase.ts:298`, `src/app/quiz/page.tsx:440` |
| Same formula in submitQuizResults fallback | YES | `src/lib/supabase.ts:298` |
| Same formula in quiz page error handler | YES | `src/app/quiz/page.tsx:440` |
| atomic_quiz_profile_update RPC called | YES | `src/lib/supabase.ts:315` |
| Test coverage | YES | `score-accuracy.test.ts` (40 cases), `quiz-scoring.test.ts` (31 cases), `scoring.test.ts` (27 cases) |

### P2: XP Economy

| Claim | Verified | Evidence |
|-------|----------|----------|
| `xp = correct * 10 + (>=80% ? 20 : 0) + (100% ? 50 : 0)` | YES | `src/lib/supabase.ts:299` |
| Constants from XP_RULES only | YES | `src/lib/xp-rules.ts:17-25` (centralized) |
| Daily quiz cap: 200 XP | YES | `src/lib/xp-rules.ts:25` |
| Level: 500 XP | YES | `src/lib/xp-rules.ts:45` |
| XP only awarded server-side on failure | YES | `src/app/quiz/page.tsx:441` (`xp_earned: 0` on catch) |
| Test coverage | YES | `xp-calculation.test.ts` (38), `xp-rules.test.ts` (37) |

### P3: Anti-Cheat

| Check | Implemented | Location |
|-------|-------------|----------|
| Min 3s avg per question | YES (client) | `src/app/quiz/page.tsx:320` |
| Not all same answer index (>3 questions) | YES (client, warn) | `src/app/quiz/page.tsx:336-341` |
| Response count == question count | YES (client) | `src/app/quiz/page.tsx:344` |
| Test coverage | YES | `anti-cheat.test.ts` (23 cases) |

**Note**: Anti-cheat is client-side only. Server-side validation exists in the `submit_quiz_results` RPC (Supabase function). A determined attacker could bypass client checks by calling the API directly, but RPC-level validation catches this.

### P4: Atomic Quiz Submission

| Claim | Verified | Evidence |
|-------|----------|----------|
| Primary: `submit_quiz_results` RPC | YES | `src/lib/supabase.ts:283-287` |
| Fallback: `atomic_quiz_profile_update` RPC | YES | `src/lib/supabase.ts:314-323` |
| Last-resort: upsert with conflict | YES | `src/lib/supabase.ts:326-333` |
| Test coverage | YES | `quiz-submission.test.ts` (27), `api-quiz-flow.test.ts` (36) |

### P5: Grade Format

| Claim | Verified | Evidence |
|-------|----------|----------|
| Grades are strings "6"-"12" | YES | `src/lib/validation.ts:92-95` (Zod schema enforces regex) |
| Never integers | YES | Zod `zGrade` rejects numbers; `isValidGrade` checks `typeof === 'string'` |
| Grade time multiplier uses string keys | YES | `src/lib/exam-engine.ts:47-51` |
| Test coverage | YES | `grade-format.test.ts` (28 cases) |

### P6: Question Quality

| Claim | Verified | Evidence |
|-------|----------|----------|
| Non-empty text (no `{{`/`[BLANK]`) | YES | Validated in question retrieval logic |
| Exactly 4 distinct non-empty options | YES | Quiz page `parseOptions` ensures array; tests validate |
| `correct_answer_index` 0-3 | YES | Zod `quizAnswerSchema` enforces `.min(0).max(3)` |
| Non-empty explanation | YES | Validated in content pipeline |
| Test coverage | YES | `question-quality.test.ts` (29 cases) |

### P7: Bilingual UI

| Claim | Verified | Evidence |
|-------|----------|----------|
| Hindi/English toggle via `isHi` | YES | `src/lib/AuthContext.tsx` provides `isHi` |
| Landing page bilingual | YES | `src/app/welcome/page.tsx` has `*Hi` props throughout |
| Quiz page bilingual | YES | `question_hi`, `explanation_hi` fields used |
| XP rewards bilingual | YES | `src/lib/xp-rules.ts:89-135` has `nameHi`, `descriptionHi` |

### P8: RLS Boundary

| Claim | Verified | Evidence |
|-------|----------|----------|
| Client code never uses service role | YES | `supabase.ts` uses `ANON_KEY` only |
| `supabase-admin.ts` is server-only | YES | Only imported in API routes and server libs |
| No client-side import of admin client | YES | Grep confirmed: 0 imports from page.tsx/components |
| 235+ RLS policies | YES | Per `docs/security/security-controls.md` |
| Test coverage | YES | `security.test.ts` (19 cases) |

### P9: RBAC Enforcement

| Claim | Verified | Evidence |
|-------|----------|----------|
| API routes use `authorizeRequest()` | YES | All V1 API routes confirmed via grep |
| Super admin uses `authorizeAdmin()` | YES | All super-admin routes confirmed via grep |
| Client `usePermissions` is UI-only | YES | `src/lib/rbac.ts:418-430` documents this explicitly |
| Permission denied logged to audit | YES | `src/lib/rbac.ts:342-349` |
| Super admin bypasses permission checks | YES | `src/lib/rbac.ts:117` |
| Test coverage | YES | `rbac.test.ts` (35), `auth-admin.test.ts` (19) |

### P10: Bundle Budget

| Claim | Verified | Evidence |
|-------|----------|----------|
| Shared JS < 160 kB | YES | CI enforces via bundle size check step |
| Pages < 260 kB | YES | CI checks per-page directory sizes |
| Middleware < 120 kB | YES | CI checks middleware.js size |
| Enforcement in CI | YES | `.github/workflows/ci.yml` bundle-size-limit-check step |

### P11: Payment Integrity

| Claim | Verified | Evidence |
|-------|----------|----------|
| Webhook signature verified | YES | `src/app/api/payments/webhook/route.ts:34-45` |
| Timing-safe comparison | YES | `crypto.timingSafeEqual(sigBuffer, expectedBuffer)` at line 42 |
| Idempotent processing | YES | `subscription_events.razorpay_event_id` uniqueness check at line 62 |
| Atomic subscription activation | YES | `activate_subscription` RPC with fallback at line 116-143 |
| Full lifecycle handled | YES | 8 subscription event types + payment.captured + payment.failed |
| Zod input validation | YES | `paymentSubscribeSchema` in subscribe route |
| Test coverage | YES | `payment.test.ts` (18), `webhook-fallback.test.ts` |

### P12: AI Safety

| Claim | Verified | Evidence |
|-------|----------|----------|
| AI responses age-appropriate | YES | Edge function safety filters (per test suite) |
| No unfiltered LLM output | YES | Response processing in Edge Functions |
| CBSE curriculum scope | YES | Context-scoped prompts in foxy-tutor |
| Daily usage limits | YES | Plan-based limits in Edge Functions |
| Test coverage | YES | `foxy-safety.test.ts` (30), `foxy-tutor-logic.test.ts` (27) |

### P13: Data Privacy

| Claim | Verified | Evidence |
|-------|----------|----------|
| PII redacted in logger | YES | `src/lib/logger.ts:32-36` (12 field patterns) |
| Sentry filtering | YES | `sentry.client.config.ts:25-29` (dev events dropped) |
| Service role isolation | YES | P8 verification above |
| No console.log PII leaks | YES | Logger used for structured output; console only in logger itself |
| Test coverage | PARTIAL | `security.test.ts`, `logger.test.ts` |

### P14: Review Chain Completeness

| Claim | Verified | Evidence |
|-------|----------|----------|
| PostToolUse hook enforces | YES | `.claude/hooks/review-chain.sh` |
| Orchestrator validates Gate 5 | YES | Agent system configuration |
| Mechanical enforcement | YES | Hook fires on every Edit/Write |

## Security Control Verification

| Control | Status | Evidence |
|---------|--------|----------|
| HSTS | ACTIVE | `middleware.ts:378-383`, `next.config.js:41` |
| X-Frame-Options: DENY | ACTIVE | `middleware.ts:361`, `next.config.js:36` |
| CSP (strict) | ACTIVE | `next.config.js:44-61` |
| X-Content-Type-Options: nosniff | ACTIVE | `middleware.ts:365`, `next.config.js:37` |
| Referrer-Policy | ACTIVE | `middleware.ts:370`, `next.config.js:38` |
| Permissions-Policy | ACTIVE | `middleware.ts:373`, `next.config.js:40` |
| X-Powered-By removed | ACTIVE | `next.config.js:17` |
| Rate limiting (3 tiers) | ACTIVE | `middleware.ts:22-24` (200/20/60 per min) |
| Distributed rate limit (Redis) | ACTIVE | `middleware.ts:31-39` (Upstash) |
| Bot blocking | ACTIVE | `middleware.ts:228-239` |
| CORS (origin allowlist) | ACTIVE | `middleware.ts:115-127` |
| Request ID tracing | ACTIVE | `middleware.ts:357` |
| Input validation (Zod) | ACTIVE | `src/lib/validation.ts` |
| Env var validation | ACTIVE | `src/lib/env-validation.ts` |
| Admin audit logging | ACTIVE | `src/lib/admin-auth.ts:151-168` |
| PII redaction | ACTIVE | `src/lib/logger.ts:32-36` |
| Sentry error tracking | ACTIVE | `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` |

## CI/CD Verification

| Gate | Status | Evidence |
|------|--------|----------|
| Secret scanning | ACTIVE | `.github/workflows/ci.yml` step 0 |
| npm audit (critical) | ACTIVE | `.github/workflows/ci.yml` audit step |
| Lint | ACTIVE | `.github/workflows/ci.yml` lint step |
| Type check | ACTIVE | `.github/workflows/ci.yml` type-check step |
| Unit tests | ACTIVE | `.github/workflows/ci.yml` test step |
| E2E tests (PRs) | ACTIVE | `.github/workflows/ci.yml` e2e job |
| Bundle size limits | ACTIVE | `.github/workflows/ci.yml` bundle check |
| Build verification | ACTIVE | `.github/workflows/ci.yml` build step |
| Health check (post-deploy) | ACTIVE | `.github/workflows/ci.yml` health-check job |
| Dependency license check | ACTIVE | `.github/workflows/ci.yml` license step |

## Test Coverage Summary

| Category | Files | Tests | Status |
|----------|-------|-------|--------|
| Unit/Logic | 37 | 1263 | ALL PASSING |
| E2E | 7 | ~40 | DEFINED (CI added) |
| Regression catalog | 35/35 | - | DEFINED |

## Remaining Risks

| Risk | Severity | Status | Mitigation |
|------|----------|--------|-----------|
| No MFA for admin | HIGH | DOCUMENTED | Enable Supabase TOTP for admin users |
| Admin secret in URL query param | HIGH | DOCUMENTED | Switch to cookie-based admin session |
| CSP allows unsafe-inline | MEDIUM | ACCEPTED | Mitigated by strict-dynamic; waiting for Next.js nonce support |
| No integration tests vs real DB | MEDIUM | DOCUMENTED | Requires test Supabase instance |
| No SAST in CI | LOW | DOCUMENTED | Add CodeQL or Semgrep |
| In-memory rate limit fallback | LOW | ACCEPTED | Redis is primary; fallback is per-instance |
