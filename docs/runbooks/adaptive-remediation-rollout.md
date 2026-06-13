# Adaptive Remediation (Phase A Loop A) — Rollout Runbook

**Date:** 2026-06-13
**Status:** Pre-rollout. Flag seeded OFF; no environment enabled yet.
**Flag:** `ff_adaptive_remediation_v1` (seeded by migration `20260619000300`, default `is_enabled=false, rollout_percentage=0`)
**Data layer:** `adaptive_interventions` (migration `20260619000200`)
**Spec:** `docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`
**Owner:** ops (this runbook + flip procedure) · architect (schema/flag seed) · backend (cron worker) · assessment (thresholds, ratified in `remediation-queue-adapter.ts`)

## What this controls

The adaptive closed loop: mastery-cliff detection → auto-inject ≤3 remediation cards into the student's daily rhythm → verify recovery within 7 days → escalate to a human (teacher B2B / guardian B2C) on failure.

Two phases, one worker route (`/api/cron/adaptive-remediation`, CRON_SECRET-gated), triggered nightly by the `adaptive_remediation_triggered` step in the `daily-cron` Edge Function:

- **INJECT** — gated on `ff_adaptive_remediation_v1` (global check + per-student rollout hash). Flag OFF ⇒ zero new interventions.
- **VERIFY** — gated on the existence of `status='active'` rows, **not** the flag. This is deliberate: the kill switch **drains, it does not freeze** (spec §9). Mid-flight interventions always reach a terminal state (`recovered` / `escalated`) even with the flag OFF.

Ratified bounds (single source of truth: `ADAPTIVE_REMEDIATION_RULES` in `src/lib/learn/remediation-queue-adapter.ts`):

| Bound | Value |
|---|---|
| Cliff threshold (single-event mastery drop) | ≥ 0.15 (or crossing below the 0.4 at-risk line) |
| Max remediation cards per student per day | 3 |
| Max total daily queue | 10 (7 base rhythm items + injections) |
| Active interventions per (student, subject, chapter) | 1 (DB partial unique index) |
| Same-chapter cooldown after a terminal intervention | 3 days |
| Recovery verification window | 7 days (denormalized into `verify_by` at insert — non-retroactive) |
| Inject scan cap | 200 students/run (24h `learner.mastery_changed` window) |
| Verify sweep cap | 500 rows/run |

## Prerequisites (must all be true before any flag flip)

- [ ] Migration `20260619000200_adaptive_interventions.sql` applied to the target environment. Verify:
  ```sql
  SELECT relrowsecurity FROM pg_class WHERE relname = 'adaptive_interventions';  -- expect: t
  SELECT polname FROM pg_policies WHERE tablename = 'adaptive_interventions' ORDER BY polname;
  -- expect 4 policies: parent_select, service_all, student_select, teacher_select
  ```
- [ ] Migration `20260619000300_seed_ff_adaptive_remediation_v1.sql` applied. Verify:
  ```sql
  SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags
  WHERE flag_name = 'ff_adaptive_remediation_v1';
  -- expect: one row, is_enabled = false, rollout_percentage = 0
  ```
- [ ] `daily-cron` Edge Function redeployed with the `adaptive_remediation_triggered` step. Verify by invoking it (or checking the next nightly tick): the response JSON `results` object must contain the key `adaptive_remediation_triggered`.
- [ ] `CRON_SECRET` set in **both** places: the Supabase Edge Function secrets (the Deno trigger reads it) and the Vercel environment (the Next.js worker reads `process.env.CRON_SECRET` and fails closed — 401 — without it).
- [ ] `SITE_URL` set on the `daily-cron` Edge Function **per environment**. The trigger falls back to `https://alfanumrik.com` when unset — a staging Edge Function without `SITE_URL` will POST to **production**. Keep `CRON_SECRET` values distinct between staging and production so a cross-environment call can only ever 401.
- [ ] Know your observability posture: the loop's `system.remediation_*` events go through `publishEvent()` → `state_events`, which is globally gated on `ff_event_bus_v1`. If that flag is OFF in the environment, those events are **silently dropped**. The `audit_logs` row on escalation and the `adaptive_interventions` table itself are bus-independent — use them as the primary monitoring source (see Monitoring below).
- [ ] Sentry capturing server errors for `/api/cron/adaptive-remediation` and `/api/rhythm/today`.

## Staging synthetic-cliff drill

Run the full loop end-to-end on staging with a **test student** (clearly marked as a test account) before any production flip. Use a fictional chapter number (e.g. `99`) so no real `learner_mastery` row or curriculum mapping interferes with the verdict.

### Step 0 — enable the flag on staging only

```sql
UPDATE feature_flags
SET is_enabled = true,
    rollout_percentage = 100,
    target_environments = ARRAY['staging']::text[],
    updated_at = now()
WHERE flag_name = 'ff_adaptive_remediation_v1';
```

The worker resolves its environment as `VERCEL_ENV || NODE_ENV`. Confirm what string your staging deployment actually reports and include it in the array (e.g. `ARRAY['staging','preview']`) — a mismatch silently keeps INJECT off. Flag cache TTL is 5 minutes; wait it out before the drill.

### Step 1 — fabricate the mastery cliff (drop ≥ 0.15)

Insert a `learner.mastery_changed` row directly via SQL (service role / Supabase SQL editor). Direct INSERT is intentional — the inject scan reads `state_events` directly, so the drill works even when `ff_event_bus_v1` is OFF. Replace `:auth_user_id` with the test student's `students.auth_user_id` (NOT `students.id`).

```sql
INSERT INTO public.state_events
  (event_id, kind, actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload)
VALUES (
  gen_random_uuid(),
  'learner.mastery_changed',
  ':auth_user_id',
  NULL,
  'drill_adaptive_remediation_cliff_' || to_char(now(), 'YYYYMMDDHH24MISS'),
  now() - interval '1 hour',
  jsonb_build_object(
    'subjectCode',   'math',
    'chapterNumber', 99,
    'fromMastery',   0.65,
    'toMastery',     0.45
  )
);
```

Drop = 0.20 ≥ 0.15 ⇒ the cliff signal flags with `worstSubject='math'`, `worstChapter=99`. The event must be within the last 24h (inject scan window) and the student must be `is_active = true, deleted_at IS NULL`.

### Step 2 — trigger the worker with `phase: 'inject'`

```bash
curl -s -X POST "https://<staging-host>/api/cron/adaptive-remediation" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"phase":"inject"}'
```

Expect `{"success":true,"data":{"phase":"inject","injected":1,...}}`. If `inject.skipped == "flag_off"`, the flag/environment match failed (see Step 0). A second identical call must report `deduped: 1, injected: 0` (the partial unique index backstop).

### Step 3 — verify the intervention row + rhythm lane + notification

```sql
SELECT id, student_id, subject_code, chapter_number, status, verify_by, trigger_snapshot
FROM adaptive_interventions
WHERE subject_code = 'math' AND chapter_number = 99
ORDER BY created_at DESC LIMIT 1;
-- expect: status='active'; trigger_snapshot carries largestDrop=0.2,
-- baselineMastery=0.65, postCliffMastery=0.45, rulesVersion='loop-a-v1'
```

Log in to staging as the test student and call `GET /api/rhythm/today` (or open the dashboard daily queue): the response items must include a `kind: 'remediation_review'` card positioned after the 5-item SRS block and before the ZPD problem. Toggle to Hindi and confirm the card copy renders bilingually (P7).

```sql
SELECT type, recipient_type, title, idempotency_key FROM notifications
WHERE type = 'remediation_assigned'
ORDER BY created_at DESC LIMIT 1;
-- expect: one student row, idempotency_key = 'remediation_assigned_<intervention_id>'
```

### Step 4 (optional but recommended) — recovery branch drill

Before fast-forwarding, insert an in-window recovery observation and confirm the `recovered` verdict (checked BEFORE expiry, so it fires immediately):

```sql
INSERT INTO public.state_events
  (event_id, kind, actor_auth_user_id, tenant_id, idempotency_key, occurred_at, payload)
VALUES (
  gen_random_uuid(),
  'learner.mastery_changed',
  ':auth_user_id',
  NULL,
  'drill_adaptive_remediation_recovery_' || to_char(now(), 'YYYYMMDDHH24MISS'),
  now(),
  jsonb_build_object('subjectCode','math','chapterNumber',99,'fromMastery',0.45,'toMastery',0.70)
);
```

Then POST `{"phase":"verify"}`. Expect `status='recovered'`, `resolved_at` set, and a `remediation_recovered` notification. (0.70 ≥ baseline 0.65 satisfies branch A; gain 0.25 ≥ 0.15 with mastery ≥ 0.4 satisfies branch B.) To continue with the escalation drill, re-run Steps 1–3 with a different chapter number (the 3-day cooldown blocks chapter 99).

### Step 5 — fast-forward the verification window

```sql
UPDATE adaptive_interventions
SET verify_by = now() - interval '1 minute'
WHERE id = '<intervention_id>' AND status = 'active';
```

Keep `verify_by > created_at` — if you set it at or before `created_at`, the worker discards the malformed window and falls back to the canonical 7 days, and the row stays `pending`. Do NOT insert any recovery observation for this branch.

### Step 6 — confirm both escalation branches

POST `{"phase":"verify"}` and check the terminal state:

**B2B (teacher path)** — precondition: the test student has an active `class_students` row in a class with an active `class_teachers` row.

```sql
SELECT status, escalated_to, teacher_assignment_id, resolved_at
FROM adaptive_interventions WHERE id = '<intervention_id>';
-- expect: status='escalated', escalated_to='teacher', teacher_assignment_id NOT NULL

SELECT id, teacher_id, student_id, class_id, chapter_id, status
FROM teacher_remediation_assignments WHERE id = '<teacher_assignment_id>';
-- expect: status='assigned'; chapter_id NULL for the fictional chapter 99
-- (nullable by design — renders as "general" remediation on the teacher side)
```

**B2C (parent path)** — precondition: NO roster teacher (remove the class link or use a second test student), and a `guardian_student_links` row with status `approved` or `active`.

```sql
-- expect: escalated_to='parent', teacher_assignment_id NULL
SELECT type, recipient_type, idempotency_key FROM notifications
WHERE type = 'remediation_escalated'
ORDER BY created_at DESC LIMIT 5;
-- expect: one student row (..._student) + one row per linked guardian
-- (..._<guardian_id>), each preference-gated (default ON)
```

**Both branches** — the bus-independent audit row must exist:

```sql
SELECT action, resource_type, resource_id, details FROM audit_logs
WHERE action = 'system.remediation_escalated'
ORDER BY created_at DESC LIMIT 5;
-- details carry UUIDs + codes only (REG-68 pattern): subject_code,
-- chapter_number, escalated_to, teacher_assignment_id, verify_by, rules_version
```

### Step 7 — cleanup

```sql
DELETE FROM adaptive_interventions
 WHERE student_id = '<test_student_id>' AND chapter_number IN (99 /*, other drill chapters */);
DELETE FROM teacher_remediation_assignments WHERE id = '<teacher_assignment_id>';
DELETE FROM notifications WHERE idempotency_key LIKE 'remediation_%<intervention_id>%';
DELETE FROM state_events WHERE idempotency_key LIKE 'drill_adaptive_remediation_%';
```

## Flag flip sequence

All flips go through the super-admin console (`/super-admin/flags` → PATCH `/api/super-admin/feature-flags`). The route requires the `super_admin` admin tier; every change writes an admin audit entry (`feature_flag.updated`, with `previous_state`) plus an `ops_events` row, and invalidates the in-process flag cache. SQL equivalents below are for break-glass use only — they bypass the admin audit trail, so prefer the console.

Propagation note: the flag cache TTL is 5 minutes per serverless instance; `invalidateFlagCache()` only clears the instance that served the PATCH. Treat every flip as taking up to 5 minutes to fully propagate.

### Stage 1 — staging (drill above must be green)

```sql
UPDATE feature_flags
SET is_enabled = true, rollout_percentage = 100,
    target_environments = ARRAY['staging']::text[], updated_at = now()
WHERE flag_name = 'ff_adaptive_remediation_v1';
```

Let at least 2 nightly cron ticks run. Confirm `adaptive_remediation_triggered` in the daily-cron response and zero `inject.errors` / `verify.errors` in the worker logs.

### Stage 2 — production pilot cohort (Day 3+ if staging clean)

```sql
UPDATE feature_flags
SET is_enabled = true, rollout_percentage = 10,
    target_environments = NULL, updated_at = now()
WHERE flag_name = 'ff_adaptive_remediation_v1';
```

**Use `rollout_percentage` for the pilot — do NOT use `target_institutions`.** The cron worker evaluates the flag without an `institutionId` in context, so any institution scoping resolves to false and disables injection entirely. The per-student cohort comes from the deterministic `hashForRollout(auth_user_id, flag_name)` check inside the inject loop; the worker's global gate passes for any percentage > 0 by design.

Hold 1 week. Watch (see Monitoring): injection volume vs. pilot-cohort size, recovery rate vs. escalation rate, notification volume, zero sustained worker errors.

### Stage 3 — global (Day 10+ if pilot clean)

```sql
UPDATE feature_flags
SET rollout_percentage = 100, updated_at = now()
WHERE flag_name = 'ff_adaptive_remediation_v1';
```

2-week observation window before declaring Loop A shipped.

## Kill-switch semantics

### Flag OFF = DRAIN, not freeze

```sql
UPDATE feature_flags
SET is_enabled = false, updated_at = now()
WHERE flag_name = 'ff_adaptive_remediation_v1';
```

(Prefer the console — audit trail.) Effects, in order:

1. Within ≤5 min (cache TTL): the INJECT phase short-circuits (`skipped: 'flag_off'`) — **no new interventions**; the `/api/rhythm/today` remediation lane renders empty; the base 7-item queue is unchanged.
2. The VERIFY phase keeps running nightly — it is gated on active rows existing, not the flag. Mid-flight interventions complete naturally to `recovered` or `escalated`. No student is left in limbo.
3. Expected full drain: ≤ 7 days (the longest outstanding `verify_by` horizon) + 1 daily cron tick.

The daily-cron trigger itself is deliberately NOT flag-gated in Deno — gating it there would break the drain. Do not "fix" this.

### Hard stop (ops-only, when the natural drain is not acceptable)

Bulk-resolve all active interventions to the ops-only terminal state `dismissed` (the cron loop never writes it). **Flip the flag OFF first** — otherwise the next nightly inject recreates rows. Dismissed rows start the normal 3-day chapter cooldown, so re-enabling later does not instantly re-inject the same chapters. Run as a single transaction with the audit row:

```sql
BEGIN;

WITH dismissed AS (
  UPDATE public.adaptive_interventions
     SET status = 'dismissed',
         resolved_at = now()
   WHERE status = 'active'
   RETURNING id
)
INSERT INTO public.audit_logs
  (auth_user_id, action, resource_type, resource_id, details, status)
SELECT
  NULL,                                   -- system/ops action
  'system.remediation_hard_stop',
  'adaptive_interventions',
  NULL,
  jsonb_build_object(
    'actor_role',      'ops',
    'dismissed_count', (SELECT count(*) FROM dismissed),
    'reason',          '<FILL IN: incident ref / why drain was insufficient>',
    'flag_state',      (SELECT jsonb_build_object('is_enabled', is_enabled,
                                                  'rollout_percentage', rollout_percentage)
                          FROM public.feature_flags
                         WHERE flag_name = 'ff_adaptive_remediation_v1')
  ),
  'success';

COMMIT;
```

Note: a hard stop suppresses the escalation that expired interventions would otherwise have produced — students who were heading to `escalated` get no teacher/guardian follow-up. If the loop was stopped for non-pedagogical reasons (e.g. an infra bug), consider a manual review of the dismissed rows (`SELECT ... WHERE status='dismissed' AND resolved_at >= <hard_stop_time>`) with assessment.

## Monitoring after enablement

Primary sources, in order of reliability:

1. **`adaptive_interventions` table** (always available — the loop's own ledger):
   ```sql
   -- Daily injection volume (last 7 days)
   SELECT date_trunc('day', created_at) AS day, count(*)
   FROM adaptive_interventions GROUP BY 1 ORDER BY 1 DESC LIMIT 7;

   -- Live state distribution
   SELECT status, count(*) FROM adaptive_interventions GROUP BY status;

   -- Terminal outcomes + escalation split (last 30 days)
   SELECT status, escalated_to, count(*)
   FROM adaptive_interventions
   WHERE resolved_at >= now() - interval '30 days'
   GROUP BY status, escalated_to ORDER BY count(*) DESC;
   ```
2. **Cron telemetry**: the nightly daily-cron response carries `results.adaptive_remediation_triggered` (= injected + resolved). Edge Function logs show `daily-cron: adaptive_remediation — injected=N resolved=M`. **Caveat:** the Deno trigger soft-fails — a worker outage shows as `0`, not as an entry in the 207 `errors` map. A flat 0 for multiple days with active rows present means the worker is failing; check Vercel logs.
3. **Vercel function logs**: `adaptive_remediation: run complete` with the full structured summary — inject `{scanned, injected, deduped, skippedNullTarget, blocked, errors}`, verify `{evaluated, pending, recovered, escalated, errors}`.
4. **`notifications` volume** (the guardian-spam guard):
   ```sql
   SELECT type, recipient_type, count(*)
   FROM notifications
   WHERE type IN ('remediation_assigned','remediation_recovered','remediation_escalated')
     AND created_at >= now() - interval '7 days'
   GROUP BY type, recipient_type;
   ```
   Structural ceilings: ≤600 `remediation_assigned`/day (200-student scan cap × 3 cards), ≤1 notification per intervention per type (deterministic idempotency keys + upsert), guardian rows only on the parent escalation path and preference-gated.
5. **`audit_logs`**: `action = 'system.remediation_escalated'` — one row per escalation, bus-independent.
6. **`state_events`** (`kind IN ('system.remediation_injected','system.remediation_recovered','system.remediation_escalated')`) — **only populated when `ff_event_bus_v1` is ON** in the environment. Do not build alerts on this source unless the bus flag is verified ON.
7. **`ops_events`**: records the flag flips themselves (`category='deploy'`, source `feature-flags/route.ts`) — your audit trail that a flip happened and who did it.
8. **Sentry**: error rate on `/api/cron/adaptive-remediation` and `/api/rhythm/today` < 0.5%.

Investigate when:

- `inject.errors` or `verify.errors` > 0 on two consecutive nightly runs.
- `inject.scanned` pins at 200 daily (scan-cap saturation — carry-over is by design, but persistent saturation means the cliff threshold is catching too much; review with assessment before raising the cap with backend).
- Escalation share > 50% of terminal outcomes in the pilot (verification window or remediation content not working — review with assessment).
- `remediation_assigned` notifications approach the 600/day structural ceiling.
- Guardian-facing `remediation_escalated` volume looks clustered on few guardians (a multi-subject collapse routes several escalations to the same family — expected at most once per chapter per ~10 days, but worth a human look).

## Rollback

1. **Standard**: flip `ff_adaptive_remediation_v1` OFF via the super-admin console. Drain semantics apply (see Kill-switch). No data loss; no schema to reverse.
2. **Escalated**: flag OFF + hard-stop SQL above (bulk `dismissed` + audit row).
3. **Optional flag-row removal** (documented manual DOWN in `20260619000300`): `DELETE FROM feature_flags WHERE flag_name = 'ff_adaptive_remediation_v1';` — a missing flag resolves OFF; already-active rows still drain via verify.
4. Migrations stay in place — `adaptive_interventions` is additive-only (RLS-locked, service-role writes) and inert while the flag is OFF.

## References

- Spec: `docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md`
- Worker route: `src/app/api/cron/adaptive-remediation/route.ts`
- Pure modules: `src/lib/pulse/signals.ts`, `src/lib/learn/remediation-queue-adapter.ts`, `src/lib/learn/recovery-evaluation.ts`
- Notifications: `src/lib/notification-triggers.ts` (`onRemediationAssigned` / `onRemediationRecovered` / `onRemediationEscalated`)
- Cron trigger: `supabase/functions/daily-cron/index.ts` (`triggerAdaptiveRemediation`)
- Migrations: `supabase/migrations/20260619000200_adaptive_interventions.sql`, `20260619000300_seed_ff_adaptive_remediation_v1.sql`
- Style precedent: `docs/superpowers/runbooks/2026-05-09-pedagogy-v2-wave-1-rollout.md`
