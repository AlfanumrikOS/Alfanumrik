# Alfanumrik One Experience V3 rollout

This runbook applies to the five role flags introduced by the approved
Alfanumrik Frontend Replacement Execution Plan:

- `ff_ui_v3_student`
- `ff_ui_v3_teacher`
- `ff_ui_v3_parent`
- `ff_ui_v3_school_admin`
- `ff_ui_v3_super_admin`

## Deployment invariant

Deploying the frontend must not enable a cohort. Missing rows, disabled rows,
malformed responses and `rollout_percentage = 0` all resolve to the legacy
experience. Cohort resolution is authenticated, server-side, deterministic by
user and shared by navigation and route access.

The database seed and frontend are reviewed separately. Apply the flag seed
first with every row disabled and at 0%, verify the rows, then deploy the web
build. Do not combine a frontend deploy with a cohort increase.

Current release status (12 July 2026): PR #1254 deployed the five rows at OFF/0
and PR #1257 deployed the additive selected-school overloads at exact production
SHA `6d57f4fa8a1b5b48779f8854c6782eebb8b8c890`; both terminal production gates
passed. The operator later reported the five switches ON, but the current UI
does not change `rollout_percentage`, so an ON/0 row still resolves to legacy.
PR #1256 and any non-zero activation remain separate releases.

## Schema compatibility sequence

This release may apply only the additive selected-school roster migration. It
adds the `p_school_id` RPC overloads and their grants without replacing,
revoking or commenting any legacy function signature. The safe sequence is:

1. Dry-run the additive migration on an isolated Supabase stack.
2. Apply it and verify both the new overloads and every existing unscoped RPC.
3. Deploy the frontend callers that send the authorized `p_school_id`.
4. Observe multi-school and rollback journeys.
5. Harden legacy wrappers only in a later reviewed migration after production
   has no old callers and rollback no longer depends on those signatures.

The teacher remediation duplicate cleanup and all-open unique index are
explicitly deferred. Before a later release, deploy the route compatibility
first, capture the affected row IDs, measure lock/index duration against
production-scale data, define bounded timeouts and prove row-level recovery.
It must not be bundled into this frontend deployment.

## Preflight

1. Confirm PRs #1254 and #1257 remain present in the frontend branch baseline
   and their exact-SHA production completion gates succeeded.
2. Confirm CI passes type-check, lint, unit/contract tests, migration lint,
   production build, bundle budget, accessibility automation and Playwright.
3. Verify the production preview route returns 404 from the built artifact.
4. Re-read all five rows and require rollout 0 before the frontend merge; do not
   treat an ON switch at 0% as an enabled cohort.
5. Verify the deployed selected-school migration remains strictly additive and
   that the
   deferred teacher data/index migration is absent from the release diff.
6. Exercise one seeded account per role against the deployment candidate.
7. Confirm rollback ownership and the observation channel before deployment.

## Deploy

1. Completed: PR #1254 applied the reviewed flag-seed migration at OFF/0 and
   passed exact-SHA production verification.
2. Completed: PR #1257 applied the additive selected-school overloads after an
   isolated PG17 behavioral gate and passed exact-SHA production verification.
3. Deploy the frontend commit with every cohort still at effective rollout 0.
4. Verify login, legacy navigation and one critical legacy journey per role.
5. Verify the health endpoint, JavaScript error rate, API error rate and Core
   Web Vitals have not regressed.
6. Enable only internal accounts through institution/role targeting or an
   explicitly approved internal cohort.

## Cohort progression

Progress each role independently:

1. Seeded QA and developers
2. Internal Alfanumrik team
3. One friendly pilot school, where applicable
4. 5%
5. 25%
6. 50%
7. 100%

Keep assignment sticky. At every step compare JavaScript errors, failed
navigation, capability 403/404 responses, task completion, scope changes,
support contacts, learning starts and role-specific actions against legacy.

## Stop conditions

Stop progression and roll back the affected role if any of these occur:

- authentication, authorization or tenant-isolation regression;
- data shown under the wrong child, class, school, year or institution;
- missing or duplicate persistent navigation;
- a primary destination is shown but denied by the same capability contract;
- critical accessibility or browser failure;
- material error-rate, Web Vital or task-completion regression.

## Rollback

Set the affected role flag to disabled and rollout 0 through the governed flag
mutation path. This is the primary rollback and does not require a deployment.
Verify a previously assigned user returns to legacy after a new navigation or
session refresh, then monitor errors until baseline is restored.

If the frontend itself regresses while all flags are disabled, roll back the
web deployment using the normal production deployment mechanism. Do not delete
the V3 rows during an incident; keeping them disabled preserves a clear audit
trail and prevents accidental default-on behavior.

The additive selected-school overloads may remain after a frontend rollback:
the prior application continues using legacy signatures because this release
does not replace or revoke them. Any future legacy-wrapper hardening or teacher
data/index migration requires its own database recovery and app-compatibility
rollback; it is not covered by the frontend flag rollback above.

## Completion and deletion

Delete a legacy role shell only after that role is at 100%, the observation
period is complete, deep-link aliases are verified and no production consumer
remains. Remove compatibility adapters and flags only in a later reviewed
change. `/dev/experience-v3` must never be available in production.
