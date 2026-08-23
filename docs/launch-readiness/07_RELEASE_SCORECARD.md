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
| B - Database and migrations | FAIL (materially narrowed 2026-08-23) | The backup/restore drill HAS now been executed (restore/verify/teardown proven against staging); what remains is a data-population gap, not a mechanism gap. DB-12 was assessed against live production: 425/425 tables have RLS enabled and exactly ONE genuinely permissive write policy exists, so the INSERT/UPDATE/DELETE grants are largely redundant-but-inert rather than exploitable. The real unmitigated gap is TRUNCATE, which structurally cannot be governed by RLS and is still held by anon/authenticated on all 4 money tables. A forward-only remediation migration is DESIGNED but deliberately NOT APPLIED (needs its own review cycle). Still open: 30 SECURITY DEFINER functions plus 11 relations with zero migration provenance. |
| C - Authentication, RBAC, tenant isolation | FAIL | TSB-1 critical cross-tenant leak fix reverified and holds. 7 RLS-bypassing views with write-capable grants, and 13 client-write policies letting a student self-grant a paid plan, were both found live in production 3 days before this program started; both are now CONFIRMED CLOSED via fresh independent behavioral re-verification against live production (2026-08-23, see below) rather than FIXED-UNVERIFIED. Still FAIL: 77 percent of routes remain on the RLS-bypassing admin client, and DB-12 (broad table grants including TRUNCATE) is untouched. |
| D - Functional journeys | FAIL (fixable) | A real launch-critical student journey 404s today. School-admin people-management is inert unless a flag is manually flipped per tenant. Both concrete and fixable, not architectural. |
| E - Adaptive learning and Foxy | **FAIL (measured, was CONDITIONALLY READY)** | Core adaptive claim still holds under direct trace. But the RAG eval harness was re-run for real on 2026-08-23 (full path, Voyage rerank-2 + Claude judge both executing) and returned a machine verdict of REGRESS vs the 2026-06-14 baseline: recall@10 0.822 -> 0.661, nDCG@10 0.662 -> 0.512, MRR 0.729 -> 0.575, faithfulness ~0.40-0.47. Against the launch mandate's bars (recall@10 >= 95%, faithfulness >= 95%) BOTH fail by a wide margin. Recall@3, correctness and abstention are not computed by this harness at all -- no number exists for three of the five mandated metrics. The 'forced-OFF streaming flag' gap is CLOSED as a false alarm (live read: enabled, 100% rollout, a deliberate 2026-08-03 CEO-approved decision). Dead-end hint/retry buttons remain open. |
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

## Second-wave investigation results (2026-08-23, post "go ahead")
Four remaining scorecard items were worked in parallel. Two closed cleanly, one narrowed a FAIL
substantially, and one surfaced a NEW blocking finding that did not exist on this scorecard before:

- **NEW BLOCKER - RAG retrieval quality has genuinely regressed.** Not a stale-measurement problem as
  previously framed: the harness ran for real and returned REGRESS on every ranking metric, with
  recall@10 at 66.1% and faithfulness at ~40-47% against 95% bars. This is now the largest open
  engineering item in the program. It is also the one finding here that directly degrades the core
  product promise (a grounded, accurate AI tutor for CBSE students) rather than a governance or
  infrastructure control.
- **DB-12 is far less severe than the ledger's raw framing implied**, but is not nothing: RLS is on
  across all 425 tables with essentially no permissive write policies, so the headline
  "anon can INSERT/UPDATE/DELETE on 419 tables" overstates real exposure. TRUNCATE is the genuine gap
  and it is unfixable by policy - only a grant revoke closes it. Designed, not applied.
- **ff_foxy_streaming was a false alarm** - live-verified enabled at 100%, a deliberate CEO decision.
  A prior recon reported it forced-OFF while explicitly noting it lacked live DB access; that caveat
  turned out to matter. Worth noting as a pattern: three separate findings this program initially
  recorded as problems (this, the school-admin RBAC flag, the /review 404) dissolved on live
  verification. Code defaults and static reads are not evidence of production state.
- **GitHub Environments hygiene** - one real wiring bug found (mesh-cron.yml points at the wrong
  environment for its API key, currently inert) and one real hygiene issue (staging DB password stored
  as a plaintext variable rather than an encrypted secret). Nothing deleted; owner decision needed.

## Updated verdict

NOT READY - LAUNCH BLOCKED. (Unchanged in verdict, but the REASON has shifted materially since the last revision. Both owner-side actions are now done - deployment gating is applied and the backup/restore drill is executed. What blocks launch today is no longer process or access: it is a measured, reproducible RAG retrieval-quality regression that puts the core AI-tutor promise below its own accuracy bars, plus a TRUNCATE-level grant exposure on the money tables with a designed-but-unapplied fix. Those are open engineering work, and they are the right things to be blocked on.)

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
2. DONE, pending real-world verification (2026-08-23): CEO applied the Vercel-side toggle and ran the
   final GitHub-side command directly (USE_CLI_DEPLOY confirmed true as of 09:02:08Z); this program added
   the 2 missing GitHub secrets (VERCEL_ORG_ID/VERCEL_PROJECT_ID) that were also blocking it. Both settings
   are live, in the correct order, no in-flight deployment spanning the gap. What remains is not an action
   but an observation: the runbook's own verification procedure requires watching the next REAL push to
   main deploy exactly once via the CLI job (not doubled by Vercel's Git integration) - deliberately not
   manufactured by this program. Treat the first production push after this change as a watched event.
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
7. DONE (2026-08-23), and it surfaced a NEW BLOCKER: the RAG eval harness was re-run for real and shows a
   genuine measured regression, not merely a stale baseline -- recall@10 66.1% and faithfulness ~40-47%
   against mandate bars of 95% each. Leading hypothesis is corpus-growth dilution (16k -> 27k chunks)
   rather than a settings regression, but this is NOT root-caused yet and is now the single largest open
   engineering item on this scorecard. Three of the five mandated metrics (recall@3, correctness,
   abstention) are not computed by the harness at all and need harness work before they can be gated on.
   The streaming-flag half is closed: it was never actually off.
8. Once CI/reliability recon completes, fold its findings into this scorecard and re-issue the verdict if
   warranted.

This file will be revised as items close, following the same rule this whole program inherited: a fix is
not verified until a session that did not author it confirms it independently.
