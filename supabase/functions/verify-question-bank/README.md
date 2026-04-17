# verify-question-bank

Retroactive verifier cron. Drains `question_bank.verification_state = 'legacy_unverified'` backlog by calling the grounded-answer service with the `quiz_answer_verifier_v1` prompt template. Implements spec §8.3.

## Behavior per invocation

1. Detect whether the current IST hour is in the **peak window** (14:00–22:00 IST).
2. Pick a **batch size** — off-peak=1000, peak=250.
3. Query `grounded_ai_traces` for the last minute. If RPM > 2400, **halve** the batch size (adaptive throttle).
4. Call the atomic `claim_verification_batch(batch_size, claimed_by, ttl_seconds)` RPC. Rows become `verification_state='pending'` with a 10-minute claim TTL.
5. For each claimed row:
   - Build a `query` JSON payload with the question, options, claimed correct index, and explanation.
   - Call the grounded-answer service with `template: 'quiz_answer_verifier_v1'`, `mode: 'strict'`, `generation.temperature: 0`.
   - Parse the verifier's JSON `answer`. If `verified=true` **and** `correct_option_index` matches the stored value → `verification_state='verified'`, `verified_against_ncert=true`. Otherwise → `verification_state='failed'`.
   - Store the trace id, Claude model, chunk ids, and timestamp.
6. **Backoff on upstream failure**: if the service returns `abstain_reason='upstream_error'` or `'circuit_open'`, retry with 5s → 10s → 20s → 40s. After 4 attempts, revert the row to `legacy_unverified` so the next run re-picks it (we never mark a row failed because *we* failed — only when the verifier disagreed).
7. Emit an `ops_events` row of category `grounding.verifier`, message `batch_complete`, with `claimed / verified / failed / released` counts.

## Idempotency & concurrency

- `claim_verification_batch` uses `FOR UPDATE SKIP LOCKED`, so two concurrent Supabase cron invocations **never** see the same rows.
- If a worker crashes mid-batch, the claim token expires after 10 minutes and the next run re-claims via the `verification_state='pending' AND verification_claim_expires_at < now()` branch.

## Schedule (ops/user action required)

This function is **not scheduled automatically** — schedule it after deploying:

```bash
# Every 30 minutes, at minutes :00 and :30
supabase functions schedule verify-question-bank --cron "*/30 * * * *"
```

## Local dev

```bash
supabase functions serve verify-question-bank --env-file .env.local
# trigger manually:
curl -X POST http://localhost:54321/functions/v1/verify-question-bank \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Environment

Reads from Edge Function secrets:

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Platform URL (service client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (RPC + row updates) |

The grounded-answer client helper (`supabase/functions/_shared/grounded-client.ts`) reads the same two vars to hop over to the service.

## Observability

Every run emits one `ops_events` row:

```json
{
  "category": "grounding.verifier",
  "source": "verify-question-bank",
  "severity": "info",
  "message": "batch_complete",
  "context": {
    "run_id": "…",
    "peak": true,
    "rpm": 120,
    "throttled": false,
    "batch_size": 250,
    "claimed": 250,
    "verified": 231,
    "failed": 14,
    "released": 5,
    "duration_ms": 48210
  }
}
```

Error runs emit `severity=error` with the same `run_id`.

## Related

- Spec: `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md` §8.3
- Migration: `supabase/migrations/20260418101100_claim_verification_batch_rpc.sql`
- Unit tests: `src/__tests__/verify-question-bank-logic.test.ts`
- Client helper: `supabase/functions/_shared/grounded-client.ts`
- Prompt template: `supabase/functions/grounded-answer/prompts/quiz_answer_verifier_v1.txt`