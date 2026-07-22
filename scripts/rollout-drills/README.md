# Rollout Drills — Executable Synthetic Staging Drills

> **STAGING ONLY — NEVER RUN AGAINST PRODUCTION.**
> Every script in this directory seeds synthetic learner state, drives the
> adaptive-loops cron worker through its state machine, and then deletes exactly
> what it seeded. They are the FIRST gate of each dormant-system rollout: run the
> drill green on staging before flipping any loop flag on production.

These scripts turn the "synthetic staging drill" prose that lives in the
per-system rollout runbooks into runnable SQL playbooks:

| Script | Loop(s) | Source runbook (drill section) |
|---|---|---|
| `loop-a-remediation-drill.sql` | Loop A — mastery-cliff → inject → recovered / escalated | `docs/runbooks/adaptive-remediation-rollout.md` §"Staging synthetic-cliff drill" (Steps 0–7) |
| `loops-bc-drill.sql` | Loop B — inactivity → nudge → return / parent-escalation; Loop C — at-risk-concentration → escalate → resolve / re-notify; + cross-loop ceiling | `docs/runbooks/adaptive-program-rollout.md` §4.B / §4.C / §4.D / §4.E |
| `loop-d-prerequisite-drill.sql` | Loop D — blocked-prerequisite → inject → recovered / escalated; + A>D>C>B ceiling | `docs/runbooks/digital-twin-rollout.md` §"Staging synthetic blocked-prerequisite drill" (Steps 0–7) |
| `verify-migrations-apply.md` | (checklist) | this session's migrations `20260722090000`..`20260722103000` |

Every threshold, seed value, and expected transition in the SQL is annotated
with the runbook section and/or the rule constant it is grounded in
(`ADAPTIVE_LOOPS_BC_RULES`, `BLOCKED_PREREQUISITE_RULES`, `PULSE_THRESHOLDS`,
`ADAPTIVE_REMEDIATION_RULES`). The scripts do **not** invent any number.

---

## Why these are multi-phase, not one `psql -f` run

Each drill interleaves SQL with an HTTP call to the cron worker
(`POST /api/cron/adaptive-remediation`). The sequence is always:

```
seed state (SQL)  →  curl worker {"phase":"inject"}  →  verify row (SQL)
                  →  [optional recovery seed (SQL)]   →  curl {"phase":"verify"}  →  verify (SQL)
                  →  fast-forward window (SQL)         →  curl {"phase":"verify"}  →  verify (SQL)
                  →  cleanup (SQL)
```

So you run each script **phase by phase**, not top-to-bottom in one shot. Each
file is divided into clearly numbered `PHASE` blocks with a comment telling you
when to fire the `curl`. Keep one `psql` session open for the SQL and a second
terminal for the `curl`.

---

## Safety by construction

1. **Sentinel-keyed seeds.** Everything a drill creates is tagged so cleanup is
   unambiguous even if you fat-finger a parameter:
   - `state_events.idempotency_key` starts with `drill_` (e.g.
     `drill_adaptive_remediation_cliff_*`).
   - Loop A uses fictional **chapter 99**; Loop B uses the reserved sentinel
     triple `('_inactivity', chapter 0)`; Loop D graph edges use
     `concept_edges.source = 'drill'`.
   - Notifications carry the loop's deterministic idempotency-key prefixes
     (`remediation_%`, `engagement_%`, `concentration_%`).
2. **Cleanup matches the seed exactly.** The final `PHASE` of every script
   deletes only sentinel-tagged rows scoped to the test student. No `TRUNCATE`,
   no unqualified `DELETE`.
3. **Test student only.** You supply an existing, clearly-marked staging test
   account (`is_active = true, deleted_at IS NULL`). The drills never touch a
   real learner. Prefer an account whose email is itself a sentinel, e.g.
   `drill+loop-a@staging.invalid`.
4. **Read-mostly.** These scripts seed synthetic rows and read state back. They
   change **no** schema, **no** RLS, **no** anti-cheat guardrail, **no** flag
   except the loop flag you deliberately flip ON for the drill on staging.

---

## Prerequisites (clear ALL before running any drill)

- [ ] You are pointed at **staging**, verified twice (see the `\echo` guard at
      the top of each script — it prints the DB you are connected to; abort if it
      is not staging).
- [ ] The relevant loop flag is enabled **and env-matched** on staging (each
      script's PHASE 0 does this). Flag cache TTL is 5 minutes — wait it out.
- [ ] **`ff_event_bus_v1` resolves ON on staging** for Loops A/B/C. Staging
      historically ships `is_enabled=true, rollout_percentage=0`, which resolves
      **OFF** — that blinds verify and every drill falsely expires to escalation.
      Clear it first (see `adaptive-program-rollout.md` §2):
      ```sql
      UPDATE feature_flags
      SET is_enabled = true, rollout_percentage = 100, updated_at = now()
      WHERE flag_name = 'ff_event_bus_v1';
      ```
      (Loop D verify reads LIVE `concept_mastery`, not the bus, so it is not
      blinded — but keep the bus ON anyway so the `system.prerequisite_resolved`
      event publishes; see `digital-twin-rollout.md` prerequisite note.)
- [ ] `CRON_SECRET` set in **both** the Supabase Edge Function secrets and the
      Vercel/staging environment, and **distinct** from production's value.
- [ ] `SITE_URL` set on the staging `daily-cron` Edge Function (unset falls back
      to production).
- [ ] The migrations are applied on staging — see `verify-migrations-apply.md`.

---

## Environment variables

```bash
# The staging Postgres connection string (service-role / direct connection).
export STAGING_DATABASE_URL='postgresql://postgres:...@db.<staging-ref>.supabase.co:5432/postgres'

# The staging deployment host that serves /api/cron/adaptive-remediation.
export STAGING_HOST='https://<staging-host>'

# The staging CRON_SECRET (must match the Vercel + Edge Function secret).
export CRON_SECRET='<staging-cron-secret>'
```

## How to run a drill (example: Loop A)

Open an interactive psql session bound to staging, set the drill parameters
once, then paste each PHASE block in order, firing the `curl` where the script
tells you to:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1

-- inside psql, set the params the script references (edit to your test account):
\set test_student_id   '00000000-0000-0000-0000-000000000000'
\set auth_user_id      '11111111-1111-1111-1111-111111111111'
-- then run the PHASE blocks from loop-a-remediation-drill.sql in order.
```

The worker trigger, run from a second terminal between phases:

```bash
curl -s -X POST "$STAGING_HOST/api/cron/adaptive-remediation" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"phase":"inject"}'   # or {"phase":"verify"}
```

> **Supabase SQL editor note.** The web SQL editor does not support psql
> `\set` / `:'var'` substitution. If you use the editor instead of psql,
> find-and-replace each `:'test_student_id'` token with a quoted UUID literal
> before running. The `\set` + psql path is recommended because it keeps the
> sentinel cleanup bulletproof.

---

## If a drill goes sideways

Run only the final **CLEANUP** phase of the script — it is sentinel-scoped and
idempotent, so it is always safe to re-run. Then, if you left an intervention
mid-flight, the loop's own drain-not-freeze verify sweep will terminalize it on
the next nightly tick even with the flag OFF (that is the designed kill-switch
behavior — see each runbook's "Kill-switch semantics").
</content>
</invoke>
