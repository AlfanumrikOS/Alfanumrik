# Deployment Checklist

For deploying the Release Candidate (commit 15742a1c and any subsequent Board-approved fixes)
once the Executive Release Board issues a decision. Not for use until that decision exists.

1. [ ] Confirm the Executive Release Board decision is APPROVED or APPROVED WITH CONDITIONS, and
       list every condition here verbatim before proceeding.
2. [ ] Confirm the exact commit being deployed matches what the Board certified - re-diff against
       the Release Candidate baseline if any commit has landed since.
3. [ ] Confirm CERT-17 evidence is on file (who verified it, when, what was found/corrected).
4. [ ] Confirm the deployment approval gate (CERT-03 resolution, if closed) has an actual human
       reviewer assigned for this specific deployment, or explicitly note it's proceeding without
       one if that gap remains open at deploy time.
5. [ ] Run the full automated suite one more time immediately before deploying (type-check, lint,
       test, build, bundle-size) - do not trust a prior run if any time has passed.
6. [ ] Confirm the rollback checklist (this folder) is printed/open and the on-call engineer has
       reviewed it before the deploy begins.
7. [ ] Deploy.
8. [ ] Immediately proceed to the post-deployment validation checklist - do not consider the
       deployment complete until that checklist passes.
9. [ ] Record the deployment (commit, timestamp, operator, Board decision reference) in the
       program's evidence trail.

## Explicit non-goals of this checklist

This checklist does not replace the existing CI/CD pipeline's own automated gates - it is the
human-facing companion checklist for the specific, one-time certified release, not a permanent
substitute for the pipeline.
