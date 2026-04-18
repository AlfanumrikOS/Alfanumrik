# Claude Outage Runbook

**Severity:** high (user-visible — AI answers unavailable or fall back to legacy path)
**Typical trigger:** Anthropic API returns 5xx, times out, or hits org rate limits; circuit breaker opens after 3 consecutive failures within 10s. Haiku → Sonnet fallback is built in; this runbook covers when BOTH are failing.
**Owner:** ops (primary) → ai-engineer (if sustained > 30 min)

## Symptoms

- `/super-admin/grounding/health` shows `circuitStates.claude = open`
- Traces show `claude_model='claude-3-5-sonnet'` appearing on Foxy turns (fallback activated — yellow flag)
- Traces show repeated `abstain_reason='llm_error'` (red flag — both models failing)
- Foxy shows the generic error card with "Something went wrong"
- Latency P95 tile spikes before circuit opens
- `ops_events` may contain `grounding.claude_circuit_opened`

## Detection queries

Model fallback rate (Haiku → Sonnet — should be < 2% steady state):
```sql
SELECT caller,
       count(*) FILTER (WHERE claude_model LIKE '%sonnet%') * 100.0
       / NULLIF(count(*), 0) AS sonnet_fallback_pct
  FROM grounded_ai_traces
 WHERE created_at > now() - interval '15 minutes'
 GROUP BY caller;
```

LLM error abstain rate (both models failed):
```sql
SELECT caller, count(*) AS llm_error_count
  FROM grounded_ai_traces
 WHERE abstain_reason = 'llm_error'
   AND created_at > now() - interval '5 minutes'
 GROUP BY caller;
```

Latency drift:
```sql
SELECT caller,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99
  FROM grounded_ai_traces
 WHERE created_at > now() - interval '10 minutes'
 GROUP BY caller;
```

Anthropic status: https://status.anthropic.com/

## Response

1. **Confirm scope.** If only Haiku is failing (Sonnet still works), traces will show mostly `sonnet` — this is the designed fallback. No action needed except monitoring. Cost alert: Sonnet is ~5x Haiku; sustained fallback will show up in the ai-health weekly report.
2. **If both models failing** (rare — Anthropic-wide outage):
   - Check Anthropic status page + Discord
   - If outage confirmed, wait for circuit auto-recovery (30s half-open probe)
3. **Kill switch** — flip `ff_grounded_ai_enabled = false` via `/super-admin/flags` if:
   - Outage sustained > 15 min AND
   - You want to fail back to the legacy inline AI path (which uses the same Claude API, so this only helps if the legacy path uses a different key/endpoint — verify with ai-engineer before flipping)
4. **If Anthropic org rate limit hit** (HTTP 429): notify ai-engineer immediately to raise the org limit or shed load (drop daily challenges, diagnostic auto-retries, etc.)

## Rollback / escalation

- **>15 min:** Page ai-engineer in #ai-incidents
- **>30 min:** Page on-call. The legacy inline path also uses Claude, so flipping `ff_grounded_ai_enabled` off is not a full rescue — students still see errors.
- **>1 hour:** Post banner via `/super-admin` ops tools ("AI features temporarily unavailable") and notify founder

## Post-incident

- Compute the blast radius: `SELECT count(DISTINCT student_id) FROM grounded_ai_traces WHERE abstain_reason='llm_error' AND created_at BETWEEN '<start>' AND '<end>';`
- Log the incident window in the ai-health weekly report
- If the fallback rate was sustained high, open an ai-engineer ticket to review Haiku reliability and consider making Sonnet the default (higher cost but fewer fallbacks)
