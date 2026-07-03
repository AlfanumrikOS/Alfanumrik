# Stage 2 - Certification tenant provisioned + two findings

2026-07-02. The dedicated certification tenant now exists on the staging Supabase project. This
is the core Stage 2 provisioning milestone.

## Provisioning result (first-party evidence from the seed run)

- Target: staging project gzpxqklxwzishrkiaatd (production-reference guard passed).
- certification_run_id: 4e6979d0-0000-0000-0000-000000000000 (short 4e6979d0).
- School: "[CERTIFICATION] cert-4e6979d0-school-001", id 96d0acd9-ef39-4d43-950f-101d708adcec.
- All 7 mission-role accounts present: student and teacher reused idempotently (confirming the
  auth-user idempotency fix works against a real database - they were the half-created rows from
  the earlier failed attempts and were healed, not duplicated); parent, school_admin, super_admin,
  content_author, support_staff all created fresh.
- content_author and support_staff correctly marked NO PORTAL - the live seed carrying the
  Wave 1 CERT-07 finding forward for Stage 2 to prove in a browser.

It took three field-caught, fixed, regression-tested defects to reach this clean run
(preferred_subject FK, auth-user idempotency, guardians is_active) - all committed. This is the
Stage 2 gate doing exactly its job: each was invisible to Stage 1 static analysis and to mocked
unit tests, and only surfaced against a real service-role write to a real, faithfully-different
database.

## Finding A (HAZARD, must fix before any browser journey) - Preview is in a split-brain state

As a side effect of the partial CERT-17 remediation, the Vercel Preview environment is now
INTERNALLY INCONSISTENT:
- Client-side variables (public Supabase URL, public anon key) are Preview-scoped to STAGING
  (fixed earlier today).
- The elevated database credential is STILL the shared production-scoped value (the fix for it
  was hard-blocked from automation and remains unset for Preview).
- The payment key is still the shared production/live value (deferred).

Effect: the deployed Preview website would route browser/client calls to staging while any
server-side route using the elevated credential connects to PRODUCTION. A mixed configuration is
arguably more dangerous than a uniformly-wrong one, because it is inconsistent - part of a single
request path points at staging, part at production. Browser-based (Path B) certification MUST NOT
run against Preview until the elevated credential is also repointed to staging. ERG-1's
elevated-credential item correctly remains open; this finding raises its urgency from "gate not
yet complete" to "actively hazardous partial state - finish it or revert the partial fix."

## Finding B - teardown is not single-operation for the seed's account mix

The seed's own teardown hint (printed at the end of the run) reveals that
purge_certification_tenant(school_id) only cleans the SCHOOL-SCOPED accounts (student, teacher,
school_admin) plus the school itself. The seed also creates accounts that are NOT school-scoped -
parent (guardians), super_admin / content_author / support_staff (admin_users) - and their
demo_accounts registry rows. These are not covered by the tenant purge; the seed prints manual
DELETE statements for them instead.

So a full certification-run teardown currently requires purge_certification_tenant PLUS three
manual DELETEs. This contradicts the earlier Environment Readiness criterion-5 framing of "clean
single-operation teardown exists" - that was accurate for the school-scoped subset but not for
the seed's actual full account set. This is a real gap between the teardown design and the seed's
output shape, worth closing so teardown is genuinely one accountable operation. Not blocking
(the manual deletes work and are printed for the operator), but it should be fixed - assigned to
architect (owns the teardown function).

## Status

Tenant provisioned. Browser journeys blocked on Finding A. Teardown-coverage gap (Finding B)
routed to architect. Data/API-level verification that does not go through the Preview website can
proceed independently.
