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

## DB-12 assessment: how urgent is the anon/authenticated grant exposure, really? (architect, 2026-08-23)

Assessment-and-design-only task, per explicit instruction. Nothing below was applied to production.
Method: direct read-only Postgres connection to production (`shktyoxqhundlvkiwguu`), using
`SUPABASE_DB_PASSWORD` from the local env file (never printed, never sourced in bash) plus
`psycopg2` with `set_session(readonly=True)` — `information_schema`/`pg_catalog` are not exposed
through PostgREST (`supabase/config.toml` only exposes `public`/`graphql_public`), so this is the
only way to query RLS/grant catalog state directly rather than through the app's own REST surface.

### Is RLS actually solid on the ~420 affected tables? Yes, almost universally.
Live measurement (2026-08-23), not carried over from the ledger:
- **425 of 425 tables in `public` have RLS ENABLED. Zero tables have RLS disabled.** This is the
  single most important number for judging DB-12's urgency: there is no table today where the
  inherited INSERT/UPDATE/DELETE grants are the only thing standing between an unauthorized caller
  and a write.
- 43 tables have RLS enabled with **zero policies** — deny-all for every role except
  BYPASSRLS `service_role`/`postgres`. This is the safe case, not the risky one (includes `coupons`,
  the DB-2 fix's own intended end-state, plus mostly internal/ops tables: `security_*`,
  `textbooks`, `textbook_chunks`, `users`, `invite_codes`, `model_pricing`, etc.).
- A naive "does a write policy have a NULL/`true` qual" sweep first returned 365 false-positive
  hits — because INSERT policies structurally have a NULL `qual` (not applicable) and DELETE
  policies structurally have a NULL `with_check` (also not applicable), and UPDATE/ALL policies
  with an unspecified `with_check` inherit `qual` rather than defaulting open. Correcting for real
  Postgres semantics (INSERT gated by `with_check` only; DELETE/UPDATE/ALL gated by `qual`) drops
  this to **exactly 1 genuinely permissive write policy across all 425 tables**:
  `demo_requests_public_insert` (INSERT, `{anon,authenticated}`, `with_check = true`) — a public
  lead-capture form, not student/PII/money data, plausibly intentional. Nothing else in the entire
  schema has an open write gate.
- **Net effect: the ledger's own framing holds up under independent verification.** For
  INSERT/UPDATE/DELETE specifically, the grant-level exposure is real but redundant-but-inert
  almost everywhere — RLS is doing its job. This materially lowers how urgent a full schema-wide
  INSERT/UPDATE/DELETE revoke is, versus how it reads in the ledger's raw table-count framing
  (`anon` 419/`authenticated` 427 tables, now measured at 412/420 — moved by 7 each in 3 days, not
  investigated further, re-run the query before quoting either number again).

### TRUNCATE is the part that is NOT redundant-but-inert — independently re-verified, not just repeated
Two structural checks, not a repeat of the ledger's claim: (1) `SELECT DISTINCT cmd FROM pg_policies`
across the whole database returns only `{SELECT, INSERT, UPDATE, DELETE, ALL}` — TRUNCATE has never
existed as a policy command, because `CREATE POLICY ... FOR {...}` has no `FOR TRUNCATE` clause;
(2) this matches PostgreSQL's documented behavior that TRUNCATE authorization is controlled purely
by the table-level TRUNCATE privilege, never consulting row-security policies. Consequence: the 43
deny-all tables' RLS posture provides **zero** protection against TRUNCATE — a full-table wipe is
gated only by the grant, on every one of the ~412-420 tables that hold it, regardless of how tight
that table's policies are. Confirmed live: all 4 money tables (`payment_history`,
`student_subscriptions`, `subscription_events`, `student_daily_usage`) still carry the exact
`{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,
service_role=arwdDxtm/postgres}` ACL — all 8 privileges including TRUNCATE — unchanged by DB-40
(which dropped policies, never grants), matching the ledger's "Known gaps" warning exactly. Money
tables also confirmed at exactly 8 live policies today (4 `*_own_select` + 4 `service_role` ALL),
consistent with the ledger's documented DB-40 after-state.

One honesty check on severity: PostgREST (the only channel this app's `anon`/`authenticated`
Postgres roles are normally reached through — browser, mobile) has **no HTTP verb that maps to SQL
TRUNCATE**. There is no known *direct* external exploitation path via the product's normal REST
surface today. The exposure is real as a latent capability — reachable via any future SECURITY
INVOKER RPC or Edge Function that issues a TRUNCATE, a direct Postgres connection opened as
`anon`/`authenticated` (e.g. a leaked pooler connection string), or a Studio SQL editor session run
under the wrong identity — not as a proven live incident. Treat it as "close this because nothing
should ever have this capability," not "this is being actively exploited today."

### The 3 SECURITY INVOKER RPCs the ledger flags — full call chain traced, not assumed
Live `pg_get_functiondef` + `prosecdef` confirm all three are genuinely `SECURITY INVOKER`
(`prosecdef = false`) with a pinned `search_path = public, pg_temp`:
- `record_learning_event()` → INSERT `adaptive_interactions`; calls `update_mastery_bkt()` (itself
  SECURITY INVOKER — traced one level deeper, not assumed safe) → SELECT/INSERT/UPDATE
  `concept_mastery`; SELECT `curriculum_topics`/`subjects`; calls `award_xp()` (SECURITY DEFINER,
  unaffected by any grant change).
- `mark_notification_read()` → UPDATE `notifications`. The function performs **no ownership check**
  on the notification id — the entire authorization boundary is the `notif_own` RLS policy
  (independently confirmed non-permissive in the sweep above). The UPDATE grant is a prerequisite
  for that policy to even be evaluated, not a substitute for it.
- `teacher_create_class()` → SELECT `teachers`; INSERT `classes`; INSERT `class_teachers`. Same
  structural note: the function does not itself verify `auth.uid()` against `p_teacher_id` — the
  real ownership boundary must be the `WITH CHECK` on the `classes`/`class_teachers` INSERT
  policies, which this pass did **not** re-verify (flagged as a dependency to check before any
  future grant narrowing touches these three tables).

### Migration DESIGN produced (NOT applied, NOT run against any environment)
`supabase/migrations/20260823154500_db12_narrow_default_grants_and_money_table_write_revoke_DESIGN_ONLY.sql`
— a forward-only design artifact, loudly marked in its own header as unapplied and requiring a
separate review/approval cycle before `supabase db push`. No `db push` or migration-apply command
was run. Shape:
1. **Explicit carve-out grants** (not revoke-then-regrant) for the 3 RPCs' full traced dependency
   tables (`adaptive_interactions`, `concept_mastery`, `curriculum_topics`, `subjects`,
   `notifications`, `teachers`, `classes`, `class_teachers`) — self-sufficient re-assertions of
   privileges that are already true today, so they survive even if a later migration narrows the
   default further without re-reading this file.
2. **Default-privileges narrowing, going forward only** — `ALTER DEFAULT PRIVILEGES ... REVOKE
   INSERT, UPDATE, DELETE, TRUNCATE ... FROM anon/authenticated`, affecting only tables created
   after this migration. Zero behavior change for the 425 existing tables. SELECT is deliberately
   left alone in the template.
3. **TRUNCATE, schema-wide, on existing tables** — a `DO $$` loop scoped to `pg_class.relkind = 'r'`
   (ordinary base tables only), so the 7 DB-1 views are excluded **by construction**, not by a
   naming list that could drift. Chosen schema-wide (unlike INSERT/UPDATE/DELETE) specifically
   because TRUNCATE is never mitigated by RLS anywhere and no legitimate application call site
   issues it as `anon`/`authenticated` (grepped across `apps/host`, `packages`,
   `supabase/functions`, `mobile` — none found).
4. **Targeted INSERT/UPDATE/DELETE revoke on the 4 named money tables only** — SELECT explicitly
   preserved (the `*_own_select` policies need it to function; revoking it would turn "read your
   own rows" into "read nothing," a regression). A schema-wide INSERT/UPDATE/DELETE narrowing
   across all ~420 tables is explicitly **not** attempted — it needs the "complete write-path map"
   that `20260821121232_converge_money_table_client_write_policies.sql`'s own header already
   identified as a blocking prerequisite, especially now that at least one genuinely-permissive,
   plausibly-intentional write policy (`demo_requests`) is confirmed to exist in this schema.

Explicitly does **not** touch: the 7 views handled by `20260821082059` (re-confirmed live today
still showing `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`, no anon/authenticated
entry), `demo_requests`' intentional public INSERT policy, any RLS policy anywhere, any SELECT
grant anywhere, or `coupons` (flagged as a candidate for the next batch, left out to keep this
migration's diff small).

**Required follow-up flagged in the file itself:** once Section 2 lands, every future migration
that creates a table needing `authenticated` writes must include an explicit
`GRANT INSERT/UPDATE/DELETE ON <table> TO authenticated` in the same migration — the implicit
default grant that silently provided this today will stop existing for new tables. The
`supabase-patterns` skill's migration template does not currently show this step and should be
updated in the same change that ever applies this design.

**Not done, and flagged as needing a human/separate cycle before this can move**: `supabase db
push` was not run. This file sitting in `supabase/migrations/` means the next `db push` against any
linked project will pick it up in version order unless a human reviews it first — treat that as a
blocking item on this branch, not a passive footnote.

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

## GitHub Environments audit — investigation and finding (architect, 2026-08-23)

Investigation only, per explicit instruction. **Nothing was deleted** — no environment, no secret,
no variable. This follows up the earlier "Notable side-finding" entry above with the actual
per-environment secret/variable contents and a full workflow cross-reference, not just the
observation that the 21-environment list looks odd.

### Method
`gh api repos/AlfanumrikOS/Alfanumrik/environments/<name>/secrets` and `/variables` for each of the
12 confusing-looking environments, then a full, case-insensitive grep of every `.github/workflows/
*.yml` for a job-level `environment:` key (static AND a check for any dynamic
`environment: ${{ ... }}` expression — none exist anywhere in this repo's workflows, so a static
grep is a complete answer here, not a sampled one). Cross-referenced every hit against
`gh api .../actions/variables` (repo-level variables) and `gh secret list` (repo-level secrets) to
determine whether an environment's contents are the only copy of something real or an unreachable
duplicate. Also resolved one ambiguity directly: GitHub environment name matching is
**case-insensitive** — confirmed by querying both `production` and `Production` and getting
byte-identical secret lists back, so workflows' lowercase `environment: production` correctly
targets the `Production` environment shown in the environments list.

### Per-environment findings

| Environment | Holds | Referenced by any workflow's `environment:` key? | Real copy exists elsewhere? | Verdict |
|---|---|---|---|---|
| **supabase** | Secret `SUPABASE_SERVICE_ROLE_KEY` | **Yes** — `rag-cosine-replay.yml:100`, the job's own comment explains it was deliberately scoped here (not repo level) specifically to keep an RLS-bypassing credential out of every other workflow's reach, after two earlier runs aborted when the job first declared no environment, then the wrong one | N/A — this *is* the real, intentional, sole copy | **Actually in use — leave alone.** The one environment of the 12 that is genuinely load-bearing. |
| **ANTHROPIC_API_KEY** | Secret `ANTHROPIC_API_KEY` | No. `mesh-cron.yml`'s `tick` job has its own code comment (lines 52-56) stating this environment is *exactly* what makes `secrets.ANTHROPIC_API_KEY` resolve — but the job actually declares `environment: agent-mesh-break-glass`, not `environment: ANTHROPIC_API_KEY`. Real bug: the two purposes (secret scoping vs. break-glass approval gating) need the same single `environment:` slot and only one was picked | No repo-level `ANTHROPIC_API_KEY` secret exists at all, and `agent-mesh-break-glass` holds zero secrets of its own | **Needs owner decision — do not delete.** This is the deliberately-provisioned, *intended* secret store for a real feature with a real wiring bug. Currently inert only because the entire workflow is Phase-0 hard-suspended (`gate` job always outputs `enabled=false` and exits 1; `tick`'s `if: needs.gate.outputs.enabled == 'true'` never fires) — but the bug must be fixed before mesh-cron is ever un-suspended, or the very first live run fails at its own "Required-env check" step. |
| **CRON_SECRET** | Secret `CRON_SECRET` | No | Yes — repo-level secret `CRON_SECRET` (used by `ci.yml`, `deploy-production.yml`, `production-cron-runner.yml`, `staging-adaptive-drill.yml`), plus a separately-scoped copy inside the real `Production` environment | **Orphaned duplicate — delete-safe.** |
| **SUPABASE_ACCESS_TOKEN** | Secret `SUPABASE_ACCESS_TOKEN` | No | Yes — repo-level secret of the same name, used directly by 10 workflows | **Orphaned duplicate — delete-safe.** |
| **SUPABASE_DB_PASSWORD** | Secret `SUPABASE_DB_PASSWORD` | No | Yes — confirmed live inside the real `Production` environment (which also holds `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, Android signing secrets, GCP secrets), the actual copy `deploy-production.yml` and `schema-reproducibility-fix.yml`'s `environment: production` jobs read. No plain repo-level copy of this exact name exists (only `SUPABASE_STAGING_DB_PASSWORD` does) | **Orphaned duplicate — delete-safe.** |
| **voyage** | Secret `VOYAGE_API_KEY` | No | Yes — repo-level secret of the same name, used by `ci.yml` and `rag-cosine-replay.yml` (whose one job scopes `environment: supabase`, not `voyage`) | **Orphaned duplicate — delete-safe.** |
| **supabase anon key** | Secret `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | Yes — repo-level secret of the same name. Also: this key is not sensitive in the way a service-role key is (it ships in the browser bundle and mobile app by design, per this repo's own architecture) | **Orphaned duplicate — delete-safe.** |
| **supabase url** | Secret `NEXT_PUBLIC_SUPABASE_URL` | No | Yes — repo-level secret of the same name; also just a public URL, not sensitive | **Orphaned duplicate — delete-safe.** |
| **USE_CLI_DEPLOY** | Secret `VERCEL_PROJECT_ID` (name mismatch vs. environment name) | No | Yes, and this resolves the "genuinely alarming mismatch" cleanly: the REAL `VERCEL_PROJECT_ID` is a repo-level secret (added THIS session, 2026-08-23, alongside `VERCEL_ORG_ID`, for the CLI deploy path). The REAL `USE_CLI_DEPLOY` gate is an entirely separate thing — a repo-level **variable** (not this environment), confirmed flipped to `"true"` by the CEO this session at `2026-08-23T09:02:08Z`, matching the "both settings now live" entry above | **Orphaned duplicate — delete-safe.** Looks alarming by name, has zero operational reach: no job anywhere declares `environment: USE_CLI_DEPLOY`. |
| **supabase staging db password** | **Variable** (not secret) `SUPABASE_STAGING_DB_PASSWORD`, value plainly readable via the API | No | Yes — a real, correctly-stored `SUPABASE_STAGING_DB_PASSWORD` **secret** exists at repo level (created 2026-08-21, itself possibly superseded by the CEO's later in-session password reset — not re-checked here) | **Needs owner decision — the standout hygiene issue of the 12.** Unlike every other entry, the defect here is not "confusingly named and inert" — it is a real database credential stored in a GitHub Environment **variable**, which (unlike a Secret) is returned in plaintext by the API to anyone with Actions-settings read access. Recommend converting/removing this specific variable promptly regardless of whether the value is still current — storing any password as a variable is the defect, independent of freshness. |
| **SUPABASE_STAGING_ACCESS_TOKEN** | Nothing — confirmed via API: zero secrets, zero variables | No | N/A | **Delete-safe — genuinely empty, holds and does nothing.** |
| **ENABLE_PYTHON_AI_PRODUCTION_DEPLOY** | **Variable** (not secret), value `"true"` | No | Yes, and again a name mismatch worth flagging: the REAL, load-bearing gate is the repo-level variable of the identical name, currently `"false"` — `python-ai-deploy.yml`'s three jobs read `vars.ENABLE_PYTHON_AI_PRODUCTION_DEPLOY` while declaring `environment: Production`, so they resolve against `Production`'s own copy if one exists there, else the repo-level fallback (`"false"`). Confirmed: Python-AI production deploys are correctly OFF at the real location | **Needs owner decision.** Not a security exposure (a `"true"`/`"false"` boolean isn't sensitive), but a live footgun: anyone who inspects the Environments list to determine whether Python-AI prod deploys are enabled would see `"true"` here and reach the wrong conclusion. Recommend deleting to remove the misleading duplicate. |

### Recommendation summary
- **Delete-safe** (orphaned, zero workflow reach, real copy already exists elsewhere or not
  sensitive): `CRON_SECRET`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `voyage`,
  `supabase anon key`, `supabase url`, `USE_CLI_DEPLOY`, `SUPABASE_STAGING_ACCESS_TOKEN` — 8
  environments.
- **Needs owner decision** (not simply cosmetic — each has a real, distinct issue behind the
  confusing name): `ANTHROPIC_API_KEY` (fix `mesh-cron.yml`'s `environment:` key before ever
  un-suspending Phase 0, don't delete the environment itself), `supabase staging db password`
  (highest-priority of the three — a real credential sitting in a plaintext-readable variable,
  not a secret), `ENABLE_PYTHON_AI_PRODUCTION_DEPLOY` (misleading duplicate value, delete
  recommended but flagging for a decision rather than doing it here since it touches deploy
  gating).
- **Actually in use, leave alone**: `supabase` — the one environment of the 12 that is genuinely
  load-bearing today.

None of the 12 were deleted, and no secret value beyond what `gh api` already legitimately returns
for an authorized investigation was persisted anywhere in this repo.

## RAG eval-harness re-run — current groundedness/retrieval numbers (ai-engineer, 2026-08-23)

Re-ran the B1 retrieval-quality eval harness for real (no fabricated numbers) to replace the
10-week-stale baseline number cited in the earlier ai-engineer recon and in Gate E.

### Command actually run
```
cd <repo root>
npx tsx eval/rag/harness/cli.ts
```
Run twice back-to-back to sanity-check judge noise. Both runs were genuinely full-path
(`full_path: true, degraded: false`) — `VOYAGE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`NEXT_PUBLIC_SUPABASE_URL` were all present via `.env.local` (read by the CLI's own `loadDotenv`),
so Voyage rerank-2 and the Claude-Haiku groundedness judge both actually executed - this is not a
degraded FTS-only run and not a fabricated/skipped measurement.

### Side finding: the documented npm-script path bug is already fixed, not still open
Root `CLAUDE.md` describes `apps/host/package.json`'s `eval:rag:harness` script body as
`npx tsx eval/rag/harness/cli.ts`, which would indeed fail from `apps/host`'s cwd. That is stale -
the script body on this branch is actually `npx tsx ../../eval/rag/harness/cli.ts`
(`apps/host/package.json:36`), fixed by commit `34fd721cf` ("fix(build): repair 22 dead npm script
paths, add a canary, unbreak the PII guard") well before this session. Verified two ways: (1) Node's
own `path.resolve()` against `apps/host` as cwd resolves to the real repo-root
`eval/rag/harness/cli.ts`; (2) `npm run eval:rag:harness` run for real from `apps/host` completed
successfully end-to-end (same verdict/metrics as invoking the CLI directly from repo root, given
retrieval is deterministic). This is a small, separate doc-drift item (root CLAUDE.md's "unresolved
discrepancy" text should be corrected) - not chased further, per scope.

### Actual current metrics vs the 2026-06-14 baseline
| Metric | Baseline (2026-06-14) | Current (run 1) | Current (run 2) | A7 band | Verdict |
|---|---|---|---|---|---|
| nDCG@10 | 0.6617 | 0.5124 | 0.5124 | 2% relative | REGRESS (-0.1494, band max -0.0132) |
| recall@10 | 0.8222 | 0.6611 | 0.6611 | 2% relative | REGRESS (-0.1611, band max -0.0164) |
| MRR | 0.7286 | 0.5749 | 0.5749 | 3% relative | REGRESS (-0.1537, band max -0.0219) |
| hit-rate@10 | 0.9667 | 0.8667 | 0.8667 | 2pp absolute | REGRESS (-0.10, band max -0.02) |
| groundedness-rate (= faithfulness) | 0.3667 | 0.4000 | 0.4667 | 3pp absolute | not regressed either run (improved or flat) |
| multi_hop@10 (reported, not gated) | n/a | 0.6000 | - | - | informational only |

Machine verdict both runs: **REGRESS** (harness's own three-state gate: PASS / REGRESS /
INCONCLUSIVE - see `eval/rag/harness/verdict.ts`). The four retrieval-ranking metrics regressed
past their assessment-set A7 bands; only groundedness (the LLM-judge faithfulness metric) did not
regress, and it did not improve to anywhere near a launch-credible level either - it moved from
36.7% to 40.0%/46.7% between two back-to-back runs of the *same* settings, which is itself useful
context: the judge is noisy (LLM-graded, non-deterministic) enough to swing ~7pp run-to-run, so
treat "~40-47%" as the honest current range, not a single precise number.

Full report artifacts (gitignored, not committed - `eval/rag/reports/` is in `.gitignore`):
`eval/rag/reports/rag-eval-2026-08-23T09-20-07-177Z.json` (run 1, groundedness 0.400),
`eval/rag/reports/rag-eval-2026-08-23T09-30-25-045Z.json` (run 2, via the npm script, groundedness
0.467).

### Mapping onto the launch mandate's named thresholds - 2 of 5 are not measured by this harness at all
The launch mandate cites Recall@10 >= 95%, Recall@3 >= 90%, faithfulness >= 95%, correctness >= 90%,
abstention >= 99%. This harness (`eval/rag/harness/`, per `verdict.ts`'s `PRIMARY_METRICS`) only
computes 5 gate metrics: nDCG@10, recall@10, MRR, hit-rate@10, groundedness-rate - plus an
informational multi-hop@10. Concretely:
- **Recall@10** - measured directly: **66.1%**, against a 95% mandate bar. Fails by a wide margin,
  and also fails the harness's own tighter regression band against baseline (82.2%).
- **Faithfulness** - this harness's `groundedness-rate` is the same concept (an LLM-judge pass/fail
  per turn on "is the answer supported by the retrieved chunks"), measured at **~40-47%** against a
  95% mandate bar. Also fails by a wide margin.
- **Recall@3, correctness, abstention** - **not computed by this harness at all.** There is no
  recall@3 surfaced as a primary/reported metric (only @10 is gated; `K_VALUES = [5,10,20]` exists in
  `metrics.ts` but only @10 is a gate metric in this run), no separate "answer correctness vs. ground
  truth" judge distinct from groundedness, and no abstention-rate metric (how often Foxy/ncert-solver
  correctly declines rather than hallucinating) anywhere in this eval harness's design. Do not
  report a number for these three - there isn't one. Closing this gap (adding recall@3, a
  correctness judge, and an abstention-rate metric) is new scope for the harness itself, not
  something this re-run could produce.

### Root-cause note (flagged, not fully resolved - out of this task's scope)
Checked whether the retrieval regression is a settings change: it is not. Current retrieve()
settings (RRF k=60, MMR lambda=0.7, fetch-N=40, Voyage voyage-3 embeddings + rerank-2) and the
groundedness judge model (`claude-haiku-4-5-20251001`, `grounding-check.ts:24`) both match what the
baseline file's own `settings_note` documents - no provider/model/parameter drift found. Checked
whether the golden set's pinned chunk IDs went stale (e.g. superseded by re-ingestion): live REST
query against `rag_content_chunks` for all 47 unique chunk IDs referenced by the golden set's 30
items found 46 of 47 still present, `is_active=true`, `version=1` (i.e., not superseded) - only one
ID is genuinely gone. That alone cannot explain a 16-point recall drop. The much more likely
explanation: the corpus has grown substantially since the 2026-06-14 baseline was measured - the
current live `ncert_2025`/`is_active=true` chunk count is **27,228**, consistent with the
CLAUDE.md-documented 27,778-chunk total measured 2026-08-11 (up from the ~16,006 figure that was
itself later found to be a 73%-low undercount from the 2026-07 audits) - meaning a materially larger
haystack is now competing for the same fixed top-10 slots on the same 30 fixed golden queries, which
would suppress recall/nDCG/MRR/hit-rate exactly as observed without any settings regression.
**This is a plausible, evidence-supported hypothesis, not a confirmed root cause** - characterizing
it properly (e.g., per-chapter dilution analysis) is follow-up work, not something to resolve inside
this measurement task.

### Recommendation: Gate E should NOT keep describing this as "a 10-week-stale baseline"
That framing implied an unmeasured, possibly-fine risk. It is now a **freshly measured, confirmed
sub-threshold result on both axes the mandate cares about**: recall@10 measured at 66% against a 95%
bar, and faithfulness measured at 40-47% against a 95% bar, plus a harness-gated REGRESS verdict on
4 of 5 retrieval metrics versus the last reviewed baseline. Recommend Gate E's RAG/Foxy line be
tightened from "a 10-week-stale RAG groundedness baseline" (implying an open question) to something
like "RAG groundedness and retrieval quality freshly measured and confirmed below the launch mandate
on both faithfulness (~40-47% vs. 95% required) and recall@10 (66% vs. 95% required); Recall@3,
correctness, and abstention-rate are not measured by the current harness at all." Whether that moves
Gate E's overall status from CONDITIONALLY READY to FAIL is the orchestrator's call, not mine to
make unilaterally, but the underlying evidence is now real and unfavorable, not merely stale.
Did not touch `docs/launch-readiness/07_RELEASE_SCORECARD.md` - reserved for the orchestrator per
instruction.

## ff_foxy_streaming - the flag is NOT forced off; it is live at 100% (ai-engineer, 2026-08-23)

The prior recon (this same file, "Adaptive intelligence and Foxy/RAG findings" section above) stated
"real-time token streaming (ff_foxy_streaming) is forced OFF in production" but explicitly caveated
that a live DB read was blocked and recommended one before sign-off. This is that live read, and it
reverses the earlier claim.

### Live production state (read via REST, service-role key parsed from `.env.local` in a Python
script, never sourced in bash, never printed)
```
flag_name: ff_foxy_streaming
is_enabled: true
rollout_percentage: 100
target_roles: []          (unscoped -> applies to everyone)
target_environments: []   (unscoped)
updated_at: 2026-08-02T11:41:16Z
```
`packages/lib/src/flags/defaults.ts` does not declare this flag at all (grepped, zero matches) - the
flag's behavior is governed entirely by the live DB row above via `isFeatureEnabled()`
(`packages/lib/src/feature-flags.ts`), which defensively defaults to `false` only when the row is
missing or unreadable. The row exists and is readable, so that default never applies here.

### Full history reconstructed from migrations + commit history (not just the current row)
1. **2026-04-29** (`supabase/migrations/_legacy/timestamped/20260429000000_p1_foxy_streaming_flag.sql`):
   flag created, seeded OFF, described as an operator-toggleable Phase 1.1 feature ("Operators can
   flip this flag in the super-admin console in under 30s if streaming misbehaves").
2. **2026-07-20 10:15 UTC** (`20260720110000_feature_flags_data_repair_ceo_approved.sql`, block ii):
   CEO-approved posture explicitly buckets `ff_foxy_streaming` into the 52-flag forced-OFF list,
   generically reasoned "feature not built, not launched, or retired" - no streaming-specific
   incident or concern found in this migration's text.
3. **2026-07-20 10:30-10:44 UTC**: an operator console bulk-enable accidentally re-enabled 49 of
   those 52 forced-OFF flags (including this one) to 100%.
4. **2026-07-20 13:00 UTC** (`20260720130000_restore_approved_flag_posture.sql`): emergency restore
   returns it (and the other 48) to OFF/0.
5. **Between 2026-07-20 and 2026-08-02**: drifts back to ON via an unaudited direct-DB write - the
   same signature the 2026-08-02 rollback migration documents for several other flags in this window
   (e.g. `ff_model_gateway_v1`, `ff_unified_memory_v1` - zero `admin_audit_log` rows for the change).
6. **2026-08-02** (`20260802160000_rollback_confirmed_flag_drift_incident.sql`): reviews 11 similarly
   drifted flags; rolls 8 back to OFF; explicitly and by name **excludes** `ff_foxy_streaming` (plus
   `ff_goal_aware_rag`, `ff_grounded_ai_concept_engine`) - "held for a separate CEO decision. Do not
   add these without a distinct CEO-authorized change."
7. **2026-08-03 05:01 IST / 2026-08-02 23:31 UTC** (commit `9c0c4aae0`, "fix(flags): approve 3
   remaining flags as intentionally-live in governance"): that separate decision lands - commit
   message: "Removes ff_foxy_streaming, ff_goal_aware_rag, ff_grounded_ai_concept_engine from
   EXPECTED_OFF_FLAGS since they are confirmed real, tested, functioning features already live in
   production with no incident history, completing the flag-drift cleanup started in PR #1439."
   `packages/lib/src/flags/protected-flags.ts:521` carries the same rationale inline. This is the
   one substantive, reasoned decision on record, and it is pro-streaming, not anti-streaming.
8. **Current** (verified live, 2026-08-23): unchanged since 2026-08-02T11:41:16Z - ON at 100%,
   matching the 2026-08-03 approval, roughly 3 weeks of unincident production operation.

### (a) Is this deliberate/documented/still-valid, or a forgotten override?
**Deliberate and currently valid - the opposite of a forgotten override.** There is a clear,
CEO-authorized decision trail (step 7 above) that was made after an incident review specifically
considered rolling it back and chose not to. The "forced OFF" framing - both in this task's premise
and in the prior recon entry above - is stale relative to the live state; nothing found suggests
the 2026-08-03 approval has since been reversed.

One real doc-hygiene gap found in the course of this: the DB's own `protected_feature_flags.reason`
column for this flag (migration `20260722090000`, still live today, re-checked via REST) still
reads "CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not
launched, or retired. Do not re-enable without an approved rollout plan." - directly contradicting
its actual approved-live status since 2026-08-03. Only the TS-side `EXPECTED_OFF_FLAGS` list/comment
was updated by commit `9c0c4aae0`; the DB companion table's reason text was never corrected. This is
a real, if low-severity, self-contradiction in the governance registry - recommend a small
architect-owned migration to correct the stored reason text (not a behavior change, a text fix).

### (b) User-facing behavior difference between streamed and non-streamed today
Read `apps/host/src/app/api/foxy/route.ts` (streaming branch ~line 2308-2358) and
`packages/ui/src/foxy-panel/useFoxyChat.ts` (the actual client hook `apps/host/src/app/foxy/page.tsx`
consumes, via the `apps/host/src/app/foxy/_hooks/useFoxyChat.ts` re-export stub):
- **Streaming ON (current reality for most turns):** client requests `stream: true` by default -
  `shouldUseStreaming()` returns `true` unless the student has explicitly opted out via
  `localStorage.alfanumrik_foxy_stream = '0'`. Server responds via SSE
  (`handleStreamingFoxyTurn`, `_lib/streaming.ts`), rendering text token-by-token as it arrives -
  materially better perceived latency for a chat UI, with a visible "typing" effect, versus waiting
  for the full response.
- **Forced blocking regardless of the flag** for two turn types, both for safety/gating reasons
  unrelated to the flag itself: `coachDirective === 'quiz_me'` and real-practice turns (the inline
  MCQ must be oracle-gated - P6/REG-54 - on the FULL structured payload before display; a streaming
  text delta can't carry a gate checkpoint), and any turn with an image upload
  (`payload.imageBase64`).
- **P12 no-unfiltered-output backstop applies identically on both paths** (already confirmed in the
  prior recon's trace: "wired on the blocking, streaming, and legacy-fallback exits - no fourth exit
  path found that skips it"); this re-check did not find anything to contradict that.
- Net effect: with the flag ON (as it live is today), ordinary Learn/Explain/Practice(non-MCQ)/
  Revise/Doubt text turns in production **are already streaming** for students who have not opted
  out - this is not a hypothetical choice being deferred, it is today's actual behavior.

### (c) Why was it off, and is there a documented reason?
No streaming-specific incident, bug, or cost-control rationale was found anywhere in the migration
chain or commit history for the original forced-OFF classification - it reads as a conservative
default inherited from the flag's dormant Phase-1.1 history (grouped generically with "not built,
not launched, or retired" flags in the 2026-07-20 posture, alongside genuinely-unbuilt features like
`wave2_video_lessons`), not a deliberate anti-streaming call. The only substantive, reasoned decision
on record is the pro-streaming one (step 7 above). The "always stream" mandate language the task
refers to traces to this agent's own rejection-condition list (`.claude/agents/ai-engineer.md`:
"Streaming disabled for real-time tutoring... unacceptable without streaming") plus the prior
recon's framing - no separate product spec/runbook establishing an "always stream" requirement was
found beyond that.

### Recommendation
**Leave it as currently configured (ON, 100%) - no flag flip needed or recommended.** It already
matches the one deliberate, CEO-reviewed decision on record, it has roughly 3 weeks of production
history with "no incident history" per that review, and the safety backstop (P12) is confirmed
identical on both paths. The action items here are documentation fixes, not a flag decision:
1. Correct the stale `protected_feature_flags.reason` text for this flag (architect-owned migration;
   text-only, no behavior change) so the governance registry stops self-contradicting.
2. Correct Gate E's scorecard line ("a forced-OFF streaming flag needing an explicit product
   decision") - that decision was already made on 2026-08-03 and the live state matches it; this is
   the orchestrator's call to make in `07_RELEASE_SCORECARD.md`, not mine to edit directly per
   instruction.
3. Correct any other project documentation describing Foxy streaming as currently forced-off.
No flag was flipped by this investigation. This entire section is measurement + recommendation only.

## Gate A — CI/reliability recon: 5-check pass (testing, 2026-08-23)

Read-only recon closing out Gate A's "repository reproducibility" line. All 5 checks below ran real
commands against this branch, `origin/main`, and live GitHub API/Actions state — nothing here is
carried over from memory. No file was changed by this pass except this entry.

### 1. Regression catalog count divergence — confirmed real, and moving in real time
`.claude/regression/00-header.md` already documents an unresolved 3-way divergence as of its last
full reconciliation (2026-08-11/2026-08-23): 404 upper-bound / 399 "honest" declared totals vs 346
independently-measured body-backed `REG-N` ids (58/53 gap, explicitly flagged as pre-existing and
NOT resolved by the header's own 2026-08-23 restoration pass, which added 18 entries back after
`b00b9c872`'s bad merge deleted them).
Independently re-ran the header's own stated measurement command against the current tree:
```
$ cd .claude/regression && SHARDS=$(ls *.md | grep -v '^00-header.md$')
$ { grep -rhoE '^#{2,4} +REG-[0-9]+' $SHARDS; grep -rhoE '^\|[[:space:]]*\*{0,2}REG-[0-9]+' $SHARDS; } \
    | grep -oE '[0-9]+' | sort -n -u | wc -l
367          # max id: 420
```
That is 21 MORE body-backed ids and 2 HIGHER a max id than the header's own last-declared state
(346 measured / max 418, "REG-419 is the next free id"). Traced the delta: two brand-new entries —
**REG-419** (`02-foxy-ai.md`, ncert-solver -> grounded-answer prompt-parity canary, backed by the
untracked `apps/host/src/__tests__/edge-functions/ncert-solver-prompt-parity.test.ts` visible in
today's `git status`) and **REG-420** (`02-foxy-ai.md`, Foxy dimension-feedback + AI-quality
dashboard P13 aggregate-only contract, backed by the untracked
`apps/host/src/__tests__/api/super-admin/ai-quality.route.test.ts`) — were filed by a concurrent
ai-engineer/backend session THIS SAME DAY, after the header's 2026-08-23 reconciliation note was
already written. Also spot-checked `01-subject-governance.md:209`, which independently declares its
own running total ("398 entries") that agrees with neither the header's 404/399 nor my 367 measured
count — a live, freshly-observed instance of exactly the divergence class the header already warns
about, not a new problem. **Verdict: the divergence is real, structurally acknowledged, not
resolved by this pass (not in scope to resolve — needs the header's own promised shard-by-shard
audit), and the catalog is being actively extended in real time by other agents faster than the
header's own count can keep up.** This is expected churn in an actively-worked catalog, not a fresh
regression. Do not quote 404, 399, 346, 367, or 398 as "the" total without saying which definition
you mean, per the header's own standing instruction.

### 2. Test suite health slice — green on the slice run, but the ONE full-suite safety net is chronically red
Ran real vitest slices from the correct CI-parity cwd (`apps/host`, matching
`vitest.config.ts`'s own documented CWD contract — the repo-root form silently matches zero test
files, which is exactly the REG-378-adjacent silent-no-op class this catalog already warns about):
- `xp-rules.test.ts` + `exam-engine.test.ts` + `cognitive-engine.test.ts` +
  `lib/cognitive-engine-coverage.test.ts`: **5 files, 290 tests, 0 failed.**
- `src/__tests__/regressions/` + `src/__tests__/security/`: **46 files, 699 passed / 7 skipped
  (706), 0 failed.**
- Combined slice: **51 files, 989 tests passed, 7 skipped, 0 failed.** No `.skip` found without a
  stated reason in anything this slice touched.
- Cross-checked GitHub Actions directly: the last real push to `main` (`3b81df86c`, 2026-08-22
  04:51 UTC) has a **green** `CI — Alfanumrik` run and a **green** `Deploy Production — Alfanumrik`
  run — the merge-gated unit/build/lint pipeline is currently healthy on main.
- **Real gap found, independent of my own slice:** `E2E Nightly — Alfanumrik` — the platform's
  *only* scheduled full-suite (~417 test) E2E safety net (PR CI only runs E2E on an opt-in label) —
  has failed **every single night for the last 10 consecutive runs measured** (2026-08-13 through
  2026-08-22, `gh run list`). The most recent run (2026-08-22) shows **41 failed / 376 passed**
  across a broad, non-single-root-cause spread (accessibility touch-targets, exam-schedule gating,
  grounding/RAG specs, nav redirect guards, refresh-page, teacher-remediation-spine,
  today-home v2, responsive/zoom a11y, welcome-v2). The workflow's own `pipeline-alert.yml` is
  working exactly as designed — it opened issue **#1418** on 2026-07-29 and has added a same-day
  comment on every one of the 25 consecutive red nights since (25 comments, `updatedAt` =
  2026-08-22T22:14:57Z) — but the issue itself is **unassigned, unlabeled beyond
  `pipeline-failure`, and carries zero human triage comments.** The alerting infrastructure is
  sound; the response process around it is not. This is a real, currently-open reliability gap,
  not a hypothetical one — flagged to ops/testing for triage ownership, not fixed in this pass.

### 3. ci.yml diff vs origin/main — 5-line diff, verified benign and intentional
`git diff origin/main -- .github/workflows/ci.yml` shows exactly one change class: `check-latest:
true` removed from 5 `./.github/actions/setup-node-workspace` call sites. Traced to this branch's
own commit `09ecd6262` ("fix(ci): resolve actionlint errors and pre-existing test drift blocking
pre-push", same-day). Independently verified the commit's claim against the actual composite
action rather than trusting the commit message: `grep -n "check-latest\|inputs:"
.github/actions/setup-node-workspace/action.yml` confirms `check-latest` is **not** among the
action's declared `inputs:` — it only appears hardcoded inline (`check-latest: true`) inside the
action's own internal `setup-node` step (line 82). So the 5 removed lines were dead/unconsumed
inputs that actionlint correctly flagged as unknown, and removing them changes no runtime behavior
(the action already hardcodes `check-latest: true` internally regardless of caller input).
**Verdict: benign, already correctly committed on this branch, not yet merged to `main` — this is
exactly why it shows as a diff, nothing more.** No other divergence found between this branch's
`ci.yml` and `origin/main`'s.

### 4. Deployment interlock status — independently reconfirmed, matches what's already documented above
Re-verified live (not re-read from the doc) rather than accepting commit `db56b0b23`'s claims at
face value:
- `gh variable list` → `USE_CLI_DEPLOY  true  2026-08-23T09:02:08Z` — confirmed live, matches the
  documented timestamp exactly.
- `gh secret list` → `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` both present, added
  2026-08-23T08:38:0{1,2}Z — i.e. genuinely BEFORE the variable flip (correct order), not merely
  asserted.
- `git log origin/main -1` → last commit `3b81df86c`, pushed 2026-08-22T10:21:06+05:30 —
  **before** the gating change (2026-08-23T09:02:08Z UTC). `gh run list --workflow "Deploy
  Production — Alfanumrik"` confirms the last real deploy run was 2026-08-22T04:51:09Z, also before
  the change. **No push to `main` has happened since the interlock was flipped**, so the runbook's
  own §4 verification (watch the next real push deploy exactly once via the CLI job, not doubled by
  Vercel's Git integration) has genuinely not yet had the chance to run — this is not a stall or an
  oversight, it is an accurate "not yet observed" state. **Verdict: no discrepancy found between the
  documented status and live reality.** Treat the next real production push as the still-outstanding
  proof point, as already recorded above and in `07_RELEASE_SCORECARD.md`.

### 5. Branch protection reality check — real, previously-uncatalogued governance gap found
`gh api repos/AlfanumrikOS/Alfanumrik/branches/main/protection` returns `404 Branch protection has
been disabled on this repository.` **This does NOT mean main is unprotected** — the repo uses the
newer GitHub **rulesets** API instead of classic branch protection, and the classic endpoint
correctly 404s when only rulesets are configured (a measurement-tool mismatch, not a real gap, so
don't quote the 404 as "no protection" — confirmed by checking the other API):
```
$ gh api repos/AlfanumrikOS/Alfanumrik/rulesets
[{"id":20528052,"name":"main-protection","target":"branch","enforcement":"active", ...}]
$ gh api repos/AlfanumrikOS/Alfanumrik/rulesets/20528052
```
Ruleset `main-protection` (created 2026-08-07, active, `bypass_actors: []`,
`current_user_can_bypass: "never"`) requires 4 status checks — Secret Scanning, Lint/Type-check &
Test, Production Build, CodeQL Analysis — matching what commit `3288ccf20`'s message already
documented. **Two real gaps found in the ruleset's own parameters, not previously called out in
this findings doc:**
- `required_approving_review_count: 0` — a pull request can be merged into `main` with **zero**
  human approving reviews. `require_code_owner_review: false` too. The `pull_request` rule exists
  (so a PR is structurally required — no direct push bypass), but nothing in it requires another
  set of eyes before merge.
- `strict_required_status_checks_policy: false` — merging does **not** require the PR branch to be
  up to date with `main` first. A PR opened against an older `main` can pass its own status checks
  and merge even if `main` has since moved — status checks are re-verified against the PR's own
  head, not against a freshly-rebased/merged tree.
Read together, these two settings are a plausible **structural** contributor to how the
384-file stale-base merge (`b00b9c872`, documented at length elsewhere in this file and in
`07_RELEASE_SCORECARD.md`) was able to land on `main` and silently revert ~190 previously-shipped
fixes: a stale-base PR could pass its own (non-strict) status checks and merge with zero required
reviewers to catch the regression by eye. This is not asserted as the confirmed root cause of that
specific incident (not traced commit-by-commit here), only as a live, currently-active
configuration gap that would allow the same failure mode to recur. Flagged to architect/ops — not
fixed in this pass (ruleset changes are a repo-admin action outside this recon's scope).

### Gate A recommendation: PENDING -> CONDITIONAL
Not FAIL: the merge-gated CI pipeline (lint/type-check/unit/build) is currently green on `main`'s
latest push, the `ci.yml` divergence on this branch is verified benign, and the deployment interlock
is genuinely applied and matches its own documentation with no discrepancy found.
Not PASS: two real, live, independently-verified gaps remain unresolved — (a) `main`'s merge
ruleset permits a zero-review, non-strict-status-check merge, a plausible structural enabler of the
exact stale-base-merge failure mode this program spent most of its wave-2 effort repairing; and (b)
the platform's only scheduled full-E2E-suite safety net has been red for 25 consecutive days behind
a working-but-untriaged alert (issue #1418), meaning "does the existing pipeline already cover this
+ is it green" (this program's own stated bar for Gate A) currently answers **covers it, not
green**, for the E2E lane specifically. The regression-catalog divergence is carried forward as a
known, already-documented, non-blocking methodological gap, not a new reason to fail. Recommend
CONDITIONAL rather than FAIL because both open items have a clear, bounded, non-architectural fix
(tighten the ruleset's two parameters; assign and triage issue #1418) rather than requiring new
design work, and neither blocks the specific database/RLS/payment concerns driving Gates B/C/G to
FAIL today. This is testing's recommendation for the orchestrator to apply to
`07_RELEASE_SCORECARD.md`; the final Gate A status line and any resulting change to the overall
verdict is the orchestrator's call, not made here.
