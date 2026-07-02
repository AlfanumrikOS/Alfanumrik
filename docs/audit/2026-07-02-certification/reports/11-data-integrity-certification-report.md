# 11 - Data Integrity Certification Report

Stage 1 (static/read-only), 2026-07-02. Scope: all 350 root-level database migrations.

## Foreign keys

The six previously-identified missing foreign-key constraints were independently confirmed
fixed by direct read of the current migration file, not by trusting the fixing commit's
message. Each is applied in a not-yet-validated state (the safe pattern for a live schema,
avoiding a lock or failure against any pre-existing orphaned rows), with the exact pre-flight
queries an operator should run before validating each constraint already included in the same
file. This means the fix is real but not yet fully closed in the retroactive-validation sense -
tracked as a low-priority follow-up (CERT-13 note), not an open defect.

Chain-wide foreign-key completeness across the full table set beyond the six previously-named
tables was not exhaustively re-derived this wave.

## Row-level security coverage

100% of the 71 real table-creating migrations enable row-level security in the same file that
creates the table - zero gaps found, both by mechanical sweep and hand verification of every
flagged candidate.

## Elevated-privilege function hygiene

Of 103 functions carrying elevated database privilege found in the migration chain, all but one
also carry the search-path guard that prevents a schema-shadowing attack. The one exception is a
zero-argument function unreachable by any application-facing role, callable only by the
service-role bypass, with every internal table reference already schema-qualified - low
exploitability, but a genuine gap the prior audit's equivalent sweep did not catch. Tracked as
CERT-12.

## Migration history

350 root-level migrations were classified in full; none were found to be malformed or to
silently duplicate an already-applied change in a way that would break a fresh-environment
rebuild.

## Duplicate records, orphan records, null anomalies

Not independently re-derived this wave beyond the foreign-key and RLS sweeps above - this class
of check generally requires live-database querying rather than static migration reading, and is
deferred to Stage 2.

## Data lifecycle, soft deletes, retention

Soft-delete honoring was flagged as an open question by the prior validation phase and was not
independently re-derived this wave beyond the specific finding that the quiz-scoring database
functions do not yet check a soft-delete flag on the student row (see CERT-01, cross-referenced
from the Security report). Retention policy enforcement was not independently traced.

## Summary

Structural integrity (foreign keys, row-level security) is strong: zero missing row-level
security policies, and the previously-known foreign-key gaps are now genuinely closed pending
routine validation. The one meaningful open item in this domain is the same suspended/deleted-
account quiz-access gap already tracked as the wave's most material security finding (CERT-01),
which is also, from this domain's perspective, a data-lifecycle enforcement gap: an account
marked inactive or deleted is not actually excluded from every code path that touches its data.
