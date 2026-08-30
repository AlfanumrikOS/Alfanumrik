# 15 — Test Coverage

**Audit date:** 2026-08-29
**Evidence source:** Limited — no dedicated test coverage agent. Data from CI/CD agent and file counts.

---

## 1. Scale

| Metric | Count |
|--------|-------|
| Test files | 1,542 |
| API routes | 410 |
| Edge Function directories | 49 (on disk) |

## 2. Test Infrastructure

| Component | Tool | Notes |
|-----------|------|-------|
| Unit/integration tests | Vitest | Primary test runner |
| E2E tests | Playwright | Browser-based end-to-end |
| CI test workflow | GitHub Actions | Runs on PR |
| E2E Nightly | GitHub Actions | **RED for 25+ days** |
| Migration lint | GitHub Actions | Advisory (not required) |
| Bundle gate | GitHub Actions | Three-layer with vacuity detection |

## 3. CI/CD Test Gates

| Gate | Status | Blocking? |
|------|--------|-----------|
| CI Gate (unit + integration) | Green | **NOT in required checks (P1-03)** |
| Bundle gate | Green | Yes (fails build) |
| Secret scanning (Gitleaks) | Green | Yes |
| Migration lint | Green | No (advisory only — P2-17) |
| E2E Nightly | **RED (25+ days)** | Not gating (nightly only) |
| Edge auth sweep | Green | No (advisory — P2-16) |

## 4. Findings

| ID | Severity | Finding | Impact |
|----|----------|---------|--------|
| P1-03 | P1 | CI Gate not in required status checks — PRs can merge without passing tests | Tests run but don't block merge |
| P2-16 | P2 | Edge auth sweep runs advisory — security findings don't block | Security regressions can merge |
| P2-17 | P2 | Migration lint not required — destructive migrations can merge without lint | Schema safety not enforced |
| P3 | P3 | E2E Nightly has been red for 25+ days (issue #1418) | Regression detection gap |

## 5. Data Gaps

- Line/branch coverage percentage not measured
- Test quality assessment not performed
- Coverage per critical path (quiz submission, payment, auth) not analyzed
- Mutation testing not run

## 6. Gate Verdict

**CONDITIONAL GO** — 1,542 test files is substantial. The critical gap is that CI Gate is not in required status checks (P1-03, Phase 0 blocker). E2E Nightly regression needs triage.
