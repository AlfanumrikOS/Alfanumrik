# 17 - Appendix

## Status of reports 15 and 16

Per the approved certification plan (Section I, "realistic session-scoping"), the Executive
Release Board pass and the final Release Recommendation are explicitly Wave 4 deliverables,
gated on Wave 2 (seeded local integration testing) and Wave 3 (dedicated staging tenant)
completing or being formally marked deferred with rationale. Neither file is written this wave.
Issuing a release decision on Stage-1-only evidence for Tier-0 surfaces (auth, payments, AI,
scoring) would violate the Board's own completeness gate. The closest thing to a decision this
package contains is the interim readiness signal in 01-executive-summary.md and
00-production-readiness-dashboard.md: APPROVED WITH CONDITIONS is the defensible ceiling on
Wave 1 evidence alone, and even that is provisional.

## Escalation requiring your decision

CERT-06: whether unredacted student free-text reaching the AI provider's fallback path is
acceptable, and whether a currently-dormant shadow-grading feature flag should ever be promoted.
This has been an open item since the prior validation phase and remains open after independent
re-verification this wave. It is not a code defect and cannot be resolved by any agent - it
requires a ruling from you before the Business Rules and AI Quality scorecard categories can be
finalized at anything better than their current Stage-1-capped confidence.

## Unresolved items log

| Item | Why unresolved | What resolves it |
|---|---|---|
| CERT-01 QUIZ-ACTIVE RPC-layer gap | requires either a code fix or a live Stage-2 test against a seeded suspended account | Wave 2 |
| CERT-09 OAuth table existence | requires live database schema access | Wave 2 or 3 |
| CERT-16 Python-proxy compensating auth | requires reading the Python service's own auth code, out of this wave's file scope | Wave 2 |
| Subscription-expiry-mid-assessment behavior | requires a live time-boxed session | Wave 2 |
| Full middleware 7-layer ordering re-trace | not in this wave's Tier-0 worklist, no contradicting evidence found elsewhere | targeted follow-up, any wave |
| CSRF/XSS/SSRF posture, rate-limiting detail, end-to-end audit-log coverage | not flagged as Tier-0 gaps by any prior phase or this wave's other findings, not independently re-derived from scratch | targeted follow-up, any wave |
| Load-test execution (the 4 scenarios recommended in 09-performance-certification-report.md) | requires a non-production target | Wave 3b or later |
| Database point-in-time-recovery / backup activation status | requires project-dashboard access | Wave 2 or 3 |
| ~90% of the operational runbooks directory, staleness beyond the two documents checked | out of this wave's time budget | any wave |

## Housekeeping items found during synthesis (not certification defects)

Two inventory CSVs under evidence/inventory/ contain a small number of rows where a comma
inside a free-text field broke simple column parsing during this synthesis pass (one row in
pages.csv, three in super-admin-pages.csv). The underlying findings are not affected - this is
a formatting cleanup for the CSVs themselves, to be fixed before Wave 2 so downstream tooling
can parse them without special-casing.

## Corroboration notes (findings independently reached by two or more agents)

Several findings in this wave were reached independently by two different domain agents working
from different evidence, which is a meaningfully stronger form of confirmation than a single
agent's read. These are: the second, undocumented deployment pipeline being currently armed
(architect and ops); the regression catalog undercount in the constitution (ops and testing);
the QUIZ-ACTIVE RPC-layer gap and its live-reachability (architect found the gap, mobile
independently confirmed it is reachable via the shipped app's default configuration - two
different angles converging on the same conclusion); and the OAuth-approval route's admin-tier
level (backend and ops both flagged it from different angles).

## What Wave 2 needs before it can start

1. Explicit confirmation of a non-shared Supabase target for seeded test accounts - never the
   project currently referenced by local environment configuration, unless that project is
   first confirmed to be a disposable sandbox.
2. A seed-accounts script, one account per mission role, clearly marked as test data.
3. A decision on CERT-01 and CERT-04 specifically, since both are inexpensive to fix and would
   otherwise consume Wave 2 verification cycles confirming a known, already-described gap rather
   than surfacing new information.

## What Wave 3 needs before it can start

Operations-agent write access to add a new seeding workflow, an actual GitHub Actions dispatch
trigger, and a human confirmation that the staging environment's payment-provider credentials
are genuinely in test mode. If any of these cannot be arranged, Wave 3 is formally marked
deferred with this rationale, not silently dropped.
