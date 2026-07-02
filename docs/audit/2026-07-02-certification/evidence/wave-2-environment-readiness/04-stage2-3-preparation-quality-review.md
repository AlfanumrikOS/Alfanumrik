# Quality Review: Stage 2/3 Certification Preparation Artifacts (2026-07-02)

Scope: preparation-only artifacts for the certification program Stage 2/3. Nothing in scope has
been or should be executed against a live target. A separate release blocker (Vercel Preview
environment variables shared with Production, tracked in the risk register) remains open and is
not resolved by this review. This review does not execute anything live either; every claim
below was verified by reading the actual code and by running commands that are safe against no
target (type-check, lint, playwright --list, and a disposable, non-committed Vitest scratch file
exercising the two scripts pure and fakeable functions against fake in-memory clients; no
network I/O, no real Supabase or Razorpay credentials touched).

Reviewed against branch fix/prod-readiness-remaining, commit 15742a1c (matches the reviewed
files own claimed HEAD).

---

## Automated Checks

- Type check (npm run type-check): PASS, zero errors. e2e/certification/star-star is fully
  covered (not excluded by tsconfig.json). scripts/seed-certification-accounts.ts is
  transitively covered (imported by e2e/certification/helpers/cert-gate.ts, which is not
  excluded). scripts/teardown-certification-tenant.ts is NOT covered; see Finding Q-2 below.
- Lint (eslint over e2e/certification, seed-certification-accounts.ts,
  teardown-certification-tenant.ts): PASS, zero problems, exit code 0. (The project lint script
  only globs src slash, so this scope was checked explicitly.)
- npx playwright test --list (default env): PASS; Total: 333 tests in 37 files, zero files
  from e2e/certification present. Also confirmed that explicitly targeting a certification
  spec by path without CERTIFICATION_RUN_ENABLED=true returns Total: 0 tests in 0 files, No
  tests found; testIgnore strips the directory from collection entirely, it is not merely
  deprioritized.
- CERTIFICATION_RUN_ENABLED=true npx playwright test e2e/certification --list: PASS; Total: 36
  tests in 8 files, matching the expected count exactly.
- Live-executed (not just --list) confirmation of the payments double-gate: ran the payments
  spec with the base gate ON (CERTIFICATION_RUN_ENABLED=true, a fake unreachable
  CERTIFICATION_BASE_URL) but CERTIFICATION_PAYMENTS_CONFIRMED_SAFE deliberately left unset.
  Result: all 3 tests reported skipped, completed near-instantly with zero navigation or
  network attempts against the target; proves paymentsSuiteEnabled extra guard is a real,
  executing gate at runtime, not just a comment.
- Build: not run (task scope did not require it; these are test/script/doc-only artifacts with
  no bundle-size surface; the playwright.config.ts change is a testIgnore string only).

---

## Group 1: Playwright certification specs plus playwright.config.ts

Files: e2e/certification/helpers/cert-gate.ts, student.spec.ts, teacher.spec.ts, parent.spec.ts,
school-admin.spec.ts, super-admin.spec.ts, content-author.spec.ts, support-staff.spec.ts,
payments.spec.ts, playwright.config.ts.

### Gating correctness, independently verified, not just trusted from comments

- playwright.config.ts line 17 sets testIgnore to an array containing the certification glob
  unless process.env.CERTIFICATION_RUN_ENABLED equals the literal string true; a strict
  string-equality check (not truthy-coercion), so a value like 1 or yes would NOT enable
  collection. Correctly fail-closed.
- Every one of the 8 spec files opens its test.describe block with an identical-pattern
  self-gate call to test.skip using either certificationSuiteEnabled() or, for payments.spec.ts,
  paymentsSuiteEnabled(). No file deviates from this pattern; no test is defined outside a gated
  describe block.
- certificationSuiteEnabled() requires both CERTIFICATION_RUN_ENABLED equal to true AND a
  non-empty CERTIFICATION_BASE_URL.
- paymentsSuiteEnabled() requires certificationSuiteEnabled() AND
  CERTIFICATION_PAYMENTS_CONFIRMED_SAFE equal to true. Live execution (above) confirms this is
  enforced at runtime, not only documented.
- No code path found anywhere in the 8 spec files or the helper that could run a certification
  test (payments or otherwise) without both layers satisfied. CI workflows were grepped for all
  three env var names; zero matches; so there is no accidental-enable path baked into CI today.

### Content-author and support-staff expected-fail assertions, genuinely regression-style

Both specs assert a waitForURL on the dashboard route pattern followed by an expect on the same
pattern, immediately after logging in as content_author or support_staff. This is a real
assertion, not a comment: if a future fix stopped misrouting these roles to the dashboard
(routed them to a dedicated portal, a 403 page, or anywhere else matching a different URL
pattern), waitForURL would time out and the test would fail loudly, exactly as the task
required. Confirmed by reading the exact regex and control flow, not by trusting the surrounding
prose comments.

### Step-list fidelity

Cross-checked every spec file step list and template file step list against the user-journey
certification report per-role tables via direct comparison. All 7 role specs, the payments
spec, and both fill-in templates mirror the report step names and stated verdicts exactly; no
invented steps found.

### Verdict: APPROVE

No blockers or majors. cert-gate.ts account-derivation functions are imported directly from
scripts/seed-certification-accounts.ts rather than reimplemented; correctly avoids the
duplication the quality checklist flags.

---

## Group 2: seed script guard change plus new teardown wrapper script

Files: scripts/seed-certification-accounts.ts (guard change), new file
scripts/teardown-certification-tenant.ts.

### The two production-reference guards, compared line by line, not assumed equivalent

Both use the identical literal project-ref string (PROD_PROJECT_REF and KNOWN_PROD_PROJECT_REF
in the two scripts), and this literal was confirmed to match the same literal already used in
the existing staging-adaptive-drill.yml GitHub Actions workflow via direct grep across all
three locations. No drift found between the three copies of this literal.

The two extractProjectRef implementations are not the same code:
- The seed script uses a regex requiring the exact shape of an https URL with the project ref
  as the only subdomain label before dot-supabase-dot-co (case-insensitive, trimmed first,
  explicit lowercase call on the captured ref).
- The teardown script uses the WHATWG URL constructor, splits the hostname on dots, and
  requires exactly one label before supabase-dot-co (no explicit lowercase call; relies on the
  URL API built-in ASCII hostname lowercasing).

This reviewer did not assume these are equivalent; both were exercised against adversarial
inputs directly in Node (uppercase project ref, leading and trailing whitespace, a port suffix,
and a subdomain-suffix masquerade of the form prodref-dot-supabase-dot-co-dot-evil-dot-com).
Result: both implementations correctly return null (fail-closed) for the masquerade case and
correctly normalize case and whitespace. The one real behavioral difference found: the teardown
script URL-based parser accepts plain http and URLs with an explicit port, which the seed script
stricter regex would reject outright (returns null, refuses). This difference never weakens the
safety property; a URL that truly resolves to the production ref is still caught by both
parsers; the only effect is the teardown script is slightly more permissive about accepting
non-production URLs in nonstandard shapes. Not a security gap, but the two guards are not
byte-for-byte identical in strictness; worth the owning team being aware of if the shared
literal is ever migrated (both files own comments already flag that this constant must be
updated in lockstep if the production project ever changes).

Minor (Q-1): the teardown script extractProjectRef relies on the URL API implicit hostname
lowercasing rather than an explicit lowercase call like its sibling in the seed script. Verified
this works correctly today (Node normalizes hostnames per the WHATWG URL spec), but recommend
adding the explicit call for auditability parity with the sibling script and to remove any
reliance on an unstated cross-runtime guarantee.

### Client-side is_demo re-check in the teardown wrapper, verified to run in every path

Read runTeardown end-to-end: the school lookup is called unconditionally as the first
statement, before either the dry-run early-return or the RPC call. The is_demo-is-not-true check
throws (does not silently continue) and that throw is not caught anywhere inside runTeardown;
it propagates to the main function catch handler, which prints the error and exits non-zero.
There is no early return, no swallowed exception, and no code path (dry-run or real) that
reaches the purge_certification_tenant RPC call without first passing the is_demo check.

This reviewer did not rely on reading alone for this: a disposable, non-committed Vitest file
was written (deleted before finishing this review; confirmed absent from the working tree via
git status afterward) that exercises runTeardown against a fake Supabase-shaped client with an
RPC call spy, covering: is_demo false (a real school), is_demo null (ambiguous), dry-run with
is_demo true, and a real run with is_demo true. All 5 assertions passed, confirming the RPC spy
is never invoked in the false, null, or dry-run cases, and is invoked exactly once in the
legitimate real-run case.

### Finding Q-2 (MAJOR): the new teardown script is invisible to npm run type-check

tsconfig.json excludes the entire scripts directory from its file set. The seed script is still
covered because e2e/certification/helpers/cert-gate.ts imports it (TypeScript pulls in
transitively-imported files regardless of exclude); confirmed via tsc --listFiles, which lists
the seed script but not the teardown script. The teardown script has no importer anywhere in the
codebase (only referenced from two markdown docs), so it never enters the compiled program. This
reviewer independently compiled the file standalone with matching strict compiler flags and it
is in fact type-correct today, so this is not a live defect; but it is a real blind spot in the
CI safety net: a future edit could introduce a type regression in this specific file (the one
carrying the fail-closed production guard and the is_demo re-check) and npm run type-check would
still report PASS. This is a systemic, pre-existing pattern across scripts generally (most
scripts are only covered incidentally, via a test file importing them) rather than something
unique to this change, but it is worth flagging precisely because this file is the one billed as
safety-critical.

### Finding Q-3 (MAJOR): zero automated test coverage of either production-reference guard

Both scripts own doc comments describe their project-ref guard functions as safety-critical,
fail-closed, and directly unit-testable pure functions. Neither is actually tested. Confirmed by
reading the existing companion test file import list (15 named exports imported from the seed
script; role and shape helpers, upsert primitives, the orchestrator; but not the guard
functions or the production-ref constant) and by grepping the whole test tree for the guard
function names; zero matches anywhere. The teardown script has no companion test file of any
kind. This is a coverage gap, not a correctness bug; the disposable scratch test described
above confirms the actual behavior is correct; but the most safety-critical logic in this
entire batch currently has no regression protection. Recommend routing to the testing agent: add
a companion test file for the teardown script (mirroring the existing seed-script test pattern)
covering extractProjectRef, isValidUuid, parseArgs, and runTeardown guard branches, and extend
the seed script existing test file to cover its own extractProjectRef and
assertNotProductionProjectRef (production-ref match, unparseable URL, valid non-prod URL). This
should be closed before either script is trusted for a real invocation once the environment
blocker clears; it does not block committing these preparation-only, not-yet-executed
artifacts today.

### Other checks

- Both scripts require both Supabase env vars even for --dry-run in the teardown script (by
  design, so the dry-run is_demo read reflects reality); confirmed by reading the main function.
- Both scripts main functions pass through the production-reference guard before constructing
  any Supabase client; confirmed by reading statement order in both files.
- No hardcoded XP/grade/subject values, no any type without justification, no unjustified
  console.log calls (the operator-facing CLI output calls are consistent with the existing
  convention across scripts, and lint, which allows console usage broadly here and did not
  flag these, passed clean).

### Verdict: APPROVE WITH CONDITIONS

Condition: close Finding Q-3 (add unit tests for both production-reference guards and the
teardown wrapper runTeardown guard branches) before either script is invoked for a real run once
the environment blocker clears. Finding Q-2 (type-check blind spot) is naturally closed as a
side effect of the same test addition. Neither finding blocks committing these preparation-only
artifacts as-is; both guards were independently verified correct by direct execution against
fake clients, not just by reading the code.

---

## Group 3: Rollback runbook plus Stage 2/3 templates

Files: the certification rollback and incident-response runbook, and the 3 Stage 2/3 fill-in
template files (API contract spot-check, per-role step verdict table, test-run cover sheet).

### Runbook verification query versus the actual regression test, compared field by field, no drift found

Compared the runbook school_id-scoped verification query (10 counts: students, teachers,
school_alert_rules, school_audit_log, school_invoices, school_seat_usage,
payment_reconciliation_queue, school_contracts, demo_accounts, and the schools row itself) and
its student_id-scoped query (4 counts: foxy_chat_messages, foxy_sessions, ai_workflow_traces,
admin_impersonation_sessions) directly against the actual regression test assertions (the
certification-tenant teardown e2e test file under src slash __tests__ slash migrations). Every
table name in both lists matches exactly; no drift, no missing table, no stale table left over
from an earlier version of the migration. The runbook claim that this is the same leak-check
pattern reused here is accurate, not aspirational.

The runbook description of the migration guard behavior (the specific error code, and that the
guard catches NULL as well as explicit false) was checked against the actual migration SQL and
matches.

### Templates

All 3 templates are empty fill-in skeletons with no executable content and no factual claims to
drift-check beyond their per-role step lists, which were cross-checked against the user-journey
certification report (see Group 1) and matched exactly, including the Content Author and Support
Staff notes correctly pre-warning the operator about the expected blocked verdict rather than
silently omitting those rows.

### Verdict: APPROVE

No findings.

---

## Group 4: RC baseline document

Spot-checked against the actual repository state (not just read for internal consistency):

| Claim | Document says | Verified value | Match |
|---|---|---|---|
| Commit SHA full | matches HEAD | git rev-parse HEAD returned an identical value | Yes |
| Commit SHA short | matches | matches | Yes |
| Root-level migration count | 351 | directly counted the migrations directory, got 351 | Yes |
| Latest migration filename | the teardown migration filename | matches the actual last file when sorted | Yes |
| Node.js version | v25.8.2 | node --version returned v25.8.2 | Yes |
| npm version | 11.11.1 | npm --version returned 11.11.1 | Yes |
| Next.js, React, TypeScript, Supabase JS, Supabase SSR, Vitest, Playwright versions | as stated | package.json shows identical, verbatim caret ranges | Yes |

No drift found in any spot-checked fact. The document own framing (captured immediately after
the environment-readiness remediation wave landed; any drift should trigger a fresh baseline
capture) is itself accurate as of this review; the current HEAD matches the pinned commit
exactly.

### Verdict: APPROVE

No findings.

---

## Overall Verdict: APPROVE WITH CONDITIONS

| Group | Verdict |
|---|---|
| Playwright certification specs plus playwright.config.ts | APPROVE |
| Seed and teardown scripts (guard change plus new teardown wrapper) | APPROVE WITH CONDITIONS |
| Rollback runbook plus Stage 2/3 templates | APPROVE |
| RC baseline | APPROVE |

Conditions (must be closed before either script is trusted for a real invocation once the
environment blocker clears; do not block committing today preparation-only artifacts):
1. (Finding Q-3, MAJOR) Add unit tests for the production-reference guard functions in both the
   seed script and the teardown wrapper, and for runTeardown guard branches. Route to the
   testing agent.
2. (Finding Q-2, MAJOR, closed as a side effect of #1) The teardown wrapper is currently outside
   npm run type-check effective file set (no importer anywhere in the codebase, and scripts is
   excluded from tsconfig.json). Adding the test file in #1 will naturally pull it into the
   compiled program.
3. (Q-1, MINOR) Add an explicit lowercase call to the teardown wrapper extractProjectRef for
   auditability parity with the sibling script, even though the implicit URL-API behavior is
   correct today.

What was independently verified live (not merely trusted from code comments):
- Default npx playwright test --list collects zero certification tests, and direct path
  targeting without the env var also yields zero; testIgnore genuinely strips the directory
  from collection.
- CERTIFICATION_RUN_ENABLED=true collection yields exactly 36 tests across 8 files.
- The payments spec extra environment-confirmation gate genuinely skips at runtime (not just
  --list) when the base gate is on but the extra confirmation flag is unset; ran it for real
  with a fake unreachable target URL and confirmed zero navigation attempts.
- The teardown wrapper is_demo re-check runs before the RPC call in every code path, via a
  disposable scratch test against a fake client (not committed; confirmed removed from the
  working tree afterward).
- npm run type-check and lint both pass clean over the full scope in question.
- All RC baseline facts spot-checked (commit SHA, migration count, runtime and dependency
  versions) match the actual repository state exactly.

No modifications were made to any reviewed file. This document is the only file this review
wrote.
