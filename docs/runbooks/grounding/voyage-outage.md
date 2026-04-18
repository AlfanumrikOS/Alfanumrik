# Voyage Outage Runbook

**Severity:** high (user-visible degradation — Foxy/quiz-gen/NCERT soft-abstain)
**Typical trigger:** Voyage API returns 5xx, times out, or hits rate limits; circuit breaker opens after 3 consecutive failures within 10s
**Owner:** ops (primary) → ai-engineer (if sustained > 30 min)

## Symptoms

- `/super-admin/grounding/health` shows `circuitStates.voyage = open` for one or more callers
- Abstain breakdown tile spikes; `abstain_reason='circuit_open'` dominates
- Foxy users see the soft-abstain "Couldn't fetch fresh sources" UI (not the hard-abstain "chapter unavailable" card)
- Quiz generator and NCERT solver fall back to legacy inline path (still serves, but no grounding)
- `ops_events` may show `grounding.voyage_circuit_opened` (severity=warning)

## Detection queries

Recent abstains due to circuit:
```sql
SELECT caller, count(*) AS circuit_open_count
  FROM grounded_ai_traces
 WHERE abstain_reason = 'circuit_open'
   AND created_at > now() - interval '5 minutes'
 GROUP BY caller
 ORDER BY circuit_open_count DESC;
```

Grounded-answer error rate (spec target ≤ 1% steady state):
```sql
SELECT caller,
       count(*) FILTER (WHERE grounded = false AND abstain_reason IN ('circuit_open','voyage_error')) * 100.0
       / NULLIF(count(*), 0) AS voyage_error_pct
  FROM grounded_ai_traces
 WHERE created_at > now() - interval '15 minutes'
 GROUP BY caller;
```

Dashboard path: `/super-admin/grounding/health` → "Circuit states" tile. Voyage status page: https://status.voyageai.com/

## Response

1. **Confirm outside the system.** Check Voyage status page + Voyage Discord. If Voyage confirms the outage, you're in passive-wait mode — the circuit breaker is doing its job.
2. **Do not manually disable `ff_grounded_ai_enabled`** unless the outage lasts > 30 minutes or the `grounded-answer` service is returning hard errors (not soft abstains). Soft-abstain is the designed behaviour.
3. **Watch for auto-recovery.** The circuit breaker goes half-open automatically after its cooldown (30s) and will probe Voyage. When Voyage recovers the breaker closes on its own.
4. **If Voyage has shipped a fix but the breaker is stuck open** (rare — indicates in-memory state drift):
   - Toggle `ff_grounded_ai_enabled = false` via `/super-admin/flags`
   - Wait 30 seconds for in-flight requests to drain
   - Toggle `ff_grounded_ai_enabled = true`
   - Edge Function re-initialisation resets the in-memory breaker state

## Rollback / escalation

- **>15 min sustained:** Notify ai-engineer in #ai-incidents
- **>30 min sustained:** Page on-call. Consider flipping `ff_grounded_ai_enabled = false` to short-circuit to legacy inline AI path (spec §10.4 global kill switch). Legacy path still serves Foxy/quiz without grounding — students get answers, just not verified-against-NCERT.
- **Voyage announces prolonged outage (>2 hours):** Consider activating fallback embedding provider (see spec §10.5 — not yet implemented; manual ai-engineer action required).

## Post-incident

- Copy the incident window (UTC) into the ai-health weekly report
- Verify no stale `verification_state='pending'` rows in `question_bank` were orphaned by the outage (claim_expires_at should auto-release; see `verifier-queue-stuck.md` if not)
- If Voyage hit rate limits rather than errored: open a ticket with ai-engineer to review our `VOYAGE_QPS_CAP` in `src/lib/grounding-config.ts` / `supabase/functions/grounded-answer/config.ts`
