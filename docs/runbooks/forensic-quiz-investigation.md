# Runbook — Forensic Quiz Investigation (60-second triage)

**Owner:** ops
**Last updated:** 2026-05-04 (Wave 4 marking-authenticity remediation)
**Reader:** ops on-call (or the founder during alpha)
**Scenario:** "A student says their quiz was marked wrong" — one report from a parent, a teacher, or a support email.
**Goal:** From incident report → root cause classification → next action in **under 60 seconds**.

> **Why 60 seconds matters.** Marking errors damage trust faster than any other class of bug. The founder personally responds to the first 100 such reports in alpha. This runbook keeps that response loop tight.

---

## Pre-flight (do once per session, not per ticket)

- Open PostHog: https://app.posthog.com/project/159341
- Open the super-admin Marking Integrity panel (TODO ops — frontend follow-up; until then use direct SQL: `psql $SUPABASE_DB_URL`)
- Have your terminal at the repo root with the worktree checkout
- Know the student's name, parent's contact, and approximate date/time of the disputed quiz

---

## Step 1 (5 s) — Get the student UUID

The student rarely knows their UUID. Use one of these to translate a name/email/phone into a UUID. **Do not paste PII into PostHog.**

**Option A — Super-admin panel** (preferred; PII stays in the admin tier):
1. Navigate to `/super-admin/users`
2. Search by name fragment ("Student H." → "Harini") or email
3. Copy the `students.id` UUID (column "ID" in the users table)

**Option B — Direct SQL** (only when admin panel is degraded):
```sql
-- Service role only. Returns one row.
SELECT id, grade, created_at
  FROM public.students
 WHERE id = '<student-uuid>'           -- use UUID if known
    OR display_handle = '<handle>';   -- otherwise the public handle the student sees
```

**Output you need:** a single UUID, e.g. `<student-uuid>`. Carry this forward — never replace it with email/name in any subsequent query.

---

## Step 2 (15 s) — PostHog timeline pull

In PostHog → Activity → Live events (or Insights → New SQL insight):

**Filter:**
- `event` IN (`quiz_graded`, `marking_authenticity_violation`, `quiz_anti_cheat_flagged`, `daily_xp_cap_hit`, `quiz_snapshot_missing`, `quiz_idempotent_replay`)
- `properties.student_id = '<student-uuid>'`
- Time range: last 7 days (extend to 30 days if the report is older)

**Equivalent PostHog HogQL** (paste into a SQL insight):
```sql
SELECT
  timestamp,
  event,
  properties.quiz_session_id     AS session_id,
  properties.marking_authenticity_path AS path,
  properties.score_percent       AS score,
  properties.xp_earned           AS xp,
  properties.xp_capped           AS capped,
  properties.oracle_verdict      AS verdict,
  properties.snapshot_present    AS has_snapshot,
  properties.idempotent_replay   AS replay
FROM events
WHERE properties.student_id = '<student-uuid>'
  AND event IN (
    'quiz_graded',
    'marking_authenticity_violation',
    'quiz_anti_cheat_flagged',
    'daily_xp_cap_hit',
    'quiz_snapshot_missing',
    'quiz_idempotent_replay'
  )
  AND timestamp > now() - INTERVAL 7 DAY
ORDER BY timestamp DESC;
```

**What you're looking for:** the specific `quiz_graded` row that matches what the student is disputing (by approximate time, score, or subject). Note its `session_id` — that's your handle for Step 4.

> **Note on person-property freshness.** PostHog returns `person.properties.*` at query time, not event time. For grade/plan at the time of the disputed quiz, use the event-level `grade_at_event` and `plan_at_event` fields — they are snapshotted on emit. (See `docs/posthog-integration.md` §3.5.)

---

## Step 3 (10 s) — Read the `marking_authenticity_path`

For the suspect `quiz_graded` event, look at the `marking_authenticity_path` property. This is the single most important field — it tells you which scoring code path actually graded the quiz.

| Path value | Meaning | Likely root cause |
|---|---|---|
| `oracle_v2` | Server-side oracle, snapshot-grounded (Wave 4 target). | Rare to be wrong. If wrong: snapshot was tampered (REG-53 hash check would have fired) OR oracle prompt regression. Escalate to ai-engineer with session_id. |
| `oracle_v1_legacy` | Older oracle, deprecation pending. | Known bug class: edge cases with shuffle map. Cross-check with Step 4. |
| `client_fallback` | Client-side scored — known weak path. **Phase 2.7 deprecation pending.** | Most common source of legitimate marking complaints. Fixable by hand-correcting XP (Step 6, "proactive correction"). |
| `foxy_freetext` | Foxy AI tutor scored a free-text answer (not a server-validated MCQ). **Phase 3 cutover pending.** | Highest false-positive rate. Apologize, manual XP grant, log to `marking_authenticity_violation` for trend tracking. |
| `unknown` | Telemetry gap — code path didn't tag itself. | **P0 escalation.** Page ai-engineer + ops lead. We've lost forensic visibility. |

If there's NO `quiz_graded` event for the disputed time window: the submit may have failed silently before reaching telemetry. Check `quiz_snapshot_missing` (Phase 1.2 footprint) and `quiz_idempotent_replay`. If neither, jump to Step 5 (system-wide check) — could be a wider outage.

---

## Step 4 (15 s) — Run the forensic CLI

Backend wrote the forensic script in Wave 4. Run it for the student:

```bash
npm run forensic:quiz -- --student-id <student-uuid> --since 7d
```

**Expected output (one block per session in the window):**
```
=== Session <session-uuid> ===
  completed_at:        2026-05-03T14:23:11Z
  subject:             Mathematics
  topic:               Linear Equations
  marking_path:        client_fallback                ← matches PostHog
  recorded_score:      80%
  recomputed_score:    100%      DRIFT (-2 questions)
  recorded_xp:         12
  recomputed_xp:       18        DRIFT (-6 XP)
  snapshot_present:    yes
  snapshot_sha256:     <hex>... self-verifies OK
  per-question detail:
    Q1 selected=2 stored_correct=true   shuffle=[0,2,1,3] orig_correct_idx=1   verified=true
    Q2 selected=0 stored_correct=true   shuffle=[1,0,2,3] orig_correct_idx=1   verified=true
    Q3 selected=1 stored_correct=false  shuffle=[3,1,0,2] orig_correct_idx=1   verified=false  ← MARKED WRONG; SHOULD BE CORRECT
    Q4 selected=3 stored_correct=false  shuffle=[2,3,1,0] orig_correct_idx=3   verified=false  ← MARKED WRONG; SHOULD BE CORRECT
    Q5 selected=0 stored_correct=true   shuffle=[0,1,2,3] orig_correct_idx=0   verified=true
  P1 verdict:          DRIFT — recorded score and recomputed score disagree by 2 questions
  P2 verdict:          DRIFT — recorded XP and P2-recomputed XP disagree by 6 XP
  Recommended action:  PROACTIVE_CORRECTION (manual XP grant + apology)
```

**Interpreting the verdict block:**
- `CONSISTENT` → the student's complaint is about something else (perhaps they misremember which questions they answered). Open the session detail in the super-admin panel and walk through the questions with the parent.
- `DRIFT` → real marking error. Proceed to Step 6 directly (skip Step 5 if the report is for a single student).
- `SNAPSHOT_MISSING` → Phase 1.2 silent-zero. The student may have actually scored higher. Treat as DRIFT for remediation purposes.
- `INTEGRITY_HASH_MISMATCH` → tampered snapshot. **P0 — page ai-engineer + architect immediately.** REG-53 should have caught this earlier.

---

## Step 5 (10 s) — System-wide blast radius

Only run this if Step 4 showed DRIFT and you suspect it's not isolated (e.g., multiple complaints in the same hour, or the path was `client_fallback` and Phase 2.7 cutover happened recently).

```sql
-- Service role only. View is service_role-granted; never queryable by students/parents/teachers.
SELECT count(*)                                AS total_drift_rows,
       count(*) FILTER (WHERE snapshot_correct_idx IS NULL) AS missing_snapshot_rows,
       count(DISTINCT session_id)              AS sessions_affected,
       count(DISTINCT student_id)              AS students_affected,
       min(completed_at) AS earliest,
       max(completed_at) AS latest
  FROM public.marking_audit_last_30d
 WHERE (recorded_is_correct IS DISTINCT FROM expected_is_correct)
    OR snapshot_correct_idx IS NULL;
```

**Decision:**
- 0 rows → isolated incident. Proceed to Step 6 with confidence.
- 1-10 rows → likely small batch (perhaps a single chapter with bad answer-key data). Find the common topic_id:
  ```sql
  SELECT qss.question_id, count(*) AS hits
    FROM public.marking_audit_last_30d ma
    JOIN public.quiz_session_shuffles qss USING (session_id, question_id)
   GROUP BY qss.question_id
   ORDER BY hits DESC
   LIMIT 10;
  ```
  Then escalate to assessment for content fix.
- > 100 rows or > 10 students → **stop. Page ai-engineer + architect immediately.** Probable systemic bug; do not do per-student remediation until the bug is identified, otherwise XP grants will be inconsistent.

---

## Step 6 (5 s) — Decide and act

Three remediation paths:

### A. Silent fix (rare)
Use only when: telemetry shows DRIFT but the difference is cosmetic (e.g., 80% vs 82% with no XP change because the daily cap was already hit). Update the audit log; do not contact the student.

### B. Proactive correction (most common)
1. Compute the correct XP delta from Step 4 output (`recomputed_xp − recorded_xp`).
2. Manual XP grant via super-admin panel: `/super-admin/users/<student-uuid>` → "Adjust XP" → enter delta + reason ("Wave 4 marking remediation, session `<session-uuid>`")
3. Apology email — use template `support/templates/marking-correction.md` (TODO backend if missing).
4. Log the incident in PostHog by emitting `xp_drift_detected` from the forensic CLI (`--emit-violation` flag) so it shows up on the founder's dashboard.
5. If parent complained: reply to parent via WhatsApp template `parent_marking_apology` (Hindi/English bilingual per P7).

### C. Rollback (oracle false-positive cascade)
Use only when: Step 5 shows > 100 rows AND all paths point to a recent oracle prompt change.
1. Flip `ff_quiz_oracle_v2_enabled` to `false` (super-admin → Flags). This routes all new quiz submits back to the previous path.
2. **Do not** retroactively re-grade — the in-flight session integrity is more important than retroactive consistency. The forensic view will keep finding the affected rows; remediate them per-student via path B.
3. Open an incident in `docs/runbooks/SRE_RUNBOOK.md` format. Notify ai-engineer + architect.

---

## Worked example — "Student H." dispute, 2026-05-04

**Report (parent WhatsApp):** "Student H. says quiz on linear equations was marked all wrong but she got most right."

| Step | Action | Result | Elapsed |
|---|---|---|---|
| 1 | Super-admin search "Harini" | UUID `<student-uuid>` | 0:05 |
| 2 | PostHog filter `student_id = <UUID>`, last 7d | Found `quiz_graded` at 2026-05-03 14:23 with `score_percent=20`, `marking_authenticity_path=client_fallback` | 0:20 |
| 3 | Read path | `client_fallback` — known weak path, Phase 2.7 deprecation pending | 0:30 |
| 4 | `npm run forensic:quiz -- --student-id <UUID> --session-id <session-uuid>` | DRIFT: recorded 20%, recomputed 80%; -36 XP | 0:50 |
| 5 | Skipped (single-student report, `client_fallback` known weak) | — | — |
| 6 | Path B — proactive correction. Granted +36 XP. Apology sent. Emitted `xp_drift_detected`. | Closed. | 1:00 |

Total: 1:00 minute.

---

## Super Admin UI Required (frontend follow-up)

The runbook above relies on three UI surfaces that **frontend will build in a follow-up PR**. Until they exist, ops uses raw SQL + PostHog. Frontend ticket scope:

### Panel 1 — Marking Integrity (top-N drift students)
- **Page:** `src/app/super-admin/marking-integrity/page.tsx` (new)
- **Data source:** `public.marking_audit_last_30d` view via `src/app/api/super-admin/marking-integrity/route.ts` (backend follow-up)
- **Layout:**
  - Top card: "Drift rows in last 30 days: N | Students affected: M | Sessions affected: K | Missing-snapshot footprint: P"
  - Top-N table (default N=20, configurable to 100): student handle (NOT name — keep PII out of the panel), drift_count, latest_drift_at, dominant_marking_path, **"Open forensic report"** button
  - "Open forensic report" navigates to `/super-admin/marking-integrity/<student-uuid>` which renders the full `npm run forensic:quiz` output server-side (don't shell out — call the same TS function the CLI uses)
- **RBAC:** `support.read.full` permission required (architect to confirm exact code)
- **PII boundary:** the panel must NEVER show student email, phone, or full name. Display `students.display_handle` only. Forensic report page may show first-name-only ("Harini H.") if the support agent needs to humanize an apology email.

### Panel 2 — Oracle Health (real-time)
- **Page:** `src/app/super-admin/oracle-health/page.tsx` (new)
- **Data source:** PostHog Insights API server-side (read-only, server-to-server with PostHog personal API key in Vercel env). Never call PostHog from the client.
- **Charts:**
  - Time series: oracle reject rate (`oracle_verdict=REJECT` / total `oracle_verdict_emitted`) over last 24h, 1m bucketing
  - Time series: oracle ambiguous rate (`oracle_verdict=AMBIGUOUS` / total) — same bucketing
  - Counter: blocks in last hour (count of `foxy_oracle_blocked`)
- **Alert visibility:** if reject rate > 20% in any 5-min window, render a top-of-page banner "Oracle reject rate elevated — investigate or rollback `ff_quiz_oracle_v2_enabled`". Same threshold should fire a PostHog alert per `docs/posthog-integration.md` §3.3 Insight 3.
- **RBAC:** `system.observability.read`

### Panel 3 — Marking Authenticity Path Mix
- **Page:** add a card to the existing `/super-admin/learning` page (or new section in control room)
- **Data source:** PostHog Insights API server-side — `quiz_graded` breakdown by `marking_authenticity_path`, last 7 days
- **Visualization:** pie chart with the 5 path values, plus a second strip below showing the same data per-day for the last 30 days as a stacked bar
- **Goal annotation in UI:** "Wave 4 target: 100% `oracle_v2`. Current mix indicates which deprecation cutovers are still pending."
- **RBAC:** `system.observability.read`

**Open question for frontend:** should panels 2 and 3 cache the PostHog API response server-side (5-minute TTL)? PostHog API has rate limits; multiple concurrent admin sessions could exhaust them. Recommend yes; cache key = (insight_id, time_range_bucket).

---

## See also

- `docs/posthog-integration.md` — event catalog and PostHog project configuration
- `supabase/migrations/20260504100400_marking_audit_view.sql` — the SQL view this runbook depends on
- `.claude/CLAUDE.md` — P1 score formula, P2 XP formula, P14 review chain matrix
- `docs/runbooks/SRE_RUNBOOK.md` — incident escalation format
