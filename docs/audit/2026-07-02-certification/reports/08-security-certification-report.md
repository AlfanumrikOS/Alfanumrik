# 08 - Security Certification Report

Stage 1 (static/read-only), 2026-07-02.

## Authentication and session management

Supabase Auth (email/PKCE), session refresh handled in the platform's middleware. The
middleware's full multi-layer ordering was not re-traced line-by-line this wave (deferred,
MEDIUM confidence pending a deeper pass) but no contradicting evidence was found anywhere else
in this wave's work.

## Authorization / RBAC

The role-permission resolution mechanism was directly read and confirmed to filter on active
status and expiry for every layer (user-role assignment, role, and permission). A full RBAC
matrix-conformance migration was confirmed present and consistent with its own claim.

## RLS boundary enforcement

100% of the 71 real table-creating migrations enable row-level security in the same file - zero
gaps, mechanically swept and hand-confirmed. The service-role client is confirmed to never leak
into any client-exposed environment variable anywhere in the repository (a full-repo search
returned zero matches). 8 tables enable row-level security with zero policies (a deny-all,
service-role-only pattern); all 8 are backend-internal tables with a documented rationale, not a
defect.

## IDOR resistance

The platform's most severe historical finding - callers able to submit or mutate another
student's quiz data via a callable database function with no ownership check - is CONFIRMED
FIXED by direct read of the current function bodies, not by trusting the fixing commit's
message. An orphaned, unused overload of the same function sharing the defect class had its
execute privilege revoked rather than patched, which is the safer fix for a function with zero
live callers.

A second, related gap remains open: none of six identified database functions carry a
predicate excluding suspended or soft-deleted student accounts, meaning such an account can
still take and submit quizzes if it can reach those functions directly rather than through the
(already-patched) application routes. This is confirmed live-reachable through the shipped
mobile app's default configuration, not merely a theoretical direct-call attack. Tracked as
CERT-01, the most material open security-relevant finding of this wave.

## JWT handling and secrets

No instance of the service-role key or any equivalent credential was found in client-exposed
code or environment-variable naming anywhere in the repository.

## Deferred this wave (not flagged as a live gap, simply not re-derived from scratch)

CSRF/XSS/SSRF posture, rate-limiting implementation detail, and end-to-end audit-log coverage
completeness were not independently re-traced this wave - none were flagged as Tier-0 gaps by
the prior phases, and none surfaced as a concern in any other agent's work this wave. Recommend
a targeted Stage-2 pass for architect-level confidence on these three items specifically.

## Unresolved, not a defect per se

Whether four OAuth-related database tables actually exist in the live production schema could
not be settled without live database access; static evidence strongly suggests they do not,
which would mean a route pinned as "high-blast-radius" in the regression catalog is currently
either dead or failing on every call rather than protecting a live capability. Resolving this
requires a Stage 2/3 live schema check (CERT-09).

## Verified clean / re-confirmed this wave

Branch-protection configuration on the main branch was confirmed live (required status checks
match real CI job names byte-for-byte, admin bypass disabled). Foreign-key completeness on the
six previously-flagged gaps was confirmed fixed. Feature-flag seed backfill confirmed present at
the correct migration root. One new, low-severity gap was found that the prior audit's
equivalent sweep missed: a single database function marked with elevated privilege has no
explicit search-path guard, though it is unreachable by any non-service-role caller and every
internal reference inside it is already schema-qualified - low exploitability, tracked as
Post-Release-Acceptable (CERT-12).
