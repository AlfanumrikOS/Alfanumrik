# 10 - Operational Certification Report

Stage 1 (static/read-only, plus live read-only GitHub API checks where credentials were
available this wave), 2026-07-02.

## Deployment

Two deployment workflows exist and were confirmed present: a production workflow and a staging
workflow. Branch-protection configuration on the main branch was independently confirmed live
via an authenticated read-only API call this wave (not left as an open question): five required
status checks matching real CI job names, strict up-to-date requirement, and admin bypass
disabled.

A second, parallel deployment pipeline targeting a different cloud provider was found to be
currently armed rather than dormant, confirmed via the same live API access: a controlling
repository variable has read true since 2026-06-23, meaning every push to the main branch has
also been deploying to a second environment for over a week. This was found independently by
two separate agents this wave, which is strong corroboration. Neither of the platform's own
constitution documents mentions this second deployment target at all. No evidence was found that
production DNS traffic is currently routed to the second environment - this is an operational
documentation and blind-spot risk, not a confirmed live-traffic incident.

No GitHub deployment environment - including the one used for staging - currently has any
protection or required-reviewer rule configured. Deploys proceed automatically on a green CI
run with no human approval gate anywhere in the pipeline.

## Monitoring, alerting, and logging

An out-of-band pipeline-failure alerting mechanism was independently re-confirmed genuine by
direct file read, not merely cited from the regression catalog. The structured logger was
independently re-confirmed to route all metadata through its redaction function before any log
line is emitted, and error-monitoring configuration was confirmed to source its connection
string from environment configuration in all three runtime contexts, not hardcoded.

## Health checks

The platform's health endpoint was confirmed to check database connectivity, authentication,
edge-function reachability, rate-limiting infrastructure, and payment-provider reachability, and
to always return a success status code regardless of individual sub-check results (by design,
so the endpoint itself never becomes a false single point of failure).

## Backup, restore, and disaster recovery

A schema-reproducibility runbook exists and constitutes a genuine disaster-recovery story for
the database specifically (an idempotent, pg_dump-derived baseline that can rebuild a fresh
environment). A separate backup/restore runbook intended for use during a security incident was
found to contain a factually incorrect claim: it states that a legacy admin-secret
authentication path was removed, when that path is in fact still live and actively consumed by
the codebase today. This is a meaningful defect specifically because the document exists to be
relied upon during an actual incident.

## Secrets management and environment parity

Spot-checks found no violation of the platform's own convention of keeping certain credentials
in edge-function-scoped secrets rather than general environment configuration.

## Feature flags

The flag-evaluation mechanism was independently confirmed to fail closed - defaulting to off or
to its statically-declared safe default - on every unreachable-service or malformed-data path
checked.

## Documentation currency

Beyond the backup/restore inaccuracy above, an admin-operations runbook was found to describe an
eight-tab admin panel when the actual current surface is 62 pages and well over a hundred API
routes - a significant staleness gap for anyone using that document to onboard a new operator.
The regression catalog is undercounted in the constitution by 51 entries, including a same-day
critical security fix that is not reflected anywhere in the narrative document - independently
found by two separate agents this wave.

## Not verified this wave

Whether the database's point-in-time-recovery/backup feature is actively enabled on the
production project could not be confirmed without dashboard access outside this wave's scope.
Roughly 90% of the runbooks directory was not individually read for staleness beyond the two
documents specifically checked above.
