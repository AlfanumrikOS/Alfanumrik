# Feature Flag Registry

Source of truth for every runtime toggle. Keep in lockstep with the
`feature_flags` table and `src/lib/feature-flags.ts`. Update this doc in the
same PR that adds or removes a flag.

Two flag systems coexist:
1. **DB flags** (`feature_flags` table) — runtime toggles. Flip via
   `/super-admin/flags` or direct `UPDATE`. 5-min in-process cache
   (`src/lib/feature-flags.ts:67`).
2. **Env-var flags** — boot-time toggles. Flip via Vercel env-var change +
   redeploy. Used for things that must be locked in at build time.

Evaluation precedence for DB flags (`isFeatureEnabled` in `src/lib/feature-flags.ts`):
exists AND `is_enabled` AND `target_environments` AND `target_roles` AND
`target_institutions` AND `rollout_percentage` (deterministic per-user via
`hashForRollout`).

Default flip pattern: `UPDATE feature_flags SET is_enabled = <bool> WHERE flag_name = '<name>';`
(or use `/super-admin/flags`). Cache invalidates via `invalidateFlagCache()` on next request.

---

## Grounded-AI rollout (ai-engineer)

### ff_grounded_ai_enabled
- Controls: master switch for grounded-answer service. When OFF, all five `ff_grounded_ai_*` sub-flags are inert.
- Default: OFF — kept off until coverage SLA validated per pair.
- Rollback: flip OFF → all routing falls back to legacy Edge Functions.
- Migration: `20260418100800_feature_flags.sql`

### ff_grounded_ai_foxy / ff_grounded_ai_quiz_generator / ff_grounded_ai_ncert_solver / ff_grounded_ai_concept_engine
- Controls: per-product routing through grounded-answer service. Gated by `ff_grounded_ai_enabled`.
- Default: OFF
- Rollback: flip OFF → service reverts to legacy Edge Function (`foxy-tutor`, `quiz-generator-v2`, `ncert-solver`, legacy concept retrieval).
- Migration: `20260418100800_feature_flags.sql`

### ff_grounded_ai_enforced_pairs (table, not flag)
- Controls: per-(grade, subject_code) strict-grounding mode. When `enabled = true`, grounded-answer abstains rather than falls back for that pair.
- Default: empty table.
- Flip via: `/super-admin/grounding/verification-queue` or `INSERT INTO ff_grounded_ai_enforced_pairs (grade, subject_code, enabled, enabled_by) VALUES (...);`
- Rollback: set `enabled = false`. Auto-disable triggers when coverage drops below threshold (`auto_disabled_at` populated).
- Migration: `20260418100800_feature_flags.sql`

### ff_irt_question_selection
- Controls: IRT-info question selection in quiz-generator (vs random/difficulty fallback).
- Default: OFF — dormant, awaiting IRT calibration accumulation (~5k responses/item).
- Rollback: flip OFF → quiz-generator falls back to existing logic.

### ff_foxy_grounded_only
- Controls: Locks Foxy to grounded-only mode (no fallback to legacy retriever). Phase-4 cleanup gate.
- Default: OFF (referenced in code TODOs; not yet seeded in DB).
- Status: planned — see TODOs in `src/lib/ai/retrieval/ncert-retriever.ts` and `src/lib/ai/config.ts`.

---

## Marketing / UI (frontend)

### ff_welcome_v2
- Controls: Mobile-first editorial redesign of `/welcome`. URL stays `/welcome`; server component renders `<WelcomeV2 />` vs `<WelcomeV1 />`. `?v=2` forces v2 (QA preview); `?v=1` forces v1 (rollback escape hatch).
- Default: OFF
- Flip via: `/super-admin/flags`. Use `rollout_percentage` for staged rollout (10% canary → 50% → 100%). Per-user determinism via `hashForRollout(userId, 'ff_welcome_v2')`.
- Rollback: flip OFF — instant, no redeploy.
- Migration: `20260426150000_add_ff_welcome_v2.sql` (full operator runbook in the migration header)

---

## Payments / Subscriptions (backend)

### ff_atomic_subscription_activation
- Controls: gates the atomic-fallback path in the Razorpay webhook. When OFF, webhook calls only `activate_subscription`; on failure returns 503 immediately (Razorpay retries) instead of trying `atomic_subscription_activation`.
- Default: ON (safety net)
- Rollback: flip OFF only for emergency rollback if the atomic RPC misbehaves. Flip back ON to resume 2-tier failover.
- Migration: `20260425140500_ff_atomic_subscription_activation.sql`

### reconcile_stuck_subscriptions_enabled
- Controls: enables `reconcile_stuck_subscriptions` action in payments Edge Function (sweeps subs stuck in `pending_activation` >24h).
- Default: OFF — flip ON only after drift metrics confirm stuck subs accumulating.
- Rollback: flip OFF → reconcile no-ops; manual SQL reconcile if needed.
- Migration: `20260414120000_payment_subscribe_atomic_fix.sql`

### razorpay_payments
- Controls: master kill-switch for Razorpay flow. When OFF, payment routes return 503 and webhook events queue without acting.
- Owner: backend + ops
- Default: ON
- Rollback: emergency flip OFF; flip back ON. Webhook idempotency via `payment_webhook_events` prevents double-processing.
- Migration: `20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql`

---

## AI kill-switches (ai-engineer + ops)

### ai_usage_global
- Controls: global kill-switch for AI Edge Functions (Foxy, NCERT-solver, quiz-generator, cme-engine). When OFF, all return 503 immediately.
- Default: ON
- Rollback: emergency flip OFF (Anthropic outage, cost runaway); flip back ON.
- Migration: `20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql`

### foxy_cognitive_engine
- Controls: cognitive-engine state tracking inside Foxy.
- Default: ON
- Rollback: flip OFF → Foxy operates without cognitive-engine state.
- Migration: `20260413170000_kill_switch_flags.sql`

### foxy_diagram_rendering
- Controls: inline diagrams/SVG in Foxy responses.
- Default: ON
- Rollback: flip OFF → text-only Foxy responses.
- Migration: `20260413170000_kill_switch_flags.sql`

---

## Quiz / Assessment (assessment)

### quiz_assembler_v2
- Controls: routes quiz assembly through v2 assembler.
- Default: ON
- Rollback: flip OFF → v1 assembler.
- Migration: `20260413170000_kill_switch_flags.sql`

### adaptive_post_quiz
- Controls: adaptive post-quiz review and remediation flow.
- Default: ON
- Rollback: flip OFF → standard results screen only.
- Migration: `20260413170000_kill_switch_flags.sql`

### spaced_repetition
- Controls: spaced repetition review-card system (dashboard review queue).
- Default: ON (rollout 100%)
- Rollback: flip OFF or lower `rollout_percentage` → review-card UI hidden.
- Migration: `20260408000018_p5_wave_rollout_feature_flags.sql`

---

## Improvement-mode (ops)

### improvement_mode (master) + improvement_auto_detect, improvement_recommendations, improvement_auto_stage
- Controls: meta-system for auto-detection, AI recommendations, and auto-staging of low-risk fixes. Sub-flags gated by master.
- Defaults: master ON, auto_detect ON, recommendations ON, auto_stage OFF. Flip sub-flag OFF or master OFF to halt.
- Migration: `20260405100001_improvement_mode_flag.sql`

---

## Operations (ops)

### maintenance_banner
- Controls: dismissible amber banner across all portals.
- Default: OFF
- Flip via: `/super-admin/flags` + set `metadata.message_en` / `metadata.message_hi`. SQL: `UPDATE feature_flags SET is_enabled = true, metadata = '{"message_en":"...","message_hi":"..."}' WHERE flag_name = 'maintenance_banner';`
- Rollback: flip OFF.

### Wave rollout gates: wave1_*, wave2_*, wave3_*
- Flags: `wave1_launch`, `wave1_irt_personalization`, `wave1_affective_coaching`, `wave1_foxy_tutor`, `wave1_parent_digest`, `wave1_leaderboard`, `wave1_spaced_repetition`, `wave2_jee_neet_prep`, `wave2_all_subjects`, `wave2_multilingual_12`, `wave2_teacher_classroom`, `wave2_video_lessons`, `wave2_group_sessions`, `wave3_phygital_centers`, `wave3_govt_school_mode`, `wave3_voice_tutor`.
- Controls: rollout-wave gates with `target_grades`, `target_subjects`, `target_languages` arrays. Most wave1 ON; wave2/wave3 OFF. Flip OFF → that wave's features become inaccessible.
- Migration: `20260408000018_p5_wave_rollout_feature_flags.sql`

---

## Env-var flags (boot-time)

### NEXT_PUBLIC_POSTHOG_ENABLED
- Controls: initializes PostHog SDK on the client. When `'true'` AND `NEXT_PUBLIC_POSTHOG_KEY` is set, every `track()` call dual-dispatches to PostHog alongside Vercel Analytics.
- Owner: ops
- Default: unset (= OFF)
- Flip via: Vercel env var → redeploy. Cannot flip at runtime.
- Rollback: unset / set to `'false'` and redeploy. PostHog client no-ops; Vercel Analytics keeps working.
- Implementation: `src/lib/posthog-client.ts`, `src/lib/analytics.ts`

### MAINTENANCE_BANNER (deprecated)
- Older env-var mechanism for the maintenance banner. Superseded by DB flag `maintenance_banner` (instant flip, no redeploy).

### RECONCILE_STUCK_SUBSCRIPTIONS_ENABLED (deprecated alias)
- Env-var alias of DB flag `reconcile_stuck_subscriptions_enabled`. Kept only for early Edge Function bootstrap; new code reads the DB flag.

---

## How to add a new flag

1. **Schema** — add a migration:
   ```sql
   DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM feature_flags WHERE flag_name = 'ff_my_new_flag') THEN
       INSERT INTO feature_flags (flag_name, is_enabled, description)
       VALUES ('ff_my_new_flag', false, 'One-line description');
     END IF;
   END $$;
   ```
   The table has no UNIQUE constraint on `flag_name` — use `IF NOT EXISTS`,
   never `ON CONFLICT` (see `20260405100001_improvement_mode_flag.sql`).

2. **Registry** — if read in TS, add a constant in the appropriate registry in
   `src/lib/feature-flags.ts` (`WELCOME_FLAGS`, `MAINTENANCE_FLAGS`,
   `PAYMENT_FLAGS`). If non-false default, add to `FLAG_DEFAULTS`.

3. **Docs** — add a section here with: Controls, Owner, Default, Flip-via,
   Rollback, Migration.

4. **Tests** — Vitest case asserting both ON and OFF branches. For
   payment/AI/RBAC/onboarding flags, add a regression that the OFF path is
   safe (503, fallback, or no-op).

5. **Review chain** (per `.claude/CLAUDE.md`):
   - Feature flag API change → ops + testing
   - Flag controlling AI behavior → also ai-engineer
   - Flag targeting new role → also architect (RBAC review)
   - Kill-switch (default ON) → E2E test verifying OFF path

6. **Observability** — flag flips log to `admin_audit_log` via
   `logAdminAudit('feature_flag.updated', ...)` and emit `ops_event`
   (`category=deploy`) from
   `src/app/api/super-admin/feature-flags/route.ts`. Cache invalidates via
   `invalidateFlagCache()` on next request — no redeploy required.
