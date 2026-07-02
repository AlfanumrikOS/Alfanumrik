# ERG-1 - Executive Release Gate

Status: **OPEN - CONFIRMED FAILING.** Updated 2026-07-02 with direct evidence obtained via the
Vercel CLI. Two of the ten items below are not merely unverified - they are now confirmed
failing with first-party evidence. Full detail: evidence/wave-2-environment-readiness/05-CERT-17-confirmed-evidence.md.
This gate must close before Stage 2 (live seeded certification testing) may begin. No item below
may be checked without linked evidence - an unchecked item with no evidence is the honest
default, not a failure of process.

- [x] Preview uses staging Supabase - **RESOLVED 2026-07-02.** Preview now has a distinct
      override for the public Supabase connection URL and the public anon key, both pointing at
      the staging project (gzpxqklxwzishrkiaatd), separate from Production. Verified via a direct
      post-change listing. See evidence/wave-2-environment-readiness/07-CERT-17-partial-remediation.md.
- [ ] Preview uses staging storage - NOT VERIFIED. Evidence needed: confirmation of which storage
      bucket/project the Preview environment's file-storage configuration targets, if the
      platform uses Supabase Storage or an equivalent distinct from the main database connection.
- [x] Preview uses staging service-role credential - **RESOLVED 2026-07-02.** The elevated
      database credential now has a distinct Preview-scoped override pointing at the staging
      project, set interactively by the CEO (piped from the Supabase CLI, value never
      materialized), and verified via a direct post-change listing (Preview split out of the old
      shared production entry). The earlier automation block on this credential class was
      correct and was respected; a human set it directly instead. The Preview split-brain hazard
      (Finding A in evidence 03) is now closed.
- [ ] Preview uses Razorpay test mode - **CONFIRMED FAILING.** Direct evidence: Preview's
      payment-provider key id begins with the live-mode prefix, not the test-mode prefix.
      Verified 2026-07-02.
- [ ] Preview uses approved AI configuration - NOT VERIFIED. Note: AI providers have no sandbox
      tier industry-wide, so "approved AI configuration" here means confirming which API keys and
      usage-cap settings apply to Preview traffic, and getting explicit sign-off that the
      resulting real, billed cost of certification AI-tutor traffic is acceptable - not that a
      sandboxed AI mode exists.
- [ ] Preview uses staging email configuration - PARTIALLY OBSERVABLE FROM CODE: the staging
      project's edge-function secrets were found to have no email-provider credentials configured
      at all during this program's investigation, meaning email sending currently fails soft
      (no-op) on staging - this is not a designed safeguard, so it should not be treated as
      "confirmed safe," only as "currently inert by accident." Evidence still needed if email
      sending is intentionally enabled for Stage 2/3.
- [ ] Preview uses staging notification configuration (WhatsApp, etc.) - PARTIALLY OBSERVABLE:
      no live credentials were found configured in either environment during this program's
      investigation, so this channel poses no risk either way at present - re-verify if that
      changes before Stage 2/3.
- [ ] Preview monitoring is isolated - **RESOLVED as of the CERT-18 fix**: Preview-tagged errors
      now correctly attribute to a non-production environment tag rather than production.
      Evidence: the Sentry configuration fix, its regression test, and this program's independent
      re-verification, all committed at 193806f4.
- [~] Preview secrets are verified - PARTIAL. The three Supabase credentials (URL, anon key,
      service-role) are all now Preview-scoped to staging and verified. Storage, AI-config,
      email, and notification items remain as noted; the Razorpay payment-mode item remains
      CONFIRMED FAILING (deferred). This umbrella cannot be fully checked until the Razorpay item
      is resolved or its payment-journey steps are formally excluded from scope.
- [ ] Browser-based certification is authorized - **cannot be checked until every item above is
      checked with evidence.** This is a derived item, not an independent judgment call.

## Gate owner

The human with hosting-dashboard access who performs the verification above. Release Management
(this process) cannot self-close this gate - that would defeat its purpose.

## What happens when this gate closes

Certification resumes at: provisioning the dedicated certification tenant in staging, then
executing the prepared Stage 2/3 tooling (Playwright journeys, seed script, API spot-checks)
for real, collecting evidence into the existing templates, then running the teardown script and
its integration test for the first time against a live database, then convening the Executive
Release Board with real Stage 2/3 evidence in hand.

## What must happen before that, given the confirmed failure above

This is no longer purely a certification-program blocker. The deployed staging website has been
live-configured to use production Supabase and live payment-provider credentials, which means it
has been capable of writing to production data and processing real payments for however long
this configuration has existed - independent of whether certification ever runs. Recommend, in
order: (1) an immediate review of whether the staging URL has actually been used by anyone while
misconfigured this way, and what if any real-world effect that had; (2) repointing Preview's
environment variables to the staging Supabase project and a test-mode payment key; (3) only then
re-attempting this gate's connection-URL, elevated-credential, and payment-mode items.
