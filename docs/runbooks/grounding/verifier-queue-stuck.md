# Verifier Queue Stuck Runbook

**Severity:** medium (no student-facing impact directly, but blocks rollout expansion — enforcement cannot be enabled for pairs where verified_ratio < 0.9)
**Typical trigger:** `verify-question-bank` runs nightly (triggered by the daily-cron fan-out step `question_bank_verify_triggered`, 18:30 UTC / 00:00 IST — NOT a separate `*/30` schedule) but `question_bank.verification_state='legacy_unverified'` count is unchanged across **2+ consecutive nights**; or rows stuck in `pending` with expired `verification_claim_expires_at` well past the nightly run
**Owner:** ops (primary) → ai-engineer (if stuck on Claude/Voyage calls)

## Symptoms

- `/super-admin/grounding/verification-queue` tile shows `legacy_unverified` count unchanged across **2+ consecutive nights**. Cadence reality check before declaring an incident:
  - The verifier runs **once nightly** (daily-cron fan-out, 00:00 IST, off-peak batch size 1000). A flat count during the day is normal — the queue only drains overnight.
  - The nightly run **claims** up to 1000 rows but the Edge wall-clock typically kills it after **~50-150 verified rows per run** — that is the realistic drain rate, not 1000/night.
  - A killed run leaves the unprocessed claimed rows in `pending`; they **self-heal via the 10-minute claim TTL** and get re-claimed the next night. `pending` rows the morning after a run are not by themselves an incident.
  - A killed run also never emits `batch_complete` — a **missing `batch_complete` event after a wall-clock kill is expected**; look at per-row `verified_at` progress instead.
- Per-pair breakdown shows rows stuck in `pending` state with `verification_claimed_by` set and `verification_claim_expires_at` in the past **long after the nightly window** (i.e. midday and still `pending`)
- `throughputLast24h.verified_per_hour` will be 0 for most hours by design; the signal is `verified` count over the **last 24h** being 0 across multiple days
- No new traces with `caller='verify-question-bank'` in `grounded_ai_traces` since the last nightly window
- Edge Function logs show errors (check Supabase dashboard → Edge Functions → verify-question-bank → Logs)

## Detection queries

Claim health:
```sql
SELECT verification_state, count(*) AS n,
       min(verification_claim_expires_at) AS oldest_claim_expiry
  FROM question_bank
 WHERE deleted_at IS NULL
 GROUP BY verification_state;
```

Stuck pending rows (claim expired but still pending):
```sql
SELECT id, grade, subject, chapter_number, verification_claimed_by,
       verification_claim_expires_at, verifier_failure_reason
  FROM question_bank
 WHERE verification_state = 'pending'
   AND verification_claim_expires_at < now()
   AND deleted_at IS NULL
 ORDER BY verification_claim_expires_at ASC
 LIMIT 100;
```

Most recent verifier activity:
```sql
SELECT max(verified_at) AS last_verified_at,
       count(*) AS verified_last_hour
  FROM question_bank
 WHERE verification_state = 'verified'
   AND verified_at > now() - interval '1 hour';
```

Check the nightly trigger fired: Supabase dashboard → Edge Functions → **daily-cron** → Logs, around 18:30 UTC / 00:00 IST. Look for `triggerVerifyQuestionBank:` warn lines (`SUPABASE_URL or CRON_SECRET unavailable — skipping`, `non-OK <status>`, `network error`). There is NO separate `verify-question-bank` entry under Database → Cron Jobs — the fan-out is the only scheduler.

## Response

1. **Confirm the nightly trigger fired.** Check daily-cron logs for `triggerVerifyQuestionBank` warns (see above). If daily-cron itself didn't run last night, the pg_cron scheduler is stuck — escalate to architect. If it ran but the trigger warned `CRON_SECRET unavailable`, fix the Edge Function secret.
2. **Check Edge Function logs** for `verify-question-bank` in Supabase dashboard. Look for:
   - Claude rate limit (HTTP 429) — coordinate with ai-engineer to raise org limit
   - Voyage errors — see `voyage-outage.md`
   - Timeouts (function exceeded 60s wall clock) — check batch size config
   - DB errors on `claim_verification_batch` RPC — see step 3
3. **If rows are stuck in `pending` with expired claims** (claim TTL passed but not reset): run the reclaim query:
   ```sql
   UPDATE question_bank
      SET verification_state = 'legacy_unverified',
          verification_claimed_by = NULL,
          verification_claim_expires_at = NULL
    WHERE verification_state = 'pending'
      AND verification_claim_expires_at < now() - interval '5 minutes'
      AND deleted_at IS NULL;
   ```
   This frees them for the next nightly run. The 5-minute buffer avoids racing a currently-running verifier. Note: with the once-nightly cadence this is usually unnecessary — expired `pending` claims self-heal when the next night's run re-claims them via the 10-min TTL branch. Run it manually only if you're about to trigger the verifier by hand and want the rows back immediately.
4. **If stuck on a specific subset** (e.g., one chapter keeps failing): inspect `verifier_failure_reason` — might indicate truly unverifiable questions (no NCERT chunk match). Leave those in `failed` state; they are expected.
5. **If verification throughput is slow but not zero** (nightly drain dropped below the realistic ~50-150 rows/night, e.g. to single digits): check Claude latency in `grounded_ai_traces` where caller='verify-question-bank'. Raise Claude concurrency in Edge Function config if needed (ai-engineer owns the change). If the backlog needs draining faster than the nightly cadence allows, coordinate with ai-engineer before invoking the function manually in a loop — each run spends real LLM budget.

## Rollback / escalation

- **Queue made zero progress across 2 consecutive nights:** page ai-engineer
- **daily-cron itself not firing (fan-out never runs):** page architect (may need Supabase support ticket)
- **Entire pipeline failing (every row goes to `failed`):** flip `ff_grounded_ai_enabled = false` to pause rollout expansion, notify ai-engineer. Existing enforcement pairs continue working on previously-verified rows.

## Post-incident

- Log the stuck window in the ai-health weekly report
- If reclaim query had to be run manually: open a ticket to make `claim_verification_batch` RPC self-heal expired claims on each call (proposed for a follow-up migration)
- If Claude rate limits caused it: add an alert on `grounded_ai_traces.abstain_reason='llm_error'` where caller='verify-question-bank'
