# 13 - Production Readiness Scorecard

Stage 1 (static/read-only), 2026-07-02. Scores below are Stage-1-confidence only (MEDIUM
ceiling per the confidence rubric - static re-read with file:line evidence, no live
Stage 2/3 execution yet). This is NOT the Executive Release Board's final scorecard; that
independent re-derivation happens in Wave 4 per the approved plan, after Stage 2/3 evidence
exists. Presented here so the interim ceiling in 01-executive-summary.md is traceable to a
number, not just an assertion.

| Category | Weight | Stage-1 score (0-100) | Weighted contribution | Confidence | Evidence basis |
|---|---:|---:|---:|---|---|
| Functional | 25% | 88 | 22.0 | MEDIUM | 02-certification-coverage-matrix.md - 100% inventory classified, 3 open defects (QUIZ-ACTIVE RPC layer, extract-ncert-questions proxy bypass, 1 SECURITY DEFINER gap) out of 837 classified artifacts |
| Business Rules | 20% | 79 | 15.8 | MEDIUM | 06-business-rules-certification-report.md - 10/14 Verified, 2 Unknown/Not-implemented (coupon, referral), 2 Verified-with-open-finding (adaptive progression doc-mismatch, subscription-mid-assessment not fully traced) |
| Security | 15% | 82 | 12.3 | MEDIUM | 08-security-certification-report.md - cross-student RPC forgery confirmed closed (was the most severe finding in Phase 2); QUIZ-ACTIVE RPC layer and OAuth-table-existence remain open/unresolved; branch protection and RLS coverage confirmed clean |
| Performance | 10% | 90 | 9.0 | MEDIUM-HIGH | 09-performance-certification-report.md - fresh build passes all 3 bundle gates; daily-cron N+1 fix independently confirmed genuine; load-test execution not yet run (recommendations only) |
| Reliability | 10% | 70 | 7.0 | LOW-MEDIUM | 10-operational-certification-report.md - no deploy approval gates, an undocumented second live deploy pipeline, and a factually wrong incident runbook are all reliability-relevant operational gaps; health checks and PII redaction confirmed working |
| AI Quality | 10% | 85 | 8.5 | MEDIUM | 07-ai-certification-report.md - oracle, single-retrieval contract, and scope-lock all confirmed live; one pending CEO-decision item (G-5) not yet resolved; latency/embedding-freshness data not available (NOT VERIFIED, not estimated) |
| Operations | 5% | 65 | 3.25 | LOW-MEDIUM | 10-operational-certification-report.md - same findings as Reliability above weighted at Operations' own 5% |
| Documentation | 5% | 55 | 2.75 | MEDIUM | Multiple stale numbers found in the constitution this wave (regression catalog count, coverage thresholds, E2E spec count, admin panel size, AWS deploy target) - all confirmed by direct comparison against live artifacts, all in addition to Phase 1-3's own doc-drift findings |

## Stage-1 weighted total: 80.6 / 100

This number is presented for traceability only and is explicitly capped at MEDIUM confidence
across every category - no category has live Stage 2/3 verification yet, and per the approved
plan's own completeness gate, Tier-0 surfaces (auth, payments, AI, scoring) are required to
reach live verification before a defensible final score can be issued. The Executive Release
Board (Wave 4) will independently re-derive this table from the same underlying evidence rather
than copying this number, and is expected to move Reliability/Operations up or down depending on
how CERT-02/03/04 (deploy pipeline, approval gates, runbook accuracy) are resolved between now
and Wave 3.
