# CERT-17 - CONFIRMED FAIL, with direct evidence

2026-07-02. Verified directly against the live Vercel project by the CEO, using orchestrator-
provided commands, after the orchestrator own attempt to pull and inspect the same values was
correctly blocked by a session safety control (writing decrypted production secrets to disk
requires an explicit permission grant that was not present). This is real, first-party evidence,
not an inference from configuration metadata.

## Method

`vercel env pull --environment=preview` against the linked alfanumrik Vercel project, then two
targeted, minimal-exposure reads of the pulled file: the full Supabase URL line (safe - the
project reference is not a secret, it appears in public client-side code either way) and the
first 24 characters only of the Razorpay key id line (enough to see the mode prefix, not enough
to expose the key).

## Result

- **Preview's NEXT_PUBLIC_SUPABASE_URL resolves to `https://shktyoxqhundlvkiwguu.supabase.co`** -
  this is the production Supabase project reference, independently confirmed earlier in this
  program (matches supabase/config.toml's pinned project_id, described in that file's own header
  as "PROD + promotion target"). It does NOT match the known staging project reference
  (`gzpxqklxwzishrkiaatd`) found earlier via a direct Vercel project listing.
- **Preview's RAZORPAY_KEY_ID begins with `rzp_liv` (live mode)**, not `rzp_test_` (test mode).

## What this means, stated plainly

The deployed staging website (the Vercel Preview build that `deploy-staging.yml` produces) is
currently configured to connect to the **production** Supabase database using **live** Razorpay
payment credentials. This is not a hypothetical risk - it is the actual, current, live
configuration of the environment this certification program was being asked to test against.

This is worse than "browser-based certification cannot proceed yet." Any existing use of the
staging website - by this certification program, by prior manual testing, by anyone - has been
writing to the production database and, for any payment-flow interaction, capable of processing
real charges through live Razorpay credentials. This is a standing operational risk independent
of whether certification ever resumes.

## Status

**CERT-17: CONFIRMED FAIL, not merely unresolved.** Per the Environment Readiness Assessment
process, this document records the exact discrepancy and the certification program stops here on
this item, exactly as directed. Certification tenant provisioning does not proceed. Recommend
this be treated as an urgent, standalone operational-security item, escalated ahead of and
independent of the certification program's own pace - the fix (repointing Preview's environment
variables to the actual staging Supabase project and a Razorpay test-mode key) is itself
low-effort, but the exposure window (Preview has apparently been live-configured this way for an
unknown period predating this session) needs its own incident-style review: what, if anything,
has actually touched the staging URL while it was silently pointed at production.

## Evidence handling note

The full pulled environment file (`.env.preview.check`, containing the complete Supabase
service-role key and Razorpay secret key in plaintext) was generated on the CEO's own machine,
outside this session's file access, and the CEO was instructed to delete it immediately after
extracting the two minimal facts recorded above. Neither the full Supabase service-role key nor
the full Razorpay secret was transmitted into this conversation or written to any file this
session controls.
