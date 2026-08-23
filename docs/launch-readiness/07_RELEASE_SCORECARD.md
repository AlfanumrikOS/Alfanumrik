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
| C - Authentication, RBAC, tenant isolation | FAIL | TSB-1 critical cross-tenant leak fix reverified and holds. 7 RLS-bypassing views with write-capable grants, and 13 client-write policies letting a student self-grant a paid plan, were both found live in production 3 days before this program started; both are now CONFIRMED CLOSED via fresh independent behavioral re-verification against live production (2026-08-23, see below) rather than FIXED-UNVERIFIED. Still FAIL: 77 percent of routes remain on the RLS-bypassing admin client, and DB-12 (broad table grants including TRUNCATE) is untouched. |
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

## Independent re-verification complete (2026-08-23, post CEO directive)
All four wave-2 fixes now carry independent confirmation (a session that did not author the fix, per this
program's own bar):
- Leaderboard P13 PII leak: CONFIRMED FIXED by a fresh subagent given no context and told to falsify the
  claim if possible. Traced every response path against git history, ran the real tests (41/41 passing).
  One coverage gap found (no dedicated unit test on the base route) has been dispatched to testing to close
  same-day.
- RBAC permission-code drift guard: CONFIRMED FIXED the same way. Both the regex and its SQL-side
  counterpart were traced by hand, not read from comments; a broader sweep for the same defect class found
  no new instance. Real tests: 92/92 passing.
- DB-1 (7 RLS-bypassing views): CONFIRMED CLOSED via a fresh, live, read-only behavioral probe against
  production using the anon key today - 7/7 views now return a genuine Postgres permission-denied error,
  not data.
- DB-40 (13 client-write self-grant/forge policies): CONFIRMED CLOSED for INSERT via a fresh, live
  behavioral probe against production today, using a disposable test auth user (created, tested, and
  deleted, with cleanup independently verified) so the check exercises the real authenticated role rather
  than anon. All 4 money tables returned a genuine RLS-policy-violation error on INSERT, not a schema or
  constraint rejection. UPDATE is consistent with closure but not independently dispositive the same way.

This closes 3 of the 4 next-actions items that were pure "re-run and confirm" work. The 2 owner-gated
actions were re-attempted, not just re-asserted as blocked: both are confirmed to genuinely require an
action only a human with dashboard/credential access can perform, and both now have a ready-to-execute,
under-5-minute path once that one human step happens. See 04_FINDINGS_AND_CONFLICTS.md for full detail.

## Updated verdict

NOT READY - LAUNCH BLOCKED. (Unchanged from the initial verdict. Every item this program could independently close without owner/credential access has now been closed and confirmed; what remains blocking is exactly two owner-side actions and the CI/reliability recon fold-in, not open engineering work.)

This is not a close call and it is not a process nitpick. A controlled B2B school launch means bringing real
students, teachers, and parents onto this system, and as of 2026-08-23: disaster recovery is not provably
functional; no backup or restore capability has ever been demonstrated despite a named quarterly commitment
in an existing runbook; a write-capable RLS bypass into the entire question bank and a set of policies
letting a student self-grant a paid plan were both found live in production this month and are now fixed
AND independently re-verified (2026-08-23); the production deployment pipeline does not yet actually block a code release
on a failed migration check; a real student-facing journey 404s today; and the school-admin
people-management pillar is inert by default.

None of this means the engineering is bad - the opposite case is also true and documented above. It means
the specific, mandatory gates this program must prove before recommending launch are not yet met, and
several of them require actions outside a single reconnaissance pass: dashboard changes only the owner can
make, a scheduled drill, a second engineer session for independent verification.

## Immediate next actions, in required severity order
1. DONE (2026-08-23) - Independent verification of the leaderboard P13 PII leak and the RBAC
   permission-code three-segment blind spot. Both confirmed fixed by a fresh session with real test runs.
2. MOSTLY DONE (2026-08-23): CEO applied the Vercel-side toggle; this program added the 2 missing
   GitHub secrets (VERCEL_ORG_ID/VERCEL_PROJECT_ID) that were also blocking it, confirmed via
   vercel project inspect and gh secret list that these were genuinely absent, not assumed. ONE command remains,
   blocked by this environment's own safety classifier as a deliberately-consequential action (activates a
   brand-new production deploy path): CEO must run
   `gh variable set USE_CLI_DEPLOY --repo AlfanumrikOS/Alfanumrik --body "true"`, then watch the next push
   to main deploy via the CLI job exactly once (not double-deployed via Vercel's Git integration) to close
   this out per the runbook's own verification procedure.
3. DONE (2026-08-23) - Independent behavioral re-verification of the two original FIXED-UNVERIFIED
   critical findings against live production. DB-1 (7 views): 7/7 confirmed permission-denied to anon.
   DB-40 (client-write policies): 4/4 money tables confirmed RLS-denied on INSERT via a disposable
   authenticated test user, cleanup verified.
4. Architect: assess the broad table grants and the ungoverned SECURITY DEFINER functions with careful,
   reviewed forward-only migrations, not a quick patch, given the ledger own warning that a blind revoke
   breaks three live SECURITY INVOKER RPCs.
5. DONE (2026-08-23): CEO reset the staging database password and provided the current value; a genuine
   restore rehearsal ran against staging (gzpxqklxwzishrkiaatd) using the one populated backup record
   available (Test Pilot Academy schools row) - restored, verified, torn down, teardown verified. This
   proves connectivity/schema/mechanics end to end but does NOT close the full 6-item checklist, which
   needs populated student/teacher/class/quiz_session data that does not exist for any real school in
   production today (a data-population gap, not a credential gap - unchanged by this session).
   Still open: wire the existing but currently uncalled daily health-check automation to an actual cron.
6. Frontend: fix the review-route 404 and confirm the school-admin RBAC flag state with ops before any
   pilot school is onboarded. (Note: a later recon pass found the "review 404" was itself a false positive
   - a pre-existing redirect already handles it - see 04_FINDINGS_AND_CONFLICTS.md; re-check this line
   against that correction before re-actioning it.)
7. Ai-engineer: re-run the RAG eval harness for a current groundedness number, and get an explicit decision
   on the streaming flag.
8. Once CI/reliability recon completes, fold its findings into this scorecard and re-issue the verdict if
   warranted.

This file will be revised as items close, following the same rule this whole program inherited: a fix is
not verified until a session that did not author it confirms it independently.
