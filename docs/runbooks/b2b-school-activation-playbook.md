# B2B School Activation Playbook

**Purpose:** Operator runbook for taking a provisioned school from "dark" (schema present, flags OFF) to "fully lit" (all appropriate surfaces enabled for the pilot school). No code changes required. Execute in the Supabase SQL Editor and Vercel dashboard.

**Audience:** Pradeep (CEO) or an ops engineer with Supabase service-role access.

**Estimated time:** 30 min pre-flight + 15 min flag flips + 30 min smoke test.

**Reversibility:** Every flag flip is a single SQL UPDATE. Rollback is instant and described in Section 4.

---

## Section 0 — Prerequisites

Before touching any flag, confirm ALL of the following:

### 0.1 Deployments

- [ ] PR #1112 (P0 — `scripts/sql/verify-b2b-objects.sql` + repair guard) is merged and deployed to production on Vercel.
- [ ] PR #1114 (P1 — school provisioning form + `POST /api/schools/trial` flow) is merged and deployed to production.
- [ ] Confirm via Vercel dashboard: latest production deployment is green, promoted, and the `bom1` (Mumbai) region shows no errors in the last 30 minutes.

### 0.2 Pilot school UUID

After P1 deploys, provision the school via the admin form (or `POST /api/schools/trial`). The response body and the `schools` table row both contain the UUID. Record it here before proceeding:

```
PILOT_SCHOOL_UUID = <paste here>
```

Verify the school exists and is active:

```sql
SELECT id, name, slug, is_active, tenant_type, created_at
FROM public.schools
WHERE id = '<PILOT_SCHOOL_UUID>';
```

Expected: `is_active = true`, `tenant_type = 'school'`, `created_at` within the last few minutes.

### 0.3 Access required

- [ ] Supabase dashboard > prod project > SQL Editor — with service-role access (not the anon key).
- [ ] Vercel dashboard — to confirm deployments and watch logs.
- [ ] Sentry — to capture a pre-flip baseline error count (project: `alfanumrik-production`).

### 0.4 Pre-flip baseline

Capture now, before any flag flip. You will compare against these numbers in Section 5.

- Sentry: total events in last 24h, any open issues tagged `school_id=<PILOT_SCHOOL_UUID>`.
- Vercel: note the current deployment hash shown on the production overview.

---

## Section 1 — Pre-flight: Repair-skip Verification

The B2B schema objects (Command Center RPCs, `schools_*` tables) may have been silently skipped on prod by the legacy repair-skip bug — a migration was marked "applied" without executing. Run this check before flipping any flag.

### 1.1 Run the verify script

Open Supabase SQL Editor (prod project) and paste the contents of `scripts/sql/verify-b2b-objects.sql`. Run it.

If that script does not exist yet (P0 not merged), run this minimal equivalent:

```sql
SELECT
  'schools table'                  AS object,
  CASE WHEN to_regclass('public.schools') IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END AS status
UNION ALL SELECT
  'school_subscriptions table',
  CASE WHEN to_regclass('public.school_subscriptions') IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END
UNION ALL SELECT
  'school_admins table',
  CASE WHEN to_regclass('public.school_admins') IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END
UNION ALL SELECT
  'school_classes table',
  CASE WHEN to_regclass('public.school_classes') IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END
UNION ALL SELECT
  'get_school_overview RPC',
  CASE WHEN to_regclass('public.get_school_overview') IS NOT NULL
            OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                       WHERE n.nspname = 'public' AND p.proname = 'get_school_overview')
       THEN 'PRESENT' ELSE 'MISSING' END
UNION ALL SELECT
  'get_classes_at_risk RPC',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = 'public' AND p.proname = 'get_classes_at_risk')
       THEN 'PRESENT' ELSE 'MISSING' END
UNION ALL SELECT
  'get_teacher_engagement RPC',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = 'public' AND p.proname = 'get_teacher_engagement')
       THEN 'PRESENT' ELSE 'MISSING' END
UNION ALL SELECT
  'feature_flags table',
  CASE WHEN to_regclass('public.feature_flags') IS NOT NULL THEN 'PRESENT' ELSE 'MISSING' END;
```

### 1.2 Interpret results

| Result | Meaning | Action |
|---|---|---|
| All rows = `PRESENT` | Schema is healthy. Proceed to Section 2. | Continue. |
| `schools`, `school_subscriptions`, `school_admins` = `MISSING` | The core B2B tables never applied. | STOP. Do not flip any flag. |
| Command Center RPCs (`get_school_overview` / `get_classes_at_risk` / `get_teacher_engagement`) = `MISSING` | Migration `20260614000000_phase3b_school_command_center_read_models.sql` was skipped. The Command Center will render but all KPI tiles will error. | STOP. Do not flip the Command Center flag. |
| `feature_flags` = `MISSING` | No flag infrastructure at all. | STOP. |

**If any B2B-critical object shows MISSING:** do not proceed. Follow the repair procedure in `docs/runbooks/schema-reproducibility-fix.md` — specifically Section 11 (migration repair via `supabase migration repair --status applied <timestamp>`). Rerun Section 1.1 after repair until all objects are PRESENT.

### 1.3 Confirm current flag state

Run this to see the starting state of every B2B flag:

```sql
SELECT flag_name, is_enabled, rollout_percentage, target_institutions, updated_at
FROM public.feature_flags
WHERE flag_name IN (
  'ff_school_command_center',
  'ff_school_pulse_v1',
  'ff_school_admin_rbac',
  'ff_school_reports_depth',
  'ff_teacher_command_center',
  'ff_school_provisioning',
  'ff_principal_ai_v1',
  'ff_education_intelligence'
)
ORDER BY flag_name;
```

**Expected healthy state after P0 deploys** (migration `20260620000400_phase3_enable_school_saas_flags.sql` applied):

| Flag | is_enabled | target_institutions | Notes |
|---|---|---|---|
| `ff_school_command_center` | `true` | `NULL` | Globally ON — no per-school scoping needed |
| `ff_school_admin_rbac` | `true` | `NULL` | Globally ON |
| `ff_school_reports_depth` | `true` | `NULL` | Globally ON |
| `ff_teacher_command_center` | `true` | `NULL` | Globally ON |
| `ff_school_pulse_v1` | `false` | `NULL` | Seeded OFF — must be enabled per-pilot |
| `ff_school_provisioning` | `false` or absent | — | CEO-gated — see Section 3 |
| `ff_principal_ai_v1` | `false` or absent | — | CEO-gated — see Section 3 |
| `ff_education_intelligence` | `false` or absent | — | CEO-gated — see Section 3 |

If `ff_school_command_center` still shows `is_enabled = false`, migration `20260620000400` has not been applied. Fix that first — the Command Center surface is the prerequisite for everything else.

---

## Section 2 — Per-pilot Flag Activation (Ordered Sequence)

Execute steps in order. Each step has a verification check. Do not skip ahead.

**Why per-school scoping?** The `target_institutions` column on `feature_flags` limits a flag to specific school UUIDs. Setting it means the flag evaluates `true` only when `isFeatureEnabled(flagName, { institutionId: '<PILOT_SCHOOL_UUID>' })` is called. Non-pilot schools see the flag as OFF even if `is_enabled = true`. This is the safe default for any flag that is not yet globally lit.

**Important:** Flags already globally ON (`ff_school_command_center`, `ff_school_admin_rbac`, `ff_school_reports_depth`, `ff_teacher_command_center`) do not need a per-school flip — they are already active for the pilot school. Section 2 covers only the flags that ship OFF.

---

### Step 2a — School Pulse (at-risk monitoring panel)

**What it does:** Enables the School Pulse panel inside the Command Center. Shows flagged students (mastery cliff, inactivity, concentration risk) to the school admin. Requires `ff_school_command_center` to be ON (already confirmed above).

**Prerequisite check:**

```sql
SELECT flag_name, is_enabled FROM public.feature_flags
WHERE flag_name = 'ff_school_command_center';
```

Must return `is_enabled = true` before proceeding.

**Enable for pilot school only:**

```sql
UPDATE public.feature_flags
SET
  is_enabled          = true,
  rollout_percentage  = 100,
  target_institutions = ARRAY['<PILOT_SCHOOL_UUID>'],
  updated_at          = now()
WHERE flag_name = 'ff_school_pulse_v1';
```

Replace `<PILOT_SCHOOL_UUID>` with the UUID captured in Section 0.2. Confirm `1 row affected`.

**Verify:** Log in as the pilot school admin account. Navigate to `/school-admin`. The Command Center should load. Within the Command Center, a "Pulse" or "At-Risk Students" panel should be visible. If the panel does not appear, the feature flag cache may be stale — wait up to 5 minutes (the server-side flag cache TTL is 5 minutes) and refresh. If still absent after 10 minutes, check Sentry for a flag evaluation error.

**Negative check:** Log in as a user from a DIFFERENT school (or a B2C student). Navigate to `/school-admin`. The Pulse panel must NOT appear. If it does, the `isFeatureEnabled` call site is reading the raw `is_enabled` column without passing `institutionId` — this is a targeting bug. Roll back and investigate before retrying.

---

### Step 2b — Command Center global state confirmation

`ff_school_command_center` is already globally ON (migration `20260620000400`). No SQL flip needed.

**Verify for the pilot school:** Log in as the pilot school admin. Navigate to `/school-admin`. The Command Center (KPI strip with seat-utilization gauge, avg mastery, classes-at-risk rail, teacher-engagement table) should render with real data — not the legacy stat-tile dashboard.

If the Command Center renders but all tiles show zero/null data: the Command Center RPCs are present but the pilot school has no student activity yet. This is expected for a brand-new school. Confirm the RPCs exist (Section 1.1 check passed) and move on — data will appear as students join and complete quizzes.

---

### Step 2c — RBAC depth confirmation

`ff_school_admin_rbac` is already globally ON (migration `20260620000400`). No SQL flip needed.

**What this does:** Enforces the role-aware permission matrix for school admins. A `principal` gets broader access than an `academic_coordinator`. The matrix is defined in `src/lib/school-admin-auth.ts` (`SCHOOL_ADMIN_ROLE_CAPABILITIES`).

**Verify:** Log in as the pilot school admin. Confirm that the school admin cannot access routes outside their `school_admins.role` permission matrix. If the school was just provisioned, the admin defaults to `institution_admin` role which has the broadest access — role narrowing is relevant when sub-admins are added.

---

### Step 2d — Reports depth confirmation

`ff_school_reports_depth` is already globally ON (migration `20260620000400`). No SQL flip needed.

**What it enables:** Three read API routes become reachable:
- `GET /api/school-admin/reports/mastery` — school-wide mastery rollup
- `GET /api/school-admin/reports/bloom` — Bloom's level distribution
- `GET /api/school-admin/reports/export` — JSON or CSV export

**Verify:** Navigate to `/school-admin/reports` (or the equivalent section in the consolidated nav). Confirm the reports surface loads without 404. Data will be sparse until students have completed quizzes.

---

### Step 2e — Teacher Command Center confirmation

`ff_teacher_command_center` is already globally ON (migration `20260620000400`). No SQL flip needed.

**What it enables:** The dense desktop-first teacher home (class switcher, roster mastery heatmap, at-risk alerts rail, today summary) and the consolidated 5-item teacher nav.

**Verify:** Log in as a teacher account linked to the pilot school. Navigate to `/teacher`. The Command Center layout should render instead of the legacy tabbed dashboard.

---

## Section 3 — CEO-gated Flags

The following flags require explicit CEO sign-off before flipping. Do NOT enable them during the standard pilot activation. They are listed here so the operator knows they exist and what the prerequisite is for each.

---

### `ff_school_provisioning`

**Risk class: P11-adjacent (billable seat enforcement)**

Every active student on a school roster becomes a billable seat when this flag is ON. The flag enables server-authoritative seat enforcement: `within_plan` allows enrollment, `grace_warn` soft-allows with a warning (up to 10% overage, 14-day window), `grace_expired` or `over_ceiling` hard-blocks with HTTP 409.

**Prerequisite before flipping:**
- Seat billing contract is in place with the school (per-seat pricing agreed and signed).
- Migration `20260614000001` (containing `evaluate_seat_policy`, `enroll_students_with_seat_check`, `refresh_school_seat_usage`) is applied and the RPCs show PRESENT in the verify query.
- Staging burn-in is green (same flag enabled on staging, no errors in 24h).
- CEO/finance have confirmed go-live.

**How to flip (when approved):**

```sql
UPDATE public.feature_flags
SET
  is_enabled          = true,
  rollout_percentage  = 100,
  target_institutions = ARRAY['<PILOT_SCHOOL_UUID>'],
  updated_at          = now()
WHERE flag_name = 'ff_school_provisioning';
```

Start with `target_institutions` scoped to the pilot school. Expand to global only after two weeks of zero seat-enforcement incidents.

---

### `ff_principal_ai_v1`

**Risk class: P12 (AI safety)**

Enables the school-scoped natural-language assistant for school leadership (principal AI assistant). The backing migration `20260616010000_principal_ai_assistant_v1.sql` is drafted but not yet applied as of this playbook's writing.

**Prerequisite before flipping:**
- Migration `20260616010000` is applied. Verify: `get_principal_ai_context` or equivalent RPC shows PRESENT in a custom verify query.
- ai-engineer has reviewed the system prompt and tool definitions for P12 compliance (age-appropriate, CBSE scope, no unfiltered output).
- CEO has approved the AI model choice and prompt design.

**How to flip (when approved):**

```sql
-- Only after ai-engineer P12 sign-off AND backing migration applied:
UPDATE public.feature_flags
SET
  is_enabled          = true,
  rollout_percentage  = 100,
  target_institutions = ARRAY['<PILOT_SCHOOL_UUID>'],
  updated_at          = now()
WHERE flag_name = 'ff_principal_ai_v1';
```

If the row does not exist yet (flag unseeded), insert it:

```sql
INSERT INTO public.feature_flags (
  flag_name, is_enabled, rollout_percentage,
  target_roles, target_environments, target_institutions,
  created_at, updated_at
)
VALUES (
  'ff_principal_ai_v1', true, 100,
  NULL, NULL, ARRAY['<PILOT_SCHOOL_UUID>'],
  now(), now()
)
ON CONFLICT (flag_name) DO UPDATE
  SET is_enabled = true,
      rollout_percentage = 100,
      target_institutions = ARRAY['<PILOT_SCHOOL_UUID>'],
      updated_at = now();
```

---

### `ff_education_intelligence`

**Risk class: Revenue dashboards (MRR/churn data)**

Enables the super-admin "Education Intelligence Cloud" dashboards (Overview, Schools, Revenue, Geography + per-school drilldown). These dashboards consume rollup tables (`mrr_snapshots`, `school_health_daily`, `school_churn_signals`, `school_mrr_daily`, `geographic_metrics`).

**Prerequisite before flipping:**
- The EIC migrations that create the rollup tables are applied.
- The nightly rollup job (`daily-cron` or a dedicated EIC job) has run at least once and populated the rollup tables. Verify: `SELECT count(*) FROM mrr_snapshots;` returns > 0.
- CEO has confirmed the dashboard definitions (MRR formula, churn definition) with ops.

**How to flip (when approved):**

```sql
-- Only after nightly rollup is running and rollup tables are populated:
INSERT INTO public.feature_flags (
  flag_name, is_enabled, rollout_percentage,
  target_roles, target_environments, target_institutions,
  created_at, updated_at
)
VALUES (
  'ff_education_intelligence', true, 100,
  NULL, NULL, NULL,
  now(), now()
)
ON CONFLICT (flag_name) DO UPDATE
  SET is_enabled = true,
      rollout_percentage = 100,
      updated_at = now();
```

This flag is a super-admin visibility flag (not per-school), so `target_institutions = NULL` (global super-admin access) is appropriate when it is ready.

---

## Section 4 — Rollback Procedure

To instantly disable a flag for the pilot school without affecting any other school or tenant:

### Rollback a per-school flag (Pulse, Provisioning, Principal AI)

```sql
UPDATE public.feature_flags
SET
  is_enabled          = false,
  rollout_percentage  = 0,
  target_institutions = NULL,
  updated_at          = now()
WHERE flag_name = '<FLAG_NAME_HERE>';
```

Replace `<FLAG_NAME_HERE>` with the flag you want to disable, e.g. `'ff_school_pulse_v1'`.

**Confirm 1 row affected.** Then re-run the negative smoke check from Section 2a: log in as the pilot school admin and confirm the disabled surface no longer appears. The server-side flag cache TTL is 5 minutes, so the change takes effect within 5 minutes of the UPDATE.

### Rollback a globally-enabled flag (Command Center, RBAC, Reports, Teacher CC)

These were enabled globally by migration `20260620000400`. Rollback disables them for ALL schools, not just the pilot. Use only if a critical error is confirmed:

```sql
UPDATE public.feature_flags
SET is_enabled = false, updated_at = now()
WHERE flag_name IN (
  'ff_school_command_center',
  'ff_school_admin_rbac',
  'ff_school_reports_depth',
  'ff_teacher_command_center'
);
```

This is a broad rollback. Coordinate with the team before executing.

### Rollback template (keep this in a scratch buffer before every flag flip)

```sql
-- ROLLBACK TEMPLATE — fill in the flag name, then paste and run:
UPDATE public.feature_flags
SET is_enabled = false, rollout_percentage = 0, target_institutions = NULL, updated_at = now()
WHERE flag_name = 'REPLACE_ME';
```

Target MTTR (mean time to rollback): under 60 seconds from decision to the UPDATE committed.

---

## Section 5 — Post-activation Smoke Test Checklist

Run within 30 minutes of each flag flip. Document each as [PASS] or [FAIL] with a one-line note.

### School admin basics

- [ ] School admin can log in to `/school-admin` without error.
- [ ] Command Center renders: KPI strip (seat utilization gauge, avg mastery %), classes-at-risk rail, teacher-engagement table. None of these tiles should show a red error state (empty/zero data is acceptable for a new school).
- [ ] Consolidated nav renders 5 sections (Overview, People, Academics, Billing, Settings). All section links are reachable (no 404 on click).

### School Pulse (only if Step 2a was executed)

- [ ] Pulse panel is visible inside the Command Center for the pilot school admin.
- [ ] Pulse panel is NOT visible when logged in as a user from a different school.
- [ ] If any students are already enrolled and have quiz activity: at least one Pulse signal card is visible (or the panel shows "All students on track" — both are valid).

### Reports depth

- [ ] Navigate to the reports section. Mastery and Bloom's report pages load without 404.
- [ ] The "Export" action is present and initiates a download (may return empty CSV for a new school — that is acceptable).

### Invite and onboarding flow

- [ ] The school admin's invite code is present in the school record:
  ```sql
  SELECT invite_code FROM public.schools WHERE id = '<PILOT_SCHOOL_UUID>';
  ```
  Expected: a non-null, non-empty string.
- [ ] A test student joins via the invite code (or the invite claim form at `/onboarding`). The student's `students.school_id` is set to `<PILOT_SCHOOL_UUID>` after joining.
- [ ] After the next cron run (daily-cron runs at 18:30 UTC — check `supabase/migrations/20260404000002_pg_cron_daily.sql`), the student appears in the Command Center's class enrollment count.

### Teacher flow

- [ ] A teacher invited to the pilot school logs in. `/teacher` renders the Command Center (dense desktop layout with class switcher, heatmap, at-risk alerts rail). Not the legacy tabbed dashboard.
- [ ] The teacher nav shows 5 items (Command Center, Gradebook, Assignments, Messages, Reports).

### Announcements (if built in P2)

- [ ] School admin can create an announcement and it appears in the student's notification feed.

---

## Section 6 — Monitoring

### Where to watch

| Signal | Source | What to look for |
|---|---|---|
| Application errors | Sentry > project `alfanumrik-production` | Any new issue class appearing after a flag flip. Filter by `tags.school_id=<PILOT_SCHOOL_UUID>` if that tag is set on school-admin routes. |
| Deployment logs | Vercel > bom1 (Mumbai) > Function Logs | 500 errors on `/api/school-admin/*`, `/api/pulse/*`, `/api/teacher/*`. |
| Flag evaluation latency | Vercel logs | The flag cache is in-memory with a 5-minute TTL. If you see repeated slow `feature_flags` DB queries, the cache is not warming correctly. |
| Cron jobs | Supabase > Edge Functions > `daily-cron` | The Command Center read models (`get_school_overview`, `get_classes_at_risk`, `get_teacher_engagement`) are called live on-demand by the API routes — not a cron-refreshed cache. But `school_health_daily` (EIC rollup) is populated nightly. Check the `daily-cron` Edge Function invocation log for errors after 18:30 UTC. |

### Checking the school audit log

After activation, confirm that flag changes and school actions are recorded:

```sql
-- Replace with the actual audit log table name for your deployment.
-- Typical: school_audit_log or admin_audit_log.
SELECT action, actor_id, details, created_at
FROM public.school_audit_log
WHERE school_id = '<PILOT_SCHOOL_UUID>'
ORDER BY created_at DESC
LIMIT 20;
```

If `school_audit_log` does not exist, check `admin_audit_log`:

```sql
SELECT action, details, created_at
FROM public.admin_audit_log
WHERE details::text ILIKE '%<PILOT_SCHOOL_UUID>%'
ORDER BY created_at DESC
LIMIT 20;
```

Expected entries: school creation event, invite_code generation, and any school admin sign-ins.

### Daily watch list (first 5 days post-activation)

Capture once per day at the same time:

| Signal | Threshold to flag | Action |
|---|---|---|
| Sentry: new issues from pilot school | Any issue > 5 occurrences | Investigate; consider rollback if school-admin or teacher flow is broken |
| Sentry: aggregate error rate | > 20% increase vs pre-flip baseline | Investigate |
| Command Center KPIs showing null | Student count null after 24h with enrolled students | Check `get_school_overview` RPC directly via SQL |
| Pulse panel errors | Red error state in the panel | Roll back `ff_school_pulse_v1` |
| Teacher reports a missing feature | Any report of the old dashboard showing instead of Command Center | Flag evaluation issue; check `target_institutions` on the globally-ON flags |

Log your daily observations to `docs/operator-notes/<date>-pilot-activation.md`.

---

## Appendix: Flag Quick Reference

| Flag | Enabled by default after P0 | Per-school scoping needed | CEO-gated |
|---|---|---|---|
| `ff_school_command_center` | YES (globally ON, migration 20260620000400) | No | No |
| `ff_school_admin_rbac` | YES (globally ON, migration 20260620000400) | No | No |
| `ff_school_reports_depth` | YES (globally ON, migration 20260620000400) | No | No |
| `ff_teacher_command_center` | YES (globally ON, migration 20260620000400) | No | No |
| `ff_school_pulse_v1` | NO (seeded OFF, migration 20260619000100) | Yes — flip per pilot | No |
| `ff_school_provisioning` | NO (unseeded / OFF) | Yes — flip per pilot | YES (P11-adjacent, seat billing contract required) |
| `ff_principal_ai_v1` | NO (unseeded / OFF) | Yes — flip per pilot | YES (P12, ai-engineer review + backing migration required) |
| `ff_education_intelligence` | NO (unseeded / OFF) | No (super-admin visibility) | YES (nightly rollup must be running) |

---

## Appendix: Scoping Semantics

The flag evaluator (`src/lib/feature-flags.ts: isFeatureEnabled`) applies scoping in this order:

1. Flag exists AND `is_enabled = true` → continue.
2. `target_environments` not null → must match `VERCEL_ENV` / `NODE_ENV`.
3. `target_roles` not null → caller's role must be in the array.
4. `target_institutions` not null → caller's `institutionId` must be in the array.
5. `rollout_percentage` < 100 AND not null → hash(`userId`, `flagName`) < `rollout_percentage`.
6. All checks passed → flag is ON.

Setting `target_institutions = ARRAY['<UUID>']` means the flag is ON only for API calls that pass `{ institutionId: '<UUID>' }` in their context. School-admin and teacher routes that correctly call `isFeatureEnabled(flagName, { institutionId: school.id })` will respect this scoping. Routes that read `is_enabled` directly from the DB (bypassing the evaluator) will NOT — they see the flag as globally ON. If the negative smoke check (Section 2a) fails, the call site is using the raw column.

`target_institutions` is stored as `text[]` in the database. Pass UUIDs as plain strings, not with a `::uuid` cast:

```sql
target_institutions = ARRAY['550e8400-e29b-41d4-a716-446655440000']
-- NOT: ARRAY['550e8400-...'::uuid]
```
