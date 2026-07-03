# Environmental limitation: no local isolated Supabase environment

Documented per explicit instruction, rather than worked around.

## Finding

This execution environment cannot run a local, fully isolated Supabase stack. The Supabase CLI
is installed and functional (version confirmed), but Docker is not installed or not accessible
from this shell - attempting to start a local stack fails at the container-runtime layer before
any Supabase-specific step even begins.

## Why this matters

The originally-approved certification plan called for a three-stage progression: static
analysis, then local integration testing on a fully isolated dev-only database, then a
dedicated staging tenant. The middle stage assumed a local Supabase stack would be available as
a genuinely separate, throwaway environment with zero relationship to any shared project. That
assumption does not hold in this environment.

## What was checked before concluding this is a hard limitation, not a workaround-able gap

- Confirmed the Supabase CLI itself works (version check succeeded).
- Confirmed the failure is specifically a missing/inaccessible container runtime, not a
  Supabase-CLI configuration problem.
- Confirmed no alternative local database target exists in this repository's configuration -
  the only Supabase project reachable from this shell's environment configuration is the
  production project itself (see the isolation-assessment findings alongside this file).
- Deliberately did not attempt to install or elevate privileges for Docker, or to substitute
  a different local Postgres instance running the application schema outside of Supabase's own
  tooling, since either would introduce an unvetted, ad hoc environment for a certification
  exercise whose entire purpose is to avoid exactly that kind of unverified substitute.

## Consequence for the certification plan

Live integration testing this program performs will run exclusively against the dedicated
staging certification tenant (the former Stage 3), contingent on the Environment Readiness
Assessment in this same folder passing. There is no separate "Stage 2, local" evidence tier in
the resulting certification package - every live-execution finding will be staging-tenant
evidence, clearly labeled as such. This is recorded here as a known constraint of the current
execution environment, not resolved, and not treated as equivalent to having had a true local
isolated environment available.
