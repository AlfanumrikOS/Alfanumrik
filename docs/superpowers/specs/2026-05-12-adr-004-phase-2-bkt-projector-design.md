# ADR-004 Phase 2 — BKT via concept-mastery-projector (Design)

**Date:** 2026-05-12 (revised twice: Path C with guardrails, then chained-prior-at-answer-time + atomic-RPC commit)
**Status:** Draft — awaiting CEO review
**Parent ADRs:** [ADR-004 — Adaptive Tutor](../../architecture/ADR-004-adaptive-tutor.md), [ADR-005 — Spine](../../architecture/ADR-005-concept-first-adaptive-learning-spine.md)
**Depends on:** [State Runtime Hardening (PR 1)](./2026-05-12-projector-substrate-design.md) in production.
**Ships as:** PR 2 of the two-PR Phase 2 sequence.
**Flag:** `ff_tutor_bkt_v1` (new, default OFF)

## Context

Phase 0 of ADR-004 shipped with a placeholder mastery write inline in `/api/tutor/answer`. Phase 2 replaces it with **Bayesian Knowledge Tracing** under ADR-005's rules.

This is the third revision of the design. Earlier drafts had real bugs:

1. **Original (Approach C — sync inline BKT):** route was the canonical writer. Violates ADR-005.
2. **Path C v1 (route publishes, projector writes):** flag-gate was too narrow; route reserved `prior` at `/api/tutor/next` time. Two near-simultaneous answers both stored `prior=0.30` at reservation, then both projected to 0.69 instead of chaining to 0.92.
3. **This revision (Path C v2):** `/api/tutor/next` is read-only; the chain head + sequence + prior + posterior + event are all computed **at /answer time inside one atomic Postgres RPC** holding `pg_advisory_xact_lock` per (student, concept). Multi-tab / concurrent answers commit in serial order through the lock; out-of-order answers chain in commit order.

## Goals

1. Replace the naive Phase 0 mastery update with BKT (Corbett & Anderson 1995). `mastery_mean` becomes a literal probability.
2. `/api/tutor/next` returns a fresh `attemptId` (UUID v4) — **no DB write**.
3. `/api/tutor/answer` requires `attemptId` and invokes the atomic RPC `tutor_commit_attempt`. The RPC:
   - Holds `pg_advisory_xact_lock(hashtext(student_id || ':' || concept_id))` for the duration.
   - Reads the **chain head's posterior** (latest answered `concept_attempts` for this student-concept) as the BKT prior, falling back to `concept_mastery.mastery_mean`, then to `DEFAULT_BKT_PARAMS.pInit (0.30)`.
   - Computes `attempt_sequence = COALESCE(MAX(seq), 0) + 1`.
   - Computes posterior `= bkt_update(prior, correct)` via a SQL function (same math as the TS `updateMasteryBKT`).
   - INSERTs `concept_attempts { ..., status='answered', prior_mastery_mean, posterior_mastery_mean }`. UNIQUE on `attempt_id` → 409 on duplicate.
   - INSERTs `state_events { kind='learner.concept_check_answered', payload }`.
   - Returns `(attempt_sequence, prior, posterior, event_id)`.
4. The new **`concept-mastery-projector`** subscribes to `learner.concept_check_answered` and is the canonical writer of `concept_mastery`. Idempotent on `attemptId`.
5. The route gates Path C on **all three flags** AND asserts `publishResult.published === true` (here: RPC success). On any check failure, the route:
   - INSERTs `concept_attempts { ..., status='excluded' }` (so the audit trail is preserved but the BKT chain skips this attempt),
   - performs the Phase 0 legacy inline `concept_mastery` write,
   - logs ops-critical and captures `tutor_answer_path_c_fallback`.
6. Picker contract unchanged. Picker reads `concept_mastery.mastery_mean`.
7. Legacy chapter-level `mastery-state-writer` untouched.

## Non-Goals

- Per-concept BKT param calibration (Phase 2.1).
- Decay column (`current_retention`) — Phase 1 of ADR-004.
- Picker changes.
- Phase 5 content backfill.
- Retiring `learner.mastery_changed` subscriber.
- Sub-minute projector latency (Phase 2.1 ad-hoc trigger).

## Architecture: Path C v2 — answer-time prior, atomic RPC

```
GET /api/tutor/next
   │
   ├── resolveNextConcept (existing)
   │
   ├── ff_tutor_bkt_v1 ON?
   │     YES → attemptId = uuid_v4()   (no DB write)
   │            return { concept, attemptId }
   │     NO  → return { concept }   (legacy)

POST /api/tutor/answer { attemptId, conceptId, correct, chosenIndex, responseTimeMs }
   │
   ├── auth + body validation (attemptId required when flag is ON)
   ├── read all three flags
   │
   ├── all three ON?
   │   YES → Path C v2:
   │     try:
   │       result = await sb.rpc('tutor_commit_attempt', {
   │         p_attempt_id: attemptId,
   │         p_student_id: studentId,
   │         p_concept_id: conceptId,
   │         p_correct: correct,
   │         p_chosen_index: chosenIndex,
   │         p_response_time_ms: responseTimeMs ?? null,
   │         p_question_id: `${conceptId}:practice:v1`,
   │         p_subject_code, p_chapter_number,
   │         p_occurred_at: now(),
   │         p_event_id: uuid_v4(),
   │         p_idempotency_key: `tutor.answer.${attemptId}`,
   │       })
   │       // RPC body, in ONE Postgres transaction:
   │       //   pg_advisory_xact_lock(hashtext(student||concept))
   │       //   prior = chain_head ?? concept_mastery.mean ?? 0.30
   │       //   seq   = MAX(seq) + 1
   │       //   posterior = bkt_update(prior, correct)
   │       //   INSERT concept_attempts (... status='answered')
   │       //   INSERT state_events (... kind='learner.concept_check_answered')
   │       //   RETURN (seq, prior, posterior, event_id)
   │       return { ok, optimistic: true, path: 'c',
   │                mastery: { mastery_mean: result.posterior,
   │                           attempts: result.attempt_sequence,
   │                           mastered: result.posterior >= 0.85 } }
   │     catch (rpcErr):
   │       // Atomic transaction failed (extremely rare in steady state)
   │       logger.error('tutor.answer: RPC failed; falling back', { rpcErr })
   │       capture('tutor_answer_path_c_fallback', { reason: 'rpc_error', ... })
   │       // FALL THROUGH to legacy block (with concept_attempts.status='excluded' marker)
   │
   ├── legacy block (flag-off path or RPC fallback):
   │   if (attemptId provided): INSERT concept_attempts { attempt_id, ...,
   │                                                       status='excluded',
   │                                                       answered_at=now(),
   │                                                       correct, ...,
   │                                                       prior=NULL, posterior=NULL }
   │   inline naive concept_mastery UPSERT (Phase 0 math)
   │   return { ok, optimistic: false, path: 'legacy', mastery: { ... } }
   │
   ▼ ≤ 1 minute later (pg_cron)
   │
concept-mastery-projector (PR 1 runtime)
   │
   ├── tickOne pulls events past cursor for kind='learner.concept_check_answered'
   ├── for each event E:
   │     existing = concept_mastery WHERE (student, concept)
   │     if existing.last_attempt_id == E.payload.attemptId: no-op (idempotent)
   │     posterior = bkt_update(E.payload.priorMasteryMean, E.payload.correct)
   │                 ← byte-identical to RPC's compute
   │     UPSERT concept_mastery {
   │       mastery_mean = posterior,
   │       last_attempt_id = E.payload.attemptId,
   │       total_attempts = E.payload.attemptSequence,
   │       total_correct = total_correct + (correct ? 1 : 0),
   │       streak_current = correct ? streak_current + 1 : 0,
   │       last_practiced_at = E.payload.occurredAt,
   │       bkt_version = 1
   │     }
   └── advance subscriber_offsets[concept-mastery-projector]
```

### Why the chain is correct under concurrency

**Two-tab race (the original bug):**
- T=0:   `/next` returns attemptId=A1 (no DB write).
- T=5:   `/next` returns attemptId=A2 (no DB write).
- T=10:  `/answer(A1, correct)` calls RPC. Lock acquired. Chain head = none. `prior = concept_mastery.mean ?? 0.30 = 0.30`. seq=1. posterior=0.693. INSERT attempt A1 (seq=1, prior=0.30, posterior=0.693). INSERT event. Commit. Lock released.
- T=15:  `/answer(A2, correct)` calls RPC. Lock acquired (after T=10 commits). Chain head = A1 (just committed, status='answered'). `prior = A1.posterior = 0.693`. seq=2. posterior=0.918. INSERT attempt A2 (seq=2, prior=0.693, posterior=0.918). INSERT event. Commit. Lock released.

Chain: 0.30 → 0.693 → 0.918. Correct.

**Out-of-order answer race:**
- T=0:   `/next` returns A1.
- T=5:   `/next` returns A2.
- T=10:  `/answer(A2, correct)` runs first. Lock. Chain head = none. prior=0.30. seq=1. posterior=0.693. INSERT A2 (seq=1).
- T=15:  `/answer(A1, correct)` runs second. Lock. Chain head = A2 (just committed). prior=0.693. seq=2. posterior=0.918. INSERT A1 (seq=2).

Note: `attempt_sequence` reflects commit order, not serve order. That's correct — both observations are real; both chain into BKT in the order they were committed.

**Why this respects ADR-005:** `concept_attempts` is operational/log data (per-attempt log + chain of priors-and-posteriors). Canonical learner state is `concept_mastery.mastery_mean`, which only the projector writes. The rule's operational-table clarification covers this.

### Why the fallback doesn't create divergence

**Atomic RPC means UPDATE + INSERT INTO state_events succeed together or fail together.** A failed RPC leaves nothing committed — no `concept_attempts` row, no `state_events` row. The route then INSERTs a `concept_attempts` row with `status='excluded'` (so the audit trail records that an attempt was made), and runs the legacy inline `concept_mastery` write.

Chain-head reads skip `status='excluded'` rows. Future Path-C attempts therefore chain off the last `status='answered'` row, falling back to `concept_mastery.mean` if no answered row exists (which now reflects the legacy write). The chain bridges cleanly across the excluded attempt — no divergence persists beyond the single fallback attempt itself.

## Pure BKT update

### `src/lib/tutor/bkt.ts` (new) — TypeScript

```ts
export interface BKTParams {
  pInit: number; pTransit: number; pGuess: number; pSlip: number;
}
export const DEFAULT_BKT_PARAMS: BKTParams = {
  pInit: 0.30, pTransit: 0.10, pGuess: 0.20, pSlip: 0.10,
};
export function updateMasteryBKT(
  prior: number, correct: boolean, params: BKTParams = DEFAULT_BKT_PARAMS,
): number { /* implementation; clamp to [1e-6, 1-1e-6] */ }
```

### SQL function — same math, used inside the RPC

```sql
CREATE OR REPLACE FUNCTION public.bkt_update(
  p_prior numeric, p_correct boolean,
  p_p_init numeric DEFAULT 0.30, p_p_transit numeric DEFAULT 0.10,
  p_p_guess numeric DEFAULT 0.20, p_p_slip numeric DEFAULT 0.10
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_post_obs numeric;
  v_result numeric;
BEGIN
  IF p_correct THEN
    v_post_obs := (p_prior * (1 - p_p_slip)) /
                  ((p_prior * (1 - p_p_slip)) + ((1 - p_prior) * p_p_guess));
  ELSE
    v_post_obs := (p_prior * p_p_slip) /
                  ((p_prior * p_p_slip) + ((1 - p_prior) * (1 - p_p_guess)));
  END IF;
  v_result := v_post_obs + (1 - v_post_obs) * p_p_transit;
  RETURN GREATEST(1e-6, LEAST(1 - 1e-6, v_result));
END $$;
```

Both implementations are tested against the same fixture table:

| Test | prior | correct | expected P(L) | tolerance |
|---|---|---|---|---|
| First-correct from default | 0.30 | true  | 0.693 | ±0.005 |
| First-wrong from default   | 0.30 | false | 0.146 | ±0.005 |
| Correct on mastered        | 0.95 | true  | 0.990 | ±0.002 |
| Wrong on mastered          | 0.95 | false | 0.733 | ±0.005 |
| Convergence (5 corrects)   | 0.30 | t×5   | > 0.97 | — |
| Convergence (10 wrongs)    | 0.95 | f×10  | < 0.20 | — |
| Crosses 0.85 fast          | 0.30 | t×2   | ≥ 0.85 | — |
| Idempotent (pure)          | x | x | exact | — |
| Clamp upper                | 1.0 | true  | < 1.0 | — |
| Clamp lower                | 0.0 | false | > 0.0 | — |

A cross-runtime test asserts TS and SQL produce equal values within ±1e-9 for ten randomized fixtures — proves the determinism contract.

## The atomic RPC

```sql
CREATE OR REPLACE FUNCTION public.tutor_commit_attempt(
  p_attempt_id        uuid,
  p_student_id        uuid,
  p_concept_id        uuid,
  p_correct           boolean,
  p_chosen_index      int,
  p_response_time_ms  int,
  p_question_id       text,
  p_subject_code      text,
  p_chapter_number    int,
  p_occurred_at       timestamptz,
  p_event_id          uuid,
  p_idempotency_key   text
) RETURNS TABLE (
  attempt_sequence    int,
  prior_mastery_mean  numeric,
  posterior_mastery_mean numeric,
  event_id            uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prior     numeric;
  v_seq       int;
  v_posterior numeric;
  v_auth_user uuid;
BEGIN
  -- Lock per (student, concept). Held until COMMIT.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_student_id::text || ':' || p_concept_id::text)
  );

  -- Chain head (latest answered attempt) → fallback to concept_mastery → default.
  SELECT COALESCE(
    (SELECT posterior_mastery_mean FROM public.concept_attempts
     WHERE student_id = p_student_id AND concept_id = p_concept_id
       AND status = 'answered'
     ORDER BY attempt_sequence DESC LIMIT 1),
    (SELECT mastery_mean FROM public.concept_mastery
     WHERE student_id = p_student_id AND concept_id = p_concept_id),
    0.30
  ) INTO v_prior;

  -- Next sequence (within this (student, concept) namespace).
  SELECT COALESCE(MAX(attempt_sequence), 0) + 1
    INTO v_seq
    FROM public.concept_attempts
    WHERE student_id = p_student_id AND concept_id = p_concept_id;

  -- BKT compute.
  v_posterior := public.bkt_update(v_prior, p_correct);

  -- Resolve actor for the event row.
  SELECT auth_user_id INTO v_auth_user
    FROM public.students
    WHERE id = p_student_id;

  -- Persist the attempt. UNIQUE(attempt_id) catches duplicate submits.
  INSERT INTO public.concept_attempts (
    attempt_id, student_id, concept_id, attempt_sequence,
    served_at, answered_at, correct, chosen_index, response_time_ms,
    prior_mastery_mean, posterior_mastery_mean, status
  ) VALUES (
    p_attempt_id, p_student_id, p_concept_id, v_seq,
    p_occurred_at, p_occurred_at, p_correct, p_chosen_index, p_response_time_ms,
    v_prior, v_posterior, 'answered'
  );

  -- Publish in the same transaction. UNIQUE(idempotency_key) makes retries safe.
  INSERT INTO public.state_events (
    event_id, kind, actor_auth_user_id, idempotency_key, occurred_at, payload
  ) VALUES (
    p_event_id, 'learner.concept_check_answered', v_auth_user, p_idempotency_key,
    p_occurred_at,
    jsonb_build_object(
      'studentId', p_student_id, 'conceptId', p_concept_id,
      'attemptId', p_attempt_id, 'questionId', p_question_id,
      'correct', p_correct, 'chosenIndex', p_chosen_index,
      'responseTimeMs', p_response_time_ms,
      'occurredAt', p_occurred_at, 'attemptSequence', v_seq,
      'priorMasteryMean', v_prior, 'eventVersion', 1,
      'subjectCode', p_subject_code, 'chapterNumber', p_chapter_number
    )
  );

  RETURN QUERY SELECT v_seq, v_prior, v_posterior, p_event_id;
END $$;

-- service_role only.
REVOKE ALL ON FUNCTION public.tutor_commit_attempt FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tutor_commit_attempt TO service_role;
```

The RPC is the only path that writes to both `concept_attempts.status='answered'` AND `state_events`. They are atomic by Postgres transaction semantics.

**`ff_event_bus_v1` enforcement:** the route checks the flag before calling the RPC (the flag is consulted via the existing `isBusEnabled` cache in `publishEvent`'s module). If OFF, route skips the RPC and goes straight to legacy. The bus is publisher-controlled; the RPC trusts that the caller did the gate.

## Event payload schema

```ts
// src/lib/state/events/registry.ts (modify — add)
LearnerConceptCheckAnswered: {
  kind: 'learner.concept_check_answered',
  schema: z.object({
    studentId:        z.string().uuid(),
    conceptId:        z.string().uuid(),
    attemptId:        z.string().uuid(),
    questionId:       z.string(),  // `${conceptId}:practice:v1`
    correct:         z.boolean(),
    chosenIndex:     z.number().int().min(0).max(3),
    responseTimeMs:  z.number().int().nonnegative().nullable(),
    occurredAt:      z.string().datetime(),
    attemptSequence: z.number().int().positive(),
    priorMasteryMean: z.number().min(0).max(1),
    eventVersion:    z.literal(1),
    subjectCode:     z.string(),
    chapterNumber:   z.number().int().min(1),
  }),
}
```

## Schema

```sql
-- 20260522000003_concept_attempts_and_bkt.sql

CREATE TABLE IF NOT EXISTS public.concept_attempts (
  attempt_id              uuid         PRIMARY KEY,
  student_id              uuid         NOT NULL,
  concept_id              uuid         NOT NULL,
  attempt_sequence        int                   NULL,  -- assigned at answer time
  served_at               timestamptz  NOT NULL DEFAULT now(),
  answered_at             timestamptz           NULL,
  correct                 boolean               NULL,
  chosen_index            int                   NULL,
  response_time_ms        int                   NULL,
  prior_mastery_mean      numeric(5,4)          NULL,
  posterior_mastery_mean  numeric(5,4)          NULL,
  status                  text         NOT NULL DEFAULT 'reserved'
                            CHECK (status IN ('reserved','answered','excluded')),
  UNIQUE (student_id, concept_id, attempt_sequence)
);

CREATE INDEX IF NOT EXISTS idx_concept_attempts_chain_head
  ON public.concept_attempts (student_id, concept_id, attempt_sequence DESC)
  WHERE status = 'answered';

ALTER TABLE public.concept_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY concept_attempts_read_own ON public.concept_attempts
  FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid()));

-- Idempotency + roll-up on concept_mastery.
ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS last_attempt_id  uuid,
  ADD COLUMN IF NOT EXISTS bkt_version      int  NOT NULL DEFAULT 0;

-- Seed cursor for the new subscriber (don't replay history).
INSERT INTO public.subscriber_offsets (subscriber_name, kind_filter, last_processed_occurred_at)
VALUES ('concept-mastery-projector', 'learner.concept_check_answered', NOW())
ON CONFLICT (subscriber_name) DO NOTHING;
```

```sql
-- 20260522000004_ff_tutor_bkt_v1.sql
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, target_environments
)
VALUES (
  'ff_tutor_bkt_v1',
  'ADR-004 Phase 2 / ADR-005 Path C v2: /api/tutor/next returns attemptId; /api/tutor/answer calls atomic tutor_commit_attempt RPC; concept-mastery-projector writes canonical concept_mastery. Requires ff_event_bus_v1 AND ff_projector_runner_v1. See docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md',
  false, 0, ARRAY['production','staging']::text[]
)
ON CONFLICT (flag_name) DO NOTHING;
```

Timestamps provisional. PR 1 migrations (`20260522000001`, `20260522000002`) must apply first. The RPC `tutor_commit_attempt` and the `bkt_update` SQL function go into migration `20260522000003` alongside the table changes.

## Code changes

### `src/lib/state/subscribers/concept-mastery-projector.ts` (new, ~110 lines)

```ts
export const conceptMasteryProjector: Subscriber<'learner.concept_check_answered'> = {
  name: 'concept-mastery-projector',
  kind: 'learner.concept_check_answered',
  maxRetries: 3,
  studentIdFromEvent: (e) => e.payload.studentId,
  async handle(event, ctx) {
    const p = event.payload;
    const { data: existing } = await ctx.sb
      .from('concept_mastery')
      .select('last_attempt_id, total_correct, streak_current')
      .eq('student_id', p.studentId).eq('concept_id', p.conceptId)
      .maybeSingle();
    if (existing?.last_attempt_id === p.attemptId) return;  // idempotent

    const newMean = updateMasteryBKT(p.priorMasteryMean, p.correct);

    const { error } = await ctx.sb.from('concept_mastery').upsert({
      student_id: p.studentId, concept_id: p.conceptId,
      mastery_mean: newMean,
      last_attempt_id: p.attemptId,
      total_attempts: p.attemptSequence,
      total_correct: (existing?.total_correct ?? 0) + (p.correct ? 1 : 0),
      streak_current: p.correct ? (existing?.streak_current ?? 0) + 1 : 0,
      last_practiced_at: p.occurredAt,
      bkt_version: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'student_id,concept_id' });
    if (error) throw error;
  },
};
```

Register in `STANDARD_SUBSCRIBERS` next to the existing chapter-level writer.

### `src/app/api/tutor/next/route.ts` (modify, ~20 lines)

When `ff_tutor_bkt_v1` is ON: generate `attemptId = crypto.randomUUID()`, include it in the response. No DB write. When OFF: unchanged.

### `src/app/api/tutor/answer/route.ts` (modify, ~100 lines)

1. Body schema gains `attempt_id: z.string().uuid()` — required when `ff_tutor_bkt_v1` is ON.
2. Read all three flags up front.
3. **All on:** call `sb.rpc('tutor_commit_attempt', {...})`. On success, return optimistic. On any thrown error, log critical, INSERT `concept_attempts` with `status='excluded'`, fall through to legacy block.
4. **Legacy block:** Phase 0 inline naive `concept_mastery` UPSERT + return.

### `src/app/tutor/page.tsx` (modify, ~10 lines)

Pass `attemptId` from the `/next` response into the `/answer` POST body.

## Testing

### Unit — `bkt.test.ts`

Ten fixture rows above. Pure function. Deterministic.

### Unit — `bkt-sql.test.ts` (new, integration-style)

For ten random `(prior, correct)` pairs: invoke `bkt_update` via Supabase RPC + `updateMasteryBKT` in TS; assert values match within 1e-9.

### Unit — `concept-mastery-projector.test.ts`

Happy path, idempotency on `last_attempt_id`, determinism (route's RPC-returned posterior matches projector's recompute).

### Integration — `tutor-next.test.ts`

- Flag ON: returns `attemptId`, no DB rows written.
- Flag OFF: no `attemptId`.

### Integration — `tutor-answer.test.ts`

- Flag OFF parity: existing Phase 0 tests pass unchanged.
- Flag ON, single attempt correct: RPC writes attempt + event; response has `mastery_mean=0.693`, `optimistic=true`. After `tickAll`, `concept_mastery.mastery_mean=0.693`, `last_attempt_id` set, `bkt_version=1`.
- Flag ON, **concurrency test** (the critical fix): two `/next` calls return A1, A2. Two parallel `/answer` POSTs with `correct=true`. Assert: one transaction commits with `seq=1, prior=0.30, posterior=0.693`; the other with `seq=2, prior=0.693, posterior=0.918`. After `tickAll`, `concept_mastery.mastery_mean ≈ 0.918`, `total_attempts=2`.
- Flag ON, **duplicate `/answer` with same attemptId**: second call → RPC raises UNIQUE violation on `concept_attempts.attempt_id` → route catches → falls back as if RPC failed → returns 409 with structured `{ error: 'already_answered' }`. (The fallback `concept_attempts.status='excluded'` insertion ALSO fails the UNIQUE, so no excluded ghost row is created.)
- Flag ON, **injected RPC failure**: mock RPC to throw. Route INSERTs `concept_attempts { status='excluded' }`, runs legacy `concept_mastery` UPSERT, captures `tutor_answer_path_c_fallback`. Verify chain head reads skip the excluded row (next attempt chains correctly off the prior answered row, or off `concept_mastery.mean` which now reflects the legacy write).
- Flag ON, **`ff_event_bus_v1` OFF**: route doesn't call the RPC; runs legacy path immediately; no event published; no `concept_attempts` row.
- Flag ON, projector **idempotency**: run `tickAll` twice; second run skips events whose `attemptId` already matches `last_attempt_id`.

### Playwright E2E — `tutor-bkt.spec.ts`

Log in, flag ON, answer 2 corrects on G7 maths concept #1, refresh, assert UI shows `mastered=true`.

## Rollout

1. Merge PR 2 with `ff_tutor_bkt_v1` default OFF. PR 1 already at 100% in production.
2. Flip flag ON for CEO account only.
3. CEO walks `/tutor`. Verify:
   - `/next` response contains `attemptId`.
   - `/answer` returns `optimistic: true, path: 'c'`.
   - `concept_attempts` row inserted with `status='answered'`.
   - Within ≤ 1 minute, `concept_mastery.mastery_mean` matches the optimistic response.
4. 10% canary on `student` role. Monitor:
   - `subscriber_lag` for `concept-mastery-projector` (alert > 5 min)
   - `tutor_answer_path_c_fallback` PostHog event (any non-zero in production is critical)
   - `subscriber_dead_letters` for the new subscriber (alert > 0)
   - `concept_attempts` ratio of `status='answered'` vs `status='excluded'` (>99% answered expected)
5. 100% rollout once content covers a full grade and metrics are clean.
6. Follow-up PR (one week post-100%) deletes the legacy inline naive-write path.

## Observability

- Existing `tutor_answer_recorded` PostHog event continues to fire with `new_mastery_mean`.
- New PostHog `concept_mastery_projected` from the projector with `prior`, `posterior`, `attempt_id`, `lag_ms` — lets us chart projector lag and compare route's optimistic vs projector's canonical.
- New PostHog `tutor_answer_path_c_fallback` whenever the route falls back. **Zero in steady state.** Alert thresholds: warn at 1/min, page at 1/sec.
- `concept_attempts` table queryable: per-student attempt chain inspection.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RPC and TS BKT diverge | Low | High | Cross-runtime test (`bkt-sql.test.ts`) verifies parity within 1e-9. |
| Advisory lock contention slows the route | Low | Low | Per-(student, concept) scope; lock held for ms. Stress test in staging soak. |
| Projector lag visible to students | Med | Low | Route returns optimistic value; chain reads from `concept_attempts` not `concept_mastery`. |
| Path-C fallback rate elevated | Med | Med | Alert on `tutor_answer_path_c_fallback`; root-cause rather than tolerate. |
| Naive `bkt_version=0` rows look mastered | Med | Low | First Path-C attempt chains off `concept_mastery.mean` (the naive value); future attempts then reflect BKT. Flag `bkt_version=0` rows in analytics. |
| Orphan `concept_attempts` reserved rows | N/A | — | No reservations in this design — `/next` doesn't write. The status enum has `reserved` for forward compat but no code writes it. |
| RPC raises on `state_events` UNIQUE (duplicate idempotency_key) | Very Low | Low | Route generates a fresh `idempotency_key = 'tutor.answer.' + attemptId` per call; duplicates only on retry, which then becomes attempt-id duplicate handled above. |

## File-by-file change list

| File | Action | Approx size |
|---|---|---|
| `src/lib/tutor/bkt.ts` | new | ~80 lines |
| `src/lib/tutor/bkt.test.ts` | new | ~140 lines |
| `src/lib/tutor/bkt-sql.test.ts` | new (cross-runtime parity) | ~80 lines |
| `src/lib/state/subscribers/concept-mastery-projector.ts` | new | ~110 lines |
| `src/lib/state/subscribers/concept-mastery-projector.test.ts` | new | ~120 lines |
| `src/lib/state/subscribers/dispatcher.ts` | modify (register new subscriber) | ~3 lines |
| `src/lib/state/events/registry.ts` | modify (add `LearnerConceptCheckAnswered`) | ~25 lines |
| `src/app/api/tutor/next/route.ts` | modify (attemptId in response under flag) | ~20 lines |
| `src/app/api/tutor/next/route.test.ts` | modify | ~50 lines added |
| `src/app/api/tutor/answer/route.ts` | modify (Path C v2 + RPC call + fallback) | ~120 lines changed |
| `src/app/api/tutor/answer/route.test.ts` | modify (concurrency + RPC-fail tests) | ~200 lines added |
| `src/app/tutor/page.tsx` | modify (thread attemptId) | ~10 lines |
| `supabase/migrations/20260522000003_concept_attempts_and_bkt.sql` | new (table, RLS, RPC, `bkt_update` fn) | ~140 lines |
| `supabase/migrations/20260522000004_ff_tutor_bkt_v1.sql` | new | ~15 lines |
| `tests/e2e/tutor-bkt.spec.ts` | new | ~50 lines |
| `docs/architecture/ADR-004-adaptive-tutor.md` | annotate Phase 2 row with shipped link + Path C v2 note | 2 lines |

Estimated effort: ~3 days including tests. Depends on PR 1 in production.

## Definition of done

- All new tests pass; existing tutor tests still pass with flag OFF.
- SQL `bkt_update` matches TS `updateMasteryBKT` to 1e-9 on the parity test.
- Migrations apply cleanly in staging.
- Manual smoke (staging) with all three flags ON:
  - Two correct answers from fresh chain → optimistic posterior in `/answer` response = `concept_mastery.mastery_mean` after `tickAll` ≈ 0.918.
  - Concurrency test (two parallel `/answer` POSTs) results in `concept_attempts` rows with sequences 1 and 2 and the chain head's posterior is 0.918.
  - Injected RPC failure produces a `status='excluded'` `concept_attempts` row + a legacy `concept_mastery` write + a `tutor_answer_path_c_fallback` PostHog event.
- `subscriber_lag` for `concept-mastery-projector` < 2 min p99 in staging soak.
- `tutor_answer_path_c_fallback` rate = 0 in steady-state staging soak.
- PR follows P14 review chain: ai-engineer, backend, ops, testing.

## References

- [ADR-005 — Spine](../../architecture/ADR-005-concept-first-adaptive-learning-spine.md)
- [ADR-004 — Adaptive Tutor](../../architecture/ADR-004-adaptive-tutor.md)
- [State Runtime Hardening (PR 1)](./2026-05-12-projector-substrate-design.md)
- Corbett & Anderson 1995. *Knowledge tracing.* UMUAI 4.
- Existing runtime files cited in PR 1 spec.
