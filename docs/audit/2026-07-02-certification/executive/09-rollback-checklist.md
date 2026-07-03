# Rollback Checklist

For rolling back a deployment of the certified Release Candidate if a post-deployment problem is
found. This is distinct from docs/runbooks/certification-rollback-procedure.md, which covers
rolling back a certification *test run* (seeded tenant cleanup), not a production deployment.

1. [ ] Confirm the problem is deployment-related, not a pre-existing issue that happened to
       surface after this deploy (check error timestamps against the deploy timestamp).
2. [ ] Use the hosting platform's own instant-rollback capability to the immediately-prior
       production deployment - this is faster and safer than a git revert + redeploy cycle for
       application-layer issues.
3. [ ] If the problem is migration-related (a schema change that can't be rolled back by
       reverting the application alone): do NOT attempt an automatic down-migration. Postgres
       migrations in this codebase are additive/forward-only by convention - escalate to
       architect for a manually-reasoned forward fix rather than attempting a schema rollback.
4. [ ] Confirm via the health endpoint and a manual smoke check (login, one quiz submission) that
       the rolled-back state is genuinely healthy, not just "deployed."
5. [ ] Notify stakeholders per the existing incident-communication convention.
6. [ ] Record the rollback (reason, timestamp, operator) in the program's evidence trail, and
       open a follow-up item to fix the root cause before attempting to redeploy.

## Decision authority

Any engineer with deploy access may initiate an emergency rollback without waiting for approval
if there is active user-facing harm. Approval is required only to *redeploy* after a rollback,
not to execute the rollback itself.
