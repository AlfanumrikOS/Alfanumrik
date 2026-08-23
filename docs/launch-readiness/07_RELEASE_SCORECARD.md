# 07 - Release Scorecard

Status: UPDATED VERDICT, 2026-08-23 (wave 2). Original recon (architect, backend, frontend, ai-engineer,
CI/reliability) is superseded in part by a second, larger finding: the branch this program is running on
carries an undetected 384-file stale-base merge (commit b00b9c872) that had silently reverted a large
number of PREVIOUSLY-SHIPPED fixes across all 7 domains, discovered only because a routine post-recon
git-history audit found the branch diverging from origin/main in ways the original recon passes had not
attributed to any specific cause. All 7 domains (ops, ai-engineer, architect, frontend, backend, mobile,
testing) were re-dispatched to find and restore this damage. Over 190 individual damage instances were
found, fixed, and independently test-verified, and are now committed across 8 sequential commits (see
04_FINDINGS_AND_CONFLICTS.md for the full narrative). This scorecard folds in both the original recon
findings below and the wave-2 discovery, and elevates the single most severe finding from either pass.

## Gate-by-gate status

| Gate | Status | Basis |
|---|---|---|
| A - Repository reproducibility | PENDING | CI/reliability recon still running actual commands. Known concern: regression catalog self-reported count divergence, and a real still-open deployment interlock gap (see below). |
| B - Database and migrations | FAIL | Zero evidence of an executed backup/restore drill. 30 SECURITY DEFINER functions plus 11 relations exist in production with zero migration provenance, one underpinning a live admin RLS policy. Table grants including TRUNCATE to anon/authenticated on roughly 420 tables sit outside migration review by design. |
| C - Authentication, RBAC, tenant isolation | FAIL | TSB-1 critical cross-tenant leak fix reverified and holds. But 7 RLS-bypassing views with write-capable grants, and 13 client-write policies letting a student self-grant a paid plan, were both found live in production 3 days before this program started, both FIXED-UNVERIFIED. 77 percent of routes remain on the RLS-bypassing admin client. |
| D - Functional journeys | FAIL (fixable) | A real launch-critical student journey 404s today. School-admin people-management is inert unless a flag is manually flipped per tenant. Both concrete and fixable, not architectural. |
| E - Adaptive learning and Foxy | CONDITIONALLY READY | Core claim holds under direct trace. Three bounded gaps: dead-end hint/retry buttons, a 10-week-stale RAG groundedness baseline, a forced-OFF streaming flag needing an explicit product decision. |
| F - UX, accessibility, performance | FAIL (measurement gap) | Real WCAG coverage exists for some shells but not for quiz or admin surfaces, and depends on an undeclared dependency that can silently vanish. No breakpoint or load-testing evidence found. |
| G - Reliability and operations | FAIL | Same backup gap as Gate B. Production code deploys are not yet actually gated on migration-parity success, because a documented two-step dashboard change has not been applied - this requires owner action outside this program authority. |

## What is genuinely good
The June 8-cycle audit program did real, credit-worthy work: a critical cross-tenant PII leak was found and
fixed, payment split-brain risk was closed via atomic RPCs, and a lost AI-safety backstop was restored. All
of this was independently re-verified this week and holds. The core adaptive-learning and Foxy claims this
launch mandate cares about most are real, not vaporware. Quiz-submission idempotency is a genuinely strong
design that should be the template for weaker idempotency patterns found elsewhere. This engineering culture
already runs its own periodic production-readiness audits and maintains a detailed, dated evidence trail -
this program is extending a real practice, not introducing one to a vacuum.

## What changes the calculus
A second, independent, more rigorous, behavioral security audit was run against production 3 days before
this program started and found a cluster of Critical issues, most still NOT-STARTED, several
FIXED-UNVERIFIED, that a separate contemporaneous self-certifying review completely missed. This is the
dominant fact of this scorecard: it is not that nothing has been checked, it is that the most recent and
most rigorous check found real, live, unresolved Critical issues three days before this program began.

## Wave-2 discovery: single most severe finding of the entire program
A public, unauthenticated, CDN-cached (60-second s-maxage) leaderboard endpoint
(apps/host/src/app/api/v1/leaderboard/route.ts) had reverted a previously-shipped P13 fix and was, until
this pass, actively leaking avatar_url, school_name, city, and board for minors to any visitor with no
auth required, while silently swallowing honest failures into a fake empty-array success. This is worse
than the TSB-1 cross-tenant leak the original recon led with: TSB-1 required an authenticated session in
the wrong tenant, this required nothing at all and was cached at the edge. It is now fixed and covered by
existing tests; independent re-verification (a session that did not author the fix) is still required
before this can be marked resolved, per the same rule this program has applied throughout.

Also elevated: the RBAC permission-code drift guard's reversion had reopened a "three-segment blind spot"
that was concurrently confirmed live in production - student/engagement/route.ts was 403-ing 100 percent
of students. Both this and the leaderboard leak were introduced by the same single stale-base merge and
are now both fixed and committed, but neither has yet had its independent-session re-verification pass.

## Updated verdict

NOT READY - LAUNCH BLOCKED. (Unchanged from the initial verdict: this was already the correct call, and wave 2 adds severity and evidence rather than reversing it.)

This is not a close call and it is not a process nitpick. A controlled B2B school launch means bringing real
students, teachers, and parents onto this system, and as of 2026-08-23: disaster recovery is not provably
functional; no backup or restore capability has ever been demonstrated despite a named quarterly commitment
in an existing runbook; a write-capable RLS bypass into the entire question bank and a set of policies
letting a student self-grant a paid plan were both found live in production this month and are fixed but
not independently verified; the production deployment pipeline does not yet actually block a code release
on a failed migration check; a real student-facing journey 404s today; and the school-admin
people-management pillar is inert by default.

None of this means the engineering is bad - the opposite case is also true and documented above. It means
the specific, mandatory gates this program must prove before recommending launch are not yet met, and
several of them require actions outside a single reconnaissance pass: dashboard changes only the owner can
make, a scheduled drill, a second engineer session for independent verification.

## Immediate next actions, in required severity order
1. Independent verification session, not the session that authored the wave-2 fixes, of the leaderboard
   P13 PII leak and the RBAC permission-code three-segment blind spot - both are committed and test-covered
   but neither has had a session that did not author it confirm them independently, which is this
   program's own bar for calling anything resolved.
2. CEO/owner action, outside this program authority: apply the two-step Vercel/GitHub deployment-gating
   change during an announced deploy freeze.
3. Independent verification session of the two original FIXED-UNVERIFIED critical findings (the RLS-
   bypassing views and the client-write self-grant policies) - re-run the detection queries fresh, confirm
   or reopen.
4. Architect: assess the broad table grants and the ungoverned SECURITY DEFINER functions with careful,
   reviewed forward-only migrations, not a quick patch, given the ledger own warning that a blind revoke
   breaks three live SECURITY INVOKER RPCs.
5. Schedule and execute one real backup/restore drill against a non-production copy, and wire the existing
   but currently uncalled daily health-check automation to an actual cron.
6. Frontend: fix the review-route 404 and confirm the school-admin RBAC flag state with ops before any
   pilot school is onboarded.
7. Ai-engineer: re-run the RAG eval harness for a current groundedness number, and get an explicit decision
   on the streaming flag.
8. Once CI/reliability recon completes, fold its findings into this scorecard and re-issue the verdict if
   warranted.

This file will be revised as items close, following the same rule this whole program inherited: a fix is
not verified until a session that did not author it confirms it independently.
