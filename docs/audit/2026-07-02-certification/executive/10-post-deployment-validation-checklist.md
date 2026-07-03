# Post-Deployment Validation Checklist

Run immediately after any deployment of the certified Release Candidate, before considering the
deployment complete.

1. [ ] Health endpoint returns healthy across all sub-checks (database, auth, edge functions,
       rate limiting, payment provider reachability).
2. [ ] One real (or seeded, if a safe account exists in production for this purpose) login
       succeeds for each of: student, teacher, parent.
3. [ ] One quiz submission completes end-to-end and the score/XP shown matches the expected
       formula for the responses given.
4. [ ] One AI-tutor turn completes and returns a grounded, on-topic response within expected
       latency.
5. [ ] Error-monitoring dashboard shows no new error signature not present before the deploy.
6. [ ] Bundle-size and page-load spot-check on 2-3 high-traffic pages (dashboard, quiz, Foxy).
7. [ ] Payment webhook test event (if a safe test-mode mechanism exists) processes correctly and
       idempotently.
8. [ ] Confirm the deployment did not accidentally trigger the second (AWS) deployment pipeline
       in an unexpected way, given CERT-02's open status - a quick check that only the intended
       target actually changed.
9. [ ] Sign off with timestamp and operator name; file alongside the deployment checklist's own
       record in the program's evidence trail.

If any item fails: do not wait to accumulate more failures - trigger the rollback checklist
immediately once a genuine user-facing regression is confirmed.
