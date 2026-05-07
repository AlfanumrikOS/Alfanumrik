# Runbook — Single-School Feature Flag Rollout (Pre-Flight)

**Audience:** super-admin operator (Pradeep) flipping a feature flag for ONE pilot school as a validation step before broader rollout.
**Time:** 30 min pre-flight + 5 min flip + 30 min smoke test + 5 days observation.
**Reversibility:** instant rollback via single SQL UPDATE; no data migration in either direction.

---

## When to use this runbook

Any time you flip an `is_enabled = false` feature flag to `true` for a single school via `target_institutions`. Examples in flight as of 2026-05-07:

- `ff_learn_read_mode_v1` — student-facing `/learn` Read mode (lowest risk)
- `ff_school_self_service_billing_v1` — school-admin Razorpay self-service (highest risk: payments)
- `ff_learn_chapter_v1` — chapter scaffold (already in code; risk depends on what's behind the flag in prod)
- `ff_gst_invoicing_v1` — GST invoice PDFs (queued; do NOT roll out before P3-A code lands)

**Do NOT use this runbook for:**
- Broader-than-one-school rollouts (use the rollout strategy block in each flag's migration header)
- Flags that touch P11 (payment integrity) without a staging burn-in first
- Flags whose underlying tables/RPCs/Edge Functions haven't been verified in canonical (read the flag's migration; confirm referenced files exist; confirm the flag's call sites match the spec)

---

## Step 1 — Pre-flight checks (~30 min)

Run each. Block on any RED. Document each as a one-line `[OK]`/`[FAIL]` in your operator notes.

### 1.1. Flag state — confirm starting point

```sql
SELECT flag_name, is_enabled, rollout_percentage, target_institutions, target_environments, target_roles, updated_at
FROM feature_flags
WHERE flag_name = '<flag_name_here>';
```

Expected:
- Row exists
- `is_enabled = false`
- `rollout_percentage = 0`
- `target_institutions IS NULL`
- `updated_at` is older than the last code deploy that referenced this flag (otherwise someone touched it; investigate before flipping)

### 1.2. Target school — confirm the right tenant

```sql
SELECT id, name, slug, is_active, tenant_type, created_at, custom_domain, domain_verified
FROM schools
WHERE id = '<target_school_uuid>';
```

Expected:
- `is_active = true`
- Slug or custom_domain you actually intend to test against
- `tenant_type` matches the flag's intent (e.g. don't flip school-billing for a B2C tenant)

### 1.3. Code path exists — confirm what the flag actually gates

`grep -r "<flag_name>" src/ supabase/functions/` and read every match:
- Is the call site `isFeatureEnabled(flagName, { institutionId, ... })` or `feature_flags.is_enabled` raw?
- If raw `is_enabled` only, the per-school targeting will NOT work — it's a binary global switch. Either fix the call site first (use `isFeatureEnabled` from `@/lib/feature-flags`) or accept that flipping the flag for one school flips it for everyone.
- For Edge Functions: confirm the function's deploy state on staging matches what's on prod. The staging deploy on `develop` must be green for the flag's referenced function before flipping prod.

### 1.4. Telemetry is wired — confirm you'll see what happens

For the surface being rolled out, confirm at least one PostHog event will fire on use:

- `ff_learn_read_mode_v1` → `learn_chapter_started`, `learn_concept_advanced`, `learn_quick_check_submitted`, `learn_chapter_completed`
- `ff_school_self_service_billing_v1` → `school_billing_viewed`, `school_plan_change_started`, `school_plan_change_completed`, `school_seat_cap_hit`
- (other flags) → check the flag's migration header for documented events

Verify in PostHog UI: open the relevant insight/dashboard, confirm event volume is non-zero from the last 7 days. If it's zero, the event isn't firing at all and you'll roll out blind. Stop and fix.

### 1.5. Sentry baseline — capture pre-rollout error rate

Sentry → Issues → filter by environment=production, last 24h. Note:
- Total events
- Unique issues (top 5 IDs)
- Per-school filter for the target school: `tags.school_id:<uuid>` (if school_id is tagged on events; if not, you only have aggregate)

Save these numbers. Step 4 ("Watch list") compares against them.

### 1.6. Backup — confirm the latest restore point

```sql
SELECT * FROM pg_stat_archiver;  -- WAL state
```

Plus: confirm the most recent Supabase project backup exists (Supabase dashboard → Database → Backups). For payment-touching flags, do not flip until a backup exists from within the last 24h.

### 1.7. Staging burn-in — confirm same flag flipped on staging first

For ANY flag that touches payment, RBAC, or schema-mutating RPCs:
- Confirm the same flag is `is_enabled = true` for the same school equivalent on the staging Supabase project (project ref in `SUPABASE_STAGING_PROJECT_REF` GitHub secret).
- Confirm staging Sentry shows no new error class from that flip.
- Confirm staging health-check `/api/v1/health` returned 200 within the last 6h.

For pure UX flags (no DB writes, no payment): staging burn-in is recommended but not blocking.

### 1.8. Communication — pre-warn the school

- Send a one-line message to the school's principal/admin contact: "We're enabling [feature] for your school today, [date+time]. If anything looks off, reply here or page Pradeep."
- This is a cheap insurance: real users will tell you about UX issues that telemetry can't see.

### 1.9. Rollback drill (recommended, not blocking)

Type the rollback SQL into a scratch buffer (don't run). Confirm you have psql / Supabase SQL editor open and can paste-and-run within 60 seconds. MTTR target: < 60s.

```sql
-- ROLLBACK (don't run unless rolling back):
UPDATE feature_flags
SET is_enabled = false, target_institutions = NULL, updated_at = now()
WHERE flag_name = '<flag_name_here>';
```

---

## Step 2 — Flip the flag

```sql
UPDATE feature_flags
SET is_enabled         = true,
    rollout_percentage = 100,
    target_institutions = ARRAY['<target_school_uuid>']::text[],
    updated_at         = now()
WHERE flag_name = '<flag_name_here>';
```

Confirm 1 row affected. Capture the timestamp.

If your flag uses `target_institutions = '<uuid>'::uuid[]` (uuid array, not text), check the column type first via `\d feature_flags` or information_schema and adjust syntax.

---

## Step 3 — Smoke test (within 30 min of flip)

Run all of:

### 3.1. Positive smoke — target school sees the new behavior

- Log in (or impersonate via super-admin/student-impersonation) as a user from the target school
- Navigate to the relevant surface (e.g. `/learn/<subject>/<chapter>` for read mode; `/school-admin/billing` for self-service)
- Confirm the new behavior is present (toggle visible, button enabled, etc.)

### 3.2. Negative smoke — non-target school does NOT see it

- Log in as a user from a DIFFERENT school (or as a B2C student)
- Navigate to the same surface
- Confirm the new behavior is HIDDEN / disabled

If the negative smoke fails, the targeting is broken. **Roll back immediately** (Step 5), fix the call site to use `isFeatureEnabled(flagName, { institutionId })`, redeploy, retry.

### 3.3. Telemetry smoke — events fire

- Use the new behavior once as the target-school user
- Within 5 min, check PostHog Live Events for the event name expected (per 1.4 above)
- Confirm `school_id` (or institution_id) tag is correctly set on the event

### 3.4. Sentry smoke — no new errors

- Sentry → Issues → last 30 min, environment=production
- Confirm no new issue class has appeared since the flip
- If a new error appears AND it references the flag's surface, roll back; investigate before retrying

---

## Step 4 — Watch list (next 5 days)

Once per day at the same time, capture:

| Signal | Source | Threshold to flag |
|---|---|---|
| New Sentry issues from target school | Sentry | Any issue with `tags.school_id = <uuid>` and >5 occurrences |
| Aggregate Sentry rate change | Sentry | >20% increase vs 1.5 baseline |
| PostHog event volume from target school | PostHog | Expected events fire at least once per active user per session |
| Support tickets from target school | super-admin/support | Any ticket mentioning the new behavior |
| `/api/v1/health` failures | Vercel logs | Any 500 from canonical path |
| Payment-related flags only: failed Razorpay webhooks | Sentry + payments table | Any unverified-signature or unexpected-status |

Log to `docs/operator-notes/<date>-<flag>-rollout.md` so the post-rollout decision (next runbook) can reference it.

---

## Step 5 — Rollback (run any time, before or after Step 4 completes)

```sql
UPDATE feature_flags
SET is_enabled = false, target_institutions = NULL, updated_at = now()
WHERE flag_name = '<flag_name_here>';
```

Then:
1. Re-run the negative smoke from 3.2 — confirm the target school no longer sees the behavior.
2. Note the rollback in operator notes with a one-line cause.
3. File a Sentry-backed incident note in `docs/operator-notes/` if rollback was triggered by errors (so the next attempt has the prior failure mode documented).

A rollback is not a failure of the runbook — it's the runbook working. Successful flips and rollbacks both count as validated learning.

---

## Decision after Step 4

Use the companion runbook: `docs/runbooks/2026-05-07-post-rollout-decision-template.md`. It scores quant + qual signals against thresholds and tells you whether to expand to 10%, hold for another week, ship a fix first, or revert.

---

## Per-flag specifics — quick reference

### `ff_learn_read_mode_v1`

- Risk class: **low** (UX only, no DB mutations beyond existing `learning_events` writes)
- Smoke surface: `/learn/<subject>/<chapter>` — Practice/Read toggle should appear
- Key event: `learn_chapter_started` with `mode: 'read'`
- Rollback impact: zero data, zero financial — students just lose the toggle

### `ff_school_self_service_billing_v1`

- Risk class: **high** (Razorpay subscription create/update/cancel; touches P11)
- **Hard prereq**: staging burn-in green within last 24h
- Smoke surface: `/school-admin/billing` — Change plan / Cancel buttons should appear
- Key event: `school_billing_viewed` then `school_plan_change_started`
- Rollback impact: any Razorpay subscription created during the window stays active in Razorpay; the school keeps the plan they bought. Revoking access requires a separate operator action (cancel via Razorpay dashboard + manual `school_subscriptions` row update).

### `ff_learn_chapter_v1`

- Likely already shipped per Phase 1 closure note (page exists at full size in prod). Confirm via grep before treating it as a real flag-gated rollout.

### `ff_gst_invoicing_v1`

- **Do not roll out yet.** Phase 3-A code does not exist on main as of 2026-05-07. Flipping this flag with no Edge Function deployed is a no-op at best, an exception at worst.
