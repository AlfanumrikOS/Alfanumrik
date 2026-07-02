# 14 — Risk Register

Stage 1 (static/read-only), 2026-07-02. Tags per the approved taxonomy: **Blocker** (Tier-0,
confirmed, S1/S2, no compensating control, or a live-reproduced P1-P15 violation — release
cannot proceed) / **Should-Fix-Before-Release** (Tier-0/1, partial mitigation, or an unresolved
Tier-0 unknown, or a pending decision materially affecting a scorecard category) /
**Post-Release-Acceptable** (Tier-2 or pure maintainability) / **Informational** (refuted,
confirmed-safe-by-design, or already-approved).

Zero items are tagged Blocker this wave. All open items below are Should-Fix-Before-Release
unless noted otherwise.

| Risk ID | Description | Likelihood | Impact | Severity | Owner | Mitigation | Effort | Recommendation |
|---|---|---|---|---|---|---|---|---|
| CERT-01 | QUIZ-ACTIVE gap open at the SQL/RPC layer (get_user_permissions, get_available_subjects, validate_academic_scope, atomic_quiz_profile_update, start_quiz_session, submit_quiz_results_v2 - none carry an is_active/deleted_at predicate). Confirmed live-reachable via the mobile app's default build configuration, not just a crafted attack. | High (normal mobile app usage today) | Medium (suspended/soft-deleted students can still quiz and earn XP; no cross-student data exposure) | S2, Board should weigh elevating to Blocker given live-reachability | architect | Add a shared is_student_active predicate to all 6 named functions | S (few hours) | Fix before Wave 2 sign-off |
| CERT-02 | ENABLE_AWS_DEPLOY=true since 2026-06-23 - a second, undocumented deployment pipeline fires on every push to main. Independently found by 2 agents. | Certain | Medium (operational blind spot; no confirmed traffic cutover) | S3 operational | ops / architect | Confirm intent with CEO; document deployment topology | S | Resolve before Wave 3 |
| CERT-03 | No GitHub Environment has protection/approval rules - deploys are fully automatic on green CI. | Certain | Medium (no human circuit-breaker) | S3 operational | ops | Add required reviewers to production-equivalent environments | S | Recommend before Wave 3 |
| CERT-04 | The backup/restore runbook falsely claims the admin-secret header-auth path was removed; it is still live and actively consumed. | Certain | High if relied upon during an actual incident | S2 (runbook integrity) | ops | Correct the runbook | XS | Fix immediately |
| CERT-05 | Regression catalog undercounted in the constitution by 51 entries (193 actual vs 142 claimed). Independently found by 2 agents. | Certain | Low-Medium (doc trust) | S3 | ops | Reconcile the constitution summary against the catalog file | XS | Fix before next reconciliation pass |
| CERT-06 | G-5 dossier (AI-provider fallback PII exposure risk; dormant shadow-grading flag) has no recorded CEO ruling. | N/A pending decision | Depends on ruling | Unrated | user (CEO) | Render a ruling | XS decision | Escalate |
| CERT-07 | content_manager/reviewer/support/finance RBAC roles have zero frontend portal; sessions silently misrouted to student dashboard. | High if roles are used | Medium (functional gap, not a security exposure) | S2 (product) | frontend | Build minimal portals or deprecate the roles | M | Clarify product intent first |
| CERT-08 | 6 Tier-0 routes (5 cron endpoints plus one quiz content route) have confirmed-correct auth but zero automated test coverage. | Low | Medium (Tier-0 surface) | S3 | testing | Add regression tests | S | Fix in Wave 2 |
| CERT-09 | OAuth tables show zero evidence of existing in the live production schema; if absent, 3 routes including a high-blast-radius pinned route would fail on every call. | Unknown, not verified without live DB access | Medium if confirmed | S2-adjacent, unresolved | architect | Live schema check in Stage 2/3 | S verification | Resolve in Wave 2 |
| CERT-10 | Adaptive/IRT question-selection is dead code while a separate in-repo comment falsely claims it is live in production. | Certain | Low-Medium (expectation mismatch, not a runtime defect) | S3 | assessment | Correct the stale comment | XS | Fix before next doc pass |
| CERT-11 | Coupon and referral logic exist only as database schema; zero application code reads or writes either table. | Certain | Low if not advertised as live | Informational-leaning-S3 | backend / product | Confirm product scope | Unknown | Clarify product intent |
| CERT-12 | update_mol_routing_weights is SECURITY DEFINER with no search_path set; unreachable by anon/authenticated. | Low | Low | S3, unreachable | architect | One-line follow-up migration | XS | Low priority |
| CERT-13 | rhythm/today fix has no dedicated regression-catalog pin. | Low | Low | S3 | testing | Add a catalog entry | XS | Batch with CERT-08 |
| CERT-14 | Leaderboard scope=school query param is silently ignored, always returns global ranking. | Medium | Low | S3 | frontend/backend | Fix param handling | S | Low priority |
| CERT-15 | Mobile plan-display has no case for canonical plan codes the live payment webhook writes; paying subscribers can see Free in the UI. Entitlements unaffected. | High | Low-Medium (trust/support risk) | S3 | mobile | Add missing switch cases | XS | Fix before Wave 2 |
| CERT-16 | extract-ncert-questions Python-proxy short-circuit bypasses the shared Deno-side auth gate; Python-side compensation unknown. | Unknown | Unknown | Unrated | ai-engineer / architect | Verify Python-side auth in Stage 2 | S verification | Resolve in Wave 2 |

## Summary

Blockers: 0 (CERT-01 flagged for the Board to weigh elevating, presented transparently rather
than unilaterally reclassified by this synthesis pass). Should-Fix-Before-Release: 12
(CERT-01,02,03,04,05,07,08,09,10,11,15,16). Post-Release-Acceptable: 3 (CERT-12,13,14). Pending
a decision, not a defect: 1 (CERT-06, escalated to user).

Per the certification plan's decision logic (0 Blockers, 1+ Should-Fix on a Tier-0 surface leads
to APPROVED WITH CONDITIONS), the interim ceiling stated in 01-executive-summary.md follows
directly from this table.

## Update 2026-07-02 (post Environment Readiness Assessment) - CEO reclassification

Per explicit CEO direction, the following are reclassified from the Wave 1 register above:

- CERT-17 (new): Vercel Preview/staging environment variables for the Supabase connection, the
  Razorpay keys, and the AI-provider keys are configured as a single shared value spanning
  Production and Preview, not distinct per-environment overrides. Browser-driven certification
  against the deployed staging URL is BLOCKED - classified as a Release Blocker, not an
  informational finding, per explicit CEO direction. Cannot be resolved by any agent; requires a
  human with Vercel dashboard access to confirm and, if necessary, correct the actual resolved
  values. Owner: user / whoever holds Vercel access. This blocks Path B (browser-driven journey
  certification) specifically; it does not block Path A (direct database/workflow-level
  certification), which remains available once CERT-18/19/20 below are fixed.
- CERT-18 (new, was environment-readiness finding, now a release blocker): Sentry environment
  detection uses the wrong signal for a Vercel Preview build, tagging certification-caused
  errors as production incidents. Now in a dedicated remediation wave, in progress.
- CERT-19 (new, was environment-readiness finding, now a release blocker): No certification-
  traffic traceability convention exists. Now in a dedicated remediation wave, in progress.
- CERT-20 (new, was environment-readiness finding, now a release blocker): Tenant cleanup has no
  clean single-operation teardown, and a foreign-key gap would cause a teardown attempt to fail
  partway through, contradicting a code comment that claims full cascade exists. Now in a
  dedicated remediation wave, in progress.

Certification tenant provisioning remains blocked until CERT-18, 19, and 20 are fixed, tested,
documented, and the affected Environment Readiness criteria are independently re-run and pass.
CERT-17 blocks browser-driven (Path B) certification only, and is not resolvable within this
engineering wave.

## Update 2026-07-02 (later same day) - remediation wave closed

CERT-18 (Sentry environment detection), CERT-19 (certification traceability), and CERT-20
(tenant cleanup / FK teardown) are CLOSED. Each went through a full builder-review cycle: fixed
by the owning agent, independently reviewed by quality (which found and required a fix for a
real gap - two additional table clusters, Foxy chat history and B2B billing/contract rows, that
the first version of the teardown migration missed), corrected, and re-approved on a second
quality pass with a fresh independent re-derivation of the underlying evidence. Regression tests
were added for all three (REG-227, REG-228, REG-229) and a full documentation runbook was
written. One minor documentation inconsistency found during the post-remediation re-verification
was fixed on the spot. Evidence: `evidence/wave-2-environment-readiness/01-consolidated-verdict.md`
(original findings), `02-remediation-quality-review.md` (both review passes),
`03-post-remediation-reverification.md` (independent re-confirmation).

CERT-20's closure carries one operational caveat, not a blocker: the teardown function is only
invokable via direct SQL/service-role access today (no wrapper script or admin-API route yet),
and its integration test has never executed against a live database in this session (no
Supabase credentials available) - it will run for real the first time Stage 2 has live access.

CERT-17 (Vercel Preview environment variables shared with production, blocking browser-driven
certification) remains OPEN and is NOT resolvable within this engineering wave - it requires a
human with Vercel dashboard access. This continues to block Path B (browser-driven journey
certification) specifically. It does not block Path A (database/workflow-level certification),
which is now unblocked pending final go-ahead to provision the certification tenant.

## Update 2026-07-02 (later same day) - CERT-17 CONFIRMED FAIL with direct evidence

CERT-17 is no longer "open, pending human verification" - it is now CONFIRMED FAILING, verified
directly against the live Vercel project. Preview's Supabase URL resolves to the production
project reference, and Preview's Razorpay key is in live mode, not test mode. Full evidence:
evidence/wave-2-environment-readiness/05-CERT-17-confirmed-evidence.md.

Reclassifying CERT-17 from Should-Fix-Before-Release (its prior provisional tag) to **Blocker**,
and treating it as broader than a certification-program blocker: this is a standing operational-
security exposure that predates and is independent of this certification program. The deployed
staging website has been live-configured to use production Supabase and live Razorpay credentials
for an unknown period. Recommend immediate remediation (repoint Preview's environment variables
to the staging Supabase project and a Razorpay test-mode key) ahead of and independent of the
certification program resuming, plus a brief incident-style review of what, if anything, has
actually been exercised against the staging URL while it was misconfigured this way.

Certification tenant provisioning does NOT proceed. Program remains paused. This finding
supersedes the prior "pending verification" framing throughout the executive package - treat
docs/audit/2026-07-02-certification/executive/04-outstanding-release-blockers.md and
12-ERG-1-executive-release-gate.md as describing the pre-confirmation state; this update is the
current, authoritative status.

## Update 2026-07-02 (Stage 2 execution) - CERT-21 duplicate migration version (elevated)

| ID | Risk | Business impact | Blocks release? | Owner | Status |
|---|---|---|---|---|---|
| CERT-21 | Two migration files shared version 20260702150000 (schema_migrations PK collision), silently halting the migration chain. Read-only migration-list on prod confirmed FIVE migrations unapplied on production as a result: the p3w2_8 flag seed, the concept-mastery index (160000), the security revoke 20260702170000_p3w1_5b_revoke_orphan_atomic_quiz_5arg (170000), and both teardown functions (180000/190000). | HIGH - a committed security-hardening migration (revoke EXECUTE on the orphaned vulnerable quiz RPC overload, REG-226/commit c2cde8c8) has NOT been applied to production; a fresh-env rebuild also fails at this version (schema-reproducibility broken). | Was effectively blocking correct prod schema state; the FIX is now committed | architect (fixed) | FIX COMMITTED + STAGING-VERIFIED. Rename resolved the collision; staging sync then applied all 5 previously-blocked migrations cleanly (empirically confirming they had never applied). Prod remediation: the fixed chain rides the next deploy-production run - MUST be confirmed applied on prod. Repair runbook: docs/runbooks/2026-07-02-cert21-duplicate-migration-version-repair.md |

Severity note: CERT-21 is the highest-impact finding of the certification program. It was invisible
to Stage 1 static analysis (the migration FILES were correct; the defect was that a version
collision three files upstream prevented them from ever applying) and only surfaced when a real
db push hit a real migration-history table during Stage 2. Until the next production deploy
applies the corrected chain, production is missing the 170000 security revoke - the orphaned
5-arg atomic_quiz_profile_update overload retains EXECUTE on prod (a defense-in-depth gap; the
primary 6/7-arg overloads DO carry the ownership check, which is applied and live). Recommend
confirming a production deploy applies 20260702151000/160000/170000/180000/190000 as a priority
follow-up, independent of the rest of the certification.

## Update 2026-07-02 (Stage 2 browser journeys executed live)

The 7-role browser journey suite ran against the staging-backed Vercel Preview (via automation
bypass, all Supabase env corrected). Final: 27 passed, 8 skipped (payments gated on the deferred
Razorpay item + 2 "blocked past dashboard" steps for the portal-less roles), 1 intentionally RED.
Two findings:

| ID | Finding | Severity | Status |
|---|---|---|---|
| CERT-FE-01 (NEW) | The Foxy AI-tutor page (/foxy) has NO role gate - its only guard redirects unauthenticated users. An authenticated TEACHER reaches the student AI tutor page and it renders, contradicting Wave 1 report 04's claim that teachers have no Foxy access ("intentional scope boundary"). Live-confirmed. Page-level reachability only; whether the Foxy API serves a teacher-role session is not yet assessed. | Medium (access-control / scope-boundary) | OPEN - recorded, journey test held intentionally RED. Fix is a gated product decision (role-gate /foxy, or declare non-student Foxy access in-scope + update report 04) for assessment + architect + ai-engineer. Product code unchanged. |
| CERT-07 (Wave 1) | content_author and support_staff RBAC roles have no dedicated frontend portal; a session holding only one is silently misrouted to the student /dashboard. | Medium (product gap) | **Now LIVE-CONFIRMED** - the browser journey for both roles logged in on the real Preview and landed on /dashboard exactly as the Wave 1 static analysis predicted. Upgraded from static-only to live-proven. |

Also fixed during this run: 6 test-spec issues (a cookie-consent banner overlaying the sidebar
logout button on a fresh context; the student Sign Out living on /profile; super_admin needing
its own console login path rather than the shared /login form). All fixes are in
e2e/certification/**; no product code changed. Full triage:
docs/audit/2026-07-02-certification/evidence/stage-2-local-integration/journey-run-01/findings.md.

Minor awareness observation (not a recorded defect): the shared /login form silently sends a
super_admin to the student /dashboard rather than the console - low severity, flagged only.
