# Alfanumrik Upgrade — Phase 2 Design

**Date:** 2026-05-06
**Owner:** Pradeep Sharma (solo)
**Status:** Draft — awaiting user review
**Working repo:** `C:\Users\Bharangpur Primary\Alfanumrik-repo` (canonical, synced to prod `088906f8` end of Phase 1).
**Predecessor:** Phase 1 (`docs/superpowers/discovery/PHASE_1_CLOSURE.md`) + three research reports under `docs/audits/2026-05-06-*.md`.

---

## Why this spec exists

Phase 1 reset our understanding of the codebase. The April-audit "rebuild from scratch" framing was wrong: most of A/B/C/D shipped between April 25 and May 6. The three research reports the user just commissioned narrow Phase 2 to three concrete sub-projects, all of which the user approved (A + B + C). This spec sequences them and establishes the rules each sub-project shares.

The work is **sequential**: P2-A → P2-B → P2-C. P2-A is half a day, ships before B starts. B is the biggest piece (~1.5 weeks) and ships before C starts. Each sub-project has its own branch, its own PR, its own merge gate. Within each sub-project, the work is small enough to hold in one head.

## Shared rules (apply to A, B, and C)

- **Branch-per-sub-project**, not one monster branch. Names: `fix/phase-2a-hardening-sweep`, `feat/phase-2b-learn-read-mode`, `feat/phase-2c-school-self-service-subscription`. Each branched from `main` after the previous one merges.
- **Draft PR opened on each branch**, never auto-merged. The user merges when ready. The draft is the review checkpoint between sub-projects.
- **Feature flags for anything user-visible.** P2-A has none (defensive only). P2-B ships behind `ff_learn_read_mode_v1`. P2-C ships behind `ff_school_self_service_billing_v1`. Both flags default off, rollout 0%, can be flipped via super-admin UI.
- **No destructive prod operations from the agent.** No `Remove-Item`, no `git push --force`, no `supabase db reset`, no SQL run against prod. Migrations land in `supabase/migrations/` for the user to apply via the existing pipeline. PRs are draft. Razorpay calls in P2-C use **test-mode keys only** during the implementation pass; switching to live mode is a user action.
- **Every change touches the canonical repo only.** The Desktop workspace is irrelevant.
- **Verification before completion claims.** Each sub-project ends with `npm run type-check && npm run lint && npm run test` passing on its branch. Build (`npm run build`) is best-effort — the user has limited Vercel build minutes; if it's slow we run it once before opening the PR, not on every commit.
- **Telemetry first when adding code.** Every new user-visible code path that ships in P2-B or P2-C emits at least one PostHog event. P2-B is partly *about* telemetry; P2-C inherits the rule.
- **Bilingual parity.** Any new user-visible string in P2-B or P2-C ships with both English and Hindi from the first commit. No "Hindi follow-up PR." The codebase already has the `isHi` pattern; follow it.
- **No new MCP/SaaS dependencies.** Use what's already in `package.json`. Specifically: no new analytics SDK, no new payment gateway. We stand on PostHog, Razorpay, Supabase, Next 16, React 18, react-markdown, KaTeX.

---

## Sub-project P2-A — Hardening sweep (defensive)

**Branch:** `fix/phase-2a-hardening-sweep`. **Estimated effort:** ~4 hours solo.

**Why first:** every later sub-project benefits from these being closed. Three of the four are the kind of bug that bites once a real user hits the wrong path; closing them now means we don't get pulled back during P2-B or P2-C to fight a fire.

**The four items:**

1. **`link_code` propagation through email-confirmation guardian signup.** The audit chain: `AuthScreen.tsx` → email-confirm flow → `auth/callback/route.ts:209` calls `bootstrap_user_profile` RPC with `p_link_code: null`, even when the guardian had supplied a link code at signup.
   - Fix shape: at signup, write `link_code` into `user_metadata.link_code`. In `auth/callback/route.ts`, read `user.user_metadata?.link_code` and pass it to the RPC.
   - Verify: a guardian who completes email confirmation lands at `/parent/dashboard` with the linked student visible. Test: a unit test that simulates the metadata round-trip; an existing E2E test if one exists for guardian signup.
   - Risk: if `link_code` is invalid, the bootstrap RPC must already handle "code not found" gracefully (it should — pre-existing). If it doesn't, that's a separate bug and we keep the current `null` fallback as a safety net but emit a structured warning log.

2. **`/guardian/*` → `/parent/*` redirect.** Add a permanent redirect in `src/proxy.ts` (the renamed middleware). Match `/guardian` and `/guardian/(.*)`, rewrite to `/parent` and `/parent/$1`. Status 308 (permanent, preserves method).
   - Verify: visiting `/guardian` in dev redirects to `/parent`. Visiting `/guardian/dashboard` redirects to `/parent/dashboard`.

3. **Wildcard CORS in three edge functions.** `cme-engine/index.ts:6`, `scan-ocr/index.ts:5`, `session-guard/index.ts:5` all have `'Access-Control-Allow-Origin': '*'`. Replace with the same allowlist pattern `foxy-tutor` and `grounded-answer` use (origin must be in `ALLOWED_ORIGINS` or match `^https:\/\/alfanumrik(-[a-z0-9]+)?\.vercel\.app$`).
   - Verify: each function's `OPTIONS` preflight returns the matching origin (or the first allowed origin) for an allowed request, and a non-matching origin gets the first allowed origin (which the browser will then block via SOP).
   - Risk: if any of the three functions is currently called from an unexpected origin (e.g., a mobile app embedding via WebView), the change blocks it. Mitigation: grep the codebase + `mobile/` for the function names and confirm no surprising callers.

4. **Razorpay monthly plan IDs runtime probe.** Read-only DB probe to determine whether `subscription_plans.razorpay_plan_id_monthly` is null on any active row. If yes: write a one-line operator action to `docs/runbooks/2026-05-06-razorpay-plan-ids-fix.md` so the user can run it. **No autonomous SQL execution against prod.**
   - Method: use the Supabase MCP `execute_sql` tool with `SELECT id, plan_code, name, razorpay_plan_id_monthly FROM subscription_plans WHERE is_active = true AND razorpay_plan_id_monthly IS NULL`. If empty, document closed; if not, write the runbook.

**Done when:** all four items resolved (in code or in a runbook), branch pushed as a draft PR, CI green.

---

## Sub-project P2-B — `/learn` Read Mode + telemetry

**Branch:** `feat/phase-2b-learn-read-mode`. **Estimated effort:** ~1.5 weeks solo. **Flag:** `ff_learn_read_mode_v1`.

**Why second:** biggest learning-loop ROI. Adds the missing "actually read the chapter" surface without rebuilding anything from scratch — leverages the RAG-RRF + `rag_content_chunks` infrastructure already in prod. Also closes the telemetry gap on the entire `/learn` page in one go.

**Sub-steps in order:**

1. **Telemetry first** (no flag needed; emit events unconditionally).
   - Add server-side PostHog `capture()` calls for: `learn_subject_viewed`, `learn_chapter_started`, `learn_concept_advanced`, `learn_quick_check_submitted` (with `is_correct`), `learn_chapter_completed` (with `score_pct`), `learn_foxy_doubt_clicked`, `learn_take_quiz_clicked`. Use the existing `src/lib/posthog/server.ts` (Phase 0 confirmed it exists).
   - Distinct ID: `auth.users.id` (P13 boundary already established in `.env.example` PostHog block).
   - PII boundary: only `student.grade`, `subject_code`, `chapter_number`, `concept_idx`, `score_pct`, `is_correct`. Never name, email, phone.
   - Verify: navigating through a chapter in dev fires the events; PostHog dashboard shows them within 10 minutes.

2. **Migration: `ff_learn_read_mode_v1` flag.** Mirror `_legacy/timestamped/20260426150000_add_ff_welcome_v2.sql`. Default off, 0% rollout, with the standard rollout/rollback runbook in the migration header.

3. **Server-side data fetcher.** Add `src/lib/learn/fetchChapterContent.ts` that, given `(subject, grade, chapter_number)`, returns `{ markdown: string; sources: Array<{chunk_id, chapter, page}>; }` from `rag_content_chunks`. Use the existing RRF retrieval shape from `_shared/rag/retrieve.ts` — no new RPC needed; just a focused query that orders by `chunk_index` and concatenates.
   - Cap: 50 KB markdown per chapter. If a chapter exceeds, paginate by section.
   - Cache: 5-minute SWR cache via the existing `cacheFetch` pattern. Chapter content rarely changes.

4. **UI toggle on the chapter page.** In `src/app/learn/[subject]/[chapter]/page.tsx`, add a `mode: 'practice' | 'read'` state. Default to `practice` (existing behavior). When the flag is on, show a toggle in the header. In `read` mode, render the markdown via `react-markdown` + `rehype-katex` + `remark-math` + `remark-breaks` (all already deps), with KaTeX for math.
   - Bilingual: if `isHi`, query a `_hi`-suffixed column or fall back to English (Phase 2.5 note: real Hindi NCERT chapter content rendering depends on whether `rag_content_chunks` has bilingual rows; if not, render English with a "हिन्दी संस्करण जल्द आएगा" notice).
   - "Read" mode also includes a "Now practice" CTA at the bottom that switches the page back to practice mode at concept 0.

5. **Inbound deep-link from quiz remediation.** In `src/app/quiz/results/[sessionId]/page.tsx` (or wherever the post-quiz screen renders), every wrong-answer card gets a "Read about this" button linking to `/learn/{subject}/{chapter}?from=quiz&question_id=X&mode=read`. The chapter page reads `from`, `question_id`, and `mode=read` from `searchParams` and (a) opens directly in read mode, (b) emits a `learn_entered_from_quiz` PostHog event.

6. **Empty / fallback states.** If `rag_content_chunks` returns nothing for a chapter, render a friendly "Foxy is preparing this chapter — try the quick-check questions for now" + practice-mode auto-switch. No 500s.

7. **Tests.** Vitest unit test for `fetchChapterContent.ts` (mock Supabase). Playwright e2e: load chapter with flag on, switch to Read mode, see prose; with flag off, no toggle visible; deep link `?mode=read` works when flag on.

8. **Type-check, lint, vitest, build.** Open draft PR.

**What this sub-project does NOT include:**

- No new RAG infrastructure (RRF, MMR, embedding pipeline).
- No editor / authoring tools for chapter content.
- No video / image embedding (Phase 3 candidate).
- No re-quizzing / mastery model changes.

**Done when:** flag on for my account in dev, both modes work, telemetry events visible in PostHog, deep-link from quiz remediation works, draft PR open with CI green, runbook entry in the migration header tells the user how to flip rollout to 10% / 100%.

---

## Sub-project P2-C — School-admin self-service subscription

**Branch:** `feat/phase-2c-school-self-service-subscription`. **Estimated effort:** ~1 week solo. **Flag:** `ff_school_self_service_billing_v1`.

**Why third:** revenue lever. Without it, every school pilot needs my involvement. With it, schools self-onboard end-to-end. Sequenced after B because B is the biggest single-piece risk; if B reveals tooling problems we want to surface those before doing a payment-flow change.

**Sub-steps in order:**

1. **Migration: `ff_school_self_service_billing_v1` flag.** Same pattern as P2-B's flag.

2. **Razorpay subscription support for `school_subscriptions`.** The student-side `student_subscriptions` flow has been atomic since prod migrated — use it as the template. Add columns/RPCs only if the migration already in prod doesn't cover them; my read suggests `school_subscriptions` already has `plan, seats_purchased, price_per_seat_monthly, status, current_period_start, current_period_end` from the GET-only viewer.
   - Add a `razorpay_subscription_id` column on `school_subscriptions` if absent.
   - Add an `activate_school_subscription(school_id, plan, seats, razorpay_subscription_id)` RPC that mirrors the student-side advisory-lock + idempotency pattern.

3. **POST `/api/school-admin/subscription/route.ts`.** Create or change a school subscription.
   - Auth: `authorizeSchoolAdmin(req, 'school.manage_billing')`.
   - Body: `{ plan: 'starter'|'pro'|'unlimited', billing_cycle: 'monthly', seats: number }`.
   - Validates: `seats >= seats_used_now`. Refuses downgrade below current usage.
   - Calls Razorpay (test keys in dev) to create the subscription. Returns `{ subscription_id, hosted_page_url, expected_amount_inr }`.
   - Idempotency key: `Idempotency-Key` header required, mirrors the student flow.

4. **PATCH `/api/school-admin/subscription/route.ts`.** Plan change or seat change on an existing subscription. Atomic plan-change RPC pattern from `_legacy/timestamped/20260427000002_atomic_plan_change_rpc.sql` ported to the school side if not already there.

5. **DELETE `/api/school-admin/subscription/route.ts`.** Cancel at end of current period (no immediate revocation — schools paid for the period).

6. **Razorpay webhook hook.** Update `src/app/api/payments/webhook/route.ts` (already 42.7 KB, sophisticated) to dispatch `subscription.activated`, `subscription.charged`, `subscription.cancelled` events for `school_subscriptions` based on the entity-id namespace prefix or a metadata flag set at subscription creation time.

7. **UI in `src/app/school-admin/billing/page.tsx`.** Three states: no subscription → onboarding CTA; trial → "convert to paid" CTA; active → plan + seats + next-invoice + "change plan" + "cancel" buttons. Bilingual.

8. **Seat enforcement.** Trying to add a student via `school-admin/students` must fail with a clear "you've used N of N seats; upgrade or remove a student" message when at cap. Wire the check; emit a `school_seat_cap_hit` PostHog event.

9. **Telemetry.** PostHog events: `school_billing_viewed`, `school_plan_change_started`, `school_plan_change_completed` (with `from_plan`, `to_plan`, `seats`), `school_subscription_cancelled`, `school_seat_cap_hit`.

10. **Tests.** Vitest unit tests for the seat-cap math and the idempotency-key path. Playwright e2e for the happy path (school admin opens billing → picks pro/20 seats → Razorpay test page → returns to active state).

11. **Type-check, lint, vitest, build.** Open draft PR.

**What this sub-project does NOT include:**

- No school-admin OAuth client self-service (P2-C *only* covers subscription; OAuth client management remains super-admin).
- No new WhatsApp templates for billing events (Phase 3 candidate).
- No invoice email-out automation (Phase 3 candidate).
- No multi-currency or non-INR pricing.

**Done when:** flag on for my own school in dev, full happy path works against Razorpay test keys, seat-cap blocks correctly, all webhook events handled, draft PR open with CI green, runbook in the migration tells the user how to roll out.

---

## Risk register (all three sub-projects)

| Risk | Mitigation |
|---|---|
| Razorpay test-mode credentials missing in `.env.local` | P2-C step 1 reads the env file before writing any code; if the keys are absent, P2-C is paused with a clear ask to the user before any Razorpay calls are made |
| `rag_content_chunks` doesn't have content for the chapters I test against | P2-B step 6 includes the friendly fallback; if the fallback rate is high (>20% of chapters), that's a P3 finding (content gap, not a code bug) |
| PostHog server SDK rate-limits the burst from the migration | We're not capturing on backfill; only on live nav. No risk |
| The 4-item P2-A wildcard CORS change blocks a legitimate caller | Grep the codebase + `mobile/` for the function names before flipping; if a non-allowlist origin shows up, add it explicitly to `ALLOWED_ORIGINS` |
| Auto mode mistakes a "ship draft PR" for "merge to main" | The spec explicitly says draft only; PR creation uses `gh pr create --draft`; no `gh pr merge` ever |
| Spec runs over 1.5 weeks for B and stalls C | If B isn't done in 12 working days, pause B at the next clean checkpoint, ship a partial behind the same flag (still off in prod), and start C — B can resume after C |

## What "done" looks like for the whole phase

- [ ] Three branches each have a draft PR open and CI green.
- [ ] P2-A has closed all 4 R1 open items (or the runbook documents the one runtime-only item).
- [ ] P2-B has the chapter Read mode working behind `ff_learn_read_mode_v1` and PostHog events for the entire `/learn` page.
- [ ] P2-C has school-admin self-service subscription working behind `ff_school_self_service_billing_v1` end-to-end against Razorpay test keys.
- [ ] Auto-memory updated with phase outcome.

When all of those are true, Phase 2 closes. Phase 3 brainstorm starts from whichever pain (observability / payments leak / parent comms / OAuth self-service / etc.) is highest after one round of school pilots informs us.
