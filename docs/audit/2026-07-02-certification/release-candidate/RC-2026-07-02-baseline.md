# Release Candidate Baseline - Phase 4 Certification

Captured 2026-07-02, immediately after the environment-readiness remediation wave landed. This
is the exact, frozen state the certification program's Stage 2/3 work will be executed against.
Any drift from this baseline (a new commit landing on the branch before Stage 2/3 runs) should
trigger a fresh baseline capture, not a silent assumption that prior findings still hold.

## Source control

| Field | Value |
|---|---|
| Branch | fix/prod-readiness-remaining |
| Commit (full SHA) | 15742a1c2b45e9e13cd6d3519bc9b64071ea42a9 |
| Commit (short) | 15742a1c |
| Immediately preceding commit | 193806f4 (fix: close environment-readiness release blockers) |
| Base branch | main |

## Migration state

| Field | Value |
|---|---|
| Root-level migrations, excludes the archived legacy chain | 351 (350 certified in Wave 1 plus 1 new: the certification-tenant-teardown migration itself) |
| Latest migration file | 20260702180000_certification_tenant_teardown.sql |
| Legacy/archived migrations | unchanged from Wave 1 findings, not re-counted this pass |

## Runtime and key dependency versions

| Component | Version |
|---|---|
| Node.js | v25.8.2 |
| npm | 11.11.1 |
| Next.js | ^16.2.6 |
| React and React DOM | ^18.3.1 |
| TypeScript | ^5.4.5 |
| Supabase JS client | ^2.108.2 |
| Supabase SSR helper | ^0.12.0 |
| Vitest | ^4.1.8 |
| Playwright test | ^1.60.0 |

Versions are as declared in the project manifest (caret-ranged). The exact resolved versions
used by any future Stage 2/3 CI run should be captured fresh from that run's lockfile-resolved
install, not assumed identical to whatever was resolved during this Wave 1 session.

## Test and build state at this commit (independently re-verified during Wave 1)

- type-check: PASS, zero errors
- lint: PASS, zero errors
- test: PASS, 14,359 tests, 14,241 passed, 118 skipped, 0 failed, 879 files
- build: PASS
- bundle-size: PASS, shared 279.9 of 284 kB, middleware 116.2 of 120 kB, worst page 198.1 of 260 kB
- regression catalog: 196 entries after the remediation wave, up from 193 at Wave 1 close

## Environment assumptions this certification program depends on

State these explicitly so Stage 2/3 execution can verify them still hold rather than silently
inheriting them:

1. A specific, identified Supabase project is production. This was confirmed by direct
   comparison between the CLI's pinned local project configuration and the application's own
   local environment configuration, both independently pointing at the same project reference.
   Certification must never write here.
2. A genuinely separate staging Supabase project exists (confirmed via a direct project listing
   showing two distinct project references under two distinct organizations), reachable via a
   dedicated staging secret in the deployment pipeline. Existing staging workflows contain a
   same-run fail-closed guard that aborts before any database write if the resolved project
   reference ever matches the known production reference.
3. The Vercel-deployed staging website (the Preview build) currently shares its Supabase,
   Razorpay, and AI-provider environment-variable values with the Production Vercel environment,
   per Vercel's own environment-variable scoping - not yet confirmed to point at the staging
   Supabase project or at sandboxed third-party credentials. This is CERT-17, an open Release
   Blocker, and is the reason browser-driven (Path B) certification remains paused pending human
   verification with Vercel dashboard access.
4. No local isolated Supabase stack is available in the execution environment used for this
   certification program (the container runtime is inaccessible). Documented as an environmental
   limitation in the environment-readiness evidence folder, not worked around.
5. AI providers have no sandbox or test tier - any live AI-tutor certification traffic, on
   staging or otherwise, incurs real billed API cost. Budget for this before Stage 2/3 execution.
6. Whether the deployed staging site's payment-provider keys are in test mode is unconfirmed,
   directly gated by assumption 3 above.
7. The certification-tenant teardown function has never executed against a live database. It is
   written, reviewed twice, and structurally verified, but its integration test currently
   self-skips because no live database credentials are available in this session. It must be run
   for real, and its result checked, before being trusted as the certification tenant's actual
   cleanup mechanism.

## What changes would invalidate this baseline

- Any new commit landing on the working branch or a merge from the base branch before Stage 2/3
  executes - re-capture the baseline (new commit hash, re-run the automated verification suite)
  rather than certifying against stale evidence.
- Any change to the hosting platform's environment-variable configuration (expected and required,
  to resolve CERT-17) - once that happens, note the resolution explicitly in a baseline addendum
  rather than silently updating this file, so the audit trail shows exactly when and how CERT-17
  closed.
- Any new migration landing after the one named above - re-run the Wave 1 migration inventory
  sweep for the delta rather than assuming the certified 351-migration state still applies.

## Addendum - Stage 2/3 tooling preparation (same day, after this baseline was captured)

Commit cd8c35a2 (feat(certification): prepare Stage 2/3 tooling, not yet executed) landed after
this baseline was captured. It adds certification tooling (Playwright specs, seed/teardown
scripts, runbooks, templates) but does not change any application behavior the platform serves
to real users - the baseline's certified test/build/bundle state above is unaffected. When
Stage 2/3 actually executes, it should be understood as certifying the platform state at
commit 15742a1c using tooling as of commit cd8c35a2, and this distinction should be preserved
in whatever evidence-collection record Stage 2/3 produces.

Program status at the time of this addendum: paused, pending CERT-17 (a human with hosting-
platform dashboard access must confirm and, if necessary, correct what the deployed staging
website's environment variables actually resolve to). No certification tenant has been
provisioned. No seed or teardown script has been executed against any target.
