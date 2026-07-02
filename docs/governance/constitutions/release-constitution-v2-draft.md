# Release Constitution (Draft)

Status: DRAFT, not ratified. Part of the Alfanumrik Engineering v2 initiative. Formalizes the
process exercised for real during the Phase 4 production-certification program - this is not a
theoretical process, every rule below was actually used this session, on this codebase.

## 1. The certification process

Every release-scale change (per the two-track model in Engineering Constitution v2) passes
through three stages before an Executive Release Board decision is possible:

- **Stage 1 - Static.** Read-only code analysis, fresh execution of the automated verification
  suite (type-check, lint, test, build, bundle-size), and 100 percent inventory classification
  of every affected artifact. Produces MEDIUM-confidence findings at best - no live system is
  touched.
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

Every finding in a certification package carries two tags, applied consistently:

**Confidence**: HIGH (live-verified plus independently re-read plus has a regression-catalog
pin), MEDIUM (static re-read with file and line citation, no live execution), LOW (cited from a
prior audit without independent re-verification), or NOT VERIFIED / DEFERRED (no verification
beyond classification). A finding never gets silently upgraded from a lower tier to a higher one
by omission - the burden is on evidence existing, not on absence of contrary evidence.

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

Convened by Release Manager once Stage 1 through 3 evidence exists. Performs five checks before
issuing a decision, each one a genuine re-derivation rather than a restatement of what the
certification teams already concluded: independent recomputation of any weighted readiness
score directly from underlying evidence tables, a cross-report consistency check that the same
finding carries the same severity everywhere it appears, a sampled re-trace of several
high-confidence claims back to their cited evidence, a completeness gate confirming every
product invariant has an explicit verdict and every open finding has exactly one risk-impact
tag, and only then a decision: APPROVED, APPROVED WITH CONDITIONS, or REJECTED. A decision of
APPROVED WITH CONDITIONS must name the conditions and, where applicable, a re-verification
deadline. No recommendation may be issued without the evidence to support it - a Board that
cannot yet decide says so explicitly (DEFERRED) rather than defaulting to an optimistic answer
because a decision was expected on schedule.

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
redeploy afterward, not to execute the rollback itself. Schema changes are treated as
forward-only per this codebase existing convention; a migration-related production problem
escalates to architect for a manually-reasoned forward fix rather than an automatic
down-migration attempt. Every rollback and every incident is recorded in the program evidence
trail with timestamp, operator, and root cause, whether or not the root cause was fully resolved
before the record was filed.

## 8. Ratification status

DRAFT. Grounded entirely in a process actually exercised this session, not a theoretical design -
recommend ratification proceed alongside Engineering Constitution v2 rather than waiting for the
Design and Product constitutions, since nothing in this document depends on roles that do not
yet exist.
