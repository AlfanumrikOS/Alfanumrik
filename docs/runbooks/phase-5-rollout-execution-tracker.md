# Phase 5 — Rollout Execution Tracker (Six Dormant Systems)

**Date:** 2026-07-22
**Owner:** ops (this tracker + flip execution + monitoring) · **co-sign per flag tier:** CEO + architect (see §6)
**Status:** Pre-execution. Every flag below is seeded **OFF**. Nothing in this document has been executed.
**Purpose:** The single top-level, operator-facing execution tracker that sequences the staged rollout of all six dormant systems in dependency order. It does **not** re-document the per-system drills — it ties the existing per-system runbooks together in the correct order with explicit go/no-go gates. For any drill detail, follow the linked runbook; **if this tracker and a per-system runbook disagree, the runbook wins.**

---

## ⛔ THIS TRACKER CANNOT BE AUTONOMOUSLY EXECUTED — BY DESIGN

Executing Phase 5 is a **human operator checklist, not a script.** It requires, non-negotiably:

- **(a) Production database / super-admin access.** Every flag flip is a privileged write against `feature_flags` (via the super-admin console or the `admin_flip_feature_flag` RPC, both service-role-gated). No agent has, or may acquire, this access.
- **(b) External Meta WhatsApp template approval** (for the Monthly Synthesis stage only). The `monthly_synthesis` template must be approved by Meta before the WhatsApp Cloud API will accept a parent-share send. This is a Meta Business Manager action outside our system — it cannot be forced, faked, or scheduled by us. Until it lands, Monthly Synthesis prod enablement is blocked on the delivery path (the student-facing view can still ship — see §3.5).
- **(c) Real calendar time.** Each system holds for multi-day / multi-week observation windows (≥ 2 nightly cron ticks on staging, 1 week at prod pilot, 2 weeks at prod-100% before "shipped"). These cannot be compressed — the loops verify over 7–14-day horizons and the anti-storm signal only accrues over real days.
- **(d) CEO / human sign-off at every stage transition.** Enforced mechanically by the **Phase 0 guardrail's confirm-gate**: every protected-flag flip requires `confirm === <exact flag_name>` (RPC arg `p_confirm = p_flag_name`), and the 4th+ protected flip in a 10-minute window demands a second `bulk_confirm` token. The guardrail exists **precisely to prevent autonomous / accidental flag flipping**, which caused two prior incidents (2026-06-21 premature constitution-pinned enable; 2026-07-20 bulk re-arm of 49 forced-OFF flags in one click — see `docs/runbooks/feature-flag-governance.md`).

**An agent may prepare, verify readiness of, and monitor this rollout. Only a human operator with production access may execute a stage transition.**

---

## The six systems, in dependency order

| # | System | Flag | Seed migration | Kill semantics | Per-system runbook |
|---|---|---|---|---|---|
| — | **Phase 0 guardrail** (hard blocker for ALL) | n/a (governance infra) | `20260722090000` / `090100` / `090200` | n/a | `docs/runbooks/feature-flag-governance.md` |
| — | **`ff_event_bus_v1`** (hard precondition for Loops A/B/C) | `ff_event_bus_v1` | `20260507000007` | n/a (infra) | `docs/runbooks/adaptive-program-rollout.md §2` |
| 1 | **Student Pulse** (visibility only) | `ff_school_pulse_v1` | `20260619000100` | instant (no drain) | `docs/runbooks/adaptive-program-rollout.md` |
| 2 | **Loop A** — mastery-cliff remediation | `ff_adaptive_remediation_v1` | `20260619000300` | DRAIN ≤ 7 d | `docs/runbooks/adaptive-remediation-rollout.md` |
| 3 | **Loops B & C** — inactivity + at-risk-concentration | `ff_adaptive_loops_bc_v1` | `20260619000600` | DRAIN ≤ 14 d | `docs/runbooks/adaptive-program-rollout.md` |
| 4 | **Loop D** — blocked prerequisite (Digital Twin) | `ff_digital_twin_v1` | `20260702000700` | DRAIN ≤ 7 d | `docs/runbooks/digital-twin-rollout.md` |
| 5 | **Monthly Synthesis** | `ff_pedagogy_v2_monthly_synthesis` | `20260509…wave_3` | **FREEZE (immediate, no drain)** | `docs/runbooks/monthly-synthesis-oncall.md` |
| 6 | **Productive Failure** (+ distractor micro-explainer) | `ff_productive_failure_v1` (+ `ff_distractor_micro_explainer_v1`) | `20260509120000` | instant fail-safe to legacy path | `docs/superpowers/runbooks/2026-05-09-pedagogy-v2-wave-1-rollout.md` |

All six flags are **protected / constitution-pinned** (Loops A/B/C/D have staged-rollout runbooks; Monthly Synthesis + Productive Failure were added to the protected registry during the 2026-07-22 Phase 0 hardening). Every flip below therefore goes through the confirm-gated path.

---

## 1. Pre-flight — DO ONCE, before ANY system starts

These are the hard blockers for the entire phase. **Do not flip a single feature flag until every box is checked.** (Ordering: Phase 0 guardrail and RLS backport are the true one-time blockers; the rest are re-verified per environment.)

- [ ] **Phase 0 flag guardrail is LIVE in the target environment.** Migrations `20260722090000` (protected-flags registry mirror), `20260722090100` (BEFORE UPDATE trigger `trg_protect_feature_flags`), `20260722090200` (`admin_flip_feature_flag` RPC) all applied. Verify:
  ```sql
  SELECT to_regclass('public.protected_feature_flags');                 -- not null
  SELECT proname FROM pg_proc WHERE proname = 'admin_flip_feature_flag'; -- one row
  SELECT tgname FROM pg_trigger WHERE tgname = 'trg_protect_feature_flags'; -- one row
  -- authenticated can NO LONGER directly UPDATE the two control columns:
  SELECT has_column_privilege('authenticated','feature_flags','is_enabled','UPDATE'); -- expect: false
  ```
  The DB/TS parity test (`feature-flags-protected-guardrail.test.ts`) and the CI migration guard (`scripts/check-protected-flag-migrations.mjs`) must be green.
- [ ] **RLS XC-3 backport applied.** The service-role/RLS migration execution (XC-3) must be complete in the target environment before any loop writes / reads student rows through the new surfaces. Confirm the service-role allowlist count and XC-3 progress per `DEPLOYMENT_RUNBOOK.md` (service-role allowlist review + XC-3 progress). This is a hard blocker: the loops read/escalate on student data whose cross-tenant boundary XC-3 tightens.
- [ ] **`ff_event_bus_v1` state confirmed per environment.** This is the HARD PRECONDITION for Loops A/B/C verify (bus OFF ⇒ verify is BLIND ⇒ every active row expires straight to escalation = notification storm). Loop D verify reads live `concept_mastery` and is NOT bus-dependent, but the program keeps bus-first anyway.
  ```sql
  SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags WHERE flag_name = 'ff_event_bus_v1';
  -- Resolves ON only when is_enabled=true AND (rollout_percentage IS NULL OR = 100).
  -- Verified 2026-06-13: PROD = ON (100%). STAGING = OFF (is_enabled=true BUT rollout_percentage=0 → the rollout=0 kill).
  ```
  **If staging is OFF, clear it FIRST** (staging is where all drills run) — bring the bus to `is_enabled=true, rollout_percentage=100` on staging before any Loop A/B/C drill. See §2 blocker in `adaptive-program-rollout.md`. Do NOT flip the bus OFF anywhere the loops are already ON (that blinds in-flight verify — drain the loops first).
- [ ] **Monitoring dashboards reachable.** `super-admin/adaptive-loops` (must show the **4th `blocked_prerequisite` column** before Loop D), `synthesis-health`, `synthesis-quality`. Confirm each renders for a super-admin session.
- [ ] **Health RPC live:** `get_adaptive_loops_health(p_window_hours int DEFAULT 24, p_storm_days int DEFAULT 30)` present, service-role-only (migration `20260722101000`). This is the single source of truth for the loop go/no-go gates. Verify:
  ```sql
  SELECT public.get_adaptive_loops_health();  -- returns a jsonb health object
  ```
- [ ] **Alert rules seeded & routing to CEO email.** Migrations `20260722102200` (ceiling-violation `critical` + escalation-storm `error`) + `20260722101500` (missed-heartbeat). Confirm each rule's `channel_ids` resolves to the `CEO email` notification channel:
  ```sql
  SELECT ar.name, ar.category, ar.min_severity, nc.name AS channel
  FROM alert_rules ar
  CROSS JOIN LATERAL unnest(ar.channel_ids) AS cid
  JOIN notification_channels nc ON nc.id = cid
  WHERE ar.source = 'cron/adaptive-loops-monitor';
  -- expect: 'Adaptive loops ceiling violation' (critical) + 'Adaptive loops escalation storm' (error)
  --         + missed-heartbeat, all → 'CEO email'.
  ```
- [ ] **Meta WhatsApp template approval status recorded** (external dependency — for Monthly Synthesis stage 5 only). This is the ONE box that may legitimately remain UNCHECKED while systems 1–4 and 6 proceed — Monthly Synthesis prod parent-share is gated on it, nothing else is:
  - [ ] `monthly_synthesis` template **submitted** to Meta Business Manager (backend owns the template definition).
  - [ ] `monthly_synthesis` template **APPROVED by Meta** ← external, cannot be forced. Do NOT start §3.5 prod parent-share until this is green.
- [ ] **On-call runbooks reviewed** by the executing operator: `docs/runbooks/adaptive-loops-oncall.md` (A/B/C/D triage decision tree) and `docs/runbooks/monthly-synthesis-oncall.md` (freeze semantics, hallucination + Meta-rejection incidents). The operator must understand **drain-vs-freeze** before the first flip.
- [ ] `daily-cron` redeployed with the shared `adaptive_remediation_triggered` step (Loops A/B/C/D) and the `monthly_synthesis_triggered` step (Synthesis). `CRON_SECRET` set in BOTH the Supabase Edge Function secrets AND the Vercel environment (worker fails closed / 401 without it). `SITE_URL` set per-environment on `daily-cron` (unset ⇒ falls back to production; keep staging/prod `CRON_SECRET` distinct so a cross-env call can only 401). Sentry capturing `/api/cron/adaptive-remediation` and `/api/synthesis/*`.

---

## 2. The single ordered sequence + dependency gates

Execute strictly top to bottom. Each numbered system is gated on the prior state described in the **"Gate to START"** column. Where a runbook labels a gate **recommended (not hard)**, it is stated as such — an operator MAY proceed earlier at their own risk, but the sequence below is the sanctioned path.

```
PRE-FLIGHT (§1) — Phase 0 guardrail LIVE + XC-3 applied + bus confirmed  ── HARD BLOCKER FOR ALL
   │
   ├─ (staging only) ff_event_bus_v1 → ON 100%                            ── HARD precondition for Loops A/B/C
   │
1. Student Pulse  (ff_school_pulse_v1)          visibility only, lowest risk, no cron, no writes
   │
2. Loop A  (ff_adaptive_remediation_v1)         the proven closed loop; full synthetic-cliff drill
   │
3. Loops B & C  (ff_adaptive_loops_bc_v1)        Gate: Loop A at prod-100% & stable — RECOMMENDED, not hard
   │
4. Loop D  (ff_digital_twin_v1)                  Gate: Loop A prod-100% AND Loops B/C ≥ pilot — RECOMMENDED, not hard
   │
5. Monthly Synthesis  (ff_pedagogy_v2_monthly_synthesis)   Gate: Meta template APPROVED (hard, external) for parent-share
   │
6. Productive Failure  (ff_productive_failure_v1 + ff_distractor_micro_explainer_v1)   independent; own 5→25→100 ladder
```

| # | System | Gate to START (from the runbooks) | Hard or recommended |
|---|---|---|---|
| — | event bus (staging) | Phase 0 guardrail live; staging bus currently OFF | **HARD** — Loops A/B/C verify is blind without it (`adaptive-program-rollout.md §2`) |
| 1 | Pulse | Pre-flight complete | HARD (pre-flight) |
| 2 | Loop A | Pulse enabled (order preference, low-risk-first); bus ON in env | Pulse-first is preference; bus ON is **HARD** for the loop |
| 3 | Loops B/C | **Loop A reaching Stage 3 (global/100%) is the recommended gate before starting B/C Stage 1** | **RECOMMENDED, not hard** — B/C ramp on a separate flag and independently (`adaptive-program-rollout.md §3`, Decision X1) |
| 4 | Loop D | **Enable Loop D only after Loop A is at Stage 3 (global) and Loops B/C are at least at pilot** | **RECOMMENDED, not hard** (`digital-twin-rollout.md`, "Flag flip sequence") |
| 5 | Monthly Synthesis | **`monthly_synthesis` WhatsApp template APPROVED by Meta** before prod parent-share | **HARD, external** for the parent-share path; the student-facing view can ship without it |
| 6 | Productive Failure | Independent of the loops; own runbook | none on the loops; standard pre-flight |

**Why "recommended, not hard" for the loop-to-loop gates:** Loops A and B/C are **separate flags** (Decision X1) that ramp independently; Loop D is a fourth candidate on the same shared arbiter. Sequencing them is about proving the shared substrate (arbiter + verify sweep) at scale before adding load — not a mechanical dependency. Ops may hold any later loop at any stage without touching an earlier one, and may roll any loop back without touching the others.

---

## 3. Per-system stage tables

**The universal flip command.** Every flip below is a protected-flag transition. Use the **super-admin console** (`/super-admin/flags` → PATCH `/api/super-admin/feature-flags`) as the human surface — it prompts for `confirm`, enforces the burst guard, and writes the `feature_flag.updated` + `ops_events` audit trail. Under the hood, and for break-glass, the sanctioned write path is the RPC:

```sql
-- Signature (migration 20260722090200):
--   admin_flip_feature_flag(p_flag_name text, p_updates jsonb, p_confirm text, p_actor_id uuid) RETURNS jsonb
-- p_confirm MUST equal p_flag_name exactly (else 42501 FLAG_CONFIRM_MISMATCH, before any write).
-- p_actor_id MUST be the operator's own auth.userId (the route passes auth.userId from authorizeAdmin(request,'super_admin')).
-- Only the keys present in p_updates are touched; the RPC arms app.protected_flag_ack for THIS TXN only,
-- updates feature_flags, and writes admin_audit_log atomically.

SELECT public.admin_flip_feature_flag(
  '<flag_name>',
  '{ "is_enabled": true, "rollout_percentage": 100, "target_environments": ["staging"] }'::jsonb,
  '<flag_name>',            -- confirm = flag name (the guardrail's typed-confirmation gate)
  '<operator-auth-user-id>'::uuid
);
```

> **Do NOT use `target_institutions` for any loop pilot cohort.** The cron worker evaluates loop flags WITHOUT an `institutionId` in context, so institution scoping resolves to `false` and disables injection entirely. Pilot cohorts come from `rollout_percentage` + the deterministic `hashForRollout(auth_user_id, flag_name)` inside the inject loop. (`adaptive-remediation-rollout.md`, `adaptive-program-rollout.md §3`, `digital-twin-rollout.md`.)

> **Rollback = flip the flag OFF** (`'{ "is_enabled": false }'::jsonb`, same confirm pattern) via the console. For the loops this DRAINS (see §4); for Synthesis it FREEZES. Draining is always safe — no student is stranded.

---

### 3.0 (staging pre-step) — `ff_event_bus_v1` ON on staging

| Stage | Flip | Go/no-go | Advance when | Rollback |
|---|---|---|---|---|
| staging-100% | `admin_flip_feature_flag('ff_event_bus_v1', '{"is_enabled":true,"rollout_percentage":100}'::jsonb, 'ff_event_bus_v1', '<actor>'::uuid)` | `SELECT is_enabled, rollout_percentage FROM feature_flags WHERE flag_name='ff_event_bus_v1';` → `true, 100` | Resolves ON; wait out the 5-min cache TTL | Do NOT flip OFF while any loop is ON in that env — drain loops first |

Prod bus is already ON at 100% — no action on prod.

---

### 3.1 Student Pulse — `ff_school_pulse_v1`  (visibility only, lowest risk)

Runbook: `adaptive-program-rollout.md`. Pulse mounts inside `ff_school_command_center` (visibility only; no cron, no writes). Ramp by percentage for program consistency (institution scoping *would* work for Pulse since it is read with role/institution context, but keep it consistent).

| Stage | Flip (`p_updates` jsonb) | Go/no-go gate | Success → advance | Rollback trigger | Observe | Sign-off |
|---|---|---|---|---|---|---|
| staging-100% | `{"is_enabled":true,"rollout_percentage":100,"target_environments":["staging"]}` | Pulse panel mounts on the staging school-admin Command Center; renders bilingually; no PII on any deny path (`canAccessStudent` boundary) | Panel renders; no console errors | Panel errors / wrong-tenant data | ≥ 1 day | ops + CEO |
| prod-pilot-10% | `{"is_enabled":true,"rollout_percentage":10,"target_environments":null}` | Panel renders for pilot cohort; Sentry clean on the Pulse API | 1 week clean | Sentry > 0.5% on `/api/pulse/*` | 1 week | ops + CEO |
| prod-100% | `{"rollout_percentage":100}` | As above at scale | 2-week window clean → shipped | Any cross-role data leak (P13) | 2 weeks | ops + CEO |

Kill: `ff_school_pulse_v1` OFF → panel stops mounting instantly; Command Center byte-identical to before. No drain (visibility only).

---

### 3.2 Loop A — `ff_adaptive_remediation_v1`  (mastery-cliff → remediate → verify → escalate)

Runbook: `adaptive-remediation-rollout.md` (full synthetic-cliff drill = Steps 0–7). Ratified bounds: cliff drop ≥ 0.15, ≤ 3 cards/student/day, 7-day verify window.

| Stage | Flip (`p_updates` jsonb) | Go/no-go gate | Success → advance | Rollback trigger | Observe | Sign-off |
|---|---|---|---|---|---|---|
| staging-drill | `{"is_enabled":true,"rollout_percentage":100,"target_environments":["staging"]}` | Run `adaptive-remediation-rollout.md` Steps 0–7 (synthetic cliff → inject → rhythm card + notification → recovery branch → fast-forward → B2B/B2C escalation → cleanup). Drill must be **green** | All 7 steps pass; `inject.errors`/`verify.errors` = 0 across ≥ 2 nightly ticks | Any drill step fails; worker errors | ≥ 2 nightly cron ticks | ops + architect + CEO |
| prod-pilot-10% | `{"is_enabled":true,"rollout_percentage":10,"target_environments":null}` | `get_adaptive_loops_health()` → `ceiling_violation_count = 0`, `escalation_share < 0.50`, `hours_since_last_success` fresh (< ~30h); injection volume ≈ pilot-cohort size | 1 week clean | ceiling-violation alert (critical); escalation-storm alert (>0.50); `inject/verify.errors` > 0 two nights running | 1 week | ops + architect + CEO |
| prod-100% | `{"rollout_percentage":100}` | Same health RPC gate at scale | 2-week window clean → **Loop A shipped** (unblocks §3.3 gate) | Same as pilot | 2 weeks | ops + architect + CEO |

Kill: `ff_adaptive_remediation_v1` OFF = **DRAIN** — inject short-circuits (`skipped:'flag_off'`), verify keeps draining active rows to `recovered`/`escalated`; full drain ≤ 7 days + 1 tick. Hard-stop (bulk `dismissed`) only if drain itself harms — `adaptive-remediation-rollout.md` "Hard stop".

---

### 3.3 Loops B & C — `ff_adaptive_loops_bc_v1`  (inactivity + at-risk-concentration)

Runbook: `adaptive-program-rollout.md §4.B / §4.C / §4.D`. **Gate to start (recommended, not hard):** Loop A at prod-100% and stable. Same worker, same substrate; B/C inject branches gated on this separate flag, verify drains regardless. Loop B = parent-only escalation (7-day cooldown, 7-day onboarding grace); Loop C = high-band (≥ 5 at-risk chapters) escalate-at-inject, 14-day window.

| Stage | Flip (`p_updates` jsonb) | Go/no-go gate | Success → advance | Rollback trigger | Observe | Sign-off |
|---|---|---|---|---|---|---|
| staging-drill | `{"is_enabled":true,"rollout_percentage":100,"target_environments":["staging"]}` | Run `§4.B` (inactivity nudge→return→parent-escalation), `§4.C` (concentration escalate-at-inject→band-drop→re-notify), AND `§4.D` cross-loop ceiling drill (A+C+B → exactly ONE new row, precedence **A>C>B**). **Bus must be ON on staging** | All B/C drills + ceiling drill green; `get_adaptive_loops_health()` `ceiling_violation_count = 0` | Any drill fails; >1 new row/student/night; bus not ON | ≥ 2 nightly cron ticks | ops + architect + CEO |
| prod-pilot-10% | `{"is_enabled":true,"rollout_percentage":10,"target_environments":null}` | Health RPC: per-loop `daily_new_by_signal` ordered roughly A>C>B; `ceiling_violation_count = 0`; `escalation_share < 0.50`; notification volume within structural ceilings | 1 week clean | ceiling-violation (critical) — full kill; escalation-storm; B volume spiking above A/C | 1 week | ops + architect + CEO |
| prod-100% | `{"rollout_percentage":100}` | Same at scale | 2-week window clean → Loops B/C shipped | Same | 2 weeks | ops + architect + CEO |

Kill: `ff_adaptive_loops_bc_v1` OFF = **DRAIN** — B/C inject short-circuits; mastery-cliff (Loop A) still respects its own flag; drain ≤ 14 days (longest Loop C `verify_by`) + 1 tick. Scoped hard-stop: `trigger_signal IN ('inactivity','at_risk_concentration')`.

---

### 3.4 Loop D — `ff_digital_twin_v1`  (blocked prerequisite / Digital Twin Slice 1)

Runbook: `digital-twin-rollout.md`. **Gate to start (recommended, not hard):** Loop A at prod-100% AND Loops B/C ≥ pilot. **Extra pre-req:** the knowledge graph must be populated and twin snapshots must exist — Loop D is a no-op otherwise (see runbook Prerequisites: `concept_edges` prerequisite count > 0, `learner_twin_snapshots` distinct students > 0). Precedence becomes **A > D > C > B**. Slice-1 `escalated` is terminal-only (NO teacher/parent notification — intentional).

| Stage | Flip (`p_updates` jsonb) | Go/no-go gate | Success → advance | Rollback trigger | Observe | Sign-off |
|---|---|---|---|---|---|---|
| staging-drill | `{"is_enabled":true,"rollout_percentage":100,"target_environments":["staging"]}` | Run `digital-twin-rollout.md` Steps 0–7 (seed prereq edge + weak twin snapshot → inject → recovered branch → expired→escalated with NO notification → **A>D>C>B ceiling drill** → cleanup). Confirm dashboard shows the **4th `blocked_prerequisite` column** | All steps green incl. D-beats-C precedence; `ceiling_violation_count = 0` | Any step fails; a Loop D notification was sent (bug); >1 new row/student/night | ≥ 2 nightly cron ticks | ops + architect + CEO |
| prod-pilot-10% | `{"is_enabled":true,"rollout_percentage":10,"target_environments":null}` | Health RPC: `daily_new_by_signal.blocked_prerequisite` plausible vs A/C; `ceiling_violation_count = 0`; Loop D terminal split not dominated by `escalated` | 1 week clean | Implausibly high D volume (spurious `concept_edges` / stale snapshots) — review graph w/ architect+assessment; very high `escalated` share — review floors w/ assessment | 1 week | ops + architect + CEO |
| prod-100% | `{"rollout_percentage":100}` | Same at scale | 2-week window clean → Loop D Slice 1 shipped | Same | 2 weeks | ops + architect + CEO |

Kill: `ff_digital_twin_v1` OFF = **DRAIN** — Loop D contributes zero arbiter candidates; A/B/C keep their own flags; drain ≤ 7 days + 1 tick. Scoped hard-stop: `trigger_signal = 'blocked_prerequisite'` (suppresses nothing user-facing — Slice 1 sends no Loop D notifications).

---

### 3.5 Monthly Synthesis — `ff_pedagogy_v2_monthly_synthesis`  (NOT a percentage cohort; freeze-not-drain)

Runbook: `monthly-synthesis-oncall.md`. **Read this before flipping:** Monthly Synthesis is NOT a multi-day verify state machine and NOT a `rollout_percentage` cohort — the flag is a **global, student-role** enable (`target_roles=['student']`, `rollout_percentage=NULL`). It is a once-per-month artifact pipeline: **Build** (Edge cron on the 1st UTC) → **Generate** (lazy Claude Haiku fill on first `/synthesis` view, behind the fabrication oracle) → **Share** (parent WhatsApp). Because there is no per-student rollout hash, the stages below are a **global enable progressed staging→prod**, with the parent-share path **hard-gated on Meta template approval**. Do not invent pilot percentages here.

| Stage | Flip (`p_updates` jsonb) | Go/no-go gate | Success → advance | Rollback trigger | Observe | Sign-off |
|---|---|---|---|---|---|---|
| staging-drill | `{"is_enabled":true,"target_environments":["staging"]}` | Build a run (or force the `getUTCDate()===1` path with a staging test student), open `/synthesis` → summary fills, oracle passes; `synthesis-quality` shows no `flagged` spike; `synthesis-health` shows build/generate OK | Drill clean; oracle catches a seeded fabrication (held as `flagged`, never sent) | Oracle miss; generation errors | 1 build cycle | ops + assessment + CEO |
| prod (view-only) | `{"is_enabled":true,"target_environments":null}` — **Meta template NOT yet required for the view** | Students can view synthesis; `synthesis-health` clean. **Do NOT trigger `parent-share` until Meta template is APPROVED** | View path stable; `flagged` count flat | Systemic hallucination / quality collapse → **flag OFF (freeze)** | until Meta approval lands | ops + assessment + CEO |
| prod (parent-share ON) | (no flag change — parent-share is gated by Meta approval + guardian opt-in, not a flag) | **HARD gate: `monthly_synthesis` template APPROVED by Meta.** Then a `parent-share` send returns 200; `parent_share_status='sent'` | Cohort share succeeds; `failed` not concentrated post-template-change | Meta rejects/pauses template → route to backend (do NOT flip the flag); single bad run → set that run `parent_share_status='flagged'` | 1 share cycle | ops + backend + CEO |

Kill: `ff_pedagogy_v2_monthly_synthesis` OFF = **FREEZE, not drain** — build/generate/share all early-return; existing `monthly_synthesis_runs` rows persist untouched but become inert/inaccessible; effect immediate on the 5-min cache TTL; there is **no drain horizon**. Safe because a synthesis is a static artifact, not an open loop. A WhatsApp/template failure is a **delivery** failure — do NOT kill the flag for it (`monthly-synthesis-oncall.md` Incident B).

---

### 3.6 Productive Failure — `ff_productive_failure_v1` (+ `ff_distractor_micro_explainer_v1`)

Runbook: `docs/superpowers/runbooks/2026-05-09-pedagogy-v2-wave-1-rollout.md`. **Independent of the loops.** Note this system uses the wave-1 ladder — **staging canary → 5% → 25% → 100%**, NOT the 10%-pilot model of the loops. Use the runbook's exact percentages. Both flags ship together in that runbook; flip them as the pair the runbook specifies.

| Stage | Flip (`p_updates` jsonb, applied to BOTH flags) | Go/no-go gate | Success → advance | Rollback trigger | Observe | Sign-off |
|---|---|---|---|---|---|---|
| staging canary | `{"is_enabled":true,"target_environments":["staging"]}` | Runbook Stage 1 smoke test: "Try this first" banner (`data-testid="productive-failure-banner"`) hides description until answer; misconception explainer (`data-testid="misconception-explainer"`) shows on curated wrong distractor, null otherwise; both render in Hindi | Smoke test passes | Any surface broken | Day 0 | ops + CEO |
| prod 5% | `{"is_enabled":true,"rollout_percentage":5,"target_environments":null}` | Sentry `/api/learn/remediation` + chapter page < 0.5%; `learn_quick_check_submitted` not depressed > 10% | 48 h clean | Error rate > 0.5% on a flag → that flag OFF | 48 h | ops + CEO |
| prod 25% | `{"rollout_percentage":25}` | Correctness regression ≤ 5% (some regression is pedagogically expected); "Ask Foxy" follow-through ≥ 30% | 72 h clean | Correctness regression > 5%; error spike | 72 h | ops + assessment + CEO |
| prod 100% | `{"rollout_percentage":100}` | As above at scale | 2-week window → Wave-1 done | Any of the above | 2 weeks | ops + CEO |

Kill: either flag OFF → **immediate fail-safe** — legacy code path renders (productive-failure hides the banner and shows the classic concept-first flow; distractor explainer unmounts). No drain, no data to reverse (the only DB write is to `feature_flags`).

---

## 4. Rollback — universal kill-switch semantics + who authorizes

### Kill semantics per system (grounded in the runbooks — know which you are firing)

| System | Flag OFF effect | Drain / freeze horizon |
|---|---|---|
| Pulse | Panel stops mounting; Command Center unchanged | Instant (visibility only) |
| Loop A | Inject short-circuits; verify keeps draining active rows to terminal | **DRAIN ≤ 7 days** + 1 tick |
| Loops B/C | B/C inject short-circuits; Loop A unaffected; verify drains | **DRAIN ≤ 14 days** (Loop C) + 1 tick |
| Loop D | Zero arbiter candidates from D; A/B/C unaffected; verify drains | **DRAIN ≤ 7 days** + 1 tick |
| Monthly Synthesis | Build + view + share all early-return; existing rows inert | **FREEZE — immediate, no drain** |
| Productive Failure | Legacy code paths render immediately | Instant fail-safe |

**The load-bearing distinction: the four loops DRAIN (in-flight interventions always reach a terminal state — no student stranded); Monthly Synthesis FREEZES (static artifact, safe to stop cold).** The daily-cron trigger is deliberately NOT flag-gated in Deno for the loops — gating it there would break the drain. Do not "fix" this.

**Hard stop (ops-only, last resort, loops only):** when the natural drain itself is causing harm, bulk-resolve active rows to the ops-only `dismissed` terminal state in ONE transaction with an audit row — **flip the flag OFF first** or the next inject recreates them. Use the exact scoped transaction in `adaptive-program-rollout.md §6` (filter by `trigger_signal` to scope to specific loops). Not a first response.

### Who authorizes a rollback at each stage

- **Any stage, any loop:** on-call ops may flip a loop flag OFF **without escalation** — draining is always safe (`adaptive-loops-oncall.md` golden rule). Prefer the console (writes the audit trail); note the incident ref if you must break-glass with SQL/RPC.
- **ceiling-violation alert (critical):** full kill of all three loop flags immediately, then page **architect** (arbiter/worker bug). Do NOT hard-stop (the issue is NEW rows; draining existing rows is still correct).
- **escalation-storm alert:** check `ff_event_bus_v1` FIRST; if bus OFF while A/B/C ON, kill the loop flags (not the bus), page architect. Bus OK → scope-kill the offending loop, page assessment (thresholds) or backend (routing).
- **Monthly Synthesis systemic hallucination/quality collapse:** ops flips OFF (freeze) immediately; then assessment + ai-engineer investigate before re-enable. A single bad run → set `parent_share_status='flagged'`, no flag flip. A Meta/template delivery failure → route to backend, do NOT flip.
- **Stage TRANSITION forward (enabling / ramping up):** requires the tier's approval — for these constitution-pinned flags that is the **runbook-stage-gate** + CEO/architect co-sign, enforced by the confirm-gate (and burst guard on the 4th+ flip in 10 min). Rolling BACKWARD (disabling) is always the safe direction and never blocked by the guardrail.

---

## 5. Progress ledger (fill in during execution)

| System | staging-drill | staging-100% / view | prod-pilot / 5% | prod-25% | prod-100% | Shipped? | Notes / incident refs |
|---|---|---|---|---|---|---|---|
| event bus (staging) | — | ☐ | — | — | — | — | |
| 1. Pulse | ☐ | ☐ | ☐ (10%) | — | ☐ | ☐ | |
| 2. Loop A | ☐ | ☐ | ☐ (10%) | — | ☐ | ☐ | |
| 3. Loops B/C | ☐ | ☐ | ☐ (10%) | — | ☐ | ☐ | gate: Loop A 100% stable (rec.) |
| 4. Loop D | ☐ | ☐ | ☐ (10%) | — | ☐ | ☐ | gate: A 100% + B/C ≥ pilot (rec.); graph populated |
| 5. Monthly Synthesis | ☐ | ☐ (view) | ☐ (share) | — | — | ☐ | share gate: Meta template APPROVED (hard) |
| 6. Productive Failure | ☐ (canary) | — | ☐ (5%) | ☐ (25%) | ☐ | ☐ | own ladder; 2 flags |

---

## 6. References (authoritative — this tracker never overrides them)

- Flag governance + Phase 0 guardrail (confirm-gate, trigger, RPC, burst guard, tiers, approval matrix): `docs/runbooks/feature-flag-governance.md`
- Sanctioned RPC: `supabase/migrations/20260722090200_admin_flip_feature_flag_rpc.sql` (`admin_flip_feature_flag(text, jsonb, text, uuid)`)
- DB guard trigger: `20260722090100_feature_flags_db_guard_trigger.sql`; protected registry: `20260722090000`
- Loop A rollout (full drill): `docs/runbooks/adaptive-remediation-rollout.md`
- Loops A+B+C program rollout + cross-loop anti-storm + program hard-stop: `docs/runbooks/adaptive-program-rollout.md`
- Loop D / Digital Twin rollout: `docs/runbooks/digital-twin-rollout.md`
- Adaptive loops on-call triage (A/B/C/D): `docs/runbooks/adaptive-loops-oncall.md`
- Monthly Synthesis on-call (freeze semantics, hallucination + Meta-rejection incidents): `docs/runbooks/monthly-synthesis-oncall.md`
- Productive Failure (Pedagogy v2 Wave 1) rollout: `docs/superpowers/runbooks/2026-05-09-pedagogy-v2-wave-1-rollout.md`
- Health RPC (go/no-go source of truth): `supabase/migrations/20260722101000_adaptive_loops_health_rpc.sql` → `get_adaptive_loops_health(int,int)`
- Alert rules: `20260722102200` (ceiling-violation + escalation-storm) + `20260722101500` (missed-heartbeat) → `CEO email` channel
- Monitoring surfaces: `super-admin/adaptive-loops` (4th `blocked_prerequisite` column), `synthesis-health`, `synthesis-quality`
- Deployment / XC-3 progress + service-role allowlist: `DEPLOYMENT_RUNBOOK.md`
- Flag evaluation semantics (double-gate): `packages/lib/src/feature-flags.ts` (`isFeatureEnabled`)
- Regression pins: REG-126..REG-134 (Loops A/B/C), REG-175 (Loop D)
</content>
</invoke>
