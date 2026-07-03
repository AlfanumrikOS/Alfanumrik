# CERT-17 - Supabase configuration fully remediated; split-brain closed

2026-07-02, follow-up to the partial remediation (evidence 07) and the split-brain hazard
(evidence 03, Finding A).

## What is now fixed

All three Supabase credentials on the Vercel Preview environment now have a distinct
Preview-scoped override pointing at the staging project (gzpxqklxwzishrkiaatd), verified via a
direct post-change listing:

- Public Supabase connection URL - Preview-scoped to staging.
- Public anon key - Preview-scoped to staging.
- Elevated database credential - Preview-scoped to staging (set 2026-07-02, the final piece).

In every case, Preview was cleanly split out of the old shared entry (which retains
Production/Development/staging scope but no longer Preview), so there is no longer any Supabase
credential where Preview silently inherits the production value.

## Split-brain hazard - CLOSED

Finding A in evidence 03 (Preview client-side pointing at staging while the elevated credential
still pointed at production - an internally inconsistent, actively hazardous state) is resolved.
Preview is now internally consistent for Supabase: client and server both resolve to staging.

## What remains

- The Razorpay payment key on Preview is still the shared live-mode value (CONFIRMED FAILING,
  deferred by explicit CEO instruction). This is now the ONLY remaining CERT-17 configuration
  item. Its practical effect is narrow: only payment-journey steps would exercise it. Those
  steps must be skipped-and-marked (not run) during browser certification until a Razorpay
  test-mode key is set on Preview - running a payment flow against a live Razorpay key would
  attempt real charges.

## Net effect on the certification program

Browser-based (Path B) certification of all NON-PAYMENT journey steps against the deployed
Preview website is now UNBLOCKED - the environment is Supabase-consistent and points at staging.
Payment-journey steps remain blocked on the deferred Razorpay item and will be explicitly marked
as not-verified-pending-Razorpay rather than executed. ERG-1's three Supabase items are checked;
its Razorpay item and the umbrella "browser-based certification authorized" item remain open
pending the Razorpay decision.
