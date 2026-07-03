# Release Notes (Draft - not for publication until certification completes)

This draft is scoped to the engineering work delivered by the Phase 4 certification program
itself (the certification tooling and the three environment-safety fixes). It is NOT a draft of
a broader product release - the certification program did not build or change any student/
teacher/parent-facing feature, by design (certification-only, no unrelated feature work mixed in).

## Fixed

- Error-monitoring events generated on the staging environment are now correctly attributed to
  staging rather than being indistinguishable from production incidents.
- A tenant-level data-cleanup capability now exists for demo/certification accounts, closing a
  gap where cleanup could previously fail partway through.

## Internal / operational (not user-facing)

- Added a documented, machine-checkable convention for marking synthetic/certification traffic
  so it can be reliably excluded from real product reporting.
- Added certification test tooling (journey specs, seed/teardown scripts, evidence templates)
  used internally to validate production readiness; not part of the deployed application.

## Known issues carried forward (tracked, not fixed in this wave)

- A suspended or deleted student account can still take quizzes and earn experience points
  through the mobile app in its default configuration, because a database-level check was not
  yet extended to match an already-fixed web-layer check. Fix identified, scheduling pending a
  Board decision.
- A small number of internal documentation pages contain outdated counts (test catalog size,
  admin panel size) - cosmetic, being corrected separately.

## Not included in this release

- Any change to coupon or referral logic (currently schema-only, not implemented).
- Any change to adaptive/IRT question selection (currently inactive by design).

This draft should be revised once Stage 2/3 evidence exists and the Executive Release Board has
rendered a decision - items above marked "carried forward" may move to "fixed" or stay
"known issue, accepted" depending on that decision.
