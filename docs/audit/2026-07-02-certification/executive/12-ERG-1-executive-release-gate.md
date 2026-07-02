# ERG-1 - Executive Release Gate

Status: **OPEN.** This gate must close before Stage 2 (live seeded certification testing) may
begin. No item below may be checked without linked evidence - an unchecked item with no evidence
is the honest default, not a failure of process.

- [ ] Preview uses staging Supabase - NOT VERIFIED. Evidence needed: hosting-dashboard screenshot
      or export showing the Preview environment's Supabase URL variable resolves to the staging
      project reference, not the production one.
- [ ] Preview uses staging storage - NOT VERIFIED. Evidence needed: confirmation of which storage
      bucket/project the Preview environment's file-storage configuration targets, if the
      platform uses Supabase Storage or an equivalent distinct from the main database connection.
- [ ] Preview uses staging service-role credential - NOT VERIFIED. Evidence needed: confirmation
      the Preview environment's elevated database credential is scoped to the staging project,
      not shared with production (this is the single highest-priority item - it gates database
      write safety for any browser-driven action).
- [ ] Preview uses Razorpay test mode - NOT VERIFIED. Evidence needed: confirmation the Preview
      environment's payment-provider key ID begins with the test-mode prefix, not the live-mode
      prefix.
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
- [ ] Preview secrets are verified - NOT VERIFIED as a whole (this line item is the umbrella for
      the individual credential checks above; it should only be checked once every specific
      credential above is individually confirmed, not checked independently of them).
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
