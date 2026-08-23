# 04 - Findings and Conflicts

Status: LIVE - being populated as recon agents report. Do not treat any DONE or FIXED claim anywhere in this
repo as closed without an independently-run verification query.

## HEADLINE FINDING - a second, more recent, more rigorous security audit already exists

docs/audits/FIX-LEDGER.md is a live-integrity behavioral audit of production dated 2026-08-20/21, three days
before this program started. It used actual behavioral testing, not just static grep or read review, and
found a cluster of Critical, currently live production issues that the June engineering-audit program did
not catch. Most rows are still NOT-STARTED, several rows marked fixed are FIXED-UNVERIFIED, and there is
zero evidence anywhere in the repo of an executed backup or restore drill.

A separate, contemporaneous 5-agent quality audit, dated the same week, self-certified that RLS posture is
strong with no client-side admin client leaks, and found NONE of the issues in FIX-LEDGER. A grep or read
based review that self-certifies security posture is not equivalent evidence to a behavioral audit.

### Critical findings (from FIX-LEDGER.md, re-confirmed by architect recon 2026-08-23)
| ID | Finding | Status | Blast radius |
|---|---|---|---|
| DB-1 | 7 views held GRANT ALL to anon and authenticated, resolved as owner postgres which is RLS-bypassing. question_bank_student_safe was an apparent unfiltered anonymous WRITE path into all 18,765 question_bank rows. | FIXED-UNVERIFIED (2026-08-21), never independently re-checked. security_invoker itself is still unset. | All student PII plus the entire question bank |
| DB-40 | 13 client-write RLS policies on payment_history, student_subscriptions, subscription_events, student_daily_usage let an authenticated student self-grant the unlimited plan, forge or delete payment rows, reset AI quota. | FIXED-UNVERIFIED (2026-08-20, reasserted 2026-08-21) | All students, revenue integrity |
| DB-12 | anon and authenticated hold INSERT, UPDATE, DELETE, and TRUNCATE on roughly 419 to 427 public tables. Grants are project defaults, applied outside migrations. TRUNCATE is not subject to RLS at all, so the DB-1 and DB-40 RLS fixes do NOT protect against it. | NOT-STARTED | Every money and learner-state table |
| DB-16 | 41 public functions plus 11 relations exist live in production, in zero of 603 migrations, 30 of the functions are SECURITY DEFINER. is_active_admin, used by a live RLS policy on admin_users, is one of them. A from-scratch disaster-recovery rebuild would break admin auth. | NOT-STARTED | Disaster recovery is currently non-functional |
| DB-19/20/21 | payment_history.razorpay_signature is NULL on every one of 5 live rows; payment_webhook_events is empty despite live payments. Code-level HMAC verification IS real. | NOT-STARTED | Cannot prove P11 compliance for any live payment |
| Backup/restore | Zero evidence of an executed drill anywhere in the repo. The one piece of daily automation is called by nothing. | Gate B requirement, unmet | Total data-loss recovery capability unproven |
| Migration collision guard | The version-collision guard script is confirmed not wired into any CI workflow. | Proven by hand, zero automated enforcement | Future same-prefix collisions invisible |
| Edge Function drift | 102 Edge Functions deployed versus roughly 47 on disk. Three rival rag-answer functions hand-deployed with no source in repo. | NOT-STARTED, unverified this session | Unknown code running unreviewed against production data |
| DB-9 | Grade format split across 14 peripheral tables, silent zero-row joins, 6,061 content assets unreachable | NOT-STARTED | P5 invariant violation |
| DB-17 | atomic quiz profile update RPC has 4 live overloads disagreeing on argument order | NOT-STARTED | P1 score-accuracy invariant |
| DB-15/DB-27 | 3 flags documented OFF are live ON in production with NULL rollout percentage; school_id unpopulated on audit-relevant tables | NOT-STARTED, contradicts documented posture | Cross-tenant/school-scoping correctness for 3 live features |

### Positive re-confirmations (real, credit-worthy)
- TSB-1, the critical cross-tenant teacher-dashboard PII leak fix from Cycle 5, re-verified genuinely still
  in place, fail-closed behavior confirmed by direct code read.
- XC-3 service-role usage ratio re-measured fresh today by TWO independent recon agents, both converging on
  77 percent (roughly 312-316 of 408 routes), down from 87 percent (316/362) in June. Still a systemic gap.
- Webhook signature-before-processing (P11) and atomic subscription-status writes reverified and hold.
- Always-200 send-auth-email behavior and the 3-layer onboarding failsafe (P15) reverified and hold.
- SAO-1 and SAO-5 PII-export tiering reverified and hold exactly as claimed.
- Quiz submit idempotency design (required Idempotency-Key header, session-bound grading key, unique
  partial index, explicit race-catch-replay) is genuinely strong and should be the template other write
  paths converge toward.

### A still-CEO-gated claim in the audit backlog itself is stale
PRIORITY-BACKLOG.md and STATE.md describe TSB-4 (repointing canAccessStudent/is_teacher_of to
class_enrollments plus a teacher RLS policy) as still an open CEO-gated decision. Backend recon found this
already shipped in rbac.ts plus two migrations, one of which is a hotfix on the first. The shipped change
looks fine on inspection - the real risk is that OTHER still-gated items in the same docs (SLC-1 backfill,
AO-3) may also be stale and should not be trusted without re-verification.

### Roster dual-table split is still live across launch-critical routes despite the security boundary
already cutting over
canAccessStudent and is_teacher_of read class_enrollments, but assignment completion, the pulse class route,
the adaptive remediation cron, both leaderboard routes, the student daily-plan route, the super-admin
student profile route, the foxy assignments helper, and the lab-notebook list route all still read the
legacy class_students directly. Sync is maintained only by two narrow trigger classes with no delete mirror
and no reconciliation cron. Owner: architect for full consolidation, backend for the nine call sites.
Severity: High.

## Payment ledger findings (orchestrator PAY-2 investigation plus backend recon, 2026-08-23)
payment_history.amount has three writer paths: the verify route (a live subscription_plans lookup at verify
time), the webhook route (the actual Razorpay-captured amount), and the pending-row RPC used by subscribe
(atomic, safer). The unique constraint is on razorpay_payment_id; whichever INSERT wins is kept, the loser is
silently swallowed. The reconcile-payments cron only reconciles plan and status, never amount. Entitlement
itself is unaffected since activation runs through atomic RPCs keyed on plan code. This is a different,
narrower issue than the historical paisa-versus-rupee unit bug already runbooked in
payment-history-amount-backfill.md, fixed 2026-07-29. Recommend folding this into that runbook Follow-up
section. Current blast radius verified zero: production payment_history has exactly 5 rows total, ever.
Severity: Medium.

Also found: assignment-completion idempotency is a heuristic (byte-identical score/count within 15 seconds),
not a hard key - bounded and fail-safe, Medium severity. The upload-assignment v1 route has no idempotency
protection at all - Low-Medium. The schools join route grants membership from an invite code alone with no
second-party approval, but bounded by expiry/max-uses/seat-cap - Low severity, worth an explicit sign-off.

## Other process-integrity findings
- Regression catalog carries a self-reported count divergence (404/399/346) per its own header file - Low
  to Medium severity, process not product.
- The gitignore bare-pattern bug was fixed and verified this session on 2026-08-22.

## Adaptive intelligence and Foxy/RAG findings (ai-engineer recon, 2026-08-23)
The agent explicitly did not trust engineering-audit docs or two prior 2026-07-10 multi-agent reports as
ground truth, and traced actual source, migrations, and call chains directly. A live feature_flags query was
blocked by the sandbox network classifier, so flag-state claims below rest on the migration chain and the
flags defaults file, the best available static evidence - recommend a live read before final sign-off.

### Positive findings (the core adaptive claim holds)
- All 6 named Foxy action buttons (Got it, Explain simpler, Show example, Quiz me, Save to notebook, Report
  an issue) are genuinely wired to real backend writes, not stubs. Got it is confirmed the intended name -
  Git it was a documentation typo in CODEX_HANDOVER.md, not a broken feature.
- SRS review-due evidence DOES reach the live Today surface, through resolveTodayQueue reading a real due
  count backed by spaced_repetition_cards and a genuinely-written SM-2 schedule.
- Adaptive (weak/due-topic) quiz question selection is genuinely wired and state-dependent: two learners
  with different mastery histories do get different question sets, confirmed via a full traced call chain.
- CME mastery writing was consolidated to a single writer (submit_quiz_results RPC to
  update_learner_state_post_quiz, BKT plus SM-2) - the old cme-engine Edge Function is a structured-410
  tombstone with both prior callers confirmed dead and deleted in the same PR. No XP-style split-brain
  currently exists for mastery.
- The RAG single-retrieval-per-turn contract holds: exactly 3 call sites exist, 2 mutually exclusive per
  turn, the third gated on a flag that is forced OFF.
- The P12 no-unfiltered-output backstop is wired on the blocking, streaming, and legacy-fallback exits - no
  fourth exit path found that skips it.
- Cross-tenant RAG content isolation is a non-issue by construction - a single content source value, no
  per-school content mixed into the vector store.

### Gaps found (the looks-built-but-isnt-wired pattern this recon was asked to surface)
- Give me a hint and Let me try buttons render unconditionally on the live action bar but have zero client
  dispatch branch anywhere - tapping them does nothing and shows no error. Severity: High. Owner: ai-engineer
  plus frontend.
- The originally-built 5 SRS plus 1 ZPD daily-rhythm orchestrator and its API route are fully wired and flag
  is enabled globally, but the dashboard renderer that used to read it was deleted in an August orphan
  consolidation and never repointed - the orchestrator now has zero live UI reader. Not user-facing risk
  today since Today is served by a different, working mechanism, but it is dead capital and a trap for a
  future engineer. Severity: Medium.
- IRT-based question selection is OFF and explicitly protected by design pending a shadow-evaluation gate -
  this is correct and deliberate, not a bug, but should not be described as live in any launch material.
- The RAG groundedness baseline is about 10 weeks stale, measured before a CEO-approved provider swap to
  OpenAI-primary, and reported only 36.7 percent groundedness at last measurement. Retrieval metrics
  (recall/nDCG/MRR) are unaffected by the swap, but groundedness depends on the generation model and has
  never been re-measured against the new primary generator. Severity: Medium-High. Owner: ai-engineer to
  re-run the harness before launch sign-off.
- Real-time token streaming (ff_foxy_streaming) is forced OFF in production, contradicting a documented
  always-stream mandate elsewhere in the project instructions. The client degrades gracefully to a single
  blocking response, so this fails safe, but needs an explicit confirmation of whether this is an accepted
  product tradeoff before any launch material claims a real-time streaming tutor experience. Severity:
  Medium-High, needs a user decision, not purely an engineering one.
- The live student-facing model is OpenAI-primary, not Claude, per a CEO-approved unconditional swap dated
  2026-08-02 - this is correctly approved and pinned as a regression test, but the root project instructions
  still describe Claude as the tutoring model. Documentation drift only, no compliance issue.
- Two parallel report-an-issue data stores exist (a new ai_issue_reports table and a legacy path) - risk of
  fragmenting quality-review triage in the super-admin dashboard. Severity: Medium.
- Several flags had a documented mid-flight incident on 2026-07-20 (a console bulk-enable event with a
  same-day emergency restore) - the flag table has had real recent operational churn; re-verify live state
  before relying on any flag-state claim in this section for sign-off.

Verdict from this recon: CONDITIONALLY READY. The core adaptive and Foxy claims hold under direct trace, but
three items should be resolved before a school-facing launch: the dead-end hint/retry buttons, the stale RAG
groundedness baseline, and an explicit decision on the streaming tradeoff.

## Frontend journeys findings (frontend recon, 2026-08-23)
No distinct Codex findings doc exists anywhere in the repo (confirmed by a second, independent search) - much
of the code the handover asks about has been substantially reworked since, so this recon investigated current
code directly rather than relying on it.

### Real, fixable blockers
- The review button on the exam-prep study-plan page pushes to /review, but that route directory contains no
  page file at all - a genuine 404 mid-journey for any student on a review or revision task. Severity: High.
  Owner: frontend, likely a one-line repoint to /revision.
- ff_school_admin_rbac defaults OFF, and the staff-management API route returns a bare 404 whenever the flag
  is off - meaning the people-management pillar of the school-admin journey is entirely inert unless someone
  flips this flag per tenant before a pilot school signs on. Severity: Critical for a B2B launch specifically.
  Owner: ops.
- Several other B2B-facing flags default OFF and map directly onto launch-mandate journeys: teacher command
  center, teacher gradebook depth, teacher-parent comms, school command center (code comment claims globally
  ON in prod, contradicting the code default - only a live table read resolves this), school reports depth,
  education intelligence, principal AI. Severity: High. Owner: ops, needs one pre-launch flag checklist
  cross-referenced against the live flags table, not just code defaults.
- docs/product/mobile-web-sync.md is stale, dated April, and still claims mobile payment 404s and a broken
  quiz schema - claims that predate fixes the audit confirmed for pricing and score-config parity, but the
  quiz-schema and payment-endpoint claims specifically were never re-tested by those fixes. Severity: High
  as a documentation-integrity risk that could mislead a launch decision either direction. Owner: mobile
  agent, to re-audit the quiz-schema and payment-endpoint claims specifically.
- /quiz, the single most launch-critical screen, has zero dedicated accessibility or responsive test
  coverage - existing WCAG axe-core coverage exists and is real, but only for dashboard, teacher, and parent
  shells, and by the test file own comment those teacher/parent scans hit an unpopulated skeleton, not the
  real populated view. No school-admin or super-admin page is scanned at all. Severity: Medium. Owner:
  testing to extend coverage, frontend to fix findings once measured.
- The WCAG axe-core gate depends on an undeclared transitive dependency and silently self-skips via
  test.skip if that dependency is ever missing, producing no CI failure - a routine dependency bump could
  disable the entire automated accessibility gate invisibly. Severity: Medium. Owner: testing/architect to
  pin axe-core as a direct devDependency.
- Duplicate report-an-issue plumbing exists in Foxy (two different backing tables depending on which of two
  simultaneously-visible controls a student taps) - corroborates the same finding from the adaptive/Foxy
  recon agent independently. Severity: Medium.
- The foxy page component remains a 2,513-line, 133KB monolithic client component - the literal target of
  the handover UI-clutter complaint - and does not appear to have been decomposed, despite supporting
  component/hook directories existing alongside it. Severity: Medium, maintainability and possible bundle-
  budget risk on that specific route.
- DKT, as named in the original handover mission, does not appear to exist anywhere in this codebase - the
  system implements BKT instead. Likely a terminology mismatch in the original brief rather than a missing
  feature. Severity: Low.

### Positive findings
- Loading, error, and empty states on sampled launch-critical pages (student dashboard, quiz, parent, teacher)
  are real, not bare-happy-path.
- So-called legacy IA redirect stubs (school-admin people/academics/insights, parent home) are deliberate,
  well-documented compatibility shims with an explicit deletion criterion, not orphaned dead pages.
- Three DONE claims were spot-checked against current code and all three held up: grade-coercion read-time
  fix, the pending parent-link-approval card mounted on the live dashboard, and Foxy learning-action wiring.
- Bilingual coverage on sampled launch-critical pages has reasonable density, though it has no mechanical
  lint enforcer, matching what the prior audit already flagged as a Tier-3 gap.

Verdict from this recon: CONDITIONALLY READY. None of the findings require architectural rework - they form
a short, well-scoped punch list, but the review 404 and the school-admin RBAC flag are real launch blockers
until addressed.

## Remediation actions taken this session (2026-08-23, post CEO approval)

### Verified: ff_school_admin_rbac is NOT actually blocking anything live today
Frontend recon flagged this flag as defaulting to false in code, which would make the school-admin people
pillar entirely inert. A direct live read of the production feature_flags table shows is_enabled true,
rollout_percentage 100, last updated 2026-06-16. This is the same code-default-versus-live-database-state
divergence pattern the adaptive/Foxy recon separately found for a different flag. Corrected finding: this
item is CLOSED, not open - no action needed before school onboarding. General lesson restated: code defaults
in flags/defaults.ts are not reliable evidence of live state on their own; a live table read is required
before treating any flag finding as current.

### Backup drill executed (partial - backup half only)
First-ever executed backup export against production, per docs/runbooks/per-school-backup-restore.md,
adapted to the REST API since no native Postgres connection was available. See
docs/launch-readiness/evidence/2026-08-23-backup-drill/README.md for full method and limitations. Material
finding: production has no real B2B pilot school with populated roster data as of today - all 9 schools are
demo/test entities, and the 68 total students in the system are essentially unlinked to any school. The
restore half of the drill could not be demonstrated - no working staging database credentials are available
in this environment. Recommend provisioning a real staging project as a prerequisite for a true restore
drill, owner architect/ops.

### /review 404 fix dispatched to frontend
Confirmed the real destination is apps/host/src/app/(student)/revision/page.tsx (resolves to /revision - the
(student) segment is a route group, invisible in the URL). Dispatched to frontend agent with instructions to
verify the revision page is not itself a stub, check whether task context needs to be passed through, fix
all occurrences (not just the one found), and add regression coverage. Result pending as of this write.

### Vercel/GitHub deployment-gating change - still cannot be completed, even with approval
Confirmed gh CLI is authenticated with repo scope (could flip the GitHub repo variable immediately) and
Vercel CLI is authenticated and this project is linked. But vercel git only supports connect/disconnect
(severing the entire Git integration) - there is no CLI or discovered API path for the specific, narrower
setting the runbook needs (disable production auto-deploy for main while leaving everything else connected).
vercel project inspect confirms this setting is not surfaced anywhere in the CLI. Flipping the GitHub
variable alone, without the matching Vercel-side change, is explicitly documented in the runbook as producing
double production deploys - worse than the current state. This still requires a human with Vercel dashboard
access to perform the one narrow toggle; the moment that is done, the GitHub half can be executed immediately
via gh CLI in the same window.

## CRITICAL - a commit already on this branch reverted three separate dated security/audit fixes
## (found and fixed 2026-08-23, post CEO approval)

Commit b00b9c872 ("fix(quality): bilingual subject grid + mobile contract enum gap", 384 files changed,
co-authored by a third-party AI agent identity, not Claude) is almost certainly a botched merge or rebase.
For several files it resolved using a stale base, silently reverting work that had landed on origin/main
after that stale base was taken, while for other files in the same commit it merged forward correctly. This
was first surfaced by the CI/reliability recon agent as a single finding (authorizeOperator missing); direct
investigation found it is broader.

### Confirmed and fixed, with tests green
1. packages/lib/src/admin-auth.ts had deleted the entire authorizeOperator RBAC function (Mission Control
   Phase 1, 2026-08-16), its two supporting helpers, and auditPost (a P0-2 fix, 2026-08-20, that made audit
   writes check the response status instead of only catching network-level failures). It also regressed the
   audit-logging functions back to pre-fix behavior: silently dropping audit rows on a foreign-key violation,
   and losing the dual-write to the canonical audit_logs table entirely for one caller. Restored from
   origin/main - confirmed b00b9c872 was the only branch-local commit touching this file. 53 tests green.
2. apps/host/src/app/api/super-admin/debug/whoami/route.ts had reverted from calling authorizeOperator back
   to the older authorizeAdmin, undoing the same Phase 1 migration. Restored the same way. Combined with
   item 1: 56 of 56 tests green.
3. packages/lib/src/rbac.ts had deleted three permission constants from the registry (STUDENT_ROUTER_ACCESS,
   LEARNING_SOURCE_VIEW - explicitly documented as closing a P0-1 fix from 2026-08-20 where a route had NO
   permission check at all, and SUPPORT_VIEW_TICKETS/SUPPORT_MANAGE_TICKETS). Confirmed no code references
   these constants by name, and the one route enforcing this specific permission uses the raw string
   literal directly, so runtime security behavior was not compromised for that route - but registry
   integrity was damaged, reintroducing exactly the drift class of bug the deleted comments describe having
   fixed. Restored the same way, purely additive, zero risk given nothing referenced the constants.

### Still open - dispatched for systematic investigation
This commit touched 384 files total. A targeted check of packages/lib/src/feature-flags.ts (also flagged,
139 changed lines) found the OPPOSITE pattern on first read - a genuine forward improvement, not a
reversion - but the file still carries 182 lines of unreviewed diff against origin/main. Given the proven,
repeating damage pattern in three files already, a dedicated architect investigation has been dispatched to
systematically review the remaining files, prioritized by risk (packages/lib, API routes, Edge Functions,
migrations first), and to determine whether this commit's damage is now fully contained or whether the
branch needs a different remediation strategy - reverting the whole commit and re-deriving its legitimate
parts fresh against a clean main, rather than continuing to patch it file by file. Result pending.

This is assessed as the single most severe finding of this entire program to date, worse in kind than the
FIX-LEDGER production findings: those were live production issues found by a proper audit; this is an
already-fixed, already-tested security and audit-integrity regression sitting on the very branch created to
prepare this system for launch, that would have shipped invisibly if the CI/reliability recon agent had not
happened to run the specific failing test files this session.

## Correction - the /review 404 finding was a false positive
Frontend recon flagged apps/host/src/app/(student)/exam-prep/page.tsx's Review button as producing a real
404 via router.push('/review'), since app/review/ is an empty directory. Direct investigation found this is
incorrect: next.config.js line 153 has a pre-existing, deliberate redirect, /review permanently to
/refresh?tab=flashcards, predating this program, already covered by an existing regression test
(internal-href-route-resolution.test.ts) that documents several other call sites relying on the same
mechanism. Next.js redirects fire before filesystem routing resolves a page, so this never 404s. No code
change was needed; a new test was added (exam-prep-review-button-navigation.test.tsx, 4/4 passing) to pin
this specific call site into the same documented class, rather than leave it uncovered. This item is CLOSED,
not open - a second corrected finding this session, following the same pattern as the school-admin RBAC flag
correction. General lesson reinforced again: a plausible-looking, evidence-cited finding from one recon pass
still needs independent verification before acting on it - this is the second finding this session that
did not survive that check.

## UPDATE - systematic audit found the b00b9c872 damage is far more extensive (2026-08-23)

Architect completed a risk-prioritized review of roughly 90 of the 384 files this commit touched (RBAC,
auth, security, quiz scoring, support, infra first). Confirmed nine MORE instances of the same reversion
pattern, several materially worse than the three already fixed:

- apps/host/src/app/api/v1/admin/roles/route.ts - deleted the authorizeOperator defense-in-depth gate,
  reopening a documented incident where an admin-tier operator could grant themselves super_admin-equivalent
  reach. Fixed, 39/39 tests green.
- apps/host/src/app/api/super-admin/sessions/route.ts - force-logout reverted from admin tier back to the
  lowest support tier, reopening a documented release-blocker (any active admin could kick any user off
  every device). Fixed, 7/7 green.
- The support-ticket cluster (internal/admin/support, support/tickets/[id], plus UI) - deleted an entire
  student-reply feature, reverted an ownership check from dual-column back to single-column (reopening a
  case where a student could read a support ticket their parent filed about them - full cross-family PII
  disclosure), and reverted an audit-log fix back to logging raw note text instead of just its length (P13).
  Fixed, 190/190 green.
- packages/lib/src/sanitize.ts - reverted a linear-time tag-stripper back to an O(n squared) regex flagged
  by CodeQL as a polynomial ReDoS, reachable via the auth bootstrap route's name field. Fixed, 42/42 green.
- apps/host/src/app/api/auth/bootstrap/route.ts - reverted a fix so an already-bootstrapped student POSTing
  an elevated role now gets it echoed back as routing truth instead of DB truth; also reordered role
  validation to after acquiring the idempotency lock, burning its TTL on garbage input. Fixed, 198/198 green.
- packages/lib/src/supabase.ts - reverted removal of the P6 disproved-question serving floor, reintroducing
  a bug that could silently serve zero questions. Required manual reconciliation since this file also
  carries large genuine new security work. Fixed, 16/17 green (the one failure is unrelated pre-existing
  migration drift, not this commit).
- packages/lib/src/flags/protected-flags.ts - reverted a CEO-approved production flag-posture change,
  which would have failed every production deploys post-deploy flag-posture gate. Fixed, 119/119 green.
- packages/lib/src/notification-triggers.ts - reverted the bilingual notification shape back to a schema
  the notifications table does not have, which would break every guardian quiz-completion notification.
  Fixed, 126/126 green.
- Two more Mission Control authorizeOperator reversions (super-admin/users, internal/admin/users/[id]),
  the second also dropping actor-id from audit calls and reverting a PII fix (now logging raw guardian email
  instead of a resolved id). Fixed.

### A methodology finding worth keeping permanently
Not every damaged file can be safely restored wholesale from origin/main. Eight files were confirmed as
mixed - the SAME commit both reverted a real fix AND added genuine new work in the same file (the quiz
submit routes, the learner-loop next-action resolver, several today-queue support files). A blind restore
on these would have destroyed real, tested, wanted work (a session-bound idempotency fix, quiz resume, a
new completed-lesson-check feature). The architect agent caught this only because tests failed after an
initial blind restore, then manually reconciled hunk by hunk instead. Any future pass on the remaining files
must check for this before restoring anything wholesale.

### Confirmed damaged, NOT yet fixed - assigned to domain owners
- apps/host/src/app/(student)/quiz/page.tsx, learn/[subject]/[chapter]/page.tsx, pyq/page.tsx,
  reports/page.tsx, learn/page.tsx - confirmed mixed-shape damage, large diffs, needs the same manual
  reconciliation technique. Owner: frontend + assessment.
- supabase/functions/grounded-answer/{config,gen-ctx,pipeline,pipeline-stream,structured-prompt}.ts -
  confirmed pure deletion of an entire flag-gated Foxy feature with no replacement. Owner: ai-engineer.
- mobile/lib/api/v2/* and related Dart files - flagged by diff pattern as likely damaged, not individually
  opened. Owner: mobile.

### Coverage and current assessment
Roughly 90 of 384 files reviewed with hard evidence; ~294 remain unverified. This branch is NOT mergeable
until a further pass (frontend, assessment, ai-engineer, mobile each covering their flagged files) completes
the same diligence on the remainder. Reverting the whole commit is NOT recommended - it would destroy a
large amount of confirmed-legitimate, tested work bundled into the same commit. File-by-file (or hunk-by-hunk
within a file) targeted reconciliation is the only safe path, demonstrated to work by both the architect
and orchestrator on 12 files so far.

### Separately, unattributed to this or any dispatched work
Seven .claude/skills/*.md files show substantial modifications (492 insertions, 952 deletions) that cannot
be attributed to any action taken in this session by the orchestrator or any dispatched agent - none of the
recon or remediation prompts touched documentation. Flagged for the CEO's awareness; not committed, not
touched further, pending an explanation of their source (possibly a concurrent, separate session).

## Wave 2 remediation - ops domain complete (2026-08-23)
Ops reviewed all 8 assigned files. 5 damaged, all Shape A (single branch commit, clean reversion), restored:
- super-admin AdminShell.tsx - deleted a nav-truth fix, silently re-hid the real support-ticket console link
  and re-mislabeled the diagnostics page as the support center.
- super-admin support/page.tsx - deleted an entire audited User Actions panel (reset password, resend
  invite, fix relationship) whose backing API and audit-log calls were confirmed still intact - the revert
  orphaned working, audited functionality behind no UI.
- super-admin users/page.tsx - largest single-file instance so far: reverted confirm-gated Ban to
  unconfirmed, deleted Force Logout, Password Reset, Admin Tier panel, Edit Profile form, and Sessions panel
  entirely. All four backing components confirmed still on disk as real, non-scaffold code - orphaned, not
  deleted at the component level.
- docs/ADMIN_OPERATIONS.md - deleted an Open Operator Decisions section pointing to still-live runbooks.
- docs/runbooks/branch-protection-required-checks.md - reverted a correction back to a disproven claim
  about which CI checks main actually requires, the same claim whose earlier version already caused one real
  incident (a commit that skipped governance jobs and broke main).
3 files checked and confirmed genuinely clean (two looked like damage by diff shape but were confirmed, via
full-history cross-check, to be coincidental/self-healed by a later legitimate merge, not this commit).
Tests: 56/56 passing on the restored super-admin surfaces. One coverage gap flagged for testing: no
render-level test exists for the restored User Actions/Sessions/Admin-Tier panels specifically - recommend
adding regression coverage so this cannot be silently re-stripped again.

Six more domain passes (backend, frontend, architect, ai-engineer, mobile, testing) still running.

## Wave 2 remediation - mobile domain complete (2026-08-23)
Mobile reviewed all 37 assigned files. For every one, b00b9c872's parent commit was byte-identical to
origin/main, meaning this commit alone is fully responsible for all divergence in this file set - unusually
clean to attribute.

25 damaged and fixed (23 pure reversions restored wholesale, 2 mixed files manually reconciled):
- Most severe: v2_api_client.dart had a SchemaVersionCompatInterceptor deleted - this workaround exists
  because the generated API client cannot decode ANY real v2 server response without it (per the file's own
  documentation). Also deleted the only test seam wiring the servers retryable flag into offline-drain
  classification, which is why the next issue went unnoticed.
- An entire offline-drain terminal/requeue feature deleted in lockstep across 6 files: exponential backoff,
  a 168-hour age cap, and permanent-failure quarantine for offline quiz submissions, plus 3 matching test
  suites.
- 14 files of stale API client regeneration - dropped error-detail fields, leaderboard fields, and enum
  constants. Most critically: quiz_api.dart had its required idempotencyKey header parameter deleted from
  postQuizSubmit - a P4-relevant regression that would have broken mobile quiz-submission idempotency in
  production had it shipped.
- 2 files reconciled hunk-by-hunk to keep genuine new work (a real nullable-field bug fix, a P6 defense-in-
  depth column allowlist) while restoring what the same commit had reverted.

2 independent bugs found and fixed in NEW code (not reversions): two new dashboard/Foxy-panel files had
broken relative import paths that would have blocked compilation entirely - fixed by cross-checking sibling
files at the same directory depth.

10 files confirmed legitimate new work, no changes needed (a real bug fix reading correct DB columns instead
of ones that do not exist, additive PYQ-year wiring, an intentional retirement of a duplicate quiz runtime).

Flagged: Flutter tooling (flutter analyze/flutter test) is not installed in this environment - all
verification was via git-history diffing and manual brace/import-path checks, NOT compiler-verified.
Recommend a human with a Flutter SDK, or testing, run flutter analyze plus the 4 affected test files before
this branch is considered mergeable on the mobile side.

Four domain passes remain (backend, frontend, architect, testing) - architect visibly already restoring
constitution doc content (CLAUDE.md, .claude/CLAUDE.md corrections observed landing this session).

## Wave 2 remediation - ai-engineer domain complete (2026-08-23)
Reviewed all 11 assigned files (5 grounded-answer files named directly, plus 6 in
docs/launch-readiness/.b00b9c872-plan/aiengineer_all.txt). For every file, b00b9c872 is the ONLY
branch-local commit touching it (`git log --oneline origin/main..HEAD -- <file>`), so Shape A applied
throughout - no manual hunk-level reconciliation was needed anywhere in this bucket.

9 damaged and fixed, all restored via `git checkout origin/main -- <file>` (confirmed byte-identical to
b00b9c872's own diff beforehand, i.e. zero drift since):
- supabase/functions/grounded-answer/{config,gen-ctx,pipeline,pipeline-stream,structured-prompt}.ts -
  confirmed pure deletion of the entire ff_foxy_everyday_examples_v1 (everyday-Indian-life example)
  feature: the EVERYDAY_EXAMPLE_DIRECTIVE constant and buildStructuredOutputPrompt() composer
  (structured-prompt.ts), the GenCtx.everyday_examples cache-key fold-in (gen-ctx.ts), the Step-1b flag
  resolution and Step-9 prompt-assembly call sites in both pipelines, and the config.ts PROMPT_REV
  rationale comment - with no replacement. Verified this does NOT conflict with the other confirmed-live
  work in the same files: origin/main's restored versions still carry the P12 no-unfiltered-output
  backstop, the RAG single-retrieval-per-turn contract, and the OpenAI-primary/Claude-primary model-order
  rollout (`modelOrder: ModelOrder = 'openai_primary'` default in gen-ctx.ts, `shouldUseClaudePrimary` in
  pipeline.ts) side by side with the restored feature - all three coexist in origin/main today, so
  restoring wholesale reintroduces nothing that regresses them.
- eval/teacher-skills/harness/cli.ts - reverted a real ordering bug fix: the damaged version reads
  `process.env.ANTHROPIC_API_KEY` for the `--judge on` config gate AFTER calling `loadDotenv`, which
  refills an explicitly-empty key from `.env.local` - so on any machine with a real key on disk (this one
  included) the gate becomes unreachable. The fix captures the caller's ambient key BEFORE the self-load.
  Negative-control-tested: temporarily reinstating the b00b9c872 content made
  `apps/host/src/__tests__/eval/teacher-skills/cli.test.ts`'s
  "exit 2 when --judge on without ANTHROPIC_API_KEY" test fail (expected exit 2, got 0 - i.e. it would have
  silently proceeded to a live Claude call using the real key in this machine's .env.local instead of
  erroring). Restored version passes.
- requirements.txt, test_api.py, test_legacy_api_contract.py - not a code revert but a dead-code
  resurrection: full git history shows a prior commit (893ba7277, "chore: remove stale root
  requirements.txt and dead legacy-API test files") had already deleted these as confirmed-dead
  (`api_server`/`api.index` do not exist anywhere in the repo; `python/requirements.txt` is the real,
  CI-verified one). b00b9c872 silently re-added all three, undoing that cleanup. None of these are
  Foxy/RAG-related - they are an unrelated legacy Python prototype that only landed in this agent's bucket
  by root-level path heuristic. Fixed by deleting them again (matching origin/main, which correctly lacks
  them).

2 reviewed and confirmed genuinely clean (no fix needed): supabase/functions/alfabot-answer/prompt.ts and
its __tests__/integration.test.ts. These looked like candidates by directory proximity but diff origin/main
is empty for both - b00b9c872's change to this pair is itself a legitimate, already-upstreamed pricing-copy
correction (removes false subject-count claims from the AlfaBot pricing script, REG-65-adjacent), not
damage. Also outside this agent's domain ownership (AlfaBot is a separate sales/marketing bot, not
Foxy/NCERT-solver/quiz-generator/cme-engine) - flagged as reviewed-clean rather than acted on further.

Tests: Deno was not preinstalled in this environment; installed via `winget install DenoLand.Deno` (v2.9.5)
to get a real signal rather than relying on static reasoning alone. Full grounded-answer Deno suite (all 20
files in the CI DENO_TEST_TARGETS list for this directory, including everyday-examples-directive.test.ts):
259 passed, 0 failed. Teacher-skills eval harness Vitest suite
(apps/host/src/__tests__/eval/teacher-skills/cli.test.ts): 12 passed, 0 failed, plus the negative-control
run described above. `deno check` on the 5 restored grounded-answer files surfaced 3 pre-existing TS2322
errors (mapCallerToSurface's 'lesson' return type vs. ShadowFireArgs.surface's narrower union) - confirmed
NOT introduced by this restore: mol-telemetry-adapter.ts and mol-shadow.ts (which define both sides of the
mismatch) are untouched, byte-identical to origin/main, so this is preexisting origin/main type debt,
consistent with CI's own advisory (non-blocking) Deno-type-check-debt job. Flagged for whoever owns that
debt ledger, not fixed here (out of scope for a revert-repair pass and not something this restore caused).

Files changed by this pass (working tree, not yet committed to this doc): 6 modified (checkout-restored),
3 deleted. 2 reviewed-clean, 0 unresolved.

## Wave 2 remediation - ai-engineer and architect domains complete (2026-08-23)

### ai-engineer (committed 975cdfa6e)
Reviewed 11 files, 9 damaged and fixed (all Shape A), 2 confirmed clean. Restored the Foxy
everyday-Indian-life-examples feature across 5 grounded-answer files, deliberately deleted with no
replacement. Fixed a real eval-harness bug (API key read ordering made a safety gate unreachable on any
machine with a real key on disk) - proved the fix mattered with a negative-control test (reinstated the bug,
confirmed the test failed exactly as predicted, then restored the fix). Deleted 3 resurrected dead Python
files referencing modules that do not exist anywhere in the repo. Flagged the most important structural gap
found this wave: the test covering the everyday-examples feature is not wired into CI's Deno test target
list at all, which is very plausibly why this exact revert went undetected.

### architect (infra/CI/config, not yet committed)
Reviewed all 54 assigned files. 50 damaged and fixed (47 Shape A, 3 Shape B manually reconciled), 4 confirmed
clean. Highlights, most severe first:
- ci.yml had the EXACT SAME governance-job-skip bug reintroduced that caused a real, already-documented past
  incident (a PR merging green while silently breaking main, repaired 2026-08-11) - also dropped a
  merge_group trigger, a workflow_dispatch merge-base fallback, and timeout-minutes across multiple jobs.
- content-quality-nightly.yml reverted to a HARD-SUSPENDED stub, silently disabling the only automated
  detector for the question bank going empty (a defect that previously caused a month-long blind spot before
  being re-enabled and security-reviewed).
- .gitignore had tools/, .venv-bge/, and graphify-out/ removed - a real secret-hygiene regression, since
  tools/ is confirmed to contain a service-role-key-adjacent file and large binaries currently untracked on
  disk (matches an orchestrator finding from an earlier, separate session this week).
- next.config.js had a documented, necessary Next 16 monorepo build-error workaround removed - build-breaking
  if left reverted.
- Package manifests and the lockfile had multiple dependency downgrades (Sentry, jsdom, testing-library,
  eslint-parser) plus removal of a root dependency and a workspace type-check script needed for the
  monorepo's own type-check command to cover everything it claims to.
- e2e-suite.yml reverted secret handling from safe env-bound shell variables back to direct interpolation in
  a bash script - a shell-injection-adjacent regression.
- Two config files (CLAUDE.md, .claude/CLAUDE.md) required manual reconciliation rather than blind restore,
  since the same commit both reverted real fixes AND carried a genuinely newer, wanted improvement (the
  27,778-chunk NCERT corpus count correction) - kept the newer content, restored the reverted parts.
- Two generated-ledger JSON files (admin-client-allowlist, route-access-manifest) needed hand reconciliation
  against live ground truth rather than either historical snapshot, since their own generators would have
  destroyed hand-curated content - regenerated/verified against the actual current codebase, not either old
  snapshot.
- Found and flagged (not fixed, out of scope) one MORE regression: apps/host/src/app/api/v2/student/
  profile/route.ts reverted from an RLS-scoped client back to the admin client - independently confirmed
  already fixed by a concurrent agent this same session.
- Flagged 2 testing-owned files needing a follow-up: one already fixed by a concurrent agent, one
  (xc3-service-role-migration-batch.test.ts) still references a field the restored ledger design deliberately
  removed and needs a matching update.

Verdict from architect: APPROVE WITH CONDITIONS - infra/CI/config damage is fully repaired and independently
validated (tests, npm, YAML/JSON/JS parsing all re-run against final state), pending the one remaining
testing-owned file fix noted above.

IMPORTANT OPERATIONAL NOTE: architect independently confirmed what the orchestrator separately discovered -
this repository has multiple concurrent agent sessions sharing the same .git directory (git index.lock
contention observed twice). Committing must happen sequentially, one domain at a time, only after each
agent's file set is fully settled - a concurrent git add was found to sweep in far more files than intended.

## Wave 2 remediation - frontend domain complete (2026-08-23)
Reviewed 103 files (98 assigned plus the 5 named critical pages). 40 damaged and fixed (33 Shape A, 3 Shape
B manually reconciled, plus 3 cross-boundary fixes needed to keep the type-check green), 68 confirmed clean
or genuine forward work, 2 flagged for other domains.

Most consequential fixes:
- contact/page.tsx had reverted to a fake setTimeout Message Sent! toast with no actual server contact - a
  previously-fixed defect reintroduced.
- diagnostic/page.tsx and a shared hook had reverted from an authenticated fetch back to a bare fetch,
  meaning every student would hit a 401.
- FoxyPanel.tsx/MessageList.tsx/useFoxyChat.ts lost retry/backoff on gateway errors, lost abort/stop and
  request-dedup, lost learning-actions/voice/starter-intents, and lost tokensUsed/claudeModel telemetry -
  an AI-safety and reliability regression cluster, not just a UX one.
- CelebrationOverlay.tsx reverted a fix explicitly citing the P1/P2 score/XP invariants - the fix made
  score/XP optional specifically to avoid fabricating a grade for scoreless completions.
- A WCAG AA contrast-token fix cluster (5 files) was reverted together.
- Multiple honesty/fabrication reversions: a leaderboard page reintroduced a self-inflated rank #1 bug by
  reading client-side tables directly again, a library page reverted an honest ready-count back to a
  different, more permissive count, and a memory page reverted an honest data-purge disclosure back to an
  over-claim.
- progress/dashboard/page.tsx reintroduced Tailwind dark: classes, violating the no-dark-mode rule, and
  dropped an error state.
- welcome/layout.tsx dropped self-hosted bilingual fonts (Mukta Devanagari) in favor of next/font/google.

Cross-boundary dependency found: packages/lib/src/foxy/schema.ts (backend-owned) had its formula_sheet type
deleted by the same commit. Frontend worked around this by temporarily stripping the corresponding UI block
from FoxyStructuredRenderer.tsx rather than blind-restoring against a type that no longer exists - once
backend restores schema.ts, that UI block needs re-adding. Flagged directly to backend.

Also flagged, confirmed NOT b00b9c872 damage: a next.config.js gap (missing /mock-exam redirects) causing
one pre-existing test failure - unrelated to this commit, zero commits touch that file in the relevant
range, left for architect as a separate pre-existing issue.

Test results: type-check clean, ~3,700+ tests run across every touched surface and its neighbors, all
passing except 2 pre-existing failures independently confirmed unrelated to b00b9c872.

Only backend remains of the 7 dispatched domain passes.

## Wave 2 remediation - backend domain complete - ALL 7 DOMAIN PASSES NOW DONE (2026-08-23)
Reviewed 66 files, 39 damaged and fixed, 27 confirmed clean/forward, 1 flagged cross-domain to frontend
(now closed, see below). This is the single most severe finding of the entire program.

Most severe, by far: apps/host/src/app/api/v1/leaderboard/route.ts had reverted a documented P13 fix. The
restored-to-broken version leaked avatar_url, school_name, city, and board - a minors institution and
location - on a PUBLIC, unauthenticated, CDN-cached (60-second s-maxage) fallback response, and silently
swallowed honest failure into a fake empty-array success. The companion leaderboard/me route lost the
privacy-safe alternative it existed specifically to provide. This is a real, live-severity child-PII
exposure class finding, on a route that would have shipped to every visitor of the leaderboard page with no
auth required.

Also found, P0 total lockout (real students denied service, not a security leak but a functional break):
- student/engagement/route.ts reverted to checking a permission code never granted to any role - every
  student denied, only super_admin able to pass.
- student/daily-plan/route.ts reverted to selecting a column confirmed not to exist in the schema - every
  request 404d.
- school-admin/leadership/route.ts reverted a dated fix that had moved a feature-flag check to run before
  auth - anonymous callers got 200 instead of a 401/403 denial.

Also found: 7 internal-admin routes silently degraded their audit-log entries to IP-only (lost WHO performed
the action), a v2 student-profile route reverted from an RLS-scoped client back to the RLS-bypassing service
role client (independently cross-confirmed against architects concurrently-fixed access ledger), two subject
-governance validation guards reverted to silently falling through instead of a clean 400, an AI question-
repair tool reverted a fix that let an AI-edited question keep riding a stale human sign-off into the exam
tier, a shipped feature flag reverted to off contradicting both its own code comment and an already-applied
migration, and three files with import paths that do not resolve in their own packages tsconfig (a genuine
build-break, confirmed via a direct tsc run).

Cross-domain dependency: schema.ts (backend) had its formula_sheet type deleted; frontends consumer file had
been temporarily stripped of the matching UI block as a safe workaround pending this fix. Backend restored
schema.ts; the orchestrator has now closed the loop by restoring the consumer block in
FoxyStructuredRenderer.tsx now that its type dependency exists again - confirmed the current file diverges
from origin/main in nothing else before restoring.

Test results: 927 of 927 tests passing across every touched and verified file, packages/lib standalone
type-check clean.

## ALL 7 DOMAIN PASSES COMPLETE
ops (5 fixed) + mobile (25 fixed + 2 independent bugs) + ai-engineer (9 fixed, committed as 975cdfa6e) +
architect (50 fixed) + frontend (40 fixed) + backend (39 fixed) + the original architect/orchestrator pass
(12 fixed, committed as 9fa76616e) = well over 170 individual damage instances found and fixed across this
one 384-file commit, on top of the 12 already committed. A full monorepo type-check is running now as final
verification before sequential, careful commits (git index contention from multiple simultaneous agents was
independently confirmed by three separate agents this session - commits must happen one domain at a time,
not in parallel).

## Wave 2 remediation - testing/regression-catalog domain complete (2026-08-23)
Reviewed 39 files (7 regression-catalog shards + 32 test/E2E files). Found and fixed 21 damaged files.
Confirmed 18 clean or legitimate improvements.

Most consequential: a REG-id collision. b00b9c872 resolved a merge conflict by keeping one parallel
lineage's REG-numbered catalog entries while wholesale-deleting a different, independently-numbered
lineage that had reused the identical id range (REG-380-398) for entirely different content -
support-thread P13, identity-Bearer transport, ownership-guard RPC, leadership auth-gate, bootstrap
role-echo, quiz-serving truthy-[], tiered verification, Bearer quiz-submit, P0001 collision, rhythm-today
cache sentinel, and a 3-entry leaderboard SEV1 batch. All 18 entries' underlying test files still existed
and passed - only the catalog documentation had been deleted. Restored under non-colliding ids
(REG-400-419).

Also restored: the bootstrap role-echo test suite, the sanitize.ts ReDoS regression suite, and - most
operationally significant - the RBAC permission-code drift guard, whose reversion (from accepting 2+
dot-segments back to exactly-2) reopened a "three-segment blind spot." Restoring it immediately caught a
still-live RBAC bug in production code: student/engagement/route.ts was authorizing against a permission
code granted to no role, 403-ing 100 percent of students - independently confirming backend's own finding
of the same defect from a different angle, and confirming both fixes are now consistent.

This pass surfaced two genuine production-code regressions outside its own file scope, both now resolved:
- getChaptersForSubject() had lost its practice_ready_count passthrough (catalogued as REG-409). Confirmed
  CLOSED same-day by the concurrent frontend/backend Shape-B reconciliation of supabase.ts; catalog note
  updated to reflect the resolved state rather than leaving a stale FAILING annotation in place.
- packages/ui/src/navigation/nav-config.ts remained reverted to a 5-slot nav contract (should be 4,
  /learn demoted since the 2026-08-19 Today consolidation) - missed by the initial frontend remediation
  pass despite being in its assigned file list. Confirmed b00b9c872 was the only branch-local commit
  touching it, confirmed pure Shape A (comment-only reversion, no new work mixed in), and restored directly
  from origin/main along with two consuming components (MobileBottomNav.tsx, TabletNavRail.tsx, also
  comment-only Shape A) and two dependent unit test files (student-primary-nav-contract.test.ts,
  nav-reduced-motion-and-hindi.test.tsx) that had been reverted to assert the wrong 5-slot contract. All
  151 nav-related unit tests pass after the fix; the E2E nav specs this domain pass had already restored
  now agree with production code rather than asserting against still-broken code.

## Second confirmed instance of the Shape-A local-fix clobber risk (2026-08-23)
Before finishing the sequential commit process, checked whether any pre-b00b9c872-investigation local fix
had been silently clobbered by one of the 7 domains' broad Shape-A origin/main restores - the same failure
mode already caught once with .gitignore line 49 earlier this session. Confirmed: (a) .gitignore's fix had
indeed been re-clobbered by architect's workflow/config restore pass (origin/main never had the fix merged,
so `git checkout origin/main -- .gitignore` silently reintroduced the bare `Alfanumrik/` pattern);
re-applied and re-verified (`git check-ignore -v` on a mobile Kotlin path now correctly exits 1). (b) The
two files modified before this entire session began (supabase/functions/grounded-answer/prompts/inline.ts, supabase/functions/ncert-solver/index.ts) were confirmed
untouched by any of the 7 domains - zero branch-local commits touch either path outside this pre-existing,
out-of-scope change. No further instances found.

## Sequential commit execution complete (2026-08-23)
All confirmed fixes across all 7 dispatched domains are now committed, one domain per commit, each verified
via `git diff --cached --stat` immediately before committing to guard against the concurrent-agent git-index
contamination risk already observed twice this session:
- 9fa76616e (security/RBAC cluster, pre-dates this continuation)
- 975cdfa6e (ai-engineer)
- 8897071b1 (ops)
- 276b758cd (testing - includes the nav-config follow-up fix)
- e6e13886c (mobile)
- 885260107 (frontend - includes the nav-config/FoxyStructuredRenderer restorations)
- 364abd5fc (backend - includes the P13 leaderboard PII fix)
- a68ca88f7 (architect - includes the .gitignore re-fix)

Combined, these 8 commits close well over 190 individual damage instances from the single b00b9c872
384-file commit. A monorepo-wide type-check was run as a final coherence gate after all commits landed.

## Independent re-verification of wave-2 fixes complete (2026-08-23, post CEO directive "complete the owner-gated actions and re-verification of wave-2 fixes")

Per this program's own rule ("a fix is not verified until a session that did not author it confirms it
independently"), four items were re-checked. Two via fresh subagents with zero context from the fixing
session, given only the claim to falsify and told explicitly not to assume it is true. Two via direct live
production behavioral probes.

### Leaderboard P13 PII fix (apps/host/src/app/api/v1/leaderboard/route.ts + me/route.ts) - CONFIRMED FIXED
Independent agent traced every response path (RPC rung, fallback rung, error path) in the current file
against the pre-fix version from git history. Fallback-rung success now selects and projects only 7
whitelisted fields; avatar_url/school_name/city/board are not fetched, let alone returned. Error paths
return a fixed generic body with no-store on all three cache-control channels. A DB error on the fallback
rung now returns 500, not a fake empty-array 200. One framing correction: the route is gated by
authorizeRequest(request, 'leaderboard.view') - "unauthenticated" in the original finding describes the
commit message's own phrasing, not the current gate; the peer-field-exposure risk to any authenticated
student is what P13 addresses and that is closed. Real test run: 2/2 files, 41/41 tests passing.

Gap found and closed same-day: no dedicated unit test exercised the base route's GET handler directly (only
/me, /titles, /streaks, /my-class were covered). Dispatched testing to add one, asserting the field
whitelist, that extra DB columns cannot leak through, and the 500-on-error/no-store behavior - closing the
exact coverage hole that let this regress silently the first time.

### RBAC permission-code drift-guard fix (rbac-permission-code-drift-guard.test.ts) - CONFIRMED FIXED
Independent agent manually traced the regex (`^[a-z_]+(?:\.[a-z_]+)+$`) and confirmed it accepts 2, 3, or
more dot-segments with no upper bound - genuinely widened, not just re-labelled. Confirmed the SQL-side
extractors that build the "granted" universe from migrations were widened identically (both sides moved
together, so a real 3-segment granted code like super_admin.subjects.manage is not turned into a false-
positive orphan by asymmetric widening). Confirmed student/engagement/route.ts's current permission code
(progress.view_own) is genuinely granted to the student role by tracing the migration grant block directly,
not by trusting the code's own comment. Broader sweep across apps/host/src/app/api for other 3+-segment
authorizeRequest call sites found no new instance of the defect class - one legitimately-ungranted,
flag-gated code was already known and whitelisted. Real test run: rbac-permission-code-drift-guard.test.ts
81/81 + rbac-permission-code-extractor-totality.test.ts 11/11 = 92/92 passing.

### DB-1 (7 RLS-bypassing views, GRANT ALL to anon/authenticated) - CONFIRMED CLOSED, live production
Fresh behavioral re-test against production (shktyoxqhundlvkiwguu) using the anon key: SELECT attempted
against all 7 views (question_bank_student_safe, v_analytics_freshness_status, v_backup_health_summary,
v_my_consent_status, v_queue_health, v_secret_rotation_health, v_xp_ledger_drift). Result: 7/7 denied with
HTTP 401, Postgres code 42501 ("permission denied for view <name>") - the same SQLSTATE the original fix
migration's own write-path check produced. This is the read-only equivalent of the original detection
query's SET LOCAL ROLE anon check, run fresh, independently, today. Not separately re-tested under the
authenticated role (no test JWT was minted for this check), but the fix migration's REVOKE statement covers
anon and authenticated atomically in the same statements, so the anon result is strong evidence for both.

### DB-40 (13 client-write policies, self-grant/forge on 4 money tables) - CONFIRMED CLOSED for INSERT, consistent for UPDATE
This required a genuine authenticated-role test (the original threat model is a logged-in student), which
the anon key cannot represent. Created a disposable, clearly-marked test auth user via the admin API
(email db40-reverify-<timestamp>@internal.alfanumrik-audit.test), confirmed zero auto-created profile/
linkage rows (students/teachers/school_admins/user_roles all empty for this user), signed in for a real
JWT, then ran INSERT attempts against all 4 money tables (payment_history, student_subscriptions,
subscription_events, student_daily_usage) with a deliberately-invalid FK so no row could ever persist even
if the write were permitted. Result: 4/4 INSERT attempts returned HTTP 403, Postgres code 42501, "new row
violates row-level security policy" - an unambiguous, real RLS denial, not a schema/constraint rejection.
UPDATE probes (filtered to a nonexistent id, so zero rows could ever be mutated regardless of outcome)
returned empty results on the 2 tables where the payload matched the schema - consistent with (though not
independently dispositive of) the ledger's documented after-state of zero write policies remaining for
authenticated on these tables, since a table with only `*_own_select` policies and no UPDATE policy makes
every row invisible to an UPDATE's row-selection phase regardless of whether a matching row exists.
Cleanup verified: the disposable test user and any linkage rows were confirmed absent both before and after
the probes; the auth user delete was confirmed via a 404 on a follow-up existence check.

### Owner-gated actions - NOT completable by this program, re-confirmed this session
Both items approved by the CEO earlier this session remain genuinely blocked on access this program does
not have, re-confirmed fresh rather than assumed stale:
- Vercel Git production auto-deploy toggle for main (docs/runbooks/production-release-gating.md Section 3,
  setting A): `vercel project inspect alfanumrik` was re-run today and confirms the CLI surfaces only
  General and Framework Settings - no Git-deploy toggle of any kind. This is a dashboard-only setting.
  Approval does not substitute for the missing UI/API access path. Once a human disables it in the Vercel
  dashboard (Settings -> Git, ~1 minute), the GitHub-side half (repo variable USE_CLI_DEPLOY=true) and full
  verification can be executed immediately in the same window via gh CLI, already confirmed authenticated.
- Backup/restore drill staging rehearsal (docs/runbooks/per-school-backup-restore.md Section 4): requires
  direct Postgres credentials against the staging project (gzpxqklxwzishrkiaatd) or a service-role key for
  it. Re-confirmed today: no SUPABASE_DB_PASSWORD, SUPABASE_ACCESS_TOKEN, staging URL, or staging
  service-role key exists anywhere in this environment's .env.local, and no supabase/psql CLI session is
  authenticated against staging. The backup half (already executed and documented) stands; the restore half
  cannot proceed without the CEO or ops provisioning those credentials into this environment.

## Backup/restore drill - restore half completed (2026-08-23, after CEO provisioned staging credentials)
The credential blocker on the restore rehearsal is closed. After several rounds of Vercel/GitHub/env-file
updates that did not match what the live staging Postgres server actually accepted (four consecutive
password-mismatch failures across different stored copies - a genuine, reproducible signal, not a
propagation-lag artifact), the CEO reset the staging database password directly and provided the current
value via the local env file (not pasted into chat). Read-only connectivity confirmed immediately
(SELECT current_database(), current_user, now() succeeded against gzpxqklxwzishrkiaatd).

Ran the runbook's Section 4 staging rehearsal using the one populated record available from the earlier
backup half (Test Pilot Academy, docs/launch-readiness/evidence/2026-08-23-backup-drill/schools.json - the
only school with non-empty roster data; all others are 0 rows, as already documented). Confirmed the
staging schools table schema matches the backup exactly (41 columns). Confirmed no ID collision (school
absent from staging beforehand, 53 pre-existing unrelated rows). Restored (INSERT) the row, verified it
landed with correct values including the features_enabled array, confirmed the count moved 53->54, then
tore it down (DELETE) per the runbook's "staging should never accumulate test schools" rule, and verified
the teardown (0 rows remaining with that id, count back to 53).

This proves connectivity, schema compatibility, and the restore/verify/teardown mechanics end to end. It
does NOT close the full 6-item rehearsal checklist in docs/runbooks/per-school-backup-restore.md Section 4
(row-count-per-student/teacher/class parity, quiz_session linkage spot-check, school_admin dashboard render,
Foxy chat history load) - those require populated student/teacher/class/quiz_session/foxy_chat_messages
rows, and none exist for any real school in production today (the same content gap already documented in
the backup-drill README: all 9 production schools are demo/test entities with no real B2B pilot roster
data). That is a data-population gap, not a credential or mechanism gap, and is unchanged by this session's
work.

## Vercel/GitHub deployment-gating - GitHub secrets closed, one command remains
Added the two missing GitHub repo secrets (VERCEL_ORG_ID, VERCEL_PROJECT_ID - non-sensitive Vercel project
identifiers, not credentials, sourced from the already-linked local .vercel/project.json) that were blocking
the deploy job even after the CEO's Vercel-dashboard toggle. Confirmed no in-flight Vercel deployment before
and after. The final step, flipping the GitHub repo variable USE_CLI_DEPLOY to true, was blocked by this
environment's own safety classifier (a genuinely consequential action - it activates a brand-new, never-
yet-exercised production deploy path) rather than by any ambiguity in the CEO's approval. Handed to the CEO
to run directly: `gh variable set USE_CLI_DEPLOY --repo AlfanumrikOS/Alfanumrik --body "true"`. Once run,
the runbook's Section 4 verification (watch the next push to main deploy via the CLI job, not Vercel's Git
integration, exactly once) still needs to happen before this item can be marked closed.

## Notable side-finding: 21 GitHub Environments, several apparently created by mistake
While checking secret scoping for the above, found this repo carries 21 GitHub "Environments"
(Settings -> Environments), several of which appear to be created accidentally in place of a secret or
variable - e.g. environments literally named "USE_CLI_DEPLOY", "SUPABASE_DB_PASSWORD", "CRON_SECRET",
"supabase staging db password", "ANTHROPIC_API_KEY" - alongside the real, intentional ones (Production,
Preview, staging, agent-mesh-break-glass, etc.). This is cosmetic/hygiene, not a security exposure (an
"environment" with no secrets scoped to it does nothing), but it makes the real environment list harder to
audit at a glance and is worth a cleanup pass. Not actioned here - flagged for ops.

## Vercel/GitHub deployment-gating - both settings now live (2026-08-23)
CEO ran the final command directly (`gh variable set USE_CLI_DEPLOY --repo AlfanumrikOS/Alfanumrik --body
"true"`), confirmed via gh variable list: USE_CLI_DEPLOY = true as of 2026-08-23T09:02:08Z. Both halves of
the runbook's Section 3 change are now in place, in the correct order (Vercel-side auto-deploy disabled by
the CEO first, GitHub-side variable flipped after), with no in-flight Vercel deployment spanning the gap
(confirmed via vercel ls immediately before and after). This program did not push to main to force a test
deployment - the runbook's own verification procedure (confirm the next real push to main deploys exactly
once via the CLI job, not doubled by Vercel's Git integration) still needs to happen on the next actual
merge to main. Recommend treating the FIRST real production push after this change as a closely-watched
event per docs/runbooks/production-release-gating.md Section 4, rather than manufacturing an artificial one.
