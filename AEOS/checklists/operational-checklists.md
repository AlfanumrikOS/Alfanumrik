# Operational Checklists

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Playbook / Checklist
**Priority:** Critical
**Applies To:** Every deployment, release sign-off, incident, security review, disaster-recovery drill, on-call handoff, and live MCP operation performed by Claude Code and human operators on the Alfanumrik platform.

---

# Purpose

The AEOS core documents define the principles of safe operation. This document makes those principles copy-ready. Each checklist below is a consolidated, grounded set of items an operator can paste into a runbook, a pull request, an incident channel, or a sign-off record and work through line by line.

A checklist is not a substitute for understanding the core document behind it; it is the executable surface of that document. Each item is fail-closed: an item that is not satisfied — or whose evidence cannot be produced — counts as not done, never as done. Where a checklist and a core document or product invariant appear to differ, the higher authority prevails.

How to use: copy the relevant checklist, replace each `- [ ]` with a checked box only when the item is satisfied by reproducible evidence, and attach the evidence to the record. An unchecked item blocks the operation it gates.

---

# Pre-Deploy Checklist

Grounded in document 20 (Deployment Pipeline) and document 08 (Testing Protocol). Confirm every item before promoting to production.

- [ ] The artifact is built from a known commit and is immutable across environments (built once, promoted, never rebuilt per environment).
- [ ] Secret scan passed: no credentials, keys, or tokens appear in the change.
- [ ] Type check passed with exit zero.
- [ ] Lint passed with exit zero; no disallowed log statements in production code.
- [ ] Unit and integration tests passed; results recorded, not assumed.
- [ ] Regression coverage exists for every product-invariant area the change touches (confirmed to exist, never assumed).
- [ ] Build produced the artifact and honored all size and bundle budgets.
- [ ] Critical-path end-to-end checks passed.
- [ ] Staging verification ran against production-like configuration and passed.
- [ ] All required configuration is externalized and validated at startup; the same artifact runs in every environment with only config differing.
- [ ] No secret appears in source or in any client-shipped artifact; least privilege confirmed; no service-role credential on a client surface.
- [ ] Database migrations are ordered, idempotent, and backward-compatible (or carry an approved compensating plan).
- [ ] Health checks (liveness, readiness, dependency) are implemented and observed passing.
- [ ] A progressive rollout strategy with explicit promote and abort criteria is defined where the platform supports it.
- [ ] A fast, rehearsed rollback path to the last known-good state exists.
- [ ] Human release authorization is in place per document 21.
- [ ] Deployment evidence will be recorded and classified honestly (verified / observed / unverified).

If any item fails, the deployment is not ready. Do not promote.

---

# Post-Deploy Verification Checklist

Grounded in document 20 (Phase 4) and document 10 (Verification Engine). A deployment is incomplete until it is observed serving correct behavior.

- [ ] The running target environment was observed directly, not assumed.
- [ ] Liveness health check passes (the process is up and responsive).
- [ ] Readiness health check passes (dependencies reachable, migrations applied, configuration valid).
- [ ] Dependency health confirmed (database, cache, external providers reachable).
- [ ] Smoke tests passed on the deployed environment.
- [ ] Critical-path end-to-end checks passed against the live environment.
- [ ] Error rate is within expected bounds for the observation window, compared to the pre-deploy baseline.
- [ ] Latency and saturation are within expected bounds.
- [ ] Applied migrations completed with the expected result.
- [ ] The exact commit and immutable artifact identifier serving traffic is confirmed and recorded.
- [ ] Monitoring and alerting are reporting correctly for the new version.
- [ ] If any abort criterion is breached, rollback was executed and recorded.
- [ ] Deployment evidence is recorded and classified (verified / observed / unverified).

If post-deploy verification fails, exercise the rollback path without hesitation and capture the failure as a defect.

---

# Release Sign-Off Checklist

Grounded in document 21 (Release Management) and document 27 (QA Sign-Off). A release may not be tagged or published until every applicable gate passes.

- [ ] The version number is correct for the change type (major / minor / patch / hotfix).
- [ ] The release branch isolates the version; scope is frozen at sign-off.
- [ ] Verification gate: all pipeline quality gates green with recorded evidence.
- [ ] Regression gate: regression coverage exists and passes for every product-invariant area touched.
- [ ] Documentation gate: changelog updated, release notes written for reader impact, migration notes prepared where needed, ADRs filed for architectural or breaking changes.
- [ ] Compatibility gate: backward compatibility confirmed for minor/patch, or an approved migration and deprecation plan exists for major.
- [ ] Risky or invariant-adjacent behavior ships behind a default-off, reversible feature flag.
- [ ] Approval gate: the named approver has signed off; invariant-affecting changes carry explicit human approval.
- [ ] Rollback gate: a fast, rehearsed rollback path exists (artifact and/or flag toggle).
- [ ] No critical or major defect remains open.
- [ ] The release will be tagged at the exact released commit after gates pass; the tag is immutable.
- [ ] A post-release observation window with promote and abort criteria is defined.
- [ ] The sign-off record is complete: who, what, evidence, outstanding issues, and date.

If any item fails, the release is not ready. Do not tag.

---

# Incident Response Checklist

Grounded in document 22 (Debugging Protocol) and document 23 (Root Cause Analysis). Reproduce and locate before fixing; mitigate without destroying evidence.

- [ ] The incident is declared with a clear severity and a single owner.
- [ ] The observed symptom and the expected behavior are stated precisely.
- [ ] Evidence is preserved before any mitigation (logs, traces, request IDs, metrics, failing state).
- [ ] No personally identifiable information is exposed or logged during investigation.
- [ ] Production inspection is read-only first; no production data is altered without approval.
- [ ] Immediate mitigation (if any) is distinguished from the eventual root-cause fix.
- [ ] The defect is reproduced reliably, or the inability to reproduce is stated explicitly.
- [ ] The fault is isolated and a specific, testable hypothesis is formed.
- [ ] The hypothesis is confirmed with evidence before any fix is applied.
- [ ] The smallest correct fix addresses the root cause, not the symptom.
- [ ] The original reproduction now passes and no new errors appear.
- [ ] A regression test is added that fails without the fix and passes with it.
- [ ] Existing tests and regression suites still pass.
- [ ] The incident, root cause, fix, and follow-up risks are documented.
- [ ] A formal Root Cause Analysis is raised where impact, recurrence, or risk warrants it.

A defect is not resolved until it was reproduced, located by evidence, fixed at the cause, and guarded by a regression test.

---

# Security Review Checklist

Grounded in document 09 (Security Protocol) and document 27 (QA Sign-Off). A security regression is an absolute release blocker.

- [ ] Authentication is verified on every protected surface.
- [ ] Authorization is enforced server-side; client checks are convenience, not the security boundary.
- [ ] Least privilege is confirmed for every credential, role, and token involved.
- [ ] Input validation is present and rejects malformed or hostile input.
- [ ] No secret appears in source, logs, client-shipped config, or generated documentation.
- [ ] Service-role and admin credentials remain server-only and never reach a client surface.
- [ ] Data-exposure protections hold: no personally identifiable information leaks to logs, monitoring, or unauthorized roles.
- [ ] Row-level security (or equivalent boundary) is enabled and policy-covered for every affected data object.
- [ ] No new vulnerability is introduced; dependency and configuration risks are reviewed.
- [ ] Webhook and inbound-event signatures are verified before processing.
- [ ] Audit logging captures security-relevant state changes with who and when, without exposing secret values.
- [ ] Every applicable product invariant for security and privacy is preserved.

If any item fails, the security review is not cleared.

---

# Disaster-Recovery Drill Checklist

Grounded in document 20 (rollback and environments) and document 23 (Root Cause Analysis). A recovery path that has never been exercised is a hypothesis, not a plan.

- [ ] The drill scope, target recovery objective, and a single owner are defined before starting.
- [ ] The drill runs against a non-production or isolated environment unless an authorized live exercise is explicitly approved.
- [ ] The most recent backup is located and its existence and integrity are confirmed.
- [ ] Restore-from-backup is executed and the restored state is verified against expectations.
- [ ] The rollback path to the last known-good artifact is exercised, not merely described.
- [ ] Schema recovery respects backward compatibility; no destructive change is applied in panic.
- [ ] Health checks (liveness, readiness, dependency) pass on the recovered environment.
- [ ] Critical user journeys are verified on the recovered environment.
- [ ] The measured recovery time is recorded and compared against the target objective.
- [ ] Gaps, surprises, and configuration drift discovered during the drill are recorded as defects.
- [ ] The drill outcome, evidence, and follow-up actions are documented.

A drill that does not produce evidence of a successful recovery has not validated the recovery plan.

---

# On-Call Handoff Checklist

Grounded in document 22 (Debugging Protocol) and document 23 (Root Cause Analysis). A handoff transfers full context, not just a pager.

- [ ] The current system health is summarized with evidence (error rate, latency, saturation versus baseline).
- [ ] All open incidents are listed with severity, owner, and current status.
- [ ] Any active mitigation, feature-flag state, or temporary measure in effect is described, with its intended duration.
- [ ] Recent deployments and releases within the window are listed with their commit and artifact identifiers.
- [ ] Known fragile areas and watch items for the shift are flagged.
- [ ] Scheduled changes, maintenance, or drills during the upcoming shift are noted.
- [ ] Access to logs, traces, monitoring, dashboards, and runbooks is confirmed for the incoming operator.
- [ ] Escalation contacts and approval paths for destructive or production-affecting actions are confirmed.
- [ ] Outstanding follow-ups and pending Root Cause Analyses are transferred.
- [ ] The outgoing and incoming operators are both named in the handoff record, with date and time.

An incomplete handoff leaves a gap that the next incident will find.

---

# MCP Operation Checklist

Grounded in document 16 (MCP Configuration) and document 10 (Verification Engine). Every MCP-mediated operation against a live system follows this loop.

- [ ] The target environment, account, and region (where applicable) are confirmed, not assumed.
- [ ] The current state of the target object was observed before any change (read before write).
- [ ] The intended change is the smallest change that achieves the goal (minimum change).
- [ ] The operation is classified as read-only, reversible-write, or destructive, and its blast radius is identified.
- [ ] A dry run, plan preview, or diff was reviewed where the server supports it.
- [ ] The operation is idempotent, or a precondition guard makes repeated execution safe.
- [ ] Any destructive operation has explicit human confirmation recorded.
- [ ] No secret is printed, logged, embedded, or summarized verbatim during the operation.
- [ ] The change was executed as planned, with no unrelated edits riding along.
- [ ] The result was verified by re-observing the system, not by assuming the command succeeded.
- [ ] Evidence (API response, CLI output, resource status, logs, health check, screenshot) was collected.
- [ ] A rollback path for the change is known and recorded.
- [ ] The report classifies every claim as verified, observed, inferred, or unknown.

If MCP access, a credential, or a permission is unavailable, state this explicitly and never claim execution occurred.

---

# References

- `08_TESTING_PROTOCOL.md` — The testing and regression discipline behind the verification items in the pre-deploy and release checklists.
- `09_SECURITY_PROTOCOL.md` — Least privilege, secret handling, and the data-exposure protections the security-review checklist enforces.
- `10_VERIFICATION_ENGINE.md` — The evidence-over-confidence model that makes every checklist item fail-closed.
- `20_DEPLOYMENT_PIPELINE.md` — The deployment flow, gates, health checks, and rollback mechanics behind the deploy and DR checklists.
- `21_RELEASE_MANAGEMENT.md` — The versioning, sign-off gates, and feature-flag discipline behind the release sign-off checklist.
- `22_DEBUGGING_PROTOCOL.md` — The reproduce-first investigation loop behind the incident-response and on-call handoff checklists.
- `23_ROOT_CAUSE_ANALYSIS.md` — The escalation and prevention discipline that closes incidents and DR drills.
- `27_QA_SIGNOFF.md` — The final quality decision the release sign-off and security checklists aggregate.
- `AEOS/playbooks/mcp-playbooks.md` — The per-server operational playbooks the MCP operation checklist condenses.
- `AEOS/docs/extensions/` — Provider-specific mechanics (regions, timeouts, dashboard and CLI controls, secret stores) referenced by the deploy, DR, and MCP checklists.

---

# Final Directive

A checklist is a promise that nothing essential was skipped under pressure. Work every item. Check a box only when evidence — not confidence — allows it. Treat an unchecked item as a closed gate, because that is exactly what it is.

When schedule pressure and a checklist item conflict, the item wins. When an item and a product invariant conflict, the invariant wins. The checklist exists to hold firm at the moment it is most tempting to bend.

**End of Document**
