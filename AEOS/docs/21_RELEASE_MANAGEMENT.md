# 21_RELEASE_MANAGEMENT.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Release Engineering Standard
**Priority:** Critical
**Applies To:** Every versioned release of software or schema under the AEOS, including major, minor, patch, and hotfix releases, their branches, notes, approvals, tags, feature-flagged rollouts, and post-release monitoring.

---

# Purpose

This document defines the release engineering standard for the AEOS.

A deployment moves an artifact into an environment (document 20). A **release** is the deliberate, versioned, communicated act of making a set of changes available to users. This document governs how releases are versioned, branched, approved, documented, rolled out, monitored, and recorded.

Release management exists to make change predictable. Users, operators, and engineers must always be able to answer: what version is running, what changed, who approved it, and how to reverse it.

This is a **core, platform-agnostic** standard. Concrete tooling (a specific tagging service, changelog generator, or flag platform — for the current project these are project choices) belongs in the AEOS extensions layer (`AEOS/docs/extensions/`). The discipline here is universal.

---

# Release Philosophy

The governing principle of this document:

> **A release is a promise about what changed. The promise must be accurate, versioned, reversible, and approved.**

Three corollaries:

1. **Every release is identifiable.** A running system can always be mapped to an exact version and the exact commit behind it.
2. **Every release is communicated.** No change reaches users without a record of what it does.
3. **Every release is reversible.** A release that cannot be backed out, or whose behavior cannot be disabled, is not ready.

Release management sits above the deployment pipeline: the pipeline delivers artifacts safely; release management decides which artifacts become a version, when, and under what authority.

---

# Semantic Versioning

Releases are versioned using semantic versioning: **MAJOR.MINOR.PATCH**.

* **MAJOR** — incompatible or breaking changes to a public contract (API, schema, data shape, or user-facing behavior that existing clients depend on).
* **MINOR** — backward-compatible new functionality.
* **PATCH** — backward-compatible bug fixes and internal improvements with no contract change.

Rules:

* The version is the single source of truth for "what is this." It must be derivable from the repository and visible in the running system.
* Pre-release identifiers (for example, a release-candidate suffix) may be used for staging builds and must never appear as a final production version.
* A version, once published, is immutable. A mistake is corrected by a new version, never by re-publishing an old one.
* Schema and data contracts are versioned with the same discipline as code.

---

# Release Types

## Major Release

* Contains breaking changes.
* Requires a migration path and explicit communication to affected consumers.
* Requires the highest level of approval and the most conservative rollout.
* Backward-incompatible changes must be justified and recorded in an ADR (document 25).

## Minor Release

* Adds backward-compatible functionality.
* Existing consumers continue to work without change.
* New behavior is preferably introduced behind a feature flag for controlled enablement.

## Patch Release

* Fixes defects without changing any contract.
* Carries a regression test for the fixed defect.
* Smallest-possible scope; unrelated changes do not ride along in a patch.

## Hotfix Release

* An urgent, narrowly scoped fix for a live production defect, outside the normal release cadence.
* Branches from the current production version, not from in-progress development.
* Goes through the same quality gates as any release; urgency never waives verification.
* After release, the hotfix is merged back into the mainline so it is not lost in the next release.
* Always accompanied by a post-incident record and a regression test.

---

# Release Branches

Branching exists to separate stabilization from ongoing development.

Principles:

* **Mainline holds the integrated work.** Day-to-day development integrates into the mainline branch through reviewed, gated changes.
* **A release branch stabilizes a version.** When a release is cut, a release branch isolates it so it can be hardened (final fixes only) while development continues on the mainline.
* **Hotfix branches** are cut from the released production state, fixed, released, and merged back to mainline.
* **No direct commits to protected branches.** Changes arrive through reviewed pull requests that pass the pipeline gates.
* **Tags mark the exact released commit** (see Tagging).

The specific branch names and protection rules are a project and platform choice and live in extensions; the separation of concerns is mandatory.

---

# Release Notes and Changelog Discipline

Every release produces release notes derived from a maintained changelog.

Changelog rules:

* The changelog is kept continuously, not reconstructed at release time.
* Entries are grouped by type: added, changed, fixed, deprecated, removed, security.
* Each entry is written for the reader who must understand impact, not for the author who wrote the code.
* Breaking changes are called out explicitly and prominently, with the migration path.
* Security-relevant changes are noted without disclosing exploit detail.

Release notes rules:

* Every published version has release notes stating the version, the date, the headline changes, breaking changes, and required migration steps.
* Notes link to the relevant ADRs (document 25) and migration guides.
* Notes are honest: known issues and limitations are disclosed, per the constitution's no-fabrication directive.

---

# Change Management and Approvals

A release is an authorized act, not an automatic one.

* **Every release has a named approver** appropriate to its type. Higher-risk releases (major, hotfix to production) require higher authority.
* **Approval is recorded.** Who approved, what they approved, and when, is part of the release record.
* **Product-invariant-affecting changes require explicit human approval.** Where a release touches a live product invariant (for the current project, the P-series invariants such as scoring, payment integrity, RBAC, or data privacy), approval cannot be automated and must come from the designated authority. The invariant always wins over any release convenience (document 00).
* **Scope is frozen at sign-off.** Once a release is approved and tagged, its scope does not change. New work goes into the next version.

---

# Feature Flags for Controlled Rollout

Feature flags decouple **deploy** from **release**: code can ship dark and be enabled later, gradually, and reversibly.

Rules:

* **Default off.** New, risky, or invariant-adjacent behavior ships behind a flag that defaults to off until deliberately enabled.
* **Reversible by configuration.** Disabling a flag must require no redeploy; flag-off is itself an instant rollback.
* **Auditable.** Flag state changes are logged to an audit trail with who and when.
* **Temporary by intent.** Rollout flags are removed once a feature is fully launched and stable; long-lived flags become configuration and are documented as such.
* **Gradual enablement.** Combine flags with progressive rollout (document 20): enable for a small cohort, observe, then widen against explicit promotion criteria.

Feature flags are a release-control mechanism, not a substitute for testing. Flagged code is verified to the same standard as any other code.

---

# Backward Compatibility

Backward compatibility is the default expectation for minor and patch releases and a deliberate, approved exception for major releases.

Principles:

* **Do not break consumers silently.** A change that alters a public contract is a major change and must be versioned and communicated as such.
* **Prefer additive change.** Add new fields, endpoints, or columns rather than altering or removing existing ones.
* **Expand then contract.** When a breaking change is unavoidable, introduce the new shape alongside the old, migrate consumers, then remove the old shape in a later, announced major release.
* **Schema changes are backward-compatible by default** so that the application can roll back without the schema rolling back (document 20). Destructive schema changes require approval and a compensating plan.
* **Mobile and other independently updated clients** deserve special care: a server release must not strand client versions still in the field. Maintain compatibility windows for clients that cannot update instantly.

---

# Migration Notes

When a release requires consumers, data, or operators to change, it ships migration notes.

Migration notes state:

* what is changing and why,
* who is affected (services, clients, operators, data),
* the exact steps to migrate, in order,
* the compatibility window during which old and new behavior coexist,
* the rollback implications (what migrating forward does to the ability to roll back),
* verification steps to confirm the migration succeeded.

Database and schema migrations follow the database engineering standard: ordered, idempotent, and reversible-by-design wherever possible. Migration notes link to the specific migrations and their compensating counterparts.

---

# Release Sign-Off Gates

A release may not be tagged or published until every applicable gate passes. Gates are sequential and fail-closed.

1. **Verification gate** — all pipeline quality gates green (document 20): type check, lint, tests, build, E2E. Evidence required.
2. **Regression gate** — regression coverage exists and passes for every product-invariant area the release touches. Coverage is confirmed to exist, never assumed.
3. **Documentation gate** — changelog updated, release notes written, migration notes prepared where needed, ADRs filed for architectural or breaking changes.
4. **Compatibility gate** — backward compatibility confirmed for minor/patch; for major, the migration path and deprecation plan are in place and approved.
5. **Approval gate** — the named approver has signed off; invariant-affecting changes carry explicit human approval.
6. **Rollback gate** — a fast, rehearsed rollback path exists (artifact and, where used, feature-flag toggle).

No gate may be waived for urgency. A hotfix passes the same gates at a smaller scope.

---

# Tagging

Every published release is tagged in version control.

* The tag names the exact version and points at the exact released commit.
* Tags are immutable; a published tag is never moved or reused.
* The tag is the canonical link between a running version, its source, its artifact, and its release notes.
* Tagging happens only after the sign-off gates pass, so a tag always corresponds to an approved, verified release.

---

# Post-Release Monitoring

A release is not finished when it ships. It is finished when it is observed healthy in production.

* **Observation window.** After a release, watch error rate, latency, saturation, and the key business metrics the release could affect, for a defined window proportional to the release risk.
* **Promotion and abort criteria.** Where the release rolls out progressively or behind a flag, widen only while metrics stay within bounds; halt and reverse if they breach the abort criteria.
* **Compare to baseline.** Judge health against the pre-release baseline, not against a guess.
* **Record the outcome.** Capture that the release was observed healthy (or not) with evidence, closing the release record.
* **Feed incidents back.** Any post-release defect produces a regression test and, where warranted, an ADR or process change so it is not repeated.

This monitoring is the release-level expression of the constitution's evidence directive: "released" is a claim that requires post-hoc proof of health.

---

# Release Readiness Checklist

Confirm each item before tagging and publishing a release. Use '-' for each check.

- The version number is correct for the change type (major / minor / patch / hotfix).
- The release branch isolates the version; scope is frozen at sign-off.
- All pipeline quality gates passed with recorded evidence.
- Regression coverage exists and passes for every product-invariant area touched.
- The changelog is updated and release notes are written for the reader's impact.
- Migration notes exist for any required consumer, data, or operator change.
- Backward compatibility is confirmed (minor/patch) or a migration and deprecation plan is approved (major).
- Risky or invariant-adjacent behavior ships behind a default-off, reversible feature flag.
- ADRs are filed for architectural and breaking changes (document 25).
- The named approver has signed off; invariant-affecting changes have explicit human approval.
- A fast, rehearsed rollback path exists (artifact and/or flag toggle).
- The release will be tagged at the exact released commit after gates pass.
- A post-release observation window with promotion and abort criteria is defined.

If any item fails, the release is not ready. Do not tag.

---

# References

* `00_AI_CONSTITUTION.md` — The supreme charter; release control derives from the maintainability and evidence values, and product invariants always win over release convenience.
* `08_TESTING_PROTOCOL.md` — The verification and regression discipline behind the verification and regression sign-off gates.
* `10_VERIFICATION_ENGINE.md` — The evidence protocol behind "released is a claim that requires proof of health."
* `11_GIT_WORKFLOW.md` — Branching, pull-request, and commit conventions that release branches and tags build on.
* `20_DEPLOYMENT_PIPELINE.md` — The deployment flow, progressive rollout, and rollback mechanics that releases wrap.
* `23_ROOT_CAUSE_ANALYSIS.md` — Post-release incident handling and operational monitoring (concrete operational tooling lives in extensions).
* `AEOS/docs/extensions/` — Project-specific tooling for tagging, changelog generation, and the feature-flag platform.

---

# Final Directive

A release is a promise to everyone downstream that you know exactly what changed, that it works, that it was authorized, and that you can take it back.

Version honestly. Communicate completely. Roll out gradually. Monitor relentlessly. Keep every release reversible.

When release convenience and a product invariant conflict, the invariant wins — every time.

**End of Document**
