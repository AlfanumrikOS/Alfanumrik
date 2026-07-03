# Certification Coverage Dashboard

Rollup of docs/audit/2026-07-02-certification/reports/02 with a Stage 2/3 readiness column added.

| Artifact class | Total | Stage 1 classified | Stage 2/3 tooling ready | Stage 2/3 executed |
|---|---:|---:|---|---|
| Pages | 177 | 177 (100%) | Playwright specs cover the 7-role journey set | Not yet - CERT-17 |
| API routes | 362 | 362 (100%) | Covered indirectly via journey specs + planned API spot-check template | Not yet |
| Edge Functions | 48 | 48 (100%) | Not directly Playwright-tested; static coverage only | Not yet |
| DB migrations | 351 | 351 (100%, incl. the remediation-wave migration) | N/A - schema-level, not a live-journey concern | N/A |
| Super-admin pages | 62 | 62 (100%) | Super-admin journey spec covers a representative path, not all 62 | Not yet |
| User journeys (7 roles) | 7 | 7 statically traced | 8 Playwright specs written (36 tests), verified excluded from normal runs | Not yet |
| Business rules (14 named) | 14 | 14 | Partially covered by journey specs (scoring, XP, quiz limits); coupon/referral has nothing to test since unimplemented | Not yet |
| Regression catalog | 197 entries | n/a | REG-227 through REG-230 added this program (Sentry, seed script, teardown, guard tests) | 4/4 new entries passing at unit level; teardown's live-DB assertions self-skip pending Stage 2 |

## Coverage that will remain Stage-1-only even after Stage 2/3 completes

Per the approved risk-tiering rule, Tier-2 items (routine admin CRUD, static marketing pages,
most super-admin sub-pages) are not individually re-verified live even in Stage 2/3 - they
remain at Stage-1 static-classification confidence by design, not by omission. This is stated
explicitly here so an executive reading "100% classified" doesn't infer "100% live-tested,"
which was never the plan.
