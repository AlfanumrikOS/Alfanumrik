# Schema review — remaining findings (H1–H5), closed 2026-08-31

Follow-up to the 5-domain live schema review conducted earlier this session
(migration ledger, edge functions, backend, middleware, RBAC). This closes out
the High-severity findings (H1–H5); the Medium/Low findings (M1–M10) are not
covered here — see "Not covered" below.

## Fixed and applied to production (`shktyoxqhundlvkiwguu`)

**DPDP-removal follow-up** — `insert_data_erasure_audit_event()` survived the
DPDP erasure-subsystem removal (PR #1666) because that migration guessed a
0-arg signature; the live function actually took 4 args. Its body read from
`data_erasure_requests`, already dropped, so it was a broken orphan. Dropped
with the correct signature.
Migration: `supabase/migrations/20260830190153_drop_orphaned_erasure_audit_event_fn.sql`

**H5 — public `schools` RLS policy bug (critical, live exploit).** The policy
`"Anyone can read active schools"` read `USING ((is_active = true) OR
(deleted_at IS NULL))` instead of `AND` — since `deleted_at IS NULL` is true
for nearly every school, this made `is_active` meaningless and let any
anonymous caller (grantee `public`) read every non-deleted school's `gstin`,
`billing_address`, `billing_email`, `principal_name`, `phone`, `email`, and
`domain_verification_token` (a secret token), regardless of `is_active`.
Verified the only legitimate public consumer (`/api/tenant/config`) already
uses the service-role client with an explicit column whitelist and does not
depend on this policy. Dropped the buggy policy along with a duplicate
service-role `ALL` policy (byte-identical to the one kept).
Migration: `supabase/migrations/20260830190641_fix_schools_public_read_policy_and_dedupe.sql`

**H2 — stale/invalid `database.types.ts`.** Regenerated from the live schema
via `generate_typescript_types`. 296 lines changed (91 insertions, 205
deletions) — real drift, not noise. `tsc --noEmit` clean across `apps/host`
and `packages/lib` with the new file.

**H4 — DB-12 (money-table + schema-wide grants).** Already closed, but not
by design: on 2026-08-23 a routine `db push` accidentally swept up a
DESIGN_ONLY file parked in `supabase/migrations/` and applied it to
production in full; on 2026-08-24 a hand-written recovery migration partially
reversed it, keeping the two things that mattered (TRUNCATE revoked
schema-wide on ~420 existing tables; INSERT/UPDATE/DELETE revoked on the 4
money tables) while restoring what an accidental blanket revoke would
otherwise have broken (future-table writes via the default-privileges
template). Independently re-verified live 2026-08-31 — current state matches
the intended end-state exactly; the 3 SECURITY INVOKER RPC carve-outs
(`record_learning_event`/`update_mastery_bkt`, `mark_notification_read`,
`teacher_create_class`) still resolve their required grants. Updated
`docs/audits/FIX-LEDGER.md`'s DB-12 row to `VERIFIED` and corrected the
now-false "DO NOT APPLY" banner on the DESIGN_ONLY migration file (it says
plainly, at the top, that it *was* applied, and why the file stays in place
unmodified).

**CI gap (found while investigating H3): no Edge Function ever gets
undeployed.** `account-purge` and `data-erasure-purger` are still `ACTIVE` on
Supabase despite their source being deleted in PR #1666 — the
"Deploy Changed Edge Functions" job in both `deploy-production.yml` and
`deploy-staging.yml` only ever calls `supabase functions deploy`, which fails
silently-ish (or not at all, since the diff-detection step never got a chance
to run — the #1666 deploy failed earlier at the migration-ledger step, and
the follow-up #1668 deploy didn't touch `supabase/functions/`) on a directory
that no longer exists locally. There was no delete/prune path at all. Added
one to both workflows: a new step detects directories deleted from
`supabase/functions/` in the push and calls `supabase functions delete` for
each, best-effort (a delete failure warns, it does not fail the release).

## Investigated, correctly NOT fixed

**H1 — `question_bank.correct_answer_index` readable by any authenticated
user.** Re-confirmed still live: `question_bank_authenticated_read` (SELECT,
`USING (true)`) plus the inherited baseline table grant means any
authenticated Postgres role (students, parents, and teachers all share it)
can read the answer key directly. The intended fix — column-level `REVOKE
SELECT (correct_answer_index, …) FROM authenticated, anon` — is fully ready
on the web/API side: an agent audit of all 18 route files that reference this
column (independently spot-checked) found every genuine read goes through a
service-role client, and the repo already has a dedicated, actively-maintained
test (`apps/host/src/__tests__/security/question-bank-answer-key-exposure.test.ts`)
that pins exactly this state and explicitly documents the blocker. **It is
blocked by the installed mobile app base**: `mobile/lib/core/constants/api_constants.dart`'s
`useV2` compile-time flag defaults to `false`, and every already-installed
APK reads `question_bank` directly under the caller's role with a bare
`.select()` (`SELECT *`), which fails under any column allowlist regardless
of which columns are withheld. No force-upgrade mechanism exists in the
codebase today. Applying the revoke now would break quiz-taking for every
user on an unupdated mobile app — this needs a mobile release (`USE_V2=true`
default) and a forced-upgrade rollout before the DB-side fix can safely ship.
No DB or code change made; this finding stays open, correctly, exactly as the
existing test file already documents.

**H3 — orphaned Edge Functions.** Confirmed live: 52 of 100 deployed Edge
Functions have no matching directory in `supabase/functions/` (`account-purge`
and `data-erasure-purger` — see the CI-gap fix above — plus 50 others with no
current source in this repo at all: `learning-analytics`, `session-manager`,
`quiz-submit`, `pool-generator`, `pdf-processor`, `tts-voice`, `student-notes`,
`chat-history`, `tarl-engine`, `cognitive-engine`, `learning-loop`,
`misconception-engine`, `adaptive-engine`, `diagnostic-engine`,
`student-experience`, `devops-agent`, `super-admin`, `rag-engine`,
`pdf-ingestion`, `voice-tutor`, `study-plan`, `pilot-analytics`, `payments`,
`welcome-email`, `lesson-engine`, `adaptive-orchestrator`, `offline-sync`,
`enhanced-quiz-generator`, `response-handler`, `quiz-generator-v2`,
`ncert-ingestion`, `rag-retrieval`, `ml-adaptation`, `mass-gen`,
`ingest-orchestrator`, `pdf-diagnose`, `ncert-ingest-v2`, `ncert-ingest-v3`,
`classify-rag-exercises`, `export-report`, `grade-written-answer`,
`edge-health-audit`, `agent-orchestrator`, `agent-worker`,
`auth-write-skeleton`, `embed-ncert-books`, `embed-rag-remaining`,
`rag-query-v3`, `rag-answer-v3`, `rag-answer-v4`, `rag-answer-v5`,
`rag-ingest-batch`, `rag-ingest-status`). This session has no Supabase
management-plane credential and no Edge Function delete tool, so none of the
52 were deleted. Two (`account-purge`, `data-erasure-purger`) are confirmed
dead with certainty — safe to delete via the Supabase dashboard or CLI at any
time. The other 50 include what look like an entirely different, earlier
architecture generation (`rag-answer-v3/v4/v5`, `agent-orchestrator`,
`agent-worker`, `tarl-engine`, `cognitive-engine`, `mass-gen`, …) — deleting
them blind risks breaking something invoked outside `apps/host` (mobile,
third-party integration, manual cron) that this session's grep sweeps
couldn't see. This needs its own dedicated investigation (start with
Supabase's function invocation logs/analytics to check for recent real
traffic on each) before any deletion, not a rushed one.

## Not covered by this pass

The Medium/Low findings from the original 5-domain review (M1–M9: `reconcile_payment`
caller check, internal governance tables readable by all, `foxy_response_cache`
public policy, log-table retention, disabled embedding-backfill cron, GSTIN
format constraint, unwired Foxy state-tracking subsystem,
`super_admin_subject_readiness` view leak, plus Low/Informational items
— `search_path` pinning batch, dead demo tables, redundant indexes, expired
coupons, stale planner statistics) and **M10 — the `guardian`/`parent` role
split-brain** were not investigated or fixed in this pass. M10 in particular
is architecturally deep (both roles exist as separate rows with live grants
to real users — 8 on `parent`, 3 on `guardian` at last count) and likely
touches role checks scattered across many files; it needs its own dedicated
investigation before any fix, not a rushed migration.
