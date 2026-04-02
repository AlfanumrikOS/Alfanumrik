# Alfanumrik Quality Baseline Gaps

**Last verified**: 2026-04-02

## Current Baseline

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| TypeScript errors | 0 | 0 | PASS |
| Lint errors | 1 (config issue) | 0 | FIX IN PROGRESS |
| Lint warnings | 18 | < 10 | NEEDS WORK |
| Unit tests | 1125 passing (36 files) | > 1000 | PASS |
| E2E tests | 7 spec files | > 10 | NEEDS WORK |
| E2E in CI | No | Yes | FIX IN PROGRESS |
| Build | Passing | Passing | PASS |
| npm audit | 3 high vulns | 0 critical | NEEDS WORK |
| Bundle budget | Within limits | Within P10 | PASS |
| Test coverage enforcement | Aspirational only | Enforced in CI | GAP |

## Gap Analysis

### G1: E2E Tests Not in CI Pipeline
- **Risk**: High — regressions in routing, auth, and page rendering are not caught before deploy
- **Current**: 7 E2E specs exist but only run manually
- **Fix**: Adding E2E job to CI pipeline (in progress)
- **Owner**: architect

### G2: Test Coverage Not Enforced
- **Risk**: Medium — coverage thresholds defined in vitest.config.ts but not gated in CI
- **Current**: Global 60% target, xp-rules 90%, cognitive/exam engines 80%
- **Fix**: Add `--coverage` flag with threshold enforcement to CI test step
- **Owner**: testing

### G3: No Integration Tests Against Real Database
- **Risk**: Medium — all DB interactions are mocked in tests
- **Current**: 0 integration tests
- **Fix**: Create test Supabase project for CI integration testing
- **Owner**: architect + testing

### G4: No Visual Regression Testing
- **Risk**: Low — UI changes could introduce visual bugs
- **Current**: No visual testing tools configured
- **Fix**: Consider Percy or Chromatic for component visual regression
- **Owner**: frontend + testing

### G5: Lint Warnings (18 total)
- **Risk**: Low — mostly React Hook dependency warnings
- **Current**: 12 react-hooks/exhaustive-deps, 2 no-console (justified in logger)
- **Fix**: Address hook dependency warnings; suppress justified console usage
- **Owner**: frontend

### G6: npm Audit Vulnerabilities
- **Risk**: Medium — 3 high severity vulnerabilities in dependencies
- **Current**: CI runs audit but `continue-on-error: true`
- **Fix**: Audit enforcement being tightened (in progress)
- **Owner**: architect

### G7: No SAST (Static Application Security Testing)
- **Risk**: Low-medium — no automated security analysis of source code
- **Current**: Manual code review only
- **Fix**: Add CodeQL or Semgrep to CI pipeline
- **Owner**: architect

### G8: Feature Flag Rollout Not Per-User
- **Risk**: Low — rollout percentages between 1-99% treated as fully enabled
- **Current**: No userId-based consistent hashing
- **Fix**: Implementing deterministic per-user rollout (in progress)
- **Owner**: ops

### G9: Admin Audit Log Failures Silent
- **Risk**: Medium — admin actions could go unlogged on DB failure
- **Current**: Empty catch block in logAdminAudit
- **Fix**: Adding structured error logging for audit failures (in progress)
- **Owner**: ops

### G10: No Schema-Level Input Validation
- **Risk**: Medium — API endpoints use ad-hoc validation, no zod/joi
- **Current**: UUID validation exists; no comprehensive schema validation
- **Fix**: Adding Zod schemas for critical API routes (in progress)
- **Owner**: backend

## Gaps Being Resolved in This Upgrade

| Gap | Agent | Status |
|-----|-------|--------|
| G1: E2E in CI | architect | In progress |
| G5: Lint config error | architect | In progress |
| G6: npm audit enforcement | architect | In progress |
| G8: Feature flag rollout | ops | In progress |
| G9: Audit log silence | ops | In progress |
| G10: Input validation | backend | In progress |

## Gaps Deferred (Post-Launch)

| Gap | Priority | Reason for Deferral |
|-----|----------|-------------------|
| G3: Integration tests | Medium | Requires test Supabase instance provisioning |
| G4: Visual regression | Low | Additive improvement, not a blocker |
| G7: SAST | Low-medium | Can be added incrementally |

## Product Invariant Coverage

All 14 product invariants (P1-P14) have test coverage:

| Invariant | Test Files | Cases | Status |
|-----------|-----------|-------|--------|
| P1: Score Accuracy | score-accuracy, quiz-scoring, scoring | ~98 | COVERED |
| P2: XP Economy | xp-calculation, xp-rules | ~75 | COVERED |
| P3: Anti-Cheat | anti-cheat | 23 | COVERED |
| P4: Atomic Submission | quiz-submission, api-quiz-flow | ~63 | COVERED |
| P5: Grade Format | grade-format | 28 | COVERED |
| P6: Question Quality | question-quality | 29 | COVERED |
| P7: Bilingual UI | smoke (component renders) | partial | NEEDS MORE |
| P8: RLS Boundary | security | 19 | COVERED |
| P9: RBAC | rbac, auth-admin | ~54 | COVERED |
| P10: Bundle Budget | CI bundle check | automated | COVERED |
| P11: Payment Integrity | payment, webhook-fallback | ~18 | COVERED |
| P12: AI Safety | foxy-safety, foxy-tutor-logic | ~57 | COVERED |
| P13: Data Privacy | security, logger | partial | NEEDS MORE |
| P14: Review Chains | hooks (mechanical) | automated | COVERED |
