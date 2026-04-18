# Verifier Queue Stuck Runbook

**Severity:** medium (no student-facing impact directly, but blocks rollout expansion — enforcement cannot be enabled for pairs where verified_ratio < 0.9)
**Typical trigger:** `verify-question-bank` cron runs but `question_bank.verification_state='legacy_unverified'` count stays flat for > 2 hours; or rows stuck in `pending` with expired `verification_claim_expires_at`
**Owner:** ops (primary) → ai-engineer (if stuck on Claude/Voyage calls)

## Symptoms

- `/super-admin/grounding/verification-queue` tile shows `legacy_unverified` count unchanged across multiple page refreshes (expected: ~1000/30min drain rate off-peak)
- Per-pair breakdown shows rows stuck in `pending` state with `verification_claimed_by` set and `verification_claim_expires_at` in the past
- `throughputLast24h.verified_per_hour = 0` or decreasing sharply
- No new traces with `caller='verify-question-bank'` in `grounded_ai_traces` over the last hour
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

Check cron is firing (Supabase dashboard → Database → Cron Jobs → verify-question-bank → "Last run"):
expected every 30 minutes.

## Response

1. **Confirm the cron is firing.** Supabase dashboard → Cron jobs. If last run was > 30 min ago, the scheduler itself is stuck — escalate to architect.
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
   This frees them for the next cron tick. The 5-minute buffer avoids racing a currently-running verifier.
4. **If stuck on a specific subset** (e.g., one chapter keeps failing): inspect `verifier_failure_reason` — might indicate truly unverifiable questions (no NCERT chunk match). Leave those in `failed` state; they are expected.
5. **If verification throughput is slow but not zero** (drain rate dropped from 1000/30min to 100/30min): check Claude latency in `grounded_ai_traces` where caller='verify-question-bank'. Raise Claude concurrency in Edge Function config if needed (ai-engineer owns the change).

## Rollback / escalation

- **Queue stuck > 4 hours:** page ai-engineer
- **Cron not firing at all > 2 hours:** page architect (may need Supabase support ticket)
- **Entire pipeline failing (every row goes to `failed`):** flip `ff_grounded_ai_enabled = false` to pause rollout expansion, notify ai-engineer. Existing enforcement pairs continue working on previously-verified rows.

## Post-incident

- Log the stuck window in the ai-health weekly report
- If reclaim query had to be run manually: open a ticket to make `claim_verification_batch` RPC self-heal expired claims on each call (proposed for a follow-up migration)
- If Claude rate limits caused it: add an alert on `grounded_ai_traces.abstain_reason='llm_error'` where caller='verify-question-bank'
