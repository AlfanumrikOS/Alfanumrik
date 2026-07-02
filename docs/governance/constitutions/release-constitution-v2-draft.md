# Release Constitution (Draft, revision 2)

Status: DRAFT, not ratified. Revision 2 - revised in response to a quality review (see
00-ratification-quality-review.md) that found one cross-document authority contradiction shared
with Engineering Constitution v2, and one rubric that conflated two distinct kinds of
confidence. Both fixed in this revision. Part of the Alfanumrik Engineering v2 initiative.
Formalizes the process exercised for real during the Phase 4 production-certification program -
this is not a theoretical process, every rule below was actually used this session, on this
codebase.

## 1. The certification process

Every release-scale change (per the two-track model in Engineering Constitution v2) passes
through three stages before an Executive Release Board decision is possible:

- **Stage 1 - Static.** Read-only code analysis, fresh execution of the automated verification
  suite (type-check, lint, test, build, bundle-size), and 100 percent inventory classification
  of every affected artifact. Caps the release-level confidence ceiling at MEDIUM regardless of
  how individual findings within it are tagged - see Section 3 for why this is a distinct claim
  from finding-level confidence.
- **Stage 2 - Seeded live testing.** Execution against a genuinely isolated environment using
  clearly-marked synthetic accounts, gated behind an Environment Readiness Assessment (Section 2
  below) that must pass before Stage 2 may begin.
- **Stage 3 - Dedicated tenant.** A purpose-built, clearly-labeled tenant in a shared staging
  environment, provisioned, exercised, evidenced, and torn down as a single accountable unit.

No stage may be skipped to save time. A change too small to warrant Stage 2/3 is, by
definition, routed through the lightweight track in Engineering Constitution v2 instead of this
process - this process exists for exactly the changes that need all three stages.

## 2. Environment Readiness Assessment

Before Stage 2 or Stage 3 may touch any environment, six criteria must be independently verified,
not assumed: isolation from production, third-party integrations operating in test or sandbox
mode, certification traffic identifiability, appropriate monitoring and alerting, a working
cleanup mechanism, and a positive confirmation that no production user or data can be affected.
A criterion that cannot be verified from source code alone (for example, whether a deployed
website environment variable actually resolves to a staging credential) is recorded as an
explicit external dependency, not silently assumed safe. This is exactly the mechanism that
found and blocked on CERT-17 during the Phase 4 program - it is being formalized here because it
worked.

## 3. Evidence requirements

Every finding carries a **finding-level confidence** tag, and every certification package as a
whole carries a separate **stage-level confidence ceiling**. These are two different claims and
must not be conflated - a specific finding can legitimately be tagged HIGH from a single
thorough static read, while the certification package containing it is still capped at MEDIUM
overall because no Stage 2/3 live evidence exists yet. Revision 1 of this document stated the
HIGH definition in a way that read as disqualifying most of the HIGH-tagged findings actually
produced during the Phase 4 program's Stage 1 pass - that was a description error, not a
practice error; the underlying practice already kept the two tiers separate, this revision now
says so explicitly.

**Finding-level confidence**: HIGH (independently re-read with file and line citation, either
live-verified or from an exhaustive, cross-referenced static read that leaves no reasonable
doubt, and has or gets a regression-catalog pin), MEDIUM (a static re-read with citation, less
exhaustive than the HIGH bar, or live-verified but without a durable regression-catalog pin yet),
LOW (cited from a prior audit without independent re-verification), or NOT VERIFIED / DEFERRED
(no verification beyond classification). A finding never gets silently upgraded from a lower
tier to a higher one by omission.

**Stage-level confidence ceiling**: a certification package cannot claim an overall confidence
higher than the most restrictive stage actually completed - Stage 1 only, regardless of how many
individual findings within it are HIGH, ceilings the package at MEDIUM; only live Stage 2/3
execution can raise the package-level ceiling toward HIGH. This is the rule that kept the Phase
4 program's own scorecard honest even though several individual Stage 1 findings were
legitimately HIGH-confidence.

**Risk impact**: Blocker (a Tier-0 surface, confirmed, with no compensating control, or any
live-reproduced product-invariant violation - release cannot proceed with one open), Should-Fix-
Before-Release (a Tier-0 or Tier-1 surface with partial mitigation, or an unresolved Tier-0
unknown), Post-Release-Acceptable (a Tier-2 surface or a pure maintainability issue), or
Informational (a refuted finding or confirmed-safe-by-design behavior).

Every prior audit or certification a new pass builds on is supporting evidence only - anything
critical or release-affecting must be independently re-derived, not cited and trusted. This is
the single rule that made the Phase 4 program catch real gaps a purely citation-based pass would
have missed, including a foreign-key gap the certification tooling itself had at first.

## 4. Executive Release Gates

A named, numbered gate (following the ERG-N pattern established as ERG-1 during the Phase 4
program) exists wherever a category of risk needs an explicit, evidence-backed checkbox before
work may proceed past it. A gate item may only be checked with a linked piece of evidence - an
unchecked item with no evidence is the correct, honest default, never silently marked complete
to keep a dashboard looking green. A gate is owned by whoever is positioned to actually verify
it - an external party (a human with a specific system access) where no engineering role can
verify it from source code alone, an internal role otherwise.

## 5. The Executive Release Board

Convened by Release Manager once Stage 1 through 3 evidence exists. The release go/no-go
decision belongs to the Board as a body - APPROVED, APPROVED WITH CONDITIONS, or REJECTED -
never to Release Manager individually. Release Manager's own authority (Engineering Constitution
v2 Section 4) is limited to gatekeeping whether a Release Candidate has adequate evidence to be
submitted to the Board in the first place - it can block a premature submission, but it cannot
substitute its own judgment for the Board's decision once submitted. This is stated explicitly
here to resolve a contradiction present in revision 1, where Engineering Constitution v2
incorrectly granted Release Manager an individual release veto that this document never granted
and does not grant now.

The Board performs five checks before issuing a decision, each one a genuine re-derivation
rather than a restatement of what the certification teams already concluded: independent
recomputation of any weighted readiness score directly from underlying evidence tables, a
cross-report consistency check that the same finding carries the same severity everywhere it
appears, a sampled re-trace of several high-confidence claims back to their cited evidence, a
completeness gate confirming every product invariant has an explicit verdict and every open
finding has exactly one risk-impact tag, and only then a decision. A decision of APPROVED WITH
CONDITIONS must name the conditions and, where applicable, a re-verification deadline. No
recommendation may be issued without the evidence to support it - a Board that cannot yet decide
says so explicitly (DEFERRED) rather than defaulting to an optimistic answer because a decision
was expected on schedule.

Where the disagreement driving a release decision also touches a product invariant or another
category listed in Engineering Constitution v2 Section 3 rule 3, that rule takes precedence per
its own rule 5 - the dispute escalates to the CEO directly, and the Board's analysis becomes
input to that decision rather than an independently binding one.

## 6. Production rollout policy

A certified Release Candidate moves to production through, in order: a deployment checklist
confirming the Board decision, the exact commit, and gate evidence are all on file immediately
before deploying; the deployment itself; a post-deployment validation checklist run immediately
after, covering health checks, a real user-journey smoke test per role, and error-monitoring
comparison against the pre-deploy baseline; and a hypercare monitoring window (recommend 48 to
72 hours, scaled to what shipped) with named exit criteria before the elevated-attention period
ends. Any user-facing regression discovered during validation or hypercare triggers the rollback
checklist evaluation immediately, not after a standard incident-triage process completes.

## 7. Rollback and incident response

Rollback authority belongs to any engineer with deploy access, exercised immediately on
confirmed active user-facing harm, without waiting for approval - approval is required only to
redeploy afterward, not to execute the rollback itself. This codebase has no automatic
down-migration tooling; a migration-related production problem escalates to architect for a
manually-authored, reviewed compensating migration applied deliberately by an operator, not an
automatic schema revert. Every rollback and every incident is recorded in the program evidence
trail with timestamp, operator, and root cause, whether or not the root cause was fully resolved
before the record was filed.

## 8. Ratification status

RATIFIED WITH ONE OPEN FOLLOW-UP, 2026-07-02, revision 2. Revision 1 was reviewed by quality and
given APPROVE WITH CONDITIONS; both conditions (the Release Manager authority contradiction and
the confidence-rubric conflation) are fixed in this revision. Quality's targeted re-review
confirmed the fixes and issued APPROVE WITH CONDITIONS again, this time for exactly one minor,
non-blocking item: Section 3 defines the Stage-1-only confidence ceiling explicitly but does not
yet define what ceiling a Stage-2-only (no Stage 3) completion yields. This has no effect on the
certification program as it stands today (Stage 1 complete, Stage 2/3 not started), so it does
not block ratification - it is recorded here as an open follow-up to resolve before this
document is relied upon at a point where Stage 2 has completed but Stage 3 has not. Ratified by
the CEO 2026-07-02. This document is now binding as written, with that one follow-up tracked.
Full review trail: 00-ratification-quality-review.md.
