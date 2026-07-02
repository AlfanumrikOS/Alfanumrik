# Go / No-Go Checklist

For the Executive Release Board's eventual final decision. Every item must have evidence linked,
not just a checkmark, per the program's own evidence-first rule. Current status shown - most
items cannot yet be marked because Stage 2/3 has not run.

## Functional and business correctness
- [ ] Zero open Blockers in the risk register - CURRENT: true for Wave 1's static findings (0
      Blockers), but Stage 2/3 has not yet had the chance to surface any live-only Blocker
- [ ] All 7 mission-role journeys pass Stage 2/3 live testing, or every failure is explicitly
      accepted with rationale - NOT YET RUN
- [ ] Core automated suite green on the Release Candidate commit - CONFIRMED (14,359 tests,
      type-check/lint/build/bundle all pass at commit 15742a1c)

## Security and privacy
- [ ] No open Should-Fix-Before-Release item touches a live-confirmed exploitable path -
      PARTIAL: CERT-01 is confirmed live-reachable via the mobile app's default configuration;
      Board must weigh this explicitly, not silently pass this checkbox
- [ ] G-5 / CERT-06 AI-fallback PII question has a recorded ruling - PENDING (needs your input)

## Environment safety
- [x] Staging database is isolated from production - CONFIRMED
- [ ] Staging website environment variables are confirmed scoped to staging - **BLOCKED, CERT-17**
- [x] Certification traffic is identifiable and excludable from reporting - CONFIRMED (CERT-19 closed)
- [x] Monitoring correctly attributes staging errors to staging, not production - CONFIRMED (CERT-18 closed)
- [x] A tested, reviewed tenant-teardown mechanism exists - CONFIRMED at unit/structural level;
      live execution still pending (tracked, not a gate on this checklist item)

## Operational readiness
- [ ] Deployment approval gate exists - NOT YET (CERT-03, open)
- [ ] Rollback procedure is documented and has been exercised at least once - documented, not yet exercised live
- [ ] Second deployment pipeline (AWS) status is a deliberate, documented decision - PENDING your input (CERT-02)

## Documentation
- [x] Release Candidate baseline captured and internally consistent - CONFIRMED
- [ ] Constitution doc drift (regression catalog count, admin panel size, etc.) corrected - open, low priority, non-blocking

**Current overall: NOT READY TO EVALUATE.** Most items are honestly marked "not yet run," not
"failed" - this checklist exists to make that distinction visible, not to imply readiness.
