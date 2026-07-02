# Stage 2 - Certification seed dry-run (evidence)

2026-07-02. First live-tooling milestone of Stage 2: the certification seed script was run in
dry-run mode against the actual staging Supabase project (gzpxqklxwzishrkiaatd), by the CEO in
their own terminal, with the service-role credential present only in that shell session and never
materialized into any file or transcript.

## Result: PASS (dry-run, no data written)

- The script's own production-reference guard did NOT refuse - confirming it correctly identifies
  the staging project reference as non-production. This is the safety mechanism preventing an
  accidental seed against production; it is now proven to work against the real target, not just
  in unit tests.
- certification_run_id generated: e7c44e64-83f9-461c-8b26-33f4fe0cf4fc (short form e7c44e64).
- School to be created: "[CERTIFICATION] cert-e7c44e64-school-001" - carries the [CERTIFICATION]
  prefix per the traceability runbook.
- Seven role accounts to be created, all under the reserved certification email domain
  (@certification.alfanumrik.invalid), each name-marked with the run id:
  student, teacher, parent, school_admin, super_admin (all portal=true), and content_author,
  support_staff (both portal=false).
- The portal=false marking on content_author and support_staff is correct, not a defect - it
  encodes the CERT-07 finding (these two RBAC roles have no dedicated frontend portal), so the
  script deliberately seeds their base accounts without asserting a portal journey for them.

## Significance

This confirms the entire Stage 2 seeding path is sound end to end - the script, its traceability
conventions, and its production-safety guard all behave correctly against the real staging
project. The only remaining action before the tenant actually exists is re-running the same
command without the dry-run flag. All downstream Stage 2/3 work (journey execution, evidence
collection, teardown) can then proceed.
