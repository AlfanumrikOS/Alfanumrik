# 03 - Feature Certification Report

Stage 1 (static/read-only), 2026-07-02. Component-level counts below are drawn directly from
evidence/inventory/*.csv (one row per artifact, zero unclassified). Full per-item detail lives
in those CSVs and in each domain's findings file under evidence/stage-1-static/code-trace-notes/.

| Component | Total | Tested (hand-verified) | Passed | Failed | Untested (mechanically classified only) |
|---|---:|---:|---:|---:|---:|
| Pages | 177 | 17 | 176 | 1 | 160 |
| API routes | 362 | 44 | 361 | 1 (upstream RPC gap, not a route bug) | 318 |
| Edge Functions (AI) | 20 | 20 | 20 | 0 | 0 |
| Edge Functions (non-AI) | 28 | 28 | 27 | 1 (proxy bypass, compensating control unverified) | 0 |
| DB migrations | 350 | ~46 | 349 | 1 (missing search_path) | 304 |
| Super-admin pages | 62 | 16 | 62 | 0 | 46 |
| Background jobs / cron | 5 (of the 6 zero-coverage Tier-0 routes) | 5 (auth hand-verified) | 5 | 0 | 0 (auth confirmed; test coverage is the gap, tracked as CERT-08, not a functional failure) |
| Scheduled tasks (daily-cron steps) | multiple, see evidence | N+1 fix step hand-verified | PASS (genuine fix, not cosmetic) | 0 | remaining steps mechanically reviewed only |
| Webhooks (payment) | 1 (Razorpay) | yes | PASS (signature verified before I/O, idempotent, atomic kill-switch fallback) | 0 | - |

Nothing in this inventory is left unclassified: every row exists in a CSV under
evidence/inventory/ with an explicit tier and verdict column, even where depth of verification
is Stage-1-static-only per the approved risk-tiering rule.

## Notable feature-level findings not captured by the raw counts

- Adaptive/IRT question selection: present in code but dead (selection flag hardcoded off,
  logic trapped in an unclosed comment block). The live adaptive mechanism is a different,
  correctly-built, currently-off system. Certified as Not Live, contrary to a stale in-repo
  comment claiming 100% production rollout.
- Coupon and referral features: database schema only, zero application code. Certified as
  Not Implemented rather than Failed.
- Leaderboard: functional, but the scope=school query parameter is silently ignored (always
  returns the global ranking).
- Mobile plan-display: a cosmetic defect shows "Free" to some paying subscribers; entitlements
  and usage gating are unaffected.
