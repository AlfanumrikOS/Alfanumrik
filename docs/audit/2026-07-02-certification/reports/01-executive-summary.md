# 01 — Executive Summary

**Certification date:** 2026-07-02 · **Wave:** 1 of 4 (Stage 1 — static/read-only) · **Board:** Alfanumrik Production Certification Board

## What this document is

This is an independent re-verification of Alfanumrik's production readiness, conducted as a
formal Certification Board exercise separate from the same-day Phase 1-3 Discovery/Validation/
Remediation audit. Per the Board's mandate, nothing from Phase 1-3 was accepted at face value —
every critical or release-affecting claim was independently re-derived from current source by
8 domain agents working in parallel (architect, backend, frontend, assessment, ai-engineer,
mobile, ops, testing), each producing file:line-cited evidence under
`docs/audit/2026-07-02-certification/evidence/`.

**This is Wave 1 of a planned 4-wave program** (Stage 1 static → Stage 2 seeded-local →
Stage 3 dedicated-staging-tenant → Executive Release Board). Per the approved plan, live
database/API execution and the final Board decision are explicitly out of scope for Wave 1.
**No release recommendation is issued in this document** — see "Interim readiness signal"
below for what can be said now, and `17-appendix.md` for the full Wave 2-4 gating plan.

## Headline result: the platform's core automated-verification claims hold up

A fresh, independent run of the full local verification suite (not trusted from a prior CI run)
passed cleanly: `type-check` (0 errors), `lint` (0 errors), `test` (14,359 tests, 14,241 passed,
118 skipped, 0 failed), `build` (0 errors), and bundle-size budget (all 3 P10 gates pass: shared
JS 279.9/284 kB, middleware 116.2/120 kB, worst page 198.1/260 kB). This is real, independently
executed evidence, not a citation of the constitution's narrative.

## What this pass found beyond "does CI pass"

Re-deriving rather than trusting surfaced a genuinely mixed picture — some Phase 2/3 claims of
"fixed" hold up under direct re-read, some do not, and several new items were found that no
prior phase had surfaced:

**Confirmed genuinely fixed (re-verified by direct code read, not commit-message trust):**
cross-student RPC forgery (the most severe finding in the entire Phase 2 audit), 6 missing
foreign-key constraints, 4 legacy-only feature-flag seeds, the QUIZ-ACTIVE gap's Next.js
route-layer half, the `daily-cron` parent-digest N+1 query pattern, and the `rhythm/today`
surrogate-id bug (Daily Rhythm queue) at all three call sites the original finding warned about.

**Reclassified as still open, contrary to how the remediation commits could be read as fully
closing them:**
- **QUIZ-ACTIVE gap, SQL/RPC layer** — the Next.js route layer is genuinely fixed, but none of
  the underlying RPCs (`get_user_permissions`, `get_available_subjects`,
  `validate_academic_scope`, `atomic_quiz_profile_update`, `start_quiz_session`,
  `submit_quiz_results_v2`) carry an `is_active`/`deleted_at` predicate. The fixing commit's own
  message admits this ("out of scope here... queued as an architect follow-up"). Independently
  escalated by the mobile-domain sweep: the shipped mobile app's **default build configuration**
  calls these RPCs directly, bypassing the patched route layer as normal behavior, not a crafted
  attack. Net effect: a suspended or soft-deleted student can still take quizzes and earn XP via
  the default mobile app today. **This is the single most material open finding in Wave 1.**

**New findings no prior phase surfaced:**
- The parallel AWS deployment pipeline is **armed, not dormant** — a repository variable has been
  `true` since 2026-06-23, meaning every push to `main` has also been deploying to a second,
  undocumented environment for over a week. Independently found by two separate agents
  (architect and ops), which is strong corroboration.
- None of the repository's deployment environments have approval/protection rules — deploys are
  fully automatic on green CI.
- A security-incident runbook (`docs/BACKUP_RESTORE.md`) contains a factually wrong claim about
  the admin-secret authentication path having been removed; it is still live.
- The regression catalog is undercounted in the constitution by 51 entries (193 actual vs. 142
  claimed), including a same-day critical security fix (cross-student RPC forgery, closed today)
  that isn't reflected in the narrative document at all — independently found by two separate
  agents (ops and testing).
- The four RBAC-seeded roles `content_manager`/`reviewer`/`support`/`finance` have zero
  dedicated frontend portal — a session holding only one of these roles is silently misrouted
  to the student dashboard. This directly determines the outcome of two of the mission's
  requested User Journey certifications (Content Author, Support Staff) in `04`.
- The adaptive/IRT question-selection path is dead code (entombed in an unclosed comment block,
  selection flag hardcoded off) while a separate in-repo comment falsely claims it is live in
  production at 100% rollout. The actual live adaptive mechanism is a different, correctly-built
  system that is itself still seeded off.
- Coupon and referral logic exist only as database schema — no application code reads or writes
  either table, so these two mission-requested business rules cannot be certified as "working";
  they are certified as **not yet implemented**.
- One `SECURITY DEFINER` migration function was found missing a `search_path` guard that the
  prior audit's equivalent sweep missed (low exploitability — the function is unreachable by
  any non-service-role caller).

**One item requires your decision, not a code fix:** the Phase 2 "G-5" dossier — whether
unredacted student free-text reaching the AI provider's fallback path is acceptable, and whether
a dormant shadow-grading flag should ever be promoted — still has no recorded ruling. Flagging
this explicitly per the Board's mandate not to let pending-decision items go silently unresolved.

## Interim readiness signal (not a release decision)

Under the risk-impact taxonomy applied by every domain agent this wave (Blocker /
Should-Fix-Before-Release / Post-Release-Acceptable / Informational), **zero items were tagged
Blocker** and **eleven items were tagged Should-Fix-Before-Release** (full list in
`14-risk-register.md`). Per the decision logic in the approved certification plan, this places
the defensible interim ceiling at **APPROVED WITH CONDITIONS**, not APPROVED FOR PRODUCTION —
and even that ceiling is provisional, since Stage 2 (live seeded-account testing) and Stage 3
(dedicated staging tenant) have not yet run, and Tier-0 surfaces (auth, payments, AI, scoring)
are explicitly required to reach live verification before a defensible final decision per the
Board's own completeness gate. **The Executive Release Board has not convened and no formal
decision is issued by this document** — see `17-appendix.md` for the Wave 2-4 plan.

## Scope executed this wave

100% inventory classification across all artifact classes (see `02-certification-coverage-matrix.md`
for the full Total/Tested/Passed/Failed/Untested breakdown): 350 migrations, 362 API routes, 48
Edge Functions, 177 pages, 62 super-admin pages. Risk-tiered depth: full individual verification
concentrated on the ~450 Tier-0 items (auth, RBAC/RLS, payments, AI, scoring/XP, the 7
high-blast-radius admin routes); Tier-1/Tier-2 items received scripted/mechanical classification
only, explicitly labeled as such, not hand-verified line-by-line.
