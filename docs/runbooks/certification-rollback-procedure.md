# Certification Rollback / Incident-Response Procedure

**Date:** 2026-07-02
**Owner:** ops (this runbook, teardown wrapper, operational procedure) · architect (owns escalation for any FK/database gap the teardown migration didn't anticipate)
**Status:** Written and ready. Not yet executed against any live target — see "Preparation-only notice" below.
**See also:** `docs/audit/2026-07-02-certification/release-candidate/RC-2026-07-02-baseline.md` (the frozen state this procedure is scoped against) · `docs/runbooks/certification-traffic-traceability.md` (the four-signal traceability convention) · `docs/runbooks/2026-07-02-environment-readiness-remediation.md` (the remediation wave that produced the teardown migration) · `scripts/seed-certification-accounts.ts` (creates the tenant this procedure tears down) · `scripts/teardown-certification-tenant.ts` (the wrapper this procedure invokes) · `supabase/migrations/20260702180000_certification_tenant_teardown.sql` (the `purge_certification_tenant` function itself) · `src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` (REG-229, the integration test whose leak-check query this runbook's operator verification query is copied from)

## Preparation-only notice

This runbook describes a procedure. It does not authorize running it. As of the RC baseline (2026-07-02), CERT-17 is an open release blocker (unconfirmed whether the deployed staging site's environment variables actually point at the staging Supabase project rather than production) and browser-driven certification traffic remains paused pending human verification with Vercel dashboard access. Do not invoke `scripts/teardown-certification-tenant.ts` against any live target until:
1. CERT-17 is closed and the RC baseline addendum records how, and
2. an operator has deliberately decided a specific certification tenant needs tearing down (either as planned end-of-run cleanup, or in response to one of the incident triggers below).

## Part 1 — How to detect a certification run has gone wrong

Watch for any of these signals during or after a certification run:

| Signal | What it looks like | Severity |
|---|---|---|
| Seed script partially completed and errored | `npx tsx scripts/seed-certification-accounts.ts` exits non-zero mid-run (its `main().catch()` prints `Fatal error: ...` and exits 1). Some mission roles may have been created (find-or-create is idempotent per-account, so partial completion is safe to re-run, not corrupt) but the operator does not have a complete `SeedResult` printout to record the school id / run id. | Low — the script's own idempotency means re-running with the same `--run-id` completes the rest without duplicating anything already created. |
| Teardown script fails | `npx tsx scripts/teardown-certification-tenant.ts <school_id>` exits non-zero. See Part 3 for what to do next — the exact failure mode determines whether this is routine or an escalation. | Medium — see Part 3 for how to classify. |
| Evidence suggests certification traffic touched something outside the intended tenant | A quiz/chat/AI-tutor event, a Sentry error, or a support ticket references a student/school id that does NOT match the `cert-<run_id_short>-*` naming convention or does not carry `is_demo = true`, but is suspected to have originated from certification testing (e.g., a tester manually created an account outside the seeding script, or a bug in the seeding script wrote to the wrong row). | High — this is the worst case. Go straight to Part 4 ("if in doubt, stop"). |
| `purge_certification_tenant`'s own guard fires unexpectedly | The RPC (or the wrapper script) raises `ERRCODE 42501` / "refusing to tear down school ... is_demo is not true" against a school id the operator BELIEVES is a certification tenant. | Medium-High — do not override this guard. It means either (a) the operator has the wrong school id, or (b) the school's `is_demo` flag was never set correctly at seed time (a seeding-script traceability bug, not a teardown bug). Re-verify the school id against the seed script's printed `school_id` before doing anything else. Never attempt to manually flip `is_demo = true` on a school to "fix" this without first confirming, independently, that the school is genuinely synthetic (see Part 4). |

## Part 2 — Step by step: invoking the teardown wrapper

1. Locate the target `school_id`. The seed script prints it at the end of a run (`school: <name> (id=<school_id>)`) — use that saved value, not a guess. If it wasn't saved, query by the run marker: `SELECT id, name FROM schools WHERE name LIKE '[CERTIFICATION] cert-<run_id_short>-%';` (per `certification-traffic-traceability.md`'s query patterns).

2. Run a dry run first, always:
   ```bash
   npx tsx scripts/teardown-certification-tenant.ts <school_id> --dry-run
   ```
   Confirm the printed output shows:
   - `Configured target project ref: <ref>` — MUST NOT be `shktyoxqhundlvkiwguu` (the known production ref). The script fails closed before this point if it is; if you see anything about a "known prod ref" match, STOP — see Part 4.
   - `[dry-run] is_demo: true` — if this instead reads `false` or `null`, DO NOT proceed to the real run. The wrapper's own guard will refuse the real call too, but do not attempt to bypass it. See Part 1's "guard fires unexpectedly" row.
   - `[dry-run] Would call: SELECT purge_certification_tenant('<school_id>');`

3. If the dry run looks correct, run it for real:
   ```bash
   npx tsx scripts/teardown-certification-tenant.ts <school_id>
   ```

4. Read the printed JSON result carefully:
   - **Success, first teardown:** `{"success": true, "already_absent": false, "school_id": "...", "registry_accounts_purged": N, "students_purged_direct": N, "teachers_purged_direct": N}`. This is the expected happy path.
   - **Success, idempotent re-run:** `{"success": true, "already_absent": true, "school_id": "..."}`. This means the tenant was already gone (a prior teardown succeeded, or the school id never existed). Safe — not an error.
   - **Non-zero exit, error message printed to stderr:** this is a FAILURE. Go to Part 3.

5. After any successful run (either shape above), run the verification query in Part 5 to confirm zero residual rows before considering the tenant fully torn down.

6. **Standalone accounts are NOT covered by this teardown.** `purge_certification_tenant` (and therefore the wrapper) only tears down the school-scoped tenant — student, teacher, school_admin rows, the school itself, and its non-cascading child tables. The parent (guardian), super_admin, content_author, and support_staff accounts the seed script also creates are never school-scoped and must be cleaned up separately. The seed script prints the exact 3 `DELETE` statements needed for these at the end of a run (`printSummary()`'s "Standalone accounts NOT covered by purge_certification_tenant" section) — run those manually via the Supabase SQL editor or an equivalent service-role SQL session, and include their row counts in the Part 5 verification.

## Part 3 — Teardown itself fails: what to do

First, distinguish between the two failure shapes the wrapper can produce:

### 3a. Refused by the wrapper's own guard (client-side, before the RPC was ever called)

Error text starts with "Refusing to tear down school ... — is_demo is not true" or a fail-closed message about the production project ref, a malformed UUID, or missing env vars. **This is the wrapper working correctly, not a bug.** Do not bypass it. Re-check:
- Is `<school_id>` actually the certification tenant's id, or a copy-paste error?
- Does `NEXT_PUBLIC_SUPABASE_URL` actually point at staging (not production, and not an unrelated project)?
- If the school genuinely should be a certification tenant but `is_demo` is `false`/`null`: this is a seeding-script traceability bug (the seed script is supposed to set `is_demo = true` unconditionally on every base-table row it creates — see `certification-traffic-traceability.md` signal 2). Do not manually flip the flag as a workaround. Escalate to architect (who owns the migration + the demo-marking convention) with the school id and the seed run's printed output.

### 3b. A genuinely new gap — the RPC itself raised a database error (foreign-key violation or otherwise)

This is different from 3a: the wrapper's own `is_demo` check passed, the RPC was called, and the RPC itself failed (a Postgres error surfaced through `sb.rpc(...)`, e.g. a `23503` foreign-key violation, or any error code other than `42501`). **This means the migration's own FK inventory missed a table** — genuinely new information, not something covered by the "CHECKED AND CONFIRMED SAFE" section or the "Corrected FK inventory" section of `supabase/migrations/20260702180000_certification_tenant_teardown.sql`.

**Escalate to architect immediately.** Architect owns the migration and the FK inventory. Do not attempt to work around a partial teardown by manually deleting rows out of order — a `NO ACTION`/`RESTRICT` FK failure means the whole RPC call rolled back as a single transaction (Postgres function bodies are transactional), so nothing was partially deleted; the tenant is in the exact same state it was before the failed call. This is a safe state to leave it in while escalating.

**Before escalating, capture:**
1. The exact error message and error code (the wrapper's error text includes both: `purge_certification_tenant RPC failed for <school_id>: <message> (code <code>)`).
2. The `school_id` that failed.
3. A fresh row count against **every table the migration's own header documents as in-scope** — this tells architect exactly where the FK chain broke and confirms the transaction really did roll back cleanly (all counts should still equal their pre-teardown values, not partial). Run this against the failed school_id:
   ```sql
   SELECT 'students' AS tbl, count(*) FROM students WHERE school_id = '<school_id>'
   UNION ALL SELECT 'teachers', count(*) FROM teachers WHERE school_id = '<school_id>'
   UNION ALL SELECT 'demo_accounts', count(*) FROM demo_accounts WHERE school_id = '<school_id>'
   UNION ALL SELECT 'school_alert_rules', count(*) FROM school_alert_rules WHERE school_id = '<school_id>'
   UNION ALL SELECT 'school_audit_log', count(*) FROM school_audit_log WHERE school_id = '<school_id>'
   UNION ALL SELECT 'school_invoices', count(*) FROM school_invoices WHERE school_id = '<school_id>'
   UNION ALL SELECT 'school_seat_usage', count(*) FROM school_seat_usage WHERE school_id = '<school_id>'
   UNION ALL SELECT 'payment_reconciliation_queue', count(*) FROM payment_reconciliation_queue WHERE school_id = '<school_id>'
   UNION ALL SELECT 'school_contracts', count(*) FROM school_contracts WHERE school_id = '<school_id>'
   UNION ALL SELECT 'foxy_chat_messages', count(*) FROM foxy_chat_messages WHERE student_id IN (SELECT id FROM students WHERE school_id = '<school_id>')
   UNION ALL SELECT 'foxy_sessions', count(*) FROM foxy_sessions WHERE student_id IN (SELECT id FROM students WHERE school_id = '<school_id>')
   UNION ALL SELECT 'ai_workflow_traces', count(*) FROM ai_workflow_traces WHERE student_id IN (SELECT id FROM students WHERE school_id = '<school_id>')
   UNION ALL SELECT 'admin_impersonation_sessions', count(*) FROM admin_impersonation_sessions WHERE student_id IN (SELECT id FROM students WHERE school_id = '<school_id>')
   UNION ALL SELECT 'schools', count(*) FROM schools WHERE id = '<school_id>';
   ```
   This covers all 7 items in the migration's "Corrected FK inventory" section plus the school row itself — exactly the set architect will need to diagnose which DELETE statement in the function body 23503'd.
4. Whether this was the FIRST call against this school_id, or a retry after a prior failure — architect will want to know if the same table failed both times (a real, reproducible gap) or a different one (possibly a race with concurrent seeding).

Hand all four items to architect as a single incident report. Do not re-attempt the teardown yourself with modified SQL — the fix belongs in the migration (`purge_certification_tenant`'s body), not in an ad hoc workaround, so the fix is durable for the next certification run too.

## Part 4 — If in doubt, stop

Production and staging are different Supabase projects, in different organizations, reachable via different credentials. For a certification run to accidentally affect production, **every one of these independent fail-closed guards would have to fail simultaneously**:
1. The teardown wrapper's own production-ref check (`scripts/teardown-certification-tenant.ts` — refuses if `NEXT_PUBLIC_SUPABASE_URL` resolves to `shktyoxqhundlvkiwguu`, or if the ref can't be parsed at all).
2. The seed script's environment — it uses whatever Supabase project URL and service-role key the operator's shell has configured; an operator would have to be actively and mistakenly pointed at production credentials for this to matter (the same risk every script in `scripts/` that touches Supabase already carries).
3. The existing staging GitHub Actions workflows' own fail-closed walls (`staging-flag-set.yml`, `staging-adaptive-drill.yml`) — both independently assert the connected project ref is not the known production ref, at multiple points (the configured secret, the CLI-linked ref, and the ref embedded in the CLI-derived pooler connection string), before any DB write.
4. `purge_certification_tenant`'s own in-body guard (`IF v_school.is_demo IS NOT TRUE THEN RAISE EXCEPTION ...`) — this is a second, independent layer inside the database function itself, not just at the call site. Even a caller with full service-role access who points the RPC at a real school id gets a hard exception, not a deletion.

State this plainly, without either alarm or complacency: the actual risk of a certification run touching production is low, because it requires multiple independent, differently-implemented guards to all fail at once — not a single point of failure. This is not a reason to skip the checks in Parts 1-3; it is the reason those checks exist and why this runbook insists on `--dry-run` first, on treating any guard refusal as a stop signal rather than an obstacle, and on escalating genuinely new database gaps to architect instead of working around them.

**If you are ever uncertain whether something you're looking at is real user/school data or certification test data — stop and verify with the traceability signals in `certification-traffic-traceability.md` (email domain, `is_demo`, name marker, `demo_accounts` registry row) before taking any destructive action.** A wrong guess in the direction of "assume it's synthetic" is the dangerous one; a wrong guess in the direction of "assume it's real and pause" costs a delay, nothing more.

## Part 5 — Verifying teardown actually succeeded (zero residual rows)

This is the same leak-check pattern `src/__tests__/migrations/certification-tenant-teardown-e2e.test.ts` (REG-229) uses internally to assert the RPC left zero rows behind, reused here as a documented, directly-runnable operator query (do not invent a different shape — this one is pinned by that regression test):

```sql
-- Run against the SAME school_id just torn down. Every row MUST be 0.
SELECT
  (SELECT count(*) FROM students      WHERE school_id = '<school_id>') AS students,
  (SELECT count(*) FROM teachers      WHERE school_id = '<school_id>') AS teachers,
  (SELECT count(*) FROM school_alert_rules          WHERE school_id = '<school_id>') AS school_alert_rules,
  (SELECT count(*) FROM school_audit_log            WHERE school_id = '<school_id>') AS school_audit_log,
  (SELECT count(*) FROM school_invoices             WHERE school_id = '<school_id>') AS school_invoices,
  (SELECT count(*) FROM school_seat_usage           WHERE school_id = '<school_id>') AS school_seat_usage,
  (SELECT count(*) FROM payment_reconciliation_queue WHERE school_id = '<school_id>') AS payment_reconciliation_queue,
  (SELECT count(*) FROM school_contracts            WHERE school_id = '<school_id>') AS school_contracts,
  (SELECT count(*) FROM demo_accounts               WHERE school_id = '<school_id>') AS demo_accounts,
  (SELECT count(*) FROM schools WHERE id = '<school_id>') AS schools_row_itself;
```

For the 4 per-student RESTRICT/no-cascade child tables, which are keyed by `student_id` rather than `school_id` (so they can't be checked after the `students` row itself is gone unless you captured student ids beforehand — capture them BEFORE running the real teardown if you want this level of verification):

```sql
-- Capture student ids BEFORE teardown:
SELECT id FROM students WHERE school_id = '<school_id>';

-- After teardown, for each captured student id:
SELECT
  (SELECT count(*) FROM foxy_chat_messages           WHERE student_id = '<student_id>') AS foxy_chat_messages,
  (SELECT count(*) FROM foxy_sessions                WHERE student_id = '<student_id>') AS foxy_sessions,
  (SELECT count(*) FROM ai_workflow_traces           WHERE student_id = '<student_id>') AS ai_workflow_traces,
  (SELECT count(*) FROM admin_impersonation_sessions WHERE student_id = '<student_id>') AS admin_impersonation_sessions;
```

**Every count in both queries MUST be 0** after a successful teardown. If any is non-zero:
- If the `purge_certification_tenant` call itself reported `success: true` (not `already_absent`) and a residual row shows up here anyway, this is a genuine regression in the migration — escalate to architect using the Part 3b procedure (the RPC claimed success but left something behind, which the RPC's own zero-row guarantee should prevent; this is worth escalating even though the call didn't error, because it means the claimed postcondition is false).
- If you are verifying against a school that already had `already_absent: true` from a PRIOR run, and now shows non-zero counts, someone or something re-created rows under that school_id after the prior teardown (e.g., a second seed run reused the id, which shouldn't happen since seeding always creates a fresh school unless `--run-id` was deliberately reused) — investigate before assuming it's a teardown bug.

Also run the coarse cross-role sweep from `certification-traffic-traceability.md` (covers non-school-scoped standalone accounts too) as a final belt-and-suspenders check for the whole run, not just this one school:

```sql
SELECT
  (SELECT count(*) FROM students      WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM teachers      WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM guardians     WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM school_admins WHERE email LIKE '%@certification.alfanumrik.invalid')
+ (SELECT count(*) FROM schools       WHERE name LIKE '[CERTIFICATION]%')
+ (SELECT count(*) FROM demo_accounts WHERE email LIKE '%@certification.alfanumrik.invalid')
  AS remaining_certification_rows;
-- MUST be 0 after full cleanup (school-scoped teardown + the 3 standalone-account DELETEs
-- from Part 2 step 6) completes. Non-zero = manual cleanup required.
```

## Part 6 — Known limitations (carried over from the environment-readiness re-verification)

- The integration test (`certification-tenant-teardown-e2e.test.ts`, REG-229) that behaviorally proves the RPC's guard/idempotency/zero-row claims has never executed against a live database as of the RC baseline — it self-skips without `RUN_INTEGRATION_TESTS=1` and real Supabase credentials. Treat the RPC's correctness as "structurally verified by two independent code-trace reviews, not yet proven by an executed test run" until that changes.
- `scripts/teardown-certification-tenant.ts` is likewise unexecuted this session — written and structurally reviewed only. The first real invocation of either the seed script's teardown hints or this wrapper against live staging should be treated as the first real-world test of this entire procedure, and any deviation from what this runbook describes should be captured and fed back into this document.
