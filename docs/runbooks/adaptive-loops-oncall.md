# Adaptive Loops (A/B/C/D) — On-Call Triage Runbook

**Audience:** the 2am on-call ops person. You have an alert and need to decide, fast, what to check and what to flip. This is a decision tree, **not** a rollout plan — for staged enablement, drills, and the full monitoring query catalog see the rollout runbooks (cross-referenced, never duplicated, below).
**Owner:** ops · **escalation targets:** architect (infra/cron), assessment (thresholds), backend (escalation routing)
**Last updated:** 2026-07-22

## What you are on call for

Four autonomous closed loops on ONE shared substrate (`adaptive_interventions`) and ONE cron worker (`/api/cron/adaptive-remediation`, triggered nightly by the `daily-cron` Edge Function's `adaptive_remediation_triggered` step):

| Loop | Signal (`trigger_signal`) | Flag | Escalates to |
|---|---|---|---|
| A | `mastery_cliff` | `ff_adaptive_remediation_v1` | teacher (B2B) / parent (B2C) |
| B | `inactivity` | `ff_adaptive_loops_bc_v1` | parent only |
| C | `at_risk_concentration` | `ff_adaptive_loops_bc_v1` | teacher / parent (at inject) |
| D | `blocked_prerequisite` | `ff_digital_twin_v1` | **nobody** (Slice 1 — `escalated` is terminal-only, no notification) |

**The two facts that make triage safe:**
1. **Kill switch = DRAIN, not freeze.** Flipping any loop flag OFF stops NEW interventions within ≤5 min (flag cache TTL) but the verify phase keeps draining active rows to terminal (it is gated on active rows existing, NOT the flag). No student is stranded. Drain horizons: Loop A/B/D ≤ 7 days, Loop C ≤ 14 days, + 1 cron tick.
2. **The `adaptive_interventions` table and `audit_logs` are always-reliable, bus-independent.** `state_events` is gated on `ff_event_bus_v1` — never build your 2am judgment on it.

## Alerts you may be paged for (from the parallel `adaptive-loops-monitor` cron)

The `adaptive-loops-monitor` cron and the `super-admin/adaptive-loops` dashboard (built in parallel this session; the dashboard has a 4th `blocked_prerequisite` `trigger_signal` column) raise three alerts. Each has a specific first response below.

| Alert | Meaning | Severity |
|---|---|---|
| **ceiling-violation** | More than 1 NEW `adaptive_interventions` row opened for the same student in the same night | CRITICAL — the anti-storm guarantee is broken |
| **escalation-storm** | Escalation/notification volume spiked far above the structural ceilings | HIGH |
| **missed-heartbeat** | The nightly worker did not run (no `adaptive_remediation: run complete`, or `results.adaptive_remediation_triggered` flat 0 with active rows present) | HIGH |

---

## FIRST RESPONSE BY ALERT

### Alert: ceiling-violation (CRITICAL)

The load-bearing anti-storm invariant is **≤ 1 new intervention per student per night, precedence A > D > C > B** (enforced centrally by `arbitrateInterventions`). A violation means the arbiter is being bypassed — a worker bug.

**Triage order:**
1. **Confirm it's real** (not a verify-phase transition, which is correctly uncapped):
   ```sql
   SELECT student_id, date_trunc('day', created_at) AS day, count(*) AS new_rows,
          array_agg(trigger_signal) AS signals
   FROM adaptive_interventions
   WHERE created_at >= now() - interval '2 days'
   GROUP BY 1, 2 HAVING count(*) > 1
   ORDER BY new_rows DESC;   -- expect ZERO rows in a healthy system
   ```
   If this returns rows, it is a genuine ceiling violation (these are all NEW opens, not verify transitions).
2. **Decide scope.** Which flags are on? A ceiling violation means the arbiter combined candidates wrongly across ≥2 loops.
   ```sql
   SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags
   WHERE flag_name IN ('ff_adaptive_remediation_v1','ff_adaptive_loops_bc_v1','ff_digital_twin_v1');
   ```
3. **STOP THE BLEED — full kill (all loops), because the anti-storm core is the compromised component and it is shared:** flip all three loop flags OFF via the super-admin console (audit trail). New injections stop within ≤5 min; active rows drain naturally.
   - Prefer the console. Break-glass SQL: `UPDATE feature_flags SET is_enabled=false, updated_at=now() WHERE flag_name IN ('ff_adaptive_remediation_v1','ff_adaptive_loops_bc_v1','ff_digital_twin_v1');`
4. **Page architect** (cron/worker owner) with the ceiling-violation query output. This is a code defect in the arbiter or the per-student processing loop — it must be fixed before re-enabling.
5. Do NOT hard-stop (bulk-dismiss) unless the drain itself is producing further harm — a ceiling violation is about NEW rows; the drain of existing rows is still correct.

### Alert: escalation-storm (HIGH)

Too many teachers/parents are being messaged. First distinguish a real storm from expected volume — the structural ceilings (from the rollout runbooks) are: Loop A `remediation_assigned` ≤ 600/day (200-student scan cap × 3 cards); ≤ 1 notification per intervention per type; guardian rows only on parent-escalation paths, preference-gated.

**Triage order:**
1. **Which loop and which recipient?**
   ```sql
   SELECT type, recipient_type, count(*)
   FROM notifications
   WHERE created_at >= now() - interval '24 hours'
     AND (type LIKE 'remediation_%' OR type LIKE 'engagement_%' OR type LIKE 'concentration_%')
   GROUP BY type, recipient_type ORDER BY count(*) DESC;
   ```
2. **Is verify blind?** The #1 cause of an escalation-storm is `ff_event_bus_v1` OFF in an environment where Loops A/B/C are ON — verify can't see recovery/return observations, so EVERY active row expires straight to escalation. **Check the bus first:**
   ```sql
   SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags WHERE flag_name='ff_event_bus_v1';
   -- resolves OFF if is_enabled=false OR (rollout_percentage IS NOT NULL AND <= 0)
   ```
   - If the bus is OFF while A/B/C are ON: **flip the loop flags OFF** (do NOT flip the bus ON mid-flight — that's a larger change and can have side effects; killing the loops drains them safely), then page architect to restore the bus before re-enabling. (Loop D verify is NOT bus-dependent — it reads live `concept_mastery` — so a bus-off storm implicates A/B/C, not D.)
3. **If the bus is fine**, the escalation content/windows may be misfiring. Scope the kill to the offending loop only:
   - Loop A storm → `ff_adaptive_remediation_v1` OFF.
   - Loop B/C storm → `ff_adaptive_loops_bc_v1` OFF.
4. **Page assessment** if escalation share (not volume from a bus outage) is genuinely > 50% of terminal outcomes — the windows/thresholds may be wrong. Page **backend** if escalations are going to the WRONG teacher/parent (routing bug — see the dispute fork below).

### Alert: missed-heartbeat (HIGH)

The nightly worker didn't complete. Because verify DRAINS (not freezes), a single missed night is low-harm — rows just verify one night later. Sustained misses are the risk (rows never reach terminal; the bounded 500-row verify sweep can back up).

**Triage order:**
1. **Was it the trigger or the worker?** Check the `daily-cron` Edge Function logs for `daily-cron: adaptive_remediation` and the Vercel logs for `adaptive_remediation: run complete`.
   - daily-cron ran but the worker didn't → worker (Vercel) problem. Check the `CRON_SECRET` match (a rotated secret on one side → 401 → the Deno trigger soft-fails as `0`), Vercel function health, and Sentry.
   - daily-cron itself didn't run → the pg_cron job (18:30 UTC, `supabase/migrations/20260404000002_pg_cron_daily.sql`) or the Edge Function is down → **page architect** (infra).
2. **Check the run-lock isn't stuck.** The worker uses a `task_queue` in-flight marker (`queue_name='adaptive-remediation-run-lock'`); a crashed run self-heals after `RUN_LOCK_STALE_MS` (5 min), but confirm no ancient `processing` marker is wedging it:
   ```sql
   SELECT id, status, created_at FROM task_queue
   WHERE queue_name = 'adaptive-remediation-run-lock' ORDER BY created_at DESC LIMIT 5;
   -- a 'processing' row older than a few minutes with no active run → delete it to unwedge:
   -- DELETE FROM task_queue WHERE queue_name='adaptive-remediation-run-lock' AND status='processing' AND created_at < now() - interval '10 minutes';
   ```
3. **Manually kick a run** once the cause is understood (safe — the worker is idempotent and re-entrant; the run lock prevents double-processing):
   ```bash
   curl -s -X POST "https://<host>/api/cron/adaptive-remediation" \
     -H "Content-Type: application/json" -H "x-cron-secret: $CRON_SECRET" -d '{"phase":"all"}'
   ```
   Expect `{"success":true,...}` with an `inject` + `verify` summary. A `skipped:"already_running"` response means another run holds the lock — that's fine.
4. **Do NOT flip any flag off for a missed heartbeat** — the loops are healthy; the scheduler isn't. Flipping off would only delay the drain further.

---

## The decision spine (when you're not sure which alert applies)

```
Alert fired
  │
  ├─ Is it a ceiling violation? ──────► run the >1-new-row/student/night query.
  │      YES → full kill (all 3 loop flags OFF) → page architect. Do not hard-stop.
  │
  ├─ Is escalation/notification volume abnormal? ─► check ff_event_bus_v1 FIRST.
  │      bus OFF while A/B/C ON → loop flags OFF (not bus ON) → page architect.
  │      bus OK → scope-kill the offending loop flag → page assessment (thresholds)
  │              or backend (wrong recipient).
  │
  ├─ Did the worker run? ─────────────► check daily-cron + Vercel logs + run-lock.
  │      worker down → CRON_SECRET / Vercel / Sentry. trigger down → page architect.
  │      Never flip a flag for a missed heartbeat.
  │
  └─ Still unclear / novel failure ──► scope-kill the loop whose signal dominates
         the anomaly (drain is always safe), then page architect + the domain owner.
```

**Golden rules at 2am:**
- **Draining is always safe.** Flipping a loop flag OFF never strands a student — it stops new work and lets existing work finish. When in doubt, scope-kill and page.
- **Prefer the console over SQL** — the console flip writes the `feature_flag.updated` audit + `ops_events` row. Break-glass SQL bypasses that trail; note the incident ref when you use it.
- **Hard-stop (bulk-dismiss) is a last resort**, not a first response — it suppresses the escalations expiring rows would have produced. Only use it when the natural drain is itself causing harm, and follow the exact transaction (with the audit row) in `adaptive-program-rollout.md §6`.
- **`state_events` is not evidence at 2am** — it's bus-gated. Trust `adaptive_interventions` + `audit_logs`.

---

## Item 8.11 — Disputed automated-flag escalation fork (Tier-1 support → routing)

When a **parent or teacher disputes** an automated escalation (an at-risk / inactivity / concentration flag they believe is wrong), this is the internal fork. Tier-1 support runs the first two steps; the third routes to the right owner. **Never** silently reverse an automated flag — either confirm it was internally consistent, or route the disagreement to the domain owner.

### Step 1 (Tier-1 support) — pull the intervention + its frozen trigger snapshot

```sql
SELECT id, trigger_signal, status, escalated_to, created_at, verify_by, resolved_at, trigger_snapshot
FROM adaptive_interventions
WHERE student_id = ':disputed_student_id'
ORDER BY created_at DESC LIMIT 10;
```

The `trigger_snapshot` is the frozen-at-inject evidence (e.g. Loop A: `largestDrop`, `baselineMastery`, `postCliffMastery`; Loop C: `atRiskChapterCount`, `bandAtTrigger`; Loop D: `prereqMastery`, `prereqDecay`, `blockReason`). Cross-check the matching bus-independent audit row (`system.remediation_escalated` / `system.engagement_escalated` / `system.concentration_escalated` / `system.blocked_prerequisite_*`).

### Step 2 (Tier-1 support) — verify the snapshot is INTERNALLY CONSISTENT

Confirm the snapshot's own numbers justify the flag under the ratified rule at the time (e.g. Loop A drop ≥ 0.15; Loop C `atRiskChapterCount ≥ 5`; Loop D prerequisite below floor 0.4 or retention below 0.5). If the snapshot is internally consistent, the system behaved correctly per its rules — explain the trigger to the disputer. If it is NOT consistent (the numbers don't justify the flag), that's a bug → Step 3, backend/architect.

### Step 3 — route the disagreement

- **The THRESHOLD itself seems wrong** (the snapshot is internally consistent, but the disputer argues the rule fired too eagerly / the cliff or band cutoff is miscalibrated) → route to **assessment**. Assessment owns the guardrail constants (`ADAPTIVE_REMEDIATION_RULES`, `ADAPTIVE_LOOPS_BC_RULES`, `BLOCKED_PREREQUISITE_RULES` in `packages/lib/src/learn/`). A threshold change is an assessment decision, never an ops/support edit.
- **The ESCALATION ROUTING was wrong** (right to flag, but it went to the wrong teacher/parent — e.g. a non-subject teacher, an unlinked guardian, or the wrong class) → route to **backend**. Backend owns `resolveEscalationTarget` / the escalation-target resolution in the cron worker (subject-match tiering, `teacher_remediation_assignments`, `guardian_student_links`).
- **The snapshot is internally inconsistent** (Step 2 failed — the flag fired on numbers that don't meet the rule) → route to **backend** (detection/worker bug), CC **architect** if it looks like a data-integrity issue upstream (bad `state_events` / stale `learner_twin_snapshots`).

In all three cases, log the dispute against the intervention id and the routing decision. If a specific student's flag must be neutralized while the dispute is investigated, resolve just that row (ops-only `dismissed` terminal state) rather than killing the whole loop.

---

## References (do not duplicate — these hold the SQL + procedures)

- Loop A rollout + monitoring + kill switch + hard-stop: `docs/runbooks/adaptive-remediation-rollout.md`
- Loops A+B+C program rollout + cross-loop anti-storm + program hard-stop: `docs/runbooks/adaptive-program-rollout.md`
- Loop D / Digital Twin rollout: `docs/runbooks/digital-twin-rollout.md`
- Worker route: `apps/host/src/app/api/cron/adaptive-remediation/route.ts`
- Rules (assessment-owned): `packages/lib/src/learn/adaptive-loops-rules.ts`, `remediation-queue-adapter.ts`
- Flag evaluation semantics: `packages/lib/src/feature-flags.ts` (`isFeatureEnabled` double-gate)
- Monitoring surfaces (parallel): `adaptive-loops-monitor` cron, `super-admin/adaptive-loops` dashboard (4th `blocked_prerequisite` column)
- Regression pins: REG-126..REG-134 (Loops A/B/C), REG-175 (Loop D)
</content>
