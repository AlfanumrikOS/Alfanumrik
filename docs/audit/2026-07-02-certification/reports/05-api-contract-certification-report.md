# 05 - API Contract Certification Report

Stage 1 (static/read-only), 2026-07-02. Scope: all 362 API routes, with individual
hand-verification concentrated on the 44 Tier-0 routes (auth, payments, cron, quiz
submission/scoring, and the 7 high-blast-radius admin routes).

## Authorization

Zero Tier-0 routes found with no detected authorization mechanism. Every route with no
detected auth check (15 total, all Tier 1/2) is an intentionally public route (health checks,
error reporting, feature-flag checks, trial signup, OAuth authorize metadata) - this list was
independently re-derived twice (backend's bulk grep and the Phase 1 discovery doc) and both
methodologies converged on the exact same 15 routes, a strong cross-check.

All 7 REG-119-pinned high-blast-radius routes were individually hand-verified and match the
regression catalog's own description with no drift. One pre-existing observation re-confirmed:
the OAuth-app-approval route (which issues OAuth client secrets) is gated at the support tier
rather than a higher admin tier - a working gate and audit log exist; whether support is the
deliberately-pinned tier was not independently confirmable from the test file alone this pass.

## Idempotency and atomicity

Payment webhook idempotency re-confirmed at the code level: signature verification runs before
any database read; event-level idempotency is enforced on a unique event-id constraint; the
atomic-fallback kill switch is checked at both event-branch call sites and fails safe (returns
503, triggering a Razorpay retry, with an audit log) when disabled. No split-brain risk found.

## Status codes and error handling

Spot-checked Tier-0 routes return consistent error shapes (a bilingual success/error/error_hi
envelope for quiz routes; a v2Success wrapper for /v2/* routes). One pre-existing, already-
tracked finding re-confirmed: the OpenAPI spec under-models the {success, data} envelope for
10 of 12 /v2/* routes - a documentation-completeness gap, not a runtime defect.

## Mobile compatibility

Light cross-reference (backend) plus a dedicated mobile-side pass found no route called by the
mobile client that does not exist server-side, and vice versa, for the /v2/* surface the mobile
app actually uses. A full bidirectional diff was not exhaustively completed this wave.

## Open findings

- Route-level QUIZ-ACTIVE gap: CONFIRMED FIXED at all 4 call sites. The residual gap is one
  layer down, at the RPC/SQL level - tracked as CERT-01, not a route-contract defect.
- extract-ncert-questions: a Python-proxy short-circuit bypasses the shared Deno-side
  authorization gate on that specific code path; whether the Python service independently
  authorizes the request was not verified this wave (CERT-16).
- 6 Tier-0 routes (5 cron endpoints, 1 quiz-content route) have confirmed-correct auth but zero
  automated test coverage (CERT-08).
- Two documentation/code drift items found and corrected in this record: extract-diagrams and
  extract-ncert-questions header comments describe a header-key auth mechanism that no longer
  exists in code; the real gate is the shared AI-admission Platform Security Layer, which is
  functioning correctly. Not a defect, but the stale comment could mislead an operator.

## Request/response schema, timeout, and retry behaviour

Not exhaustively re-verified per-route this wave (out of the Tier-0-concentrated scope); no
Tier-0 route was found with an inconsistent schema during the spot-checks performed. Recommend
a dedicated Stage-2 contract-test pass if the Board wants full-surface confidence on this point.
