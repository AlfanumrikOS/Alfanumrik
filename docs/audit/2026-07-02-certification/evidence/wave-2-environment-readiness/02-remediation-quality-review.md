# Quality Review: Environment Readiness Remediation Wave (2026-07-02)

Reviewer: quality agent (veto authority).

Scope: the 3 fixes from
`docs/runbooks/2026-07-02-environment-readiness-remediation.md` -- Sentry
environment tagging (ops), certification traceability + seeding (ops +
testing), certification-tenant teardown migration (architect) -- plus their
regression tests (REG-227..REG-229) and catalog entries. Every file listed in
the task was read in full; findings below are grounded in direct
line-references, not summaries.

## Automated Checks
- Type check: PASS (`npm run type-check`, exit 0, clean)
- Lint: PASS (`npm run lint`, exit 0, clean -- no console.log, no
  unjustified any/@ts-ignore/eslint-disable in any changed/new file)
- Tests (targeted): PASS -- environment-tag-resolution.test.ts (11
  tests) + seed-certification-accounts.test.ts (23 tests) = 34/34 passed,
  confirmed by direct run, not trusted from agent summaries. The full
  src/__tests__/sentry/ directory also passes (34/34, same two files).
  certification-tenant-teardown-e2e.test.ts (4 tests) correctly SKIPS
  under both the default lane and RUN_INTEGRATION_TESTS=1 (no live Supabase
  creds in this environment) -- this matches the catalog's own honest
  "PARTIALLY resolved" claim; no false "all pass" claim was made anywhere in
  the deliverables. Regression suite for the touched route
  (institutions-delete.test.ts, institutions-tenant-type.test.ts,
  custom-domain.test.ts, rbac-elevation.test.ts) also re-run clean:
  45/45.
- Build: PASS (`npm run build`, exit 0). Bundle check
  (`node scripts/check-bundle-size.mjs`): shared 279.9/284 kB, middleware
  116.2/120 kB, 0/179 pages over the 260 kB per-page cap. No app-level
  bundle impact from this wave (expected -- no client-bundle-affecting files
  were touched).
- Catalog: REG-227/228/229 exist and are accurately described (verified
  against the actual test bodies, not just presence -- see "Regression
  catalog accuracy" below). Catalog total 196/35 (target exceeded).

## Per-fix verdicts

### Fix 1 -- Sentry environment tagging (ops): APPROVE

Both client and server/edge Sentry init files now resolve the `environment:`
tag by prioritizing the Vercel-specific deploy-target variable, falling back
to NODE_ENV only when unset. Verified:

- The client-readable mirror is genuinely populated on Vercel: the Next.js
  root config (lines 59-69) bakes it at build time from the server-side
  Vercel deploy-tier variable via its `env:` block, an existing mechanism
  already consumed the same way by the root layout component (its own
  `isPreview` check). Not a new or unverified pattern. Vercel's own
  deploy-tier value set (production/preview/development) matches what both
  the code comments and the test file assert.
- The client-side init file reads the NEXT_PUBLIC_-prefixed mirror (correct
  -- browser code cannot read the bare server var); the server/edge init
  files read the bare var directly (correct -- Vercel exposes it to Node/Edge
  runtime functions without needing the prefix, and neither file runs in a
  browser).
- A diff against the committed HEAD on all three init files confirms the fix
  is exactly what it claims: before was NODE_ENV-only in all three (the
  confirmed bug -- a production-mode Next.js build always sets
  NODE_ENV=production regardless of Vercel deploy target, so every
  staging/preview event was mislabeled as a real production incident). The
  before-send production-only drop guard is untouched, exactly as the
  remediation record claims.
- The new REG-227 test file is genuinely meaningful, not a tautology: it
  pins the exact expression byte-for-byte (regression-proof against
  reordering/dropping a fallback), asserts the pre-fix NODE_ENV-only shape
  never reappears, AND exercises real precedence semantics via env-stubbing
  -- a Preview-shaped env resolves to 'preview', not 'production' (the exact
  certification-on-staging scenario), plus a real negative check that the
  client resolver never leaks the bare server-only var. The
  locally-reproduced resolver function (not imported into app code, to avoid
  triggering the Sentry SDK's top-level init side effect) is a reasonable,
  well-justified pattern already used elsewhere in this test suite for the
  same "can't import a side-effecting init module" problem.

No issues found. This fix is correct and completely verified.

### Fix 2 -- Certification traceability + seeding (ops + testing): APPROVE WITH CONDITIONS

The traceability runbook is precise, and the seeding script implements it
faithfully for the 4 roles the runbook explicitly specifies (student/
teacher/parent/school_admin) -- email/name marker shapes, is_demo=true, and
the demo_accounts registry row all match byte-for-byte (confirmed by direct
comparison of the runbook's exact-shape SQL block against the script's
buildAccountShape/buildDemoAccountsRow helpers, and by the passing 23-test
suite, which asserts the shapes, not just presence).

The known gap (content_author/support_staff have no CHECK-legal
demo_accounts.role value) is handled safely, not just deferred: the
demo_accounts_role_check constraint (promote_demo_accounts_v2 migration)
confirms the CHECK only allows student/teacher/parent/school_admin/
super_admin. buildDemoAccountsRow returns null for those two roles (never
mislabels them super_admin), and the orchestrator correctly skips the
registry insert only for those two -- the base admin_users row is still
created (count = 3 in the orchestration test: super_admin + content_author +
support_staff), so nothing crashes or silently produces a bad row. This does
not need to block the wave -- it is genuinely a documented, tested,
safely-degraded limitation, not a defect.

CONDITION TO FIX (MAJOR, not blocking merge but must be corrected before this
is called spec-conforming): the script deviates from the runbook in an
unreported way. The runbook's own "signal 1" role enum and the demo_accounts
registry-row spec explicitly scope the convention to student/teacher/parent/
school_admin only (super_admin is mentioned once, in passing, as "valid...
though certification seeding should not need it"). The actual script seeds 7
mission roles -- super_admin, content_author, and support_staff are a real
extension driven by a different source (the "certification plan," referenced
only in the script's own header comment, not in the runbook). This isn't
hidden -- the script documents it -- but the runbook itself was never updated
to reflect that the traceability convention now needs to cover 3 more roles,
and a future reader who checks only the runbook (the document of record per
its own "Owner" line) will not know the seeding script diverges. FIX: update
the runbook's signal-1 and signal-4 sections to list all 7 roles, and add a
short note (mirroring the script's own "Known limitation" paragraph) that
super_admin IS now needed and that content_author/support_staff are real
admin_users rows outside the demo_accounts CHECK.

No blocker-level issue in this fix.

### Fix 3 -- Certification-tenant teardown migration (architect): REJECT

The new tenant-teardown RPC's design is directionally correct and several
things about it are genuinely well done:

- The privilege-elevation function attribute plus an explicit safe search
  path is present on BOTH functions (the extended per-account purge and the
  new tenant-level purge) -- confirmed by direct read of the migration's
  source. This does NOT repeat the missing-safe-search-path gap this same
  session flagged elsewhere. Correct.
- Execute-privilege revocation down to the service role only is present on
  both functions, and the is_demo guard lives INSIDE the function body, not
  just at the grant layer -- confirmed this genuinely cannot become a
  general-purpose school-deletion backdoor even from a service-role caller
  pointed at the wrong id. Correct, and REG-229's integration test
  (structurally sound, though unexecuted this session for lack of live
  credentials) proves exactly this via the is-demo-not-true and
  is-demo-is-null cases, both raising the expected Postgres privilege-error
  code.
- Idempotency (a no-op success on a second call, or on an id that never
  existed) is correctly implemented and tested.
- The super-admin institutions route diff is confirmed COMMENT-ONLY by a
  direct diff against HEAD -- the DELETE handler's body and every line of
  executable code is byte-identical to before; only the doc comment above it
  changed (correcting a stale "cascades via existing FKs" claim, and
  cross-referencing the new RPC). Re-ran all 4 existing test files touching
  this route (45 tests total) and all pass unchanged, confirming no logic
  drift.
- The "no blanket cascade" design rationale (why the two school-ownership
  foreign keys deliberately stay non-cascading, and why a future engineer
  must not "fix" this by adding a cascade) is documented directly in the
  migration file itself, in strong, explicit, unambiguous language ("A
  future engineer should not 'simplify' this..."). This is genuinely
  durable -- a future engineer editing this file will read the rationale
  before touching those two foreign keys.

BLOCKER -- the migration's own central claim, "no FK violation possible
mid-sequence," is false for realistic certification data, not just a
theoretical edge case. The migration's inventory of school-scoped child
tables that reference the schools table without a cascade (4 tables: alert
rules, audit log, invoices, seat usage) is STALE relative to the schema that
exists in this repo today, and it inherited that staleness directly from the
ops Environment Readiness Assessment's own FK audit table, which is missing
multiple tables that already existed in the migration chain when that audit
was written (dated well before this wave). I independently re-derived the
full FK inventory against the students/teachers/schools tables across every
migration file (not just the baseline dump) and found:

1. Two B2B revenue-flow tables -- the offline-payment reconciliation queue
   and the school-contracts table -- both reference the schools table with a
   hard-blocking (RESTRICT) foreign key, both NOT NULL. Neither table is
   cleared anywhere in the new tenant-purge function. Worse: the
   reconciliation-queue table ALSO references the school-invoices table with
   the same hard-blocking behavior -- so if a certification tenant has any
   reconciliation-queue row, the function's own school-invoices cleanup step
   fails before it even reaches the schools-row delete, rolling back the
   entire transaction (all the preceding student/teacher/registry cleanup
   included, since this all runs inside one function-call transaction). Both
   tables are real, shipped, currently gated off by default via their own
   feature flags -- but they are exactly the kind of B2B revenue flow a
   certification pass would plausibly flip on and exercise for a
   school-admin account (billing/contract flows are headline B2B features,
   not incidental).
2. MORE SEVERE: the AI-tutor chat-message table and its parent session table
   both reference the students table with a hard-blocking (RESTRICT) foreign
   key. The AI tutor is the platform's flagship feature -- any certification
   student account used for "Stage 2 live testing" (the certification plan's
   own next step, per the runbook and REG-229's own coverage note) is
   virtually certain to generate at least one row in these two tables simply
   by using the product. When that happens, the plain student-row delete
   inside the per-account purge function's student branch (used both
   standalone and via the loop inside the new tenant-purge function) fails
   with the same class of foreign-key error, before the function ever
   reaches the schools row. This is not a hypothetical -- it is the single
   most likely real-world teardown failure mode this fix will hit on its
   very first live Stage-2 run, because it blocks on the platform's core,
   most-used feature.
3. Lower-severity, same class: an admin-impersonation-session table and an
   AI-workflow-trace table referencing the students table have NO delete
   behavior specified at all (the Postgres default, same blocking effect).
   The trace table has a live application writer, so it is plausible, not
   just theoretical, that a certification run populates it too.

None of these four tables are seeded by the new integration test's
happy-path fixture, so REG-229 does NOT catch this gap -- it only proves the
teardown works for the narrower 4-table inventory the migration itself
enumerates, which is the same incomplete inventory that's wrong. This is why
the gap survived review this far: the test was written against the design
doc's own (incomplete) claim, not independently re-derived from the schema.

WHAT MUST CHANGE before Fix 3 can be called done:
- Add a delete against the offline-payment reconciliation queue, scoped by
  school_id, BEFORE the existing school-invoices cleanup step (ordering
  matters -- the reconciliation queue's invoice reference is the
  hard-blocking kind against school_invoices).
- Add a delete against the school-contracts table, scoped by school_id,
  anywhere before the final schools-row delete (no internal ordering
  constraint -- its only child reference, from institution entitlements,
  nulls out on delete rather than blocking).
- Add deletes against the AI-tutor chat-message and session tables, scoped
  to the tenant's student ids -- or, more robustly, fix this at the
  per-account purge function level (the function that actually issues the
  student-row delete) so every caller benefits, not just the certification
  path. Same treatment for the admin-impersonation-session and
  AI-workflow-trace tables if a full audit confirms they're populated for
  demo students in practice.
- Given how the first gap was introduced (an architect migration trusting an
  already-stale ops FK audit without independently re-querying the live
  constraint catalog against the current migration chain), the follow-up fix
  should re-derive the COMPLETE FK inventory referencing the schools,
  students, and teachers tables directly from the schema (a system-catalog
  query, or an equivalent full-chain search across every migration file --
  which is what surfaced this review's findings) rather than reusing the
  existing narrative list a second time.
- Extend the integration test's happy-path fixture to seed at least one
  AI-tutor session/chat-message row (the most likely real-world trigger) so
  REG-229 would have caught this, and add reconciliation-queue/contract rows
  too once the fix lands, so regression coverage matches the corrected
  inventory.

This is a BLOCKER, not a MAJOR, because it directly falsifies the specific
claim this review was asked to verify ("is the teardown order actually
correct, no FK violation possible mid-sequence") for a scenario that is not
an edge case but the EXPECTED shape of Stage-2 data -- and because the whole
point of this migration is closing Environment Readiness criterion 5 ("test
data can be cleaned up"); shipping it with this gap means criterion 5 is
still not really closed, just closed for a narrower slice of data than a
real certification run will produce.

## Regression catalog accuracy (REG-227/228/229)

All three catalog entries were checked against the actual test files, not
just their presence:

- REG-227: description matches -- the entry claims both a static-source pin
  and a semantic env-stubbing precedence proof; both are genuinely present in
  the test file (verified above). Accurate.
- REG-228: description matches -- claims idempotent find-or-create semantics
  for all 4 primitives plus the full orchestrator, proven against an
  in-memory fake, 23 tests; all confirmed true by direct read and by the
  passing run. Accurate.
- REG-229: description matches the test file's actual 3 assertions
  (refuse-non-demo / idempotent-no-op / full-purge-zero-rows), and -- this is
  the important part -- the catalog is HONEST about the gap: it explicitly
  states live-DB execution is deferred to Stage 2 and records criterion 5 as
  "PARTIALLY resolved," not fully resolved. No false "all regression tests
  pass" claim anywhere in the deliverables. However, per the BLOCKER above,
  REG-229's own "proven" scope (4 tables) is narrower than what a correct fix
  needs to cover -- the catalog entry should be amended once the fix above
  lands, to describe the corrected/widened table set.

Catalog total: 196/35 (target exceeded). No regression-catalog process issue
found -- the catalog diff is additive-only (confirmed 91 insertions, 0
deletions) and the new entries are accurate to what their tests assert.

## Review chain note

This review substituted for a full Gate-5 orchestrator report -- no such
report was supplied alongside the task. The three fixes were made in
sequence by architect (migration), ops (Sentry fix + traceability runbook),
and testing (seeding script + all 3 regression tests), and this review
independently re-verified all three rather than relying on their handoff
summaries. Recommend the orchestrator still produce a formal Gate-5 status
report for this wave once Fix 3's BLOCKER is resolved, since the migration
touches the schools/students/teachers tables (architect-owned, high-blast-
radius) and per the review-chain matrix a migration of this shape should
also be seen by backend (the institutions route it cross-references) --
which did happen here in substance (the route's comment was corrected in the
same commit) but was not a formally invoked backend review.

## Overall Verdict: REJECT

- Fix 1 (Sentry environment tagging): APPROVE
- Fix 2 (traceability runbook + seeding script): APPROVE WITH CONDITIONS
  (runbook must be updated to list all 7 roles -- MAJOR, not blocking Fix
  1/3)
- Fix 3 (certification-tenant teardown migration): REJECT (BLOCKER -- the
  new tenant-purge function and the per-account purge function it delegates
  to will fail on realistic Stage-2 data: any certification student with
  AI-tutor chat history, or any certification school with an offline-
  payment-reconciliation or contract row, cannot actually be torn down
  today, contradicting the migration's own central safety claim)

This remediation wave is not ready to be reported as done, and the
Environment Readiness Assessment should not be re-run/re-authorized for a
full Stage-2 certification pass yet. Fix 1 can ship independently (it has no
dependency on Fix 3). Fix 3 needs the widened delete set (at minimum the
AI-tutor chat/session tables, the offline-payment-reconciliation queue, and
the school-contracts table) added to the tenant-purge function (and ideally
to the per-account purge function itself, since it has the same blind spot
for every existing caller, not just this new one) before criterion 5 can be
called closed. Fix 2's runbook update is a documentation-only follow-up and
does not block merging Fix 1 or a corrected Fix 3.


---

## Re-review (2026-07-02, same day) -- Fix 3 correction verification

Reviewer: quality agent (veto authority). This section re-reviews the wave
after architect corrected the certification-tenant-teardown migration
(20260702180000_certification_tenant_teardown.sql) and testing extended the
integration fixture, in response to the REJECT verdict above. Per
instructions, this is an independent third derivation of the FK inventory
(not a re-check of whether the 6 named tables were added), against the same
standard used to issue the original BLOCKER.

### Automated checks (re-run this session, not trusted from summaries)
- Type check: PASS (type-check script, exit 0, clean).
- Lint: PASS (lint script, exit 0, clean).
- Tests (targeted, re-run directly):
  - environment-tag-resolution.test.ts -- 11/11 pass.
  - seed-certification-accounts.test.ts -- 23/23 pass. (34/34 combined,
    matches the original review count.)
  - certification-tenant-teardown-e2e.test.ts -- confirmed it correctly
    skips under the default lane (excluded from the unit-test include globs
    entirely) and under an explicit integration-lane run (4/4 tests report
    skipped, not passed, via the live-Supabase-env gate -- no live Supabase
    credentials in this environment). No false all-pass claim.
  - Institutions-route regression suite re-run clean: 45/45
    (institutions-delete, institutions-tenant-type, custom-domain,
    rbac-elevation test files).
- Build: not re-run this pass (no client-bundle-affecting files changed
  since the last PASS -- only the migration file, its own header comment,
  and the test fixture were touched; the original review PASS at
  279.9/284 kB shared, 116.2/120 kB middleware stands).

### Independent third FK-inventory re-derivation (methodology)

Per the task, this pass did not check whether the 6 named tables were
added -- the complete inventory was re-derived from scratch, a third time,
independently of both the ops audit and the first-pass review, by grepping
every REFERENCES-students(id), REFERENCES-teachers(id),
REFERENCES-schools(id) clause across the full effective migration chain:
the pg_dump baseline file (using its actual quoted-identifier constraint
syntax -- ADD CONSTRAINT ... FOREIGN KEY (...) REFERENCES
public.students(id) with double-quoted identifiers, not the unquoted
inline style; a first naive grep using only the unquoted pattern silently
misses every baseline-defined FK, including all 4 of the tables this wave
BLOCKER was about) plus every non-legacy migration filed after it (the
legacy directory is confirmed archived/unapplied -- skipped by the CLI
db-push command, which only picks up files at the immediate migrations
root).

Results:
- students(id): every FK found across the baseline and later migrations is
  ON DELETE CASCADE or ON DELETE SET NULL, with exactly 4 exceptions --
  admin_impersonation_sessions_student_id_fkey (no clause),
  ai_workflow_traces_student_id_fkey (no clause),
  foxy_chat_messages_student_id_fkey (ON DELETE RESTRICT),
  foxy_sessions_student_id_fkey (ON DELETE RESTRICT) -- confirmed via a
  targeted grep for the exact no-clause / RESTRICT constraint text, not
  manual scanning of the roughly 100-line full list. All 4 are cleared in
  both the per-account purge function (student and school_admin branches)
  and the tenant purge function defensive sweep. Matches the corrected
  inventory exactly -- no 5th table found.
- teachers(id): every FK found (11 constraint sites resolving to 10
  distinct tables -- one reconciliation migration is confirmed a same-day
  re-issue of an earlier table body after a prod repair-skip incident, not
  a second distinct table) is ON DELETE CASCADE or ON DELETE SET NULL.
  Zero blocking teachers(id) FK exists anywhere in the schema. Matches the
  migration claim.
- schools(id): 10 blocking (no-clause/RESTRICT) FKs total -- students,
  teachers (handled by the core per-account deletes), school_alert_rules,
  school_audit_log, school_invoices, school_seat_usage (no-clause; cleared
  explicitly), payment_reconciliation_queue, school_contracts (RESTRICT;
  cleared explicitly) -- 8 accounted for by explicit DELETEs -- plus
  quiz_sessions and student_learning_profiles (no clause), which the
  migration argues are already empty by the time the schools delete runs
  because both tables student_id column is NOT NULL (confirmed directly
  against the baseline CREATE TABLE bodies) and ON DELETE CASCADE
  (confirmed against the baseline FK list), so every row is removed
  transitively once the demo students under the school are removed. This
  reasoning is sound for well-formed data. 10 of 10 accounted for -- no
  11th table found.
- Chained blocker (school_invoices(id) as a second-hop FK target): the
  only FK anywhere in the schema referencing school_invoices(id) is
  payment_reconciliation_queue.invoice_id (ON DELETE RESTRICT, NOT NULL)
  -- confirmed by a dedicated grep with zero other matches. No other
  chained blocker exists.
- Also checked for completeness (not previously called out, not a gap):
  foxy_message_feedback, foxy_quality_scores, foxy_pending_expectations,
  and foxy_served_items all reference foxy_chat_messages(id) /
  foxy_sessions(id) with ON DELETE CASCADE (two rows in
  foxy_pending_expectations use SET NULL) -- since the migration already
  explicitly deletes foxy_chat_messages and foxy_sessions rows, these
  cascade automatically; no manual clearing needed, no ordering issue.
  school_contracts(id) is referenced only by its own self-reference
  (previous_contract_id, SET NULL) and institution_entitlements.contract_id
  (SET NULL) -- matches the migration claim that no downstream ordering
  constraint exists for the school_contracts delete. demo_accounts.school_id
  is confirmed a plain nullable uuid with no FK constraint (read directly
  from the demo_accounts promotion migration CREATE TABLE body) -- matches
  the migration claim.

Conclusion: zero additional missing tables found. The corrected inventory
is complete for every FK referencing students, teachers, or schools in the
effective (non-legacy) migration chain, including the one transitive hop
(school_invoices via payment_reconciliation_queue) the original BLOCKER
also required.

One non-blocking residual observation (MINOR, not a table gap): the
already-empty-via-CASCADE argument for quiz_sessions and
student_learning_profiles assumes every row school_id is consistent with
its (NOT NULL) student_id actual owning school. If application code ever
wrote an inconsistent school_id (a quiz_sessions row pointing at school A
via school_id but at a student who belongs to school B via student_id),
the schools delete for school A would still 23503 on that orphaned row.
This is a pre-existing data-integrity assumption inherited unchanged from
the original (first-pass, non-BLOCKER) part of the migration design, not a
new gap introduced by the correction, and it requires already-corrupt data
to trigger -- categorically different from the previous BLOCKER scenario
of any certification student who used the product, which was realistic
data. Noting it for the record, not blocking.

### Ordering verification (payment_reconciliation_queue vs school_invoices)

Read directly (not summarized): step (c) of the tenant purge function
issues DELETE FROM payment_reconciliation_queue as the FIRST statement, a
full 3 lines before DELETE FROM school_invoices. Confirmed correct --
matches the required order (the chained RESTRICT is on
payment_reconciliation_queue.invoice_id pointing at school_invoices(id),
so the child must go first). The inline comment immediately above the
block correctly explains why. No reversed-order regression found.

### Test-fixture verification (read directly, not trusted from summary)

Read certification-tenant-teardown-e2e.test.ts in full. Confirmed:
- The happy-path fixture inserts real rows into all 6 newly covered tables
  -- foxy_sessions, foxy_chat_messages, ai_workflow_traces,
  admin_impersonation_sessions (all scoped to the seeded student),
  payment_reconciliation_queue, school_contracts (both scoped to the
  seeded school) -- in addition to the original 4 (school_alert_rules,
  school_audit_log, school_invoices, school_seat_usage) plus students,
  teachers, demo_accounts. A pre-condition block asserts every one of
  these rows actually exists before the RPC is called, so the
  post-teardown zero-row assertions are not vacuously true.
- Would this test fail if the new cleanup steps were removed? Yes,
  genuinely. The tenant purge function is a single plpgsql SECURITY
  DEFINER function, invoked as one RPC call -- a single SQL statement from
  the client perspective, so the whole function body executes inside one
  implicit transaction. If any of the 6 new DELETEs were removed, the
  function would hit a live 23503 mid-body (the DELETE FROM students and
  DELETE FROM schools statements further down would fail against the
  still-present child rows), the exception would propagate out of the RPC
  call as a non-null error, and the very first assertion after the call
  (expecting that error to be null) would fail immediately, before any of
  the per-table zero-row assertions are even reached. This matches
  testing own documented reasoning in the file and was independently
  verified against the actual RPC/transaction semantics, not just the
  comment text. The payment_reconciliation_queue fixture invoice_id is
  genuinely linked to the same school_invoices row being torn down
  (captured from the school_invoices insert earlier in the same test), so
  the zero-row assertion doubles as a live ordering-regression guard,
  exactly as claimed -- not just a coincidental double-empty check.

### Regression catalog (REG-229) accuracy

Read the current regression-catalog entry for REG-229 in full. It
accurately describes the corrected/widened scope: names all 13 tables now
covered (7 original plus 6 correction additions, itemized individually),
correctly attributes the ordering proof to the
payment_reconciliation_queue/school_invoices link, and correctly states
the integration lane still self-skips pending live Stage-2 execution (no
false all-pass claim). No process issue found -- the catalog total
(196/35, target exceeded) and the entry content match the actual test
file assertions.

### Per-fix verdicts (updated)

- Fix 1 -- Sentry environment tagging (ops): APPROVE (unchanged; no files
  in this fix changed since the original review full verification).
- Fix 2 -- Certification traceability plus seeding (ops and testing):
  APPROVE WITH CONDITIONS (unchanged; still open). Spot-checked the
  traceability runbook this pass -- the MAJOR condition from the original
  review (update the runbook signal-1/signal-4 sections to list all 7
  seeded roles, not just the 4 the runbook currently documents) has NOT
  been addressed yet; the file still only mentions super_admin once, in
  passing, with no content_author/support_staff coverage. This does not
  block Fix 3 or Fix 1 and was out of this pass primary scope (the task
  was to re-verify Fix 3), but it remains an open, unresolved MAJOR and
  should not be reported as closed.
- Fix 3 -- Certification-tenant teardown migration (architect): APPROVE.
  The BLOCKER from the original review is resolved. The corrected
  migration clears all 4 previously-missing per-student
  RESTRICT/no-cascade tables (foxy_chat_messages, foxy_sessions,
  ai_workflow_traces, admin_impersonation_sessions) and both
  previously-missing tenant-level B2B RESTRICT tables
  (payment_reconciliation_queue, school_contracts, including the correct
  pre-school_invoices ordering for the chained FK). An independent third
  re-derivation of the full FK inventory -- done from first principles
  against the actual schema, not by re-checking the 6 named tables --
  found no further gaps. The corrected migration own in-file "Corrected
  FK inventory" and "CHECKED AND CONFIRMED SAFE" sections are accurate
  and durable documentation for future readers. REG-229 fixture now seeds
  and asserts all 13 touched tables and would genuinely fail (not
  silently pass) if any of the 6 new cleanup steps regressed.

### Overall Verdict: APPROVE

Fix 3 BLOCKER is resolved and independently re-verified against a fresh,
from-first-principles FK derivation -- not just a check that the
previously named tables were added. No new gap was found in this pass.
The wave is ready to ship, subject to Fix 2 still-open, non-blocking
MAJOR (traceability runbook not yet updated to list all 7 seeded roles --
tracked as a documentation follow-up, does not block merge). Criterion 5
(test data can be cleaned up) is now structurally closed for realistic
Stage-2 certification data; full closure still requires the REG-229
integration suite to actually execute against live Supabase credentials
in Stage 2, per the test file own honest STAGE-2 COVERAGE NOTE -- this
remains correctly reported as PARTIALLY resolved (structurally proven,
live-execution pending), not fully resolved, and should continue to be
reported that way until the Stage-2 run happens.
