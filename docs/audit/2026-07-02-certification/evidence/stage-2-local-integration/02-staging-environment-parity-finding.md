# Stage 2 - Environment-parity finding (staging vs production reference data)

2026-07-02. Surfaced by the first real (non-dry-run) execution of the certification seed against
the live staging Supabase project. This is a genuine field-caught finding, distinct from the
seed-script fix it prompted.

## What happened

The seed's production-reference guard passed and it correctly targeted staging. The first student
insert then failed:

```
insert or update on table "students" violates foreign key constraint "students_preferred_subject_fkey"
```

## Root cause - an environment-parity gap, not just a script bug

- `students.preferred_subject` has a column default of the literal string 'Mathematics' and a
  foreign key into the subjects reference table (keyed on subject name/code).
- On production, a subject row matching 'Mathematics' exists, so the default is a valid FK
  target and inserts that omit the column succeed.
- On the staging project (gzpxqklxwzishrkiaatd), the subjects reference data was NOT seeded to
  match - there is no row the 'Mathematics' default can point at - so the same insert fails.
- Net: staging is schema-cloned from production but its reference/seed data (at least the
  subjects table) diverges. Any code path that relies on a defaulted FK value being satisfiable
  will behave differently on staging than production.

## Two distinct issues, two distinct owners

1. **Seed-script robustness (FIXED, testing).** The seed now explicitly sets
   preferred_subject = null for the student row, so it no longer depends on any environment's
   subject-seed state. A null FK value is always valid. A regression test pins this. This is
   done and does not require staging's data to change.
2. **Staging reference-data parity (RECORDED, not fixed).** The underlying divergence - staging's
   subjects table (and possibly other reference tables) not matching production's - is a real
   operational finding. It means any manual or automated testing on staging that exercises
   subject-dependent flows may hit missing-reference-row errors that would never occur on
   production, and conversely that staging is not a faithful mirror for reference-data-dependent
   behavior. This is not blocking the certification tenant (the seed fix routes around it), but
   it is worth a deliberate decision: either seed staging's reference tables to match production,
   or accept and document that staging diverges on reference data.

## Bonus finding (testing surfaced, architect-relevant)

The `students_preferred_subject_fkey` constraint is present on the live database but is NOT
captured in the pg_dump-derived baseline migration (00000000000000_baseline_from_prod.sql). That
is a schema-reproducibility parity gap in its own right: a fresh environment rebuilt purely from
the baseline would not have this FK at all, which is a different divergence from the reference-
data one above. Recorded here for architect follow-up; not fixed in this pass.

## Status

Seed script is now robust and ready to re-run. The two parity findings above are recorded as
operational items, neither blocking the certification program's own progress.
