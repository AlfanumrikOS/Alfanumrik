# Outstanding Release Blockers

Exactly one item blocks program progress. Everything else is a finding for the Board's eventual
decision, not a blocker on doing further certification work.

## The one blocker

**CERT-17 - Deployed staging website environment-variable verification.**

- What: the hosting platform's Preview environment (what the staging website actually runs)
  shares its Supabase connection details, payment-provider keys, and AI-provider keys with the
  Production environment in the platform's own configuration store - confirmed by comparing the
  two deploy workflows' secret references and the platform's own environment-variable listing.
- Why it blocks: any browser-driven certification traffic against the staging website could
  currently be using production-shared credentials rather than staging-scoped ones. This cannot
  be resolved by inspecting source code - it requires reading the actual resolved values in the
  hosting dashboard.
- Who can close it: a human with dashboard access to the hosting platform (Vercel).
- What closing it looks like: confirming (and correcting, if necessary) that the Preview
  environment's Supabase URL, service-role credential, payment-provider keys, and AI-provider
  keys are scoped to non-production values, then recording that confirmation as evidence.
- What does NOT block on this: database/workflow-level certification tooling preparation
  (already done), the executive documentation package (this document and its siblings), and any
  further static-analysis work.

## Everything else is explicitly not a blocker on resuming certification

The 12 Should-Fix items from Wave 1 and the risk-register entries in this executive package are
inputs the Executive Release Board will weigh when it eventually renders a release decision -
none of them prevent the certification program itself from proceeding to Stage 2/3 once CERT-17
closes.

## Update 2026-07-02 (later same day) - confirmed with direct evidence

CERT-17 is no longer "unverified" - it has been checked directly against the live Vercel project
and is CONFIRMED FAILING: Preview's Supabase connection resolves to the production project, and
its payment-provider key is in live mode. Full evidence: evidence/wave-2-environment-readiness/
05-CERT-17-confirmed-evidence.md. See 12-ERG-1-executive-release-gate.md for the updated,
item-by-item gate status. This is now treated as an urgent operational-security item in its own
right, not only a certification-program blocker - see the recommended immediate actions in that
gate document.
