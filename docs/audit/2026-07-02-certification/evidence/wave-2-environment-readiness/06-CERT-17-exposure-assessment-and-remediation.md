# CERT-17 - Exposure assessment and remediation plan

2026-07-02, following the confirmed-failing finding in 05-CERT-17-confirmed-evidence.md.

## Exposure assessment

**Scope is broader than "the staging website."** Vercel's own deployment list shows the
production-pointed Preview credentials apply to every Preview deployment, not only the one
`deploy-staging.yml` intentionally produces. Vercel's GitHub integration auto-deploys a Preview
build for essentially every pushed branch, each getting its own git-branch-based alias
(confirmed via `vercel alias ls` - dozens of branch-named preview URLs, spanning at least the
last two days of visible history, likely longer). Every one of these shares the same
misconfigured Preview-scoped Supabase and Razorpay credentials.

**Mitigating fact.** The intentional, workflow-driven staging deployment process
(`deploy-staging.yml`) only performs an automated `GET /api/v1/health` request against its own
freshly-generated preview URL as a post-deploy check - a read-only health probe, not a flow that
creates student data or processes a payment. No evidence was found that this specific,
repeatable process has generated real user or payment data.

**Inconclusive.** A spot-check of Vercel's own request logs for the most recent Preview
deployment returned no log data at all - this could mean no traffic occurred, or it could mean
Vercel simply does not retain logs long enough / at this access tier for this check to be
conclusive either way. This assessment does not have enough log retention/depth to positively
rule out a human having manually visited a branch-preview URL and interacted with the live
application at some point during however long this misconfiguration has existed. Determining
that with certainty would require deeper Vercel Observability/Analytics access than a CLI-level
spot-check provides, or cross-referencing Supabase's own audit/access logs for anomalous
patterns - both out of scope for what this session can complete quickly.

**Recommendation on this point**: treat the exposure as unconfirmed-but-plausible rather than
confirmed-harmful or confirmed-safe. The fix (below) closes the exposure going forward regardless
of whether any past exposure actually occurred; determining whether it did is a separate,
lower-urgency forensic question that does not need to block the fix itself.

## Remediation plan (prepared, not executed - requires credentials this session does not have)

The fix is narrow and low-effort: Preview needs its own environment-scoped values for the
Supabase connection and the payment-provider key, distinct from Production's.

1. Obtain, from whoever manages the staging Supabase project, three values already known by
   reference but not by value in this session: the staging project's public URL, its anon key
   (not sensitive, safe to obtain and set), and its service-role key (sensitive - handle with the
   same care used throughout this program: never paste into chat, never leave in a plaintext
   file longer than needed).
2. Obtain a Razorpay test-mode key id and secret (prefixed `rzp_test_`) - likely already exists
   somewhere in this project's own staging tooling, since `seed-staging-test-student.yml` and
   similar workflows already operate against a staging-safe configuration; if not, generate one
   in the Razorpay dashboard's test mode.
3. For each of the following variable names, add a Preview-scoped override (which takes
   precedence over a value also scoped to Production) rather than removing the existing
   Production-scoped entry: the public Supabase URL variable, the public Supabase anon-key
   variable, the Supabase service-role variable, the Razorpay key-id variable, and the Razorpay
   webhook-secret variable. Concretely, for each: `vercel env add <VARIABLE_NAME> preview`, which
   prompts for the value interactively - run this by whoever holds the actual staging/test-mode
   values, not scripted with a value this session does not have.
4. Redeploy (or wait for the next natural Preview deployment) so the new Preview-scoped values
   take effect - Vercel does not retroactively update already-built deployments.
5. Re-verify using the same narrow, minimal-exposure method already proven safe this session:
   pull the Preview environment again and check only the connection-URL host and the payment
   key's mode prefix, exactly as done for the original finding - no need to re-expose full
   secret values to confirm the fix.
6. Once confirmed, this program's ERG-1 gate document should be updated from CONFIRMED FAILING
   back to a checked, evidenced pass, and this incident closed.

## What this session cannot do

Steps 1-4 require values (a staging Supabase service-role key, a test-mode Razorpay secret) this
session does not possess and should not attempt to obtain by pulling more production secrets to
disk - that would repeat exactly the pattern the session's own safety control correctly blocked
earlier. This is intentionally left for whoever holds those staging-scoped credentials already,
consistent with this program's own evidence-handling discipline.
