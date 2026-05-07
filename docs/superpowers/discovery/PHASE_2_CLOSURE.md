# Phase 2 Closure — Alfanumrik Upgrade

**Date:** 2026-05-07
**Predecessor:** Phase 1 — `docs/superpowers/discovery/PHASE_1_CLOSURE.md` (status: Closed).
**Spec:** `docs/superpowers/specs/2026-05-06-alfanumrik-upgrade-phase-2-design.md`.
**Status:** Closed in code. All three sub-projects (P2-A, P2-B, P2-C) are substantially shipped behind feature flags. GA cutover (flag flips) remains the user's call.
**Verified by:** code audit + Supabase MCP read-only probe + type-check + lint, all on canonical `Alfanumrik\` branch `docs/phase-1-2-closure-notes` against `origin/main` HEAD `94b5cd1e`.

---

## Why this closure was needed

The Phase 2 spec was written 2026-05-06 with implementation expected over ~2.5 weeks (P2-A 4h + P2-B 1.5w + P2-C 1w). On 2026-05-07 a fresh code audit found that the bulk of all three sub-projects had already shipped — likely through parallel agent/Codex/Cursor sessions plus same-day commits #574–#578 on origin/main. Without a closure note, the spec would keep looking "open" and risk re-implementation.

This closure documents what actually shipped, with file:line evidence, so future planning starts from accurate ground truth.

## P2-A — Hardening sweep (4 items, ~4 hours estimate)

### Item 1 — `link_code` propagation through email-confirmation guardian signup ✅ SHIPPED

**Spec wanted:** at signup write `link_code` into `user_metadata.link_code`; in `auth/callback/route.ts` read `user.user_metadata?.link_code` and pass it to `bootstrap_user_profile` RPC.

**Shipped:**
- `src/components/auth/AuthScreen.tsx:185-187` — at parent-tab signup, persists `metaData.link_code = linkCode.trim()` with explicit comment `(Phase 2-A hardening.)`.
- `src/app/auth/callback/route.ts:209` — RPC call passes `p_link_code: meta.link_code || null`.

### Item 2 — `/guardian/*` → `/parent/*` permanent redirect ✅ SHIPPED

**Spec wanted:** 308 permanent redirect from `/guardian` and `/guardian/(.*)` to `/parent` and `/parent/$1`.

**Shipped:**
- `src/proxy.ts:415-421` — exact match for `/guardian` and `pathname.startsWith('/guardian/')`, status 308 (preserves request method), with explicit comment `(Phase 2-A hardening — closes Frontend audit H9.)`.

### Item 3 — Wildcard CORS in three Edge Functions ✅ SHIPPED

**Spec wanted:** replace `'Access-Control-Allow-Origin': '*'` in `cme-engine`, `scan-ocr`, `session-guard` with the allowlist pattern from `foxy-tutor` / `grounded-answer`.

**Shipped:** all three Edge Functions now import `getCorsHeaders` from `'../_shared/cors.ts'` (centralized allowlist, not wildcard):
- `supabase/functions/cme-engine/index.ts:4`
- `supabase/functions/scan-ocr/index.ts:3`
- `supabase/functions/session-guard/index.ts:3`

### Item 4 — Razorpay monthly plan IDs runtime probe ✅ CLOSED (no fix needed)

**Probe executed via Supabase MCP `execute_sql` on project `shktyoxqhundlvkiwguu` (Alfanumrik Adaptive Learning OS, ap-south-1, ACTIVE_HEALTHY) on 2026-05-07.**

Query: `SELECT id, plan_code, name, razorpay_plan_id_monthly, is_active FROM subscription_plans WHERE is_active = true ORDER BY plan_code;`

| plan_code | name | razorpay_plan_id_monthly |
|---|---|---|
| free | Explorer | null *(expected — free plan has no recurring charge)* |
| starter | Starter | plan_SWj4mjnfC2MY5Q |
| pro | Pro | plan_SWj4nFgbldrnTM |
| unlimited | Family / School | plan_SWj4nmErRIbd02 |

All paid plans have monthly Razorpay plan IDs configured. Spec's null-checking criterion is met. **No runbook required.**

## P2-B — `/learn` Read Mode + telemetry (~1.5 weeks estimate)

### Flag ✅
- `supabase/migrations/20260507000001_add_ff_learn_read_mode_v1.sql` (created 2026-05-07).

### Server-side data fetcher ✅
- `src/lib/learn/fetchChapterContent.ts` — present.
- `src/app/learn/[subject]/[chapter]/actions.ts` — `loadChapterContent` server action present (page imports from `./actions`).

### Read-mode UI component ✅
- `src/components/learn/ChapterReadView.tsx` — present.
- `src/app/learn/[subject]/[chapter]/page.tsx:25-28` — lazily imported via `next/dynamic` with `ssr: false`, only loaded when student opens Read mode (protects bundle budget P10).
- `src/app/learn/[subject]/[chapter]/page.tsx:79-80` — explicit comment `Phase 2-B: Read mode (gated by ff_learn_read_mode_v1)`.

### Telemetry ✅
- `src/app/learn/[subject]/[chapter]/page.tsx` matched the grep for `learn_chapter_started|learn_concept_advanced|learn_quick_check_submitted|learn_chapter_completed`.
- `src/lib/posthog/types.ts` registers the corresponding event types.
- Distinct ID + PII boundary inherited from existing PostHog setup (P13 boundary).

### Items the spec called out as in-scope but not separately re-verified in this closure
- The "Read about this" deep-link from quiz remediation results (spec step 5).
- The Hindi fallback notice when `rag_content_chunks` lacks `_hi` content (spec step 4 sub-bullet).
- The empty-chapter fallback "Foxy is preparing this chapter" with practice-mode auto-switch (spec step 6).
- Vitest unit test for `fetchChapterContent.ts` and Playwright E2E for the toggle/deep-link (spec step 7).

These should be confirmed by a quick spot-check or a focused test pass before flag rollout to >0%.

## P2-C — School-admin self-service subscription (~1 week estimate)

### Flag ✅
- `supabase/migrations/20260507000002_add_ff_school_self_service_billing_v1.sql` (created 2026-05-07).

### Atomic plan-change RPC ✅
- `supabase/migrations/20260507000003_atomic_school_plan_change_rpc.sql` (created 2026-05-07).

### Subscription API ✅
- `src/app/api/school-admin/subscription/route.ts` — full GET/POST/PATCH/DELETE shape.
  - Imports `createRazorpaySubscription`, `cancelRazorpaySubscription`, `updateRazorpaySubscriptionQuantity` from `@/lib/razorpay`.
  - `POST` validates plan ∈ `{starter, pro, unlimited}`, billing_cycle ∈ `{monthly, yearly}`, seats ∈ `[1, 5000]`. Refuses if Razorpay plan id is unprovisioned (`razorpay_plan_id_monthly` null).
  - Auth: `authorizeSchoolAdmin(request, 'school.manage_billing')`.
  - Feature-flag gated via `isFeatureEnabled(SELF_SERVICE_FLAG, …)`.
  - PostHog `capture` import wired for telemetry.

### Webhook integration ✅
- `src/app/api/payments/webhook/route.ts:215` — dispatches `subscription.activated` → `school_activated` and `subscription.renewed` flow for school subscription entities.

### Seat enforcement ✅
- `school_seat_cap_hit` PostHog event registered in `src/lib/posthog/types.ts`.
- Live seat count via `countActiveSeats(schoolId)` in `src/app/api/school-admin/subscription/route.ts:64-72` (counts `students` where `school_id` matches and `is_active = true`).
- Used by super-admin: `src/app/api/super-admin/seat-usage/route.ts`, `src/app/super-admin/invoices/page.tsx`, billing UIs.

### UI ✅
- `src/app/school-admin/billing/page.tsx` — present.
- `src/app/school-admin/billing/ManageSubscriptionSection.tsx` — present.

### Items the spec called out as in-scope but not separately re-verified in this closure
- Idempotency-Key header enforcement on POST (spec step 3 sub-bullet).
- DELETE cancellation timing (`end_of_cycle` vs `immediate`) — code path stub visible in `DeleteBody` interface; full handler should be re-read.
- Vitest unit tests for the seat-cap math and idempotency-key path (spec step 10).
- Playwright E2E for the happy path against Razorpay test keys (spec step 10).

## Plus: substantial work beyond Phase 2 spec scope

Recent commits #574–#578 on `origin/main` (all 2026-05-07) ship additional white-label / B2B infrastructure that is beyond Phase 2's spec but builds on the same surface:

- `feat(white-label): nightly reverify-domains cron for ownership + TLS drift (#577)`
- `chore(audit): smarter tenant-isolation classifiers — REVIEW queue 132 → 41 (#578)`
- `feat(super-admin): Vercel API integration for custom-domain attach + TLS (#576)`
- `feat(super-admin): custom-domain set + DNS-TXT verification (Phase E core) (#575)`
- `feat(audit): trail school-admin module + tenant-config mutations (#574)`

The school-admin surface in canonical now contains 20 API routes and 19 pages, far beyond what Phase 2-C anticipated. This is a positive surprise that materially compresses the work needed for the original "Initiative D — teacher/parent portals" pain point.

## Verification performed at closure time

- ✅ `git status` clean on canonical; local main fast-forwarded to `origin/main` HEAD `94b5cd1e`.
- ✅ `npm install` ran clean (934 packages, exit 0).
- ✅ `npm run type-check` — exit 0, zero TypeScript errors against current canonical (`tsc --noEmit`).
- ✅ `npm run lint` — exit 0, **0 errors, 2642 warnings**. All warnings are pre-existing and non-blocking: design-token sweep follow-ups (`no-restricted-syntax`, "See Phase 5B design-token sweep"), a handful of `react/no-unescaped-entities`, and `no-console` warnings in `analytics.ts` / `logger.ts`. Per `next.config.js` `ignoreDuringBuilds: true`, lint warnings do not block production builds.
- ⏸ `npm test` — not run in this closure pass because canonical lacks `.env.local`; flag for follow-up before any flag rollout to >0%.
- ⏸ Razorpay test-mode end-to-end (P2-C spec step 10 E2E) — not runnable in this closure pass without `.env.local` and Razorpay test keys.

## Follow-ups (small, scoped)

1. **Confirm the test surface for P2-B and P2-C.** Run `npm test` once `.env.local` is in place; if Vitest tests for `fetchChapterContent.ts` and the seat-cap math are absent, add them before flipping either flag above 0%.
2. **Manual spot-check of the P2-B deep-link** from quiz remediation (`?from=quiz&question_id=X&mode=read`) and the empty-chapter / Hindi fallbacks — quick browser pass.
3. **Verify the staging environment claim.** The `claude.ai Supabase` MCP exposed exactly one project (`shktyoxqhundlvkiwguu` — prod). Either staging is a separate Supabase project the current MCP credentials can't see, or staging is a Supabase database branch / schema rather than a separate project. Worth a 5-minute clarification so the Phase 3 spec's "staging burn-in mandatory" rule has a known target.
4. **Decide flag rollout.** Both `ff_learn_read_mode_v1` and `ff_school_self_service_billing_v1` default to OFF / 0%. The user's super-admin flag UI controls this. No agent action required; this is the user's go/no-go call.

## What this changes for Phase 3

The queued spec at `docs/superpowers/specs/2026-05-07-phase-3-enterprise-billing-design.md` was written assuming P2-C had shipped Razorpay self-service for individual schools. That assumption is correct — Track 2 of this same closure batch will re-read the Phase 3 spec against the discovered surface, especially:

- `/api/school-admin/invoices/route.ts` already exists, which may pre-empt or inform P3-A (GST invoice PDF generation).
- The `subscription_plans.razorpay_plan_id` column exists alongside `razorpay_plan_id_monthly` (per the route file's PlanRow interface) — the data model has more than the spec assumed.
- White-label / domain / tenant infra already present is heavier than Phase 3 anticipated, so multi-tenant prerequisites are already settled.

Phase 3 should be re-scoped accordingly. That work is queued behind this closure.

## Bottom line

Phase 2 is closed in code. Three feature flags off by default (`ff_learn_chapter_v1`, `ff_learn_read_mode_v1`, `ff_school_self_service_billing_v1`) gate the user-visible behavior. The next decision is whether to (a) roll any of them above 0%, (b) close the spec follow-ups above first, or (c) start Phase 3 with a re-scoped plan against the now-known surface.
