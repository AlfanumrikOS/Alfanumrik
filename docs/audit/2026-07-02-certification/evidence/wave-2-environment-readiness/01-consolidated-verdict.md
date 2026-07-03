# Environment Readiness Assessment - Consolidated Verdict

2026-07-02. Synthesized from three independent read-only investigations (architect: isolation,
backend: third-party sandbox modes, ops: traceability/monitoring/cleanup). No data has been
written anywhere. No workflow has been dispatched.

## Overall verdict: NOT READY. Do not provision the certification tenant yet.

Of the six criteria the CEO specified, one passes cleanly, three fail or are unconfirmed in a
way that carries real financial or monitoring risk, and two require a small amount of setup
work before they can be satisfied. This is not a blanket "staging is unsafe" finding - the
underlying staging database is genuinely a separate project from production, which is the hard
part and it already checks out. The remaining gaps are narrower and fixable.

## Criterion-by-criterion

**1. Isolated from production - PARTIALLY.**
The staging Supabase project is confirmed to be a genuinely separate project from production
(separate project reference, separate organization, confirmed via a direct project listing) -
not just a separate variable name. Existing staging workflows already contain a same-run
fail-closed check that aborts before touching any database if the resolved project reference
ever matches the known production reference - a real, working safety mechanism, independently
verified. However, the deployed staging website (a Vercel Preview build) is a different story:
both the production and staging deploy workflows point at the same Vercel project, and - this
is the critical finding - the actual environment variables that website reads (the Supabase
URL, the Supabase service-role key, the Razorpay keys, and every AI provider key) are configured
as a single shared value spanning Production and Preview in Vercel's own environment-variable
store, not distinct per-environment overrides. In plain terms: the separate staging database
exists, but the deployed staging website may currently be configured to talk to production
credentials rather than staging ones. This was not visible from repository code alone and
requires Vercel dashboard access to resolve.

**2. Third-party integrations in test/sandbox mode - FAILS / NOT CONFIRMED.**
Because of finding 1, this cannot be confirmed positively for Razorpay: no test-mode-prefix
check exists anywhere in the payment code, and the shared-across-environments Vercel
configuration means staging traffic through the website may currently use the same Razorpay
keys as production - which would mean real charges. AI providers (Claude, OpenAI, Voyage) have
no sandbox tier at all, industry-wide - any AI-tutor certification traffic will incur real,
billed API cost regardless of environment; this is a real constraint to accept, not a defect to
fix. Email is currently inert on staging only by accident (the staging project's Edge Function
secrets are simply missing email credentials, not a deliberate safety measure) - it fails soft
today but should not be relied upon as a designed sandbox. WhatsApp is not wired to live
credentials in either environment yet, so it poses no risk either way right now.

**3. Certification traffic identifiable - MUST BE ESTABLISHED.**
No existing convention marks synthetic or certification accounts in a database-queryable way.
One narrow precedent exists (a single demo-account flag plus a reserved email pattern used by
an existing drill workflow) but was never generalized. A concrete convention was proposed
during this assessment and is ready to adopt before any seeding happens.

**4. Monitoring and alerts appropriate - FAILS (one confirmed defect).**
All three error-monitoring configuration files key their environment tag off the wrong signal
for a Vercel Preview deployment, which resolves to the same value as production. Practical
effect: any error thrown during certification testing on the staging website would currently
be logged and alerted as if it were a real production incident, indistinguishable from an
actual outage. This is a small, well-scoped fix (three files, one line each) but it is a real
defect that would otherwise directly undermine criterion 4 as stated.

**5. Test data can be cleaned up - PARTIAL, with a related bug found.**
No single-operation teardown exists for a tenant's worth of seeded accounts. Worse, a real
foreign-key defect was found in the process of checking: the two account tables involved have
no cascade-delete relationship to the tenant table, which directly contradicts a code comment
elsewhewhere in the codebase claiming a full cascade exists. Attempting to delete a
certification tenant today would fail partway through with a database constraint error, not
succeed. The closest working cleanup tool has an ordering gap of its own and was never deployed
as an automated job.

**6. No production users or data can be affected - CONDITIONAL PASS, contingent on 1 and 2.**
True at the database level if certification work is done via direct database/CLI access to the
staging project (the same pattern the existing safe drill workflows already use, bypassing the
deployed website entirely). Not yet confirmed true if certification work is done by driving the
actual staging website, because of finding 1.

## What this means concretely

There are two different ways certification could touch staging, and they have very different
risk profiles right now:

- **Path A - direct database/workflow-level seeding and verification** (extending the existing,
  already-proven-safe drill-workflow pattern): safe on the evidence gathered, does not depend on
  resolving the Vercel shared-credential question, and can proceed once criteria 3, 4, and 5 are
  addressed.
- **Path B - driving the deployed staging website** (which is what any browser-based user-journey
  testing would require): NOT safe to start yet, because of the unresolved shared-credential
  question in finding 1. This blocks any live journey certification that requires an actual
  logged-in browser session against the staging URL, including payment and AI-tutor journeys.

## Recommendation

Do not provision the certification tenant yet. Recommend this order of operations:

1. Fix the three-file Sentry environment-tag defect (small, low-risk, directly required by
   criterion 4).
2. Fix or work around the cascade-delete gap so a clean tenant teardown is actually possible
   (required by criterion 5) - either patch the foreign keys or build a scoped, tested teardown
   procedure that deletes in the correct order.
3. Adopt the proposed traceability convention before any seeding (required by criterion 3).
4. Get a human with Vercel dashboard access to confirm - and if necessary correct - what the
   Preview/staging environment's Supabase, Razorpay, and AI-provider variables actually resolve
   to, before any Path B (browser-driven) testing is attempted. This is the one item that cannot
   be resolved by any agent in this session; it requires access none of us have.
5. Once 1-3 are done, Path A (direct database-level provisioning and verification of the
   certification tenant) can proceed immediately without waiting on item 4. Path B stays
   blocked until item 4 resolves.
