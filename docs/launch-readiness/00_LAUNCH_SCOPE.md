# 00 — Launch Scope

**Status:** DRAFT — Phase 1 (reconnaissance in progress). Last updated 2026-08-23 by orchestrator.
**Branch:** `release/launch-readiness` (created off `fix/staging-catchup-quiz-rag-and-learning-source`, all prior uncommitted work preserved).

## What this program is
A controlled-launch readiness effort for a **B2B school pilot** of the Alfanumrik Adaptive Learning OS.
This is NOT a rewrite from scratch — a prior 8-cycle engineering audit already ran 2026-06-28→2026-06-29
(`engineering-audit/PROGRAM-SUMMARY.md`) and found/fixed a critical cross-tenant student-PII leak plus
several P11/P12 safety gaps. This program's job is to (a) verify those fixes are still true today,
(b) close the CEO-gated and Tier-3 items still open, (c) measure the gates this specific launch mandate
adds that the prior audit did not explicitly measure (WCAG breakpoints, RAG eval numeric thresholds, load
testing, backup/restore drills), and (d) produce independently reproducible release evidence.

## Launch-critical scope (in scope)
1. Authentication, session refresh, onboarding (all 3 roles: student, teacher, parent) + school-admin/super-admin.
2. School tenancy, white-label config, RBAC (6 roles / 71 permissions per root CLAUDE.md).
3. One canonical school/class/student/teacher roster — **currently NOT single-sourced**: `class_students` vs
   `class_enrollments` dual-table with a sync trigger; the DROP/consolidation (TSB-4-cutover) is CEO-gated
   and open. See `03_SOURCE_OF_TRUTH_MATRIX.md`.
4. Student journey: Sign in → Today → recommended action → Learn/Practice → answer submission → feedback →
   learning evidence → learner-state update → next action.
5. Teacher journey: Sign in → class/student view → create assignment → student completes → teacher sees
   truthful evidence and acts.
6. Parent journey: Sign in → authorized child → understandable progress/evidence → appropriate next action.
7. School Admin journey: people, classes, academics, adoption, learning insights on canonical data.
8. Super Admin journey: tenant support, configuration, operational visibility, audited privileged access.
9. Foxy contextual tutoring — NCERT-grounded retrieval, safety controls, citations, transparent degraded
   behaviour. P12 backstop (`screenStudentFacingText`) was restored by the prior audit (Cycle 4) after being
   lost at a cutover — re-verification in progress, see `04_FINDINGS_AND_CONFLICTS.md`.
10. Notifications, observability, support, recovery for the above journeys.
11. Razorpay entitlement/payment — only for the launch cohort if enabled. Payment integrity (P11) was
    hardened by the prior audit (atomic RPCs, advisory lock, webhook idempotency); a NEW dual-writer
    inconsistency in `payment_history.amount` was found by the orchestrator today (2026-08-23) — see findings.

## Explicitly OUT of scope for this launch (frozen)
Fees, payroll, HRMS, transport, route management, and other ERP functions not part of the Adaptive Learning
OS's core teaching/learning loop. **Verification pending**: confirm no such modules exist live in the app
that would need explicit hiding/disabling (see `01_SYSTEM_INVENTORY.md` route inventory once frontend recon
lands — no evidence of ERP-scope modules found in initial pass; the codebase is a learning platform, not a
school-ERP suite, so this is likely a non-issue but is being checked, not assumed).

## Subject/grade scope
Root `CLAUDE.md` / `.claude/CLAUDE.md` do not document a subject-restriction decision beyond general CBSE
grades 6-12 coverage. Recent migrations (`20260814000007_subject_catalogue_restrict_math_science.sql`,
`20260814000016_plan_subject_access_grant_pcb_to_starter.sql`, `20260814000018_plan_subject_access_restrict.sql`,
`20260814000024_reconcile_subjects_allowed_with_plan_reality.sql`) suggest an ACTIVE, recent narrowing of
subject access by plan — this may already implement "Mathematics and Science as primary subjects unless a
newer approved decision exists." Needs explicit confirmation against current `subscription_plans`/
`subject_access` state — tracked in the task ledger.

## Canonical stack (do not replace without demonstrated necessity + approval)
Next.js 16.2 (App Router) · React 18 · Tailwind 3.4 · SWR · Supabase Postgres/Auth/Storage/Edge Functions
(Deno) · Razorpay · Claude (Haiku/Sonnet/Opus via Anthropic API) · Flutter mobile · Vercel (bom1/Mumbai) ·
GitHub Actions. Confirmed via `package.json` engines (`node >=22.0.0 <23.0.0`), workspaces (`apps/*`,
`packages/*`, `eslint-plugin-alfanumrik`), and root `CLAUDE.md`.

## Freeze policy for this program
No new features. Any control found disabled, half-wired, or unproven is to be hidden/labeled/disabled, not
silently left claiming functionality it doesn't have. This applies most sharply to the Foxy action buttons
and adaptive-engine wiring — see `engineering-audit/CODEX_HANDOVER.md`, which raised exactly this concern
and whose completion could not be confirmed (see `04_FINDINGS_AND_CONFLICTS.md`).
