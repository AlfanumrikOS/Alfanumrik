# 02 — Certification Coverage Matrix

Stage 1 (static/read-only), 2026-07-02. "Tested" = individually hand-verified by a certification
agent (file:line read); mechanically-classified-only rows are counted under Total/Untested-Tier2
per the approved risk-tiering rule, not silently folded into "Tested." Full row-level detail in
`evidence/inventory/*.csv`.

| Component class | Total | Hand-verified (Tier 0) | Mechanically classified only (Tier 1/2) | Passed | Failed / Open finding | Untested this wave |
|---|---:|---:|---:|---:|---:|---:|
| Pages (`page.tsx`) | 177 | 17 (Tier 0) | 160 (82 T1 + 77 T2 + 1 anomaly) | 176 | 1 (role-routing gap, see below) | 0 (100% classified; depth varies by tier) |
| API routes (`route.ts`) | 362 | 44 (Tier 0, all hand-verified) | 318 (147 T1 + 171 T2) | 361 | 1 (QUIZ-ACTIVE RPC-layer gap is not a route defect per se, tracked under migrations below — routes themselves: 0 route-level defects) | 0 |
| Edge Functions | 48 | 20 AI (all hand-verified) + ~16 non-AI Tier-0-adjacent | 12 remainder | 47 | 1 (Python-proxy short-circuit bypasses shared auth gate on `extract-ncert-questions`, compensating control NOT VERIFIED) | 0 |
| DB Migrations | 350 | ~30 hand-read (risk-weighted sample) + 12 SD-flagged + 4 CREATE-TABLE-flagged, all resolved | remainder mechanically swept (7 grep patterns) | 349 | 1 (`update_mol_routing_weights` missing search_path) | 0 |
| Super-admin pages | 62 | 16 (Tier 0) | 46 (31 T1 + 12 T2 + 3 parsing anomalies to clean up) | 62 | 0 defects found (documentation-accuracy issues tracked separately, not a page defect) | 0 |
| User journeys (7 roles × 13 steps = 91 cells) | 91 | 35 (5 Tier-0 steps × 7 roles) | 56 | see `04` — majority PASS/INTACT | 2 roles (Content Author, Support Staff) FAIL at Dashboard step (no portal); 1 step (Daily Rhythm, pre-fix) historically broken, now fixed but re-verify in Stage 2 | Payments/Subscriptions/Certificates steps not live-tested this wave (static trace only) |
| Business rules (14 named in mission) | 14 | 14 | 0 | 10 Verified | 2 Unknown/Not-implemented (coupon, referral — schema-only, no app code) | 2 Verified-with-open-finding (adaptive progression is dead-code/flag-off contrary to a stale in-repo claim; subscription-expiry-mid-assessment not fully traced) |
| Automated test suite | 1 run | — | — | type-check/lint/test/build/bundle-size all PASS (14,359 tests) | 0 | E2E (37 specs) correctly deferred to Stage 2/3 (requires live server) |

## Notes on "nothing unclassified"

- Every migration, route, page, and Edge Function has a row in its respective CSV under
  `evidence/inventory/` — zero rows are blank/unclassified. Depth of verification differs by
  tier per the approved risk-tiering rule (Section C of the certification plan), and that tier
  is itself a CSV column, so the difference between "hand-verified" and "mechanically classified"
  is auditable per-row, not asserted in aggregate only.
- The "1 anomaly" in the pages row and "3 parsing anomalies" in the super-admin-pages row are
  CSV-formatting artifacts (a page path containing a comma inside a quoted description field)
  found during this synthesis pass, not certification defects — flagged for cleanup in
  `evidence/inventory/` before Wave 2, tracked in `17-appendix.md`.
- Coupon/referral logic is marked "Unknown/Not-implemented" rather than Failed — the mission
  asked to certify these business rules, and the honest answer is that there is nothing to
  certify: the schema exists, the application layer does not.
