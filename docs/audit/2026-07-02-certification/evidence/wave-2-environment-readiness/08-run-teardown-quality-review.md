# Quality Review: purge_certification_run(p_run_id_short text) run-scoped teardown

**Reviewer:** quality
**Date:** 2026-07-02
**Branch:** fix/prod-readiness-remaining (HEAD b19b7265)

**Change under review (pre-commit gate, full-process, destructive SECURITY DEFINER function):**
- Migration 20260702190000_certification_run_teardown.sql (NEW - purge_certification_run)
- src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts (REG-229 extended, 4 new run-scoped tests)
- docs/runbooks/certification-rollback-procedure.md (Part 2 step 6 - one-call option)
- Cross-read (unchanged, confirmed): migration 20260702180000_certification_tenant_teardown.sql, scripts/seed-certification-accounts.ts

## Automated Checks
- Type check: **PASS** (tsc --noEmit, exit 0)
- Lint: **PASS** (eslint src, exit 0)
- Tests: **N/A this session** - the REG-229 integration suite lives in the migrations test folder, which vitest.config.ts EXCLUDES from the default unit run; it runs only in the integration lane (RUN_INTEGRATION_TESTS=1) and self-skips without live Supabase creds. It compiles cleanly (covered by type-check). Assertions verified by hand against the migration real output shape. Status is honestly: written, structurally sound, UNEXECUTED against a live DB. No unit-test regression risk since no non-test TS changed.
- Build: **N/A** - no application/bundle code changed (one .sql migration + one excluded integration test + one doc).

## Adversarial destructive-safety trace

### Double guard (domain AND is_demo) on every destructive statement against a real table - HOLDS
Traced each statement individually:

| # | Statement | Scope | Both guards? |
|---|-----------|-------|--------------|
| 1 | DELETE FROM admin_announcements | created_by IN (SELECT id FROM admin_users WHERE email LIKE v_email_like AND is_demo=true) | YES (transitive) |
| 2 | DELETE FROM admin_audit_log | admin_id IN (SELECT id FROM admin_users WHERE email LIKE ... AND is_demo=true) | YES (transitive) |
| 3 | DELETE FROM admin_impersonation_sessions | admin_id IN (SELECT ... AND is_demo=true) | YES (transitive) |
| 4 | DELETE FROM admin_support_notes | admin_id IN (SELECT ... AND is_demo=true) | YES (transitive) |
| 5 | UPDATE schools SET paused_by_super_admin_id=NULL | paused_by_super_admin_id IN (SELECT ... AND is_demo=true) | YES - UPDATE SET NULL, never a DELETE; cannot remove a school |
| 6 | DELETE FROM admin_users | email LIKE v_email_like AND is_demo=true | YES (direct) |
| 7 | DELETE FROM guardian_student_links | guardian_id IN (SELECT id FROM guardians WHERE email LIKE ... AND is_demo=true) | YES (transitive) |
| 8 | DELETE FROM guardians | email LIKE v_email_like AND is_demo=true | YES (direct) |
| 9 | DELETE FROM demo_accounts | email LIKE v_email_like (domain only) | Acceptable - demo_accounts is the demo registry itself (no is_demo column; every row is by definition demo), marker embeds the run-specific cert-run_id_short marker in the certification.alfanumrik.invalid domain. Matches the seed teardown hint and the tenant function posture. |

Every row that is not BOTH cert-domain AND is_demo=true is structurally unreachable. No statement deletes by a broader criterion. The IN (SELECT ... WHERE is_demo=true) subquery guard holds for all four admin child tables and the schools UPDATE. schools.paused_by_super_admin_id is NULLed, not deleted - a possibly-real paused school survives.

### 8-hex format guard - genuinely blocks wildcard injection / over-matching
The anchored 8-lowercase-hex regex guard on p_run_id_short raises 22023 before any DELETE. Percent and underscore LIKE wildcards are outside 0-9a-f so any wildcard input is rejected (fail-closed); NULL and empty rejected; uppercase rejected (case-sensitive operator), safe because the seed emits lowercase (runIdShortOf calls toLowerCase). No wildcard or over-broad marker can reach a LIKE. The marker embeds the exact run id, so no cross-run over-match.

### FK-safe order - verified against the actual schema (not trusted from the header)
Re-derived the complete inbound-FK inventory to admin_users(id) directly from the 00000000000000_baseline_from_prod.sql pg_dump baseline plus all root migrations. Found EXACTLY five, all with NO ON DELETE clause (NO ACTION = blocking): admin_announcements.created_by, admin_audit_log.admin_id, admin_impersonation_sessions.admin_id, admin_support_notes.admin_id (baseline lines 18653/18657/18661/18669) plus schools.paused_by_super_admin_id (migration 20260527000011). No sixth exists. All five are cleared/NULLed BEFORE DELETE FROM admin_users. The header admin_users inventory is complete and accurate.

### schools.paused_by_super_admin_id path - confirmed non-destructive
It is UPDATE schools SET paused_by_super_admin_id = NULL WHERE ..., not a DELETE. It can only null an audit pointer (scoped through the same demo+domain subquery); it cannot delete any school, real or demo.

### Delegation soundness - sound and unchanged
Step 1 loops schools WHERE name LIKE v_school_name_like AND is_demo=true and PERFORM purge_certification_tenant(v_school.id). The delegated function re-checks is_demo IS NOT TRUE and RAISEs 42501 inside its own body, so a mislabeled school hard-fails rather than deletes. purge_certification_tenant and purge_demo_account_by_id in the 20260702180000 migration are byte-for-byte unchanged by this migration (new file only; CREATE OR REPLACE of the run function alone).

### search_path / EXECUTE grants - correct, does not repeat the earlier miss
SET search_path = public is present (line 167). REVOKE EXECUTE FROM public, anon, authenticated plus GRANT EXECUTE TO service_role (lines 315-316). SECURITY DEFINER justified. The prior-session missing-search_path mistake is NOT repeated here.

### Test honesty - confirmed
The 4 new run-scoped tests assert against the migration ACTUAL return shape (success, run_id_short, already_absent, schools_purged, schools_purged_count, guardians_purged, admin_users_purged, demo_accounts_purged, standalone_auth_user_ids) and real table/column names - all cross-checked against the SQL. The double-guard survivors genuinely test both guards:
- Survivor 1 (admin_users, cert domain, is_demo=false) asserted to SURVIVE - fails if the is_demo guard were dropped.
- Survivor 2 (guardians, is_demo=true, NON-cert domain) asserted to SURVIVE - fails if the email LIKE domain guard were dropped.
Auth surfacing asserts exact order [guardianAuthId, demoAdminAuthId] matching v_guardian_auth_ids concat v_admin_auth_ids, and that survivors auth ids are NOT surfaced.

### Seed to LIKE pattern parity - byte-for-byte exact
- Email: seed local-part cert-short-role-nnn in the certification.alfanumrik.invalid domain vs the marker cert-short-wildcard in the same domain - the wildcard covers role-nnn; the dot and at chars are literal in LIKE. Match.
- School: seed name with the bracket-CERTIFICATION prefix then cert-short-school-nnn vs marker cert-short-school-wildcard - the bracket chars are literal in LIKE (no bracket classes). Match.
- CERTIFICATION_EMAIL_DOMAIN, SCHOOL_NAME_PREFIX, runIdShortOf (8 lc hex) align with the function hardcoded literals and format guard. No silent-miss risk.

### Runbook Part 2 - accurate
Step 6 documents the preferred one-call purge_certification_run(run_id_short), the double guard, the 5 blocking FKs (4 deleted + pointer nulled), the standalone_auth_user_ids surfacing (RPC does not delete auth.users), the 8-hex format constraint, and retains the legacy path. Consistent with the migration.

## Code Review
| # | Severity | File:Line | Issue |
|---|----------|-----------|-------|
| 1 | MINOR | 20260702190000_certification_run_teardown.sql:118-122 | The guardians(id) inbound-FK inventory comment lists 4 CASCADE children (guardian_student_links, teacher_parent_threads, dpdp_parental_consent, parent_cheers) as an exhaustive re-derived-same-pass list, but a 5th exists: parent_weekly_reports.guardian_id references guardians(id) ON DELETE CASCADE (migration 20260620000600, line 66). No safety/functional impact - the omitted child is also ON DELETE CASCADE, so DELETE FROM guardians clears it automatically and the header conclusion (all CASCADE, none blocks a guardians delete) stays TRUE. It also has student_id references students(id) ON DELETE CASCADE, so demo-student teardown clears it too. Recommend architect update the enumeration to 5 in a follow-up (owner-only file; not editable by quality). Non-blocking. |

No BLOCKER or MAJOR findings. No new any type, no ts-ignore, no console.log added in reviewed code (seed script console calls are pre-existing, no-console-suppressed, out of this change scope). No product-invariant (P1-P15) violation; this is operator-only certification teardown tooling, not learner/payment/auth runtime. RLS/RBAC boundary preserved (service_role-only, in-body demo guard as a second independent layer beyond the GRANT).

## Verdict
**APPROVE** - automated checks green (type-check, lint). The double guard is unbypassable on every destructive statement against a real table; the 8-hex format guard blocks wildcard/over-match injection; the admin_users 5-FK clear order is FK-safe and independently verified against the baseline schema; schools.paused_by_super_admin_id is a non-destructive SET NULL; delegation is correctly scoped and the delegated function is unchanged; search_path/EXECUTE hardening is present and correct; the seed-to-LIKE patterns match byte-for-byte; and the tests honestly assert the real return shape with guards that fail if either guard is removed.

One MINOR documentation nit (stale guardians CASCADE enumeration, missing parent_weekly_reports) with zero safety impact is recommended as a non-blocking architect follow-up. It does not gate this commit.

Release-record note: the REG-229 integration suite remains UNEXECUTED against a live DB this session (excluded from the default unit lane; needs RUN_INTEGRATION_TESTS=1 + real staging creds + a real seed-to-teardown cycle). Environment Readiness criterion 5 stays structurally-verified / live-execution-pending until that run happens. The code is safe to commit now.
