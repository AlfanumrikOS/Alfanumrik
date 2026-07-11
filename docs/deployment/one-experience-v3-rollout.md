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

## Preflight

1. Confirm the approved frontend and flag-seed pull requests target the same
   release window and have independent approval.
2. Confirm CI passes type-check, lint, unit/contract tests, migration lint,
   production build, bundle budget, accessibility automation and Playwright.
3. Verify the production preview route returns 404 from the built artifact.
4. Verify all five rows are disabled with rollout 0 and no stale environment,
   role or institution targeting.
5. Exercise one seeded account per role against the deployment candidate.
6. Confirm rollback ownership and the observation channel before deployment.

## Deploy

1. Apply the reviewed flag-seed migration. Re-read all five rows; do not infer
   success from migration history alone.
2. Deploy the frontend commit with every cohort still disabled.
3. Verify login, legacy navigation and one critical legacy journey per role.
4. Verify the health endpoint, JavaScript error rate, API error rate and Core
   Web Vitals have not regressed.
5. Enable only internal accounts through institution/role targeting or an
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

## Completion and deletion

Delete a legacy role shell only after that role is at 100%, the observation
period is complete, deep-link aliases are verified and no production consumer
remains. Remove compatibility adapters and flags only in a later reviewed
change. `/dev/experience-v3` must never be available in production.
