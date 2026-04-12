# Alfanumrik Testing Strategy

**Last verified**: 2026-04-02

## Current Test Inventory

### Summary
| Type | Tool | Files | Approx. Cases | CI Enforced |
|---|---|---|---|---|
| Unit / Logic | Vitest 4.1.0 | 27 | ~730 | Yes |
| Component | @testing-library/react | (within unit files) | ~24 (smoke) | Yes |
| E2E | Playwright 1.58.2 | 5 | ~25 | No (not in CI) |
| Integration | None | 0 | 0 | N/A |
| Visual regression | None | 0 | 0 | N/A |

### Unit Test Files (26 files, all in `src/__tests__/` except 1)

| File | Cases | Domain | Product Invariant |
|---|---|---|---|
| `cognitive-engine.test.ts` (lib/) | 70 | Cognitive engine | -- |
| `score-accuracy.test.ts` | 40 | Score formula validation | P1 |
| `exam-engine.test.ts` | 40 | Exam timing and presets | -- |
| `xp-calculation.test.ts` | 38 | XP economy math | P2 |
| `xp-rules.test.ts` | 37 | XP rule constants | P2 |
| `api-quiz-flow.test.ts` | 36 | Quiz API lifecycle | P4 |
| `rbac.test.ts` | 35 | Role-based access control | P9 |
| `quiz-scoring.test.ts` | 31 | Scoring edge cases | P1 |
| `foxy-safety.test.ts` | 30 | AI safety filters | P12 |
| `question-quality.test.ts` | 29 | Question validation rules | P6 |
| `grade-format.test.ts` | 28 | Grade as string enforcement | P5 |
| `scoring.test.ts` | 27 | General scoring logic | P1 |
| `quiz-submission.test.ts` | 27 | Atomic quiz submission | P4 |
| `foxy-tutor-logic.test.ts` | 27 | AI tutor response logic | P12 |
| `ncert-solver.test.ts` | 26 | NCERT solver logic | -- |
| `quiz-generator-logic.test.ts` | 25 | Quiz generation | -- |
| `feedback-engine.test.ts` | 25 | Feedback engine | -- |
| `smoke.test.tsx` | 24 | Component render smoke | -- |
| `cognitive-load.test.ts` | 23 | Cognitive load management | -- |
| `anti-cheat.test.ts` | 23 | Anti-cheat detection | P3 |
| `auth-admin.test.ts` | 19 | Admin authentication | P9 |
| `security.test.ts` | 19 | Security header validation | P8 |
| `payment.test.ts` | 18 | Payment flow logic | P11 |
| `admin-control-plane.test.ts` | 12 | Admin control plane | -- |
| `api.test.ts` | 8 | API smoke tests | -- |
| `india.test.ts` | 7 | India locale specifics | -- |
| `observability-migration-1a.test.ts` | 6 | Observability 1a migration (DB-gated) | -- |
| `observability-migration-1b.test.ts` | 5 | Observability 1b alerting migration (DB-gated) | -- |

### E2E Test Files (4 files in `e2e/`)

| File | Purpose | Auth Required |
|---|---|---|
| `smoke.spec.ts` | Basic page load verification | No |
| `navigation.spec.ts` | Route navigation and redirects | No |
| `accessibility.spec.ts` | Accessibility checks | No |
| `landing-seo.spec.ts` | SEO meta tags, structured data | No |
| `observability-timeline.spec.ts` | Observability Console timeline, filters, drawer, export | Yes (super admin) |
| `observability-rules.spec.ts` | Observability Console alert rules and channels management | Yes (super admin) |

E2E tests are unauthenticated except `observability-timeline.spec.ts` and `observability-rules.spec.ts` which require `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` env vars (skips without them).

## Vitest Configuration

**File**: `vitest.config.ts`

| Setting | Value |
|---|---|
| Environment | jsdom |
| Setup file | `src/__tests__/setup.ts` |
| Include pattern | `src/**/*.{test,spec}.{ts,tsx}` |
| Globals | true |
| Coverage provider | v8 |
| Coverage scope | `src/lib/**` |
| Coverage reporters | text, json |

### Coverage Thresholds (defined but not enforced in CI)

| Scope | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Global | 60% | 60% | 60% | 60% |
| `src/lib/xp-rules.ts` | 90% | 90% | 90% | 90% |
| `src/lib/cognitive-engine.ts` | 80% | 80% | 80% | 80% |
| `src/lib/exam-engine.ts` | 80% | 80% | 80% | 80% |

**Important**: These thresholds are aspirational. `npm test` (which CI runs) does not include `--coverage`, so thresholds are not checked in the pipeline. Only `npm run test:coverage` would check them.

## Playwright Configuration

**File**: `playwright.config.ts`

| Setting | Value |
|---|---|
| Test directory | `./e2e` |
| Timeout | 30,000ms |
| Retries | 1 |
| Base URL | `http://localhost:3000` (or `BASE_URL` env) |
| Trace | on-first-retry |
| Web server | `npm run dev` on port 3000 (skipped in CI) |

**Not in CI**: Playwright tests are not part of any GitHub Actions workflow. They must be run locally with `npm run test:e2e`.

## Regression Catalog

35 regression scenarios are defined across product invariants P1-P13. Current coverage status:

### P1: Score Accuracy
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 1 | score_percent rounds correctly | Yes | `score-accuracy.test.ts` |
| 2 | 0 correct = 0% | Yes | `score-accuracy.test.ts` |
| 3 | All correct = 100% | Yes | `score-accuracy.test.ts` |
| 4 | Score consistent across submit + results + RPC | Partial | `quiz-scoring.test.ts` (client-side only) |
| 5 | Division by zero (0 questions) handled | Yes | `score-accuracy.test.ts` |
| 6-8 | Rounding edge cases, large question counts | Yes | `score-accuracy.test.ts` |

### P2: XP Economy
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 9 | Base XP per correct answer | Yes | `xp-rules.test.ts`, `xp-calculation.test.ts` |
| 10 | High score bonus at 80%+ | Yes | `xp-calculation.test.ts` |
| 11 | Perfect score bonus at 100% | Yes | `xp-calculation.test.ts` |
| 12 | Daily cap at 200 XP | Yes | `xp-calculation.test.ts` |
| 13 | Level at 500 XP | Yes | `xp-rules.test.ts` |
| 14 | No hardcoded XP outside xp-rules.ts | Yes | `xp-rules.test.ts` |

### P3: Anti-Cheat
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 15 | Min 3s avg per question | Yes | `anti-cheat.test.ts` |
| 16 | Not all same answer (>3 questions) | Yes | `anti-cheat.test.ts` |
| 17 | Response count = question count | Yes | `anti-cheat.test.ts` |

### P4: Atomic Quiz Submission
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 18 | RPC called for submission | Yes | `quiz-submission.test.ts` |
| 19 | Fallback logged on RPC failure | Yes | `quiz-submission.test.ts` |

### P5: Grade Format
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 20 | Grades are strings "6"-"12" | Yes | `grade-format.test.ts` |
| 21 | Integer grades rejected | Yes | `grade-format.test.ts` |

### P6: Question Quality
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 22 | Non-empty text, no placeholders | Yes | `question-quality.test.ts` |
| 23 | Exactly 4 distinct options | Yes | `question-quality.test.ts` |
| 24 | correct_answer_index 0-3 | Yes | `question-quality.test.ts` |
| 25 | Non-empty explanation | Yes | `question-quality.test.ts` |

### P9: RBAC
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 26 | authorizeRequest checks permission | Yes | `rbac.test.ts` |
| 27 | Unauthorized returns 403 | Yes | `rbac.test.ts` |
| 28 | Role hierarchy respected | Yes | `rbac.test.ts` |

### P11: Payment Integrity
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 29 | Webhook signature verified | Yes | `payment.test.ts` |
| 30 | Subscription status atomic with payment | Partial | `payment.test.ts` (logic only, no DB) |
| 31 | No access without verified payment | Yes | `payment.test.ts` |

### P12: AI Safety
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 32 | Age-appropriate responses | Yes | `foxy-safety.test.ts` |
| 33 | CBSE scope enforcement | Yes | `foxy-safety.test.ts` |
| 34 | No unfiltered LLM output | Yes | `foxy-safety.test.ts` |

### P13: Data Privacy
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 35 | PII redacted in logs | Yes | `security.test.ts` |

### Observability (Cut 1a)
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 36 | AI failure in claude.ts persists as an ops_event with category=ai, severity=error | Yes | `ops-events.test.ts` (writer) + `observability-migration-1a.test.ts` (persistence) |
| 37 | PII is redacted before writing to ops_events | Yes | `ops-events.test.ts`, `ops-events-redactor.test.ts` |
| 38 | cleanup_ops_events deletes info rows after 30 days and warning rows after 90 days; never deletes error/critical rows | Yes (DB-gated) | `observability-migration-1a.test.ts` |
| 39 | Observability Console page loads and renders snapshot widgets | Yes (auth-gated) | `e2e/observability-timeline.spec.ts` |
| 40 | Observability timeline loads with widgets for range=1h | Yes (auth-gated) | `e2e/observability-timeline.spec.ts` |
| 41 | Free-text search on the observability timeline matches against message, subject_id, and request_id | Partial | Implementation verified by inspection; no dedicated search assertion test |

### Observability (Cut 1b)
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 42 | Critical payment event (severity=critical, category=payment) fires the on-insert trigger and creates a pending alert_dispatch | Yes (DB-gated) | `observability-migration-1b.test.ts` |
| 43 | Alert deliverer retries a failed dispatch up to 3 times, then buries with status=failed | Yes | `supabase/functions/alert-deliverer/index_test.ts` (Deno test) |
| 44 | Alert rules and channels pages render with seeded data | Yes (auth-gated) | `e2e/observability-rules.spec.ts` |

### Student Impersonation
| # | Scenario | Test Exists | File |
|---|---|---|---|
| 45 | Impersonation sessions are audit-logged in admin_impersonation_sessions with start/end times and admin identity | Yes | `student-impersonation-api.test.ts` |
| 46 | Support notes are append-only -- only GET and POST routes exist, no PUT/PATCH/DELETE | Yes | `student-notes-api.test.ts` + code inspection |
| 47 | Live View iframe pages have no write endpoints -- all proxy routes are GET-only | Yes (by inspection) | Code inspection of `src/app/api/super-admin/students/[id]/{dashboard,progress,foxy-history,quiz-history}/route.ts` |

### Catalog Summary
- **35/35 core scenarios have corresponding tests** at the unit level
- **6 observability scenarios added (R36-R41)**: 4 fully covered, 1 partial, 1 DB-gated (skips without local Supabase)
- **3 observability Cut 1b scenarios added (R42-R44)**: 2 DB/auth-gated, 1 Deno test
- **3 impersonation scenarios added (R45-R47)**: R45 unit-tested, R46 unit-tested + inspected, R47 by code inspection
- **Gap**: No integration tests verify core invariants against real database/services
- **Gap**: No E2E tests verify core invariants in a running application (observability E2E added but auth-gated)
- **Gap**: Score consistency across client + server + RPC (P1 #4) is only tested client-side

## Testing Gaps and Priorities

### Critical Gaps (should fix before launch)
1. **Authenticated E2E flows**: No Playwright tests for logged-in user flows (quiz, dashboard, payment)
2. **Payment integration tests**: Webhook signature verification and subscription lifecycle with test Razorpay credentials
3. **RLS policy verification**: No automated tests that RLS policies correctly restrict access per role
4. **Coverage enforcement in CI**: Thresholds defined but not checked in pipeline

### Medium Priority Gaps
5. **API route integration tests**: No tests exercise actual API route handlers with mocked Supabase
6. **Mobile-web contract tests**: No automated check that Flutter app and Next.js API agree on response shapes
7. **Edge Function tests**: AI Edge Functions have no unit tests (logic tested via proxy in Vitest)
8. **Cross-browser E2E**: Playwright only uses default browser (Chromium)

### Low Priority Gaps
9. **Visual regression testing**: No screenshot comparison for UI consistency
10. **Performance testing**: No load tests for API routes or database queries
11. **Accessibility automation**: E2E accessibility spec exists but is basic

## CI Pipeline Integration

### Current State
```
ci.yml:
  quality job:
    npm run lint          --> ESLint
    npm run type-check    --> TypeScript compilation
    npm test              --> Vitest (722 tests)
  build job:
    npm run build         --> Next.js production build
```

### Target State
```
ci.yml:
  quality job:
    npm run lint
    npm run type-check
    npm audit --audit-level=high    --> enforced (not continue-on-error)
    npm run test:coverage           --> Vitest with coverage thresholds enforced
  build job:
    npm run build
    Bundle size assertions          --> fail if over budget
  e2e job (on PR):
    Deploy to Vercel preview
    npm run test:e2e                --> Playwright against preview URL
```
