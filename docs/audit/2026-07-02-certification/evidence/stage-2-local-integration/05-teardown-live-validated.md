# Stage 2 - Teardown functions LIVE-VALIDATED against staging

2026-07-02, 22:00. The certification teardown integration test (REG-229, 8 tests) passed 8/8
executing for real against the staging Supabase project - the first live validation of these
functions.

## What is now proven live (not mocked, not static)

- purge_certification_tenant: full 13-table teardown (7 original + 6 corrected-FK-inventory
  additions from the CERT-21-adjacent hardening), idempotent re-call is a clean no-op,
  never-existed school id returns the no-op shape.
- purge_certification_run: the run-scoped single-call teardown clears the school-scoped tenant
  AND the standalone accounts (guardians, admin_users, their auth ids surfaced, demo_accounts),
  spares the guarded survivors (the double guard - a non-demo admin row and a non-cert-domain
  guardian both SURVIVE), surfaces the correct standalone auth ids, and the second call is a
  clean no-op.
- Both guard families proven live: is_demo refusal (raises + zero rows) including the is_demo IS
  NULL case, and the strict 8-hex run_id_short format guard (ERRCODE 22023).

## What it took to get here (Stage 2 value)

Reaching a green live run required fixing, in order, real defects that were all invisible to
Stage 1 static analysis and to mocked unit tests:
- CERT-21: the duplicate migration version that had silently blocked the teardown functions (and
  a security migration) from ever applying to staging or prod.
- Three seed-script defects (preferred_subject FK, auth-user idempotency, guardians is_active).
- Three fixture-correctness defects, the last fixed comprehensively: the test fixtures fabricated
  FK values that a real DB rejects (auth_user_id, preferred_subject, then a full audit found the
  remaining school_audit_log.actor_id and payment_reconciliation_queue.submitted_by_user_id -> 
  auth.users). The comprehensive audit against the FULL migration chain (not just the baseline)
  ended the one-at-a-time cycle.

## Significance

The certification tenant teardown - the mechanism that makes the whole Stage 2/3 cleanup a single
accountable operation, and the thing Environment Readiness criterion 5 depends on - is now
live-proven, not just written and reviewed. This closes the last piece of criterion 5 that was
previously "structurally complete but never executed."

## Tenant status

The certification tenant 4e6979d0 (school 96d0acd9) remains intact and is_demo-marked - the
teardown TEST used its own throwaway fixtures and did not touch it. 4e6979d0 is kept for the
browser-journey sub-phase (Option B), then cleaned up via
purge_certification_run('4e6979d0') afterward.
