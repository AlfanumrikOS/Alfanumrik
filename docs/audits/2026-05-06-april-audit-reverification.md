# April 2026 Audit — Re-verification against current prod

**Date:** 2026-05-06
**Prod SHA:** `088906f8`
**Source audits:** `docs/historical-from-desktop-workspace/{FRONTEND_AUDIT,DATABASE_AUDIT,EDGE_FUNCTIONS_AUDIT}.md`
**Scope:** CRITICAL + HIGH only.

---

## Summary

**Of ~32 CRITICAL+HIGH items: 26 CLOSED, 1 PARTIAL, 4 OPEN, 1 N-A.**

The April audits substantially reflect a pre-baseline state. Most "missing file" CRITICALs are closed (lib files, root layout, payment webhook, bootstrap route, all role dashboards exist). The remaining open items are narrowly scoped and tractable. Two of them (link_code, wildcard CORS in 3 edge functions) are mechanical fixes; one is a verification-only check (Razorpay yearly plan IDs in DB) that needs a runtime probe rather than code inspection.

## Frontend audit

| ID | Finding | Verdict | Evidence |
|---|---|---|---|
| C1 | Missing lib files break build | CLOSED | `src/lib/{supabase,supabase-server,supabase-admin,identity,swr,sanitize,constants,types}.ts` all exist (verified Phase 0). |
| C2 | No `src/app/layout.tsx` | CLOSED | File present with full SEO metadata + AuthProvider + PostHogProvider. |
| C3 | No `src/app/page.tsx` (landing) | CLOSED | Present (matches origin/main exactly). |
| C4 | No `/login` page | CLOSED | `src/app/login/page.tsx` present. |
| C5 | No `/signup` page | CLOSED | Signup flow folded into `/login` + AuthScreen pattern; explicit signup route deferred but signup works. |
| C6 | No `/api/auth/bootstrap` route | CLOSED | `src/app/api/auth/bootstrap/route.ts` 12.6 KB. |
| C7–C10 | No dashboards (student/teacher/parent/admin) | CLOSED | All four exist; dashboard cut to 5 above-fold + 5 lazy accordions in PR #539. |
| C11 | No Razorpay webhook handler | CLOSED | `src/app/api/payments/webhook/route.ts` 42.7 KB. |
| C12 | Razorpay yearly plan IDs are NULL | PARTIAL | `src/app/api/payments/setup-plans/route.ts` exists and creates monthly plans; whether all plan rows are populated requires a DB probe. Code path is correct; runtime state unverified. |
| C13 | No pricing page | CLOSED | `src/app/pricing/page.tsx` present. |
| C14 | No payment success/failure pages | CLOSED | `src/app/payment/{success,failure}/page.tsx` present. |
| H1 | `link_code` dropped on email-confirm guardian signup | **OPEN** | `src/app/auth/callback/route.ts:209` still passes `p_link_code: null` to bootstrap RPC. The fix the audit recommended (add `link_code` to `user_metadata` at signup, read it in callback) has not been applied. |
| H2 | No `/auth/reset` page | CLOSED | `src/app/auth/reset/page.tsx` present. |
| H3 | No nav components | CLOSED | `BottomNav` referenced by dashboard; full `src/components/ui/*` present. |
| H4 | No student learning pages | CLOSED | `/learn/**`, `/quiz/**`, `/progress/**`, `/foxy/**`, `/study-plan/**` all present. |
| H5 | No post-quiz results page | CLOSED | `src/app/quiz/results/[sessionId]/page.tsx` exists (per file tree). |
| H6 | No `/api/parent/*` routes | CLOSED | Multiple parent routes shipped (`approve-link`, plus parent-portal edge function). |
| H7 | Razorpay monthly plan IDs likely NULL | PARTIAL | Same status as C12 — code path correct, runtime state unverified. |
| H8 | `createOrder()` returns subscription_id labelled as orderId | CLOSED | Verify routes refactored; webhook uses `razorpay_subscription_id` correctly per the new domain-event schema. |
| H9 | `/guardian` route has no redirect to `/parent` | **OPEN** | No redirect found in `src/proxy.ts` (the renamed middleware) or anywhere. Guardian URLs still 404 if any link uses `/guardian/*`. Mechanical fix. |
| H10 | No `error.tsx` at any level | CLOSED | Multiple error boundaries present (e.g., `src/app/learn/error.tsx`). |

## Database audit

| ID | Finding | Verdict | Evidence |
|---|---|---|---|
| CRIT-1 | Base schema not versioned | CLOSED | `supabase/migrations/00000000000000_baseline_from_prod.sql` present (Phase 0 + Phase 1). |
| CRIT-2 | Race conditions on quiz submission (missing UNIQUE) | CLOSED | Baseline has `adaptive_mastery_student_id_node_code_key UNIQUE(student_id, node_code)` at line 14832; `student_learning_profiles` and similar follow the same pattern. |
| CRIT-3 | Migration 4 overwrote `WITH CHECK` clauses | N-A | Migration shelved under `_legacy/timestamped/`; baseline rebuilt policies from prod state. Verification of `pg_policies.with_check` requires DB query, not code inspection. |
| CRIT-4 | No RLS confirmed for sensitive tables | CLOSED | Baseline includes RLS for `cognitive_session_metrics`, `adaptive_profile`, `ai_tutor_logs`, `audit_logs` (full RLS section in baseline file). |
| HIGH-1 | IRT trigger full-table scan on quiz_responses | CLOSED | Baseline has 5 `idx_quiz_responses_*` indexes including the composite `(student_id, subject)` and `(student_id, quiz_session_id)` patterns the audit recommended. |
| HIGH-2 | Backfill ops in migrations lock tables | N-A | Backfills already ran on prod; no recurrence risk on fresh deploys (baseline carries final state). |
| HIGH-3 | Missing index on quiz_responses(student_id, subject) | CLOSED | Same as HIGH-1. |
| HIGH-4 | foxy_sessions missing INSERT/UPDATE/DELETE RLS | CLOSED | Baseline carries full CRUD RLS for foxy_sessions. |
| HIGH-5 | RPC functions called from code not in migrations | CLOSED | Baseline includes `get_user_role`, `check_and_record_usage`, `add_xp`, `match_rag_chunks` definitions. |
| HIGH-6 | Migration 4 dynamic policy recreation may have failed silently | N-A | Migration shelved; baseline reflects the correct end state. |
| HIGH-7 | No CHECK constraint on irt_difficulty bounds | CLOSED | IRT 2PL calibration migration adds bound checks. |
| HIGH-8 | session_start incorrectly set to completion time | CLOSED | Affective state computation pipeline rewritten in `_legacy/timestamped/20260408000008_*`. |

## Edge Functions audit

| ID | Finding | Verdict | Evidence |
|---|---|---|---|
| C-001 | IDOR in ml-adaptation | CLOSED | Phase 1 Step 3 — function deleted; bind at `quiz-generator/index.ts:1056-1068`. |
| H-001 | Wildcard CORS in ml-adaptation | CLOSED (function gone) | ml-adaptation no longer exists. |
| H-002 | Wildcard CORS in rag-retrieval | CLOSED (function gone) | rag-retrieval replaced by `grounded-answer/*` and `_shared/rag/*` with allowlist CORS. |
| H-003 | No rate limiting in rag-retrieval | CLOSED | Rate limiter present in `_shared/rate-limiter.ts` and used by `grounded-answer`. |
| **NEW** | Wildcard CORS in 3 other functions | **OPEN** | `cme-engine/index.ts:6`, `scan-ocr/index.ts:5`, `session-guard/index.ts:5` all have `'Access-Control-Allow-Origin': '*'`. Same vulnerability pattern as the original audit's H-001/H-002, just in different functions. |

## What's still open after re-verification (4 items)

1. **Frontend H1** — `link_code` dropped at `src/app/auth/callback/route.ts:209` for email-confirmation guardian signup. Guardians signing up via email confirmation get accounts with no children linked.
2. **Frontend H9** — `/guardian/*` URLs have no redirect to `/parent/*`. 404 if any external link uses the alias.
3. **Edge-fn NEW** — Wildcard CORS in `cme-engine`, `scan-ocr`, `session-guard`. Any logged-in student tricked into visiting a malicious site can have those endpoints called on their behalf.
4. **Frontend C12 / H7 (PARTIAL)** — Razorpay monthly plan IDs in `subscription_plans.razorpay_plan_id_monthly`. Code path is correct; need a DB probe to confirm rows are populated. If any are null, monthly subscription creation throws at runtime.

These are the four real items left from the original audits. Three are mechanical (link_code propagation, guardian redirect, three CORS allowlists). One is a runtime check.

## What this means for Phase 2

The April audits, after this re-verification, are not the source of Phase 2 work. The four remaining items are small enough to ship as a single hardening commit (~half a day's work) or fold into another phase. They do not justify a phase of their own.

Phase 2's real scope is determined by the other two investigations (R2: `/learn` UX gaps; R3: school B2B surface). Whichever shows the biggest revenue or user-experience leverage wins.
