# ADR-004 Phase 2 — BKT via concept-mastery-projector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 naive `concept_mastery` write with an event-sourced Path C v2: `/api/tutor/answer` calls an atomic Postgres RPC `tutor_commit_attempt` that writes a `concept_attempts` row and publishes a `learner.concept_check_answered` event in one transaction (per-(student,concept) advisory lock); a new `concept-mastery-projector` subscriber consumes those events and is the canonical writer of `concept_mastery`.

**Architecture:** Three-flag gate (`ff_event_bus_v1 && ff_projector_runner_v1 && ff_tutor_bkt_v1`). When ON, route invokes RPC and returns optimistic BKT posterior; chain head reads `concept_attempts.posterior_mastery_mean` so concurrent answers chain correctly. When OFF or RPC fails, route falls back to Phase 0 naive inline `concept_mastery` write (and inserts `concept_attempts { status: 'excluded' }` so the audit trail is preserved). Projector recomputes BKT from the event's `priorMasteryMean` → byte-identical to RPC's compute → deterministic projection.

**Tech Stack:** Next.js App Router routes (TypeScript), Supabase Postgres + plpgsql RPC, Zod-validated event payloads, vitest unit/integration tests, Playwright E2E. Reuses PR 1 substrate (`subscriber_offsets`, `subscriber_retry_state`, `tickAll` runtime, Edge Function).

**Spec:** [docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md](../specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md)

**Branch:** `feat/adr-004-phase-2-bkt-projector` (off `main` at 837db714, PR 1 merged).

**Flag:** `ff_tutor_bkt_v1` (new, default OFF on production+staging).

---

## Pre-discovered constraints

These shape multiple tasks below — read once, then move on.

### Schema reality check

Production `public.concept_mastery` (from baseline) has the **legacy** schema keyed by `topic_id` with `mastery_probability`. The Phase 0 route at `src/app/api/tutor/answer/route.ts` writes the **new** schema (`concept_id`, `mastery_mean`, `last_practiced_at`, `total_attempts`, `total_correct`, `streak_current`, `updated_at`) — but **no migration has added those columns to production**. The Phase 0 flag `ff_tutor_v1` is OFF in production, so this code path has never fired and never noticed. PR 2 is the first PR that requires the new columns to actually exist.

**Decision:** PR 2 adds the missing columns to `public.concept_mastery` via `ADD COLUMN IF NOT EXISTS`, plus a `UNIQUE (student_id, concept_id)` constraint (required for the upsert's `onConflict`). Legacy columns (`topic_id`, `mastery_probability`, BKT params `p_know/p_learn/p_guess/p_slip`, etc.) stay untouched — legacy RPCs that reference them continue to work.

### Substrate already exists

PR 1 shipped these in `supabase/migrations/20260524110001_state_runtime_per_subscriber.sql`:
- Tables: `subscriber_offsets`, `subscriber_retry_state`, `subscriber_dead_letters`
- View: `subscriber_lag`
- Flags: `ff_projector_runner_v1` (kill-switch, default OFF) and `ff_event_bus_v1` (existing)
- Seed row: `subscriber_offsets` for `mastery-state-writer`

PR 1 also shipped the runtime in `src/lib/state/runtime/{offsets,retry-state,flag,tick-one,tick-all,event-listener}.ts` and Deno copies in `supabase/functions/_shared/state-runtime/`. PR 2 adds **one new subscriber** to that substrate and **one new event kind** to the registry — does not modify the substrate.

### Deno copy pattern

`supabase/functions/_shared/state-runtime/` is the Deno-side copy of `src/lib/state/{runtime,subscribers,events}/`. The Edge Function `projector-runner` imports from there. Any new subscriber MUST exist in BOTH locations. The cross-runtime parity is verified by a registry-shape test in `src/__tests__/state/`.

### Event bus name

Production writes events to `public.state_events` (renamed from `public.domain_events` in migration `20260521100000_state_events_bus_rename.sql` because prod had a legacy outbox at the original name). All references in code already use `state_events`.

---

## File Structure

```
docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md   (existing)
docs/superpowers/plans/2026-05-12-adr-004-phase-2-bkt-projector.md          (this file)

supabase/migrations/
  20260525100000_adr_004_phase_2_bkt_schema.sql                              NEW
  20260525100001_adr_004_phase_2_bkt_rpc.sql                                 NEW
  20260525100002_ff_tutor_bkt_v1.sql                                         NEW

src/lib/tutor/
  bkt.ts                                                                     NEW
  bkt.test.ts                                                                NEW
  bkt-sql.integration.test.ts                                                NEW   (cross-runtime parity)
  types.ts                                                                   MODIFY (add optional attempt_id to TutorNextResponse)

src/lib/state/events/
  registry.ts                                                                MODIFY (+LearnerConceptCheckAnswered)

src/lib/state/subscribers/
  concept-mastery-projector.ts                                               NEW
  concept-mastery-projector.test.ts                                          NEW
  dispatcher.ts                                                              MODIFY (+1 line registration)

supabase/functions/_shared/state-runtime/
  events-registry.ts                                                         MODIFY (mirror registry change)
  concept-mastery-projector.ts                                               NEW (Deno copy)
  dispatcher.ts                                                              MODIFY (mirror registration)

src/app/api/tutor/next/route.ts                                              MODIFY (+attemptId under flag)
src/app/api/tutor/next/route.test.ts                                         NEW
src/app/api/tutor/answer/route.ts                                            MODIFY (Path C v2 + RPC + fallback)
src/app/api/tutor/answer/route.test.ts                                       NEW
src/app/tutor/page.tsx                                                       MODIFY (thread attemptId)

tests/e2e/tutor-bkt.spec.ts                                                  NEW

docs/architecture/ADR-004-adaptive-tutor.md                                  MODIFY (Phase 2 row update)
```

Estimated effort: ~14 tasks, mostly mechanical; review checkpoints add re-loops.

---

### Task 1: Pure BKT function in TypeScript

**Files:**
- Create: `src/lib/tutor/bkt.ts`
- Create: `src/lib/tutor/bkt.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/tutor/bkt.test.ts
import { describe, it, expect } from 'vitest';
import { updateMasteryBKT, DEFAULT_BKT_PARAMS } from './bkt';

describe('updateMasteryBKT', () => {
  it('first-correct from default prior → 0.693 ±0.005', () => {
    expect(updateMasteryBKT(0.30, true)).toBeCloseTo(0.693, 2);
  });
  it('first-wrong from default prior → 0.146 ±0.005', () => {
    expect(updateMasteryBKT(0.30, false)).toBeCloseTo(0.146, 2);
  });
  it('correct on mastered (0.95) → 0.990 ±0.002', () => {
    expect(updateMasteryBKT(0.95, true)).toBeCloseTo(0.990, 2);
  });
  it('wrong on mastered (0.95) → 0.733 ±0.005', () => {
    expect(updateMasteryBKT(0.95, false)).toBeCloseTo(0.733, 2);
  });
  it('converges above 0.97 after 5 corrects from default', () => {
    let p = 0.30;
    for (let i = 0; i < 5; i++) p = updateMasteryBKT(p, true);
    expect(p).toBeGreaterThan(0.97);
  });
  it('drops below 0.20 after 10 wrongs from 0.95', () => {
    let p = 0.95;
    for (let i = 0; i < 10; i++) p = updateMasteryBKT(p, false);
    expect(p).toBeLessThan(0.20);
  });
  it('crosses 0.85 after 2 corrects from default', () => {
    let p = 0.30;
    p = updateMasteryBKT(p, true);
    p = updateMasteryBKT(p, true);
    expect(p).toBeGreaterThanOrEqual(0.85);
  });
  it('idempotent (pure function) — same inputs → same output', () => {
    const a = updateMasteryBKT(0.42, true);
    const b = updateMasteryBKT(0.42, true);
    expect(a).toBe(b);
  });
  it('clamps upper — prior=1.0 + correct stays below 1', () => {
    const r = updateMasteryBKT(1.0, true);
    expect(r).toBeLessThan(1);
  });
  it('clamps lower — prior=0.0 + wrong stays above 0', () => {
    const r = updateMasteryBKT(0.0, false);
    expect(r).toBeGreaterThan(0);
  });
  it('exposes DEFAULT_BKT_PARAMS with the documented values', () => {
    expect(DEFAULT_BKT_PARAMS).toEqual({ pInit: 0.30, pTransit: 0.10, pGuess: 0.20, pSlip: 0.10 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tutor/bkt.test.ts`
Expected: FAIL — module `./bkt` does not exist.

- [ ] **Step 3: Implement bkt.ts**

```ts
// src/lib/tutor/bkt.ts
/**
 * Bayesian Knowledge Tracing (BKT) — Corbett & Anderson 1995.
 *
 * Given a prior P(L_t) that the student knows the concept and an observation
 * (correct/wrong), returns the posterior P(L_{t+1}).
 *
 * Parameters mirror the ones used by the SQL `bkt_update` function — both
 * implementations are verified equal to 1e-9 in bkt-sql.integration.test.ts.
 *
 * Why parameters are global (not per-concept) in Phase 2: calibration is
 * Phase 2.1. Until we have interaction data, the literature consensus
 * (pInit=0.30, pTransit=0.10, pGuess=0.20, pSlip=0.10) is what we use.
 */

export interface BKTParams {
  pInit: number;
  pTransit: number;
  pGuess: number;
  pSlip: number;
}

export const DEFAULT_BKT_PARAMS: BKTParams = {
  pInit: 0.30,
  pTransit: 0.10,
  pGuess: 0.20,
  pSlip: 0.10,
};

const EPSILON = 1e-6;

export function updateMasteryBKT(
  prior: number,
  correct: boolean,
  params: BKTParams = DEFAULT_BKT_PARAMS,
): number {
  const { pTransit, pGuess, pSlip } = params;
  // Clamp prior to avoid division-by-zero at extremes.
  const p = Math.max(EPSILON, Math.min(1 - EPSILON, prior));

  // P(L_t | obs) — Bayesian update given the observation.
  let postObs: number;
  if (correct) {
    postObs = (p * (1 - pSlip)) / ((p * (1 - pSlip)) + ((1 - p) * pGuess));
  } else {
    postObs = (p * pSlip) / ((p * pSlip) + ((1 - p) * (1 - pGuess)));
  }

  // P(L_{t+1}) — learning transition: a non-knowing student may have learned
  // during this interaction with probability pTransit.
  const result = postObs + (1 - postObs) * pTransit;

  // Final clamp so callers never see exactly 0 or 1.
  return Math.max(EPSILON, Math.min(1 - EPSILON, result));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tutor/bkt.test.ts`
Expected: PASS — all 11 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tutor/bkt.ts src/lib/tutor/bkt.test.ts
git commit -m "feat(tutor): pure BKT update function (ADR-004 Phase 2 / PR 2 step 1)"
```

---

### Task 2: Add LearnerConceptCheckAnswered to the event registry

**Files:**
- Modify: `src/lib/state/events/registry.ts`
- Modify: `supabase/functions/_shared/state-runtime/events-registry.ts` (mirror — keep in sync by hand)
- Modify: `src/__tests__/state/events-registry.test.ts` (the pinned shape test; if it doesn't exist yet, see Task 2a fallback)

- [ ] **Step 1: Add the schema in src/lib/state/events/registry.ts**

In the "Learner events" section (after `LearnerScanExtractedSchema`), add:

```ts
export const LearnerConceptCheckAnsweredSchema = EventBaseSchema.extend({
  kind: z.literal('learner.concept_check_answered'),
  payload: z.object({
    studentId:        uuidLike(),
    conceptId:        uuidLike(),
    attemptId:        uuidLike(),
    // `${conceptId}:practice:v1` in Phase 0/2; opens up for variant questions later.
    questionId:       z.string().min(1).max(200),
    correct:          z.boolean(),
    chosenIndex:      z.number().int().min(0).max(3),
    responseTimeMs:   z.number().int().nonnegative().nullable(),
    occurredAt:       isoDatetime(),
    attemptSequence:  z.number().int().positive(),
    priorMasteryMean: z.number().min(0).max(1),
    eventVersion:     z.literal(1),
    subjectCode:      z.string(),
    chapterNumber:    z.number().int().min(1),
  }),
});
```

Then add `LearnerConceptCheckAnsweredSchema` to the `DomainEventSchema = z.discriminatedUnion('kind', [...])` array (slot it next to the other `learner.*` schemas, before the AI/Foxy block).

Then add `'learner.concept_check_answered'` to the `ALL_EVENT_KINDS` readonly array (same slot — before the AI block).

- [ ] **Step 2: Mirror the change to the Deno copy**

Open `supabase/functions/_shared/state-runtime/events-registry.ts` and apply the same three edits (schema definition, union member, ALL_EVENT_KINDS entry).

- [ ] **Step 3: Pin the registry shape**

If `src/__tests__/state/events-registry.test.ts` does not exist, create it as:

```ts
// src/__tests__/state/events-registry.test.ts
import { describe, it, expect } from 'vitest';
import { ALL_EVENT_KINDS } from '@/lib/state/events/registry';
import { ALL_EVENT_KINDS as DENO_KINDS } from '../../../supabase/functions/_shared/state-runtime/events-registry';

describe('events registry parity', () => {
  it('Node + Deno copies expose the same ALL_EVENT_KINDS list', () => {
    expect([...DENO_KINDS].sort()).toEqual([...ALL_EVENT_KINDS].sort());
  });

  it('includes learner.concept_check_answered (Phase 2 BKT)', () => {
    expect(ALL_EVENT_KINDS).toContain('learner.concept_check_answered');
  });
});
```

If it does exist, only add the `expect(...).toContain('learner.concept_check_answered')` assertion (don't duplicate the parity check).

- [ ] **Step 4: Run the registry tests**

Run: `npx vitest run src/__tests__/state/events-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/events/registry.ts supabase/functions/_shared/state-runtime/events-registry.ts src/__tests__/state/events-registry.test.ts
git commit -m "feat(state): register learner.concept_check_answered event (ADR-004 Phase 2 / PR 2 step 2)"
```

---

### Task 3: Migration — concept_attempts table + concept_mastery columns + seed cursor

**Files:**
- Create: `supabase/migrations/20260525100000_adr_004_phase_2_bkt_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260525100000_adr_004_phase_2_bkt_schema.sql
--
-- ADR-004 Phase 2 / PR 2 of ADR-005 — schema for concept-mastery-projector.
--
-- Adds:
--   1. public.concept_attempts          NEW TABLE (per-attempt BKT chain log).
--   2. public.concept_mastery           NEW COLUMNS (concept_id, mastery_mean,
--                                       last_practiced_at, total_attempts,
--                                       total_correct, streak_current,
--                                       last_attempt_id, bkt_version, updated_at)
--                                       + UNIQUE (student_id, concept_id).
--   3. subscriber_offsets               SEED ROW for concept-mastery-projector
--                                       (cursor set to NOW() — don't replay
--                                       historical mastery_changed events).
--
-- Spec: docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md
--
-- Legacy concept_mastery columns (topic_id, mastery_probability, p_know etc.)
-- are NOT modified. Legacy RPCs that reference them continue to work.

-- ────────────────────────────────────────────────────────────────────
-- 1. concept_attempts
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.concept_attempts (
  attempt_id              uuid         PRIMARY KEY,
  student_id              uuid         NOT NULL,
  concept_id              uuid         NOT NULL,
  attempt_sequence        int                   NULL,    -- assigned at /answer time inside RPC
  served_at               timestamptz  NOT NULL DEFAULT now(),
  answered_at             timestamptz           NULL,
  correct                 boolean               NULL,
  chosen_index            int                   NULL,
  response_time_ms        int                   NULL,
  prior_mastery_mean      numeric(7,6)          NULL,
  posterior_mastery_mean  numeric(7,6)          NULL,
  status                  text         NOT NULL DEFAULT 'reserved'
                            CHECK (status IN ('reserved','answered','excluded')),
  created_at              timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT concept_attempts_seq_unique UNIQUE (student_id, concept_id, attempt_sequence)
);

COMMENT ON TABLE public.concept_attempts IS
  'Per-attempt BKT chain log (ADR-004 Phase 2 / ADR-005 Path C v2). '
  'The RPC tutor_commit_attempt inserts one row per /api/tutor/answer call '
  'with status=''answered''. The route inserts status=''excluded'' rows when '
  'the Path C path is unavailable (flag-off OR RPC failure) — preserves audit '
  'trail without participating in the BKT chain. The canonical learner state '
  'mastery_mean is rolled up onto public.concept_mastery by '
  'concept-mastery-projector.';

-- Hot-path index for the RPC's chain-head read.
CREATE INDEX IF NOT EXISTS idx_concept_attempts_chain_head
  ON public.concept_attempts (student_id, concept_id, attempt_sequence DESC)
  WHERE status = 'answered';

-- RLS — service_role has implicit access via Supabase. Students can read their
-- own attempts (used by an analytics surface in a later PR; harmless to have now).
ALTER TABLE public.concept_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS concept_attempts_read_own ON public.concept_attempts;
CREATE POLICY concept_attempts_read_own
  ON public.concept_attempts
  FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS concept_attempts_service_role_all ON public.concept_attempts;
CREATE POLICY concept_attempts_service_role_all
  ON public.concept_attempts
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────
-- 2. concept_mastery — ADD the new Phase-0/Phase-2 columns
-- ────────────────────────────────────────────────────────────────────
-- The legacy table from baseline_from_prod.sql is keyed by (student_id,
-- topic_id) with mastery_probability. Phase 0's /api/tutor/answer route
-- writes (student_id, concept_id) → mastery_mean. Those columns never
-- shipped (flag stayed OFF). PR 2 adds them via ADD COLUMN IF NOT EXISTS
-- so existing rows + legacy RPCs are untouched.

ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS concept_id         uuid,
  ADD COLUMN IF NOT EXISTS mastery_mean       numeric(7,6),
  ADD COLUMN IF NOT EXISTS last_practiced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS total_attempts     int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_correct      int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_current     int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_id    uuid,
  ADD COLUMN IF NOT EXISTS bkt_version        int          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz  NOT NULL DEFAULT now();

-- UNIQUE constraint required for the route + projector upsert's onConflict.
-- Conditional creation — only add if not already present.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'concept_mastery_student_concept_unique'
       AND conrelid = 'public.concept_mastery'::regclass
  ) THEN
    -- Only enforce uniqueness on rows where concept_id IS NOT NULL.
    -- Legacy rows have concept_id NULL and are not covered — they live
    -- under the legacy topic_id-keyed access path.
    EXECUTE 'CREATE UNIQUE INDEX concept_mastery_student_concept_unique
             ON public.concept_mastery (student_id, concept_id)
             WHERE concept_id IS NOT NULL';
  END IF;
END $do$;

COMMENT ON COLUMN public.concept_mastery.concept_id IS
  'ADR-004 / ADR-005 Path C v2 — new key alongside legacy topic_id. The '
  'concept-mastery-projector upserts on (student_id, concept_id).';
COMMENT ON COLUMN public.concept_mastery.mastery_mean IS
  'BKT posterior mean in [0,1]. Written by concept-mastery-projector from '
  'learner.concept_check_answered events; matches the optimistic value '
  'returned by /api/tutor/answer once the projector catches up.';
COMMENT ON COLUMN public.concept_mastery.last_attempt_id IS
  'Idempotency anchor for concept-mastery-projector: if equals event.payload.attemptId, the projector skips (no-op).';
COMMENT ON COLUMN public.concept_mastery.bkt_version IS
  '0 = Phase 0 naive write; 1 = Phase 2 BKT write. Lets analytics distinguish.';

-- ────────────────────────────────────────────────────────────────────
-- 3. Seed cursor for the new subscriber
-- ────────────────────────────────────────────────────────────────────
-- last_processed_occurred_at = NOW() so the new subscriber doesn't replay
-- historical events (there shouldn't be any of this kind yet, but be safe).
-- The substrate runtime treats events with occurred_at > cursor as pending.
INSERT INTO public.subscriber_offsets (subscriber_name, kind_filter, last_processed_occurred_at)
VALUES ('concept-mastery-projector', 'learner.concept_check_answered', now())
ON CONFLICT (subscriber_name) DO NOTHING;
```

- [ ] **Step 2: Apply the migration locally (or verify SQL parses) — optional but recommended**

If a local Supabase DB is running:
Run: `npx supabase db reset` (or `npx supabase db push` depending on setup)
Expected: migration applies cleanly. No errors.

If no local DB: visually inspect that every `IF NOT EXISTS` / `IF NOT EXISTS` guard is in place. The migration must be safely re-runnable on a database that has already had it applied.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525100000_adr_004_phase_2_bkt_schema.sql
git commit -m "feat(db): concept_attempts table + concept_mastery BKT columns (ADR-004 Phase 2 / PR 2 step 3)"
```

---

### Task 4: Migration — bkt_update SQL function + tutor_commit_attempt RPC

**Files:**
- Create: `supabase/migrations/20260525100001_adr_004_phase_2_bkt_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260525100001_adr_004_phase_2_bkt_rpc.sql
--
-- ADR-004 Phase 2 / PR 2 of ADR-005 — atomic RPC + BKT SQL function.
--
-- Adds:
--   1. public.bkt_update            IMMUTABLE SQL function — must produce
--                                   the same numeric result as the TS
--                                   updateMasteryBKT (within 1e-9). The
--                                   parity is verified by
--                                   src/lib/tutor/bkt-sql.integration.test.ts.
--
--   2. public.tutor_commit_attempt  The atomic RPC that:
--                                     a. takes pg_advisory_xact_lock per
--                                        (student, concept)
--                                     b. reads chain head → fallback to
--                                        concept_mastery.mastery_mean
--                                        → DEFAULT pInit=0.30
--                                     c. computes posterior via bkt_update
--                                     d. INSERTs concept_attempts (answered)
--                                     e. INSERTs state_events for
--                                        learner.concept_check_answered
--                                     f. returns (seq, prior, posterior, event_id)
--
-- Both INSERTs in the RPC are inside one Postgres transaction. Failure
-- leaves the database untouched; the route's catch block then INSERTs a
-- concept_attempts row with status='excluded' (a separate, idempotent
-- statement outside the failed transaction).

-- ────────────────────────────────────────────────────────────────────
-- 1. bkt_update — pure SQL mirror of updateMasteryBKT()
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bkt_update(
  p_prior     numeric,
  p_correct   boolean,
  p_p_init    numeric DEFAULT 0.30,
  p_p_transit numeric DEFAULT 0.10,
  p_p_guess   numeric DEFAULT 0.20,
  p_p_slip    numeric DEFAULT 0.10
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p          numeric;
  v_post_obs   numeric;
  v_result     numeric;
  v_epsilon    constant numeric := 1e-6;
BEGIN
  -- Suppress unused parameter warning. p_p_init exists for API symmetry
  -- with TS DEFAULT_BKT_PARAMS; the algorithm itself doesn't reference it.
  PERFORM p_p_init;

  -- Clamp prior away from {0,1} to avoid div-by-zero at extremes.
  v_p := GREATEST(v_epsilon, LEAST(1 - v_epsilon, p_prior));

  IF p_correct THEN
    v_post_obs := (v_p * (1 - p_p_slip)) /
                  ((v_p * (1 - p_p_slip)) + ((1 - v_p) * p_p_guess));
  ELSE
    v_post_obs := (v_p * p_p_slip) /
                  ((v_p * p_p_slip) + ((1 - v_p) * (1 - p_p_guess)));
  END IF;

  v_result := v_post_obs + (1 - v_post_obs) * p_p_transit;

  RETURN GREATEST(v_epsilon, LEAST(1 - v_epsilon, v_result));
END $$;

COMMENT ON FUNCTION public.bkt_update(numeric, boolean, numeric, numeric, numeric, numeric) IS
  'Pure BKT update — must match TS updateMasteryBKT within 1e-9. '
  'Cross-runtime parity verified by bkt-sql.integration.test.ts.';

REVOKE ALL ON FUNCTION public.bkt_update(numeric, boolean, numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bkt_update(numeric, boolean, numeric, numeric, numeric, numeric) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 2. tutor_commit_attempt — atomic answer+publish under advisory lock
-- ────────────────────────────────────────────────────────────────────
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
  attempt_sequence       int,
  prior_mastery_mean     numeric,
  posterior_mastery_mean numeric,
  event_id               uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prior      numeric;
  v_seq        int;
  v_posterior  numeric;
  v_auth_user  uuid;
BEGIN
  -- Per-(student,concept) lock held until COMMIT. Concurrent answers
  -- serialize through this; out-of-order answers chain in commit order.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_student_id::text || ':' || p_concept_id::text)
  );

  -- Chain head: latest answered attempt's posterior → fallback to
  -- concept_mastery.mastery_mean (the Phase 0 naive value if any) →
  -- DEFAULT_BKT_PARAMS.pInit (0.30).
  SELECT COALESCE(
    (SELECT posterior_mastery_mean
       FROM public.concept_attempts
      WHERE student_id = p_student_id
        AND concept_id = p_concept_id
        AND status = 'answered'
      ORDER BY attempt_sequence DESC
      LIMIT 1),
    (SELECT mastery_mean
       FROM public.concept_mastery
      WHERE student_id = p_student_id
        AND concept_id = p_concept_id),
    0.30
  ) INTO v_prior;

  -- Next attempt_sequence within this (student, concept) namespace.
  -- Counts answered + excluded rows so excluded sequence numbers stay
  -- monotonic — chain-head reads filter on status='answered' anyway.
  SELECT COALESCE(MAX(attempt_sequence), 0) + 1
    INTO v_seq
    FROM public.concept_attempts
   WHERE student_id = p_student_id
     AND concept_id = p_concept_id;

  v_posterior := public.bkt_update(v_prior, p_correct);

  -- Resolve actor_auth_user_id for the event envelope. Students table is
  -- the only place that links student_id → auth.users.id.
  SELECT auth_user_id INTO v_auth_user
    FROM public.students
   WHERE id = p_student_id;

  IF v_auth_user IS NULL THEN
    RAISE EXCEPTION
      'tutor_commit_attempt: no student row for student_id=%, refusing to publish event without actor',
      p_student_id;
  END IF;

  -- Append the chain row.
  INSERT INTO public.concept_attempts (
    attempt_id, student_id, concept_id, attempt_sequence,
    served_at, answered_at, correct, chosen_index, response_time_ms,
    prior_mastery_mean, posterior_mastery_mean, status
  ) VALUES (
    p_attempt_id, p_student_id, p_concept_id, v_seq,
    p_occurred_at, p_occurred_at, p_correct, p_chosen_index, p_response_time_ms,
    v_prior, v_posterior, 'answered'
  );

  -- Publish the event in the same transaction. UNIQUE(idempotency_key) on
  -- state_events makes retries safe.
  INSERT INTO public.state_events (
    event_id, kind, actor_auth_user_id, tenant_id, idempotency_key,
    occurred_at, payload
  ) VALUES (
    p_event_id, 'learner.concept_check_answered', v_auth_user, NULL,
    p_idempotency_key, p_occurred_at,
    jsonb_build_object(
      'studentId',        p_student_id,
      'conceptId',        p_concept_id,
      'attemptId',        p_attempt_id,
      'questionId',       p_question_id,
      'correct',          p_correct,
      'chosenIndex',      p_chosen_index,
      'responseTimeMs',   p_response_time_ms,
      'occurredAt',       to_char(p_occurred_at AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'attemptSequence',  v_seq,
      'priorMasteryMean', v_prior,
      'eventVersion',     1,
      'subjectCode',      p_subject_code,
      'chapterNumber',    p_chapter_number
    )
  );

  RETURN QUERY SELECT v_seq, v_prior, v_posterior, p_event_id;
END $$;

COMMENT ON FUNCTION public.tutor_commit_attempt IS
  'ADR-004 Phase 2 / ADR-005 Path C v2 — atomic answer commit. Holds '
  'pg_advisory_xact_lock per (student, concept), reads chain head, computes '
  'BKT posterior, inserts concept_attempts row + state_events row in one '
  'transaction. service_role only.';

REVOKE ALL ON FUNCTION public.tutor_commit_attempt FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_commit_attempt TO service_role;
```

- [ ] **Step 2: Apply locally if possible**

Run: `npx supabase db push` (or equivalent)
Expected: migration applies. Verify both functions exist:

```sql
SELECT proname FROM pg_proc WHERE proname IN ('bkt_update','tutor_commit_attempt');
-- Expected: two rows.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525100001_adr_004_phase_2_bkt_rpc.sql
git commit -m "feat(db): bkt_update SQL fn + tutor_commit_attempt RPC (ADR-004 Phase 2 / PR 2 step 4)"
```

---

### Task 5: Migration — ff_tutor_bkt_v1 feature flag

**Files:**
- Create: `supabase/migrations/20260525100002_ff_tutor_bkt_v1.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260525100002_ff_tutor_bkt_v1.sql
-- ADR-004 Phase 2 — the third-of-three flag gating the BKT path.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, target_environments
)
VALUES (
  'ff_tutor_bkt_v1',
  'ADR-004 Phase 2 / ADR-005 Path C v2: /api/tutor/next returns attemptId; '
  '/api/tutor/answer calls atomic tutor_commit_attempt RPC; '
  'concept-mastery-projector writes canonical concept_mastery.mastery_mean. '
  'Requires ff_event_bus_v1 AND ff_projector_runner_v1 also ON. '
  'See docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md.',
  false,
  0,
  ARRAY['production','staging']::text[]
)
ON CONFLICT (flag_name) DO NOTHING;
```

- [ ] **Step 2: Apply locally if possible**

Run: `npx supabase db push`
Expected: flag exists, default OFF.

```sql
SELECT flag_name, is_enabled FROM public.feature_flags WHERE flag_name = 'ff_tutor_bkt_v1';
-- Expected: ff_tutor_bkt_v1 | false
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525100002_ff_tutor_bkt_v1.sql
git commit -m "feat(db): ff_tutor_bkt_v1 flag, default OFF (ADR-004 Phase 2 / PR 2 step 5)"
```

---

### Task 6: Cross-runtime BKT parity test (TS vs SQL)

**Files:**
- Create: `src/lib/tutor/bkt-sql.integration.test.ts`

This test requires a running Supabase (local or staging) — it's the parity gate that catches drift between the two BKT implementations. If the integration runner is not wired (e.g. CI without Supabase), it should `describe.skip` based on an env flag and document that staging must run it pre-merge.

- [ ] **Step 1: Write the test**

```ts
// src/lib/tutor/bkt-sql.integration.test.ts
//
// Cross-runtime parity: SQL public.bkt_update vs TS updateMasteryBKT.
// Skipped automatically when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// unset (i.e. unit-only CI). Required pre-merge run is on staging via
// the integration suite.

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { updateMasteryBKT } from './bkt';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runIt = url && key ? describe : describe.skip;

runIt('bkt_update SQL fn ≡ updateMasteryBKT (within 1e-9)', () => {
  const sb = createClient(url!, key!, { auth: { persistSession: false } });

  const fixtures: Array<{ prior: number; correct: boolean }> = [
    { prior: 0.30, correct: true },
    { prior: 0.30, correct: false },
    { prior: 0.95, correct: true },
    { prior: 0.95, correct: false },
    { prior: 0.50, correct: true },
    { prior: 0.10, correct: false },
    { prior: 0.78, correct: true },
    { prior: 0.22, correct: false },
    { prior: 0.999, correct: true },
    { prior: 0.001, correct: false },
  ];

  for (const f of fixtures) {
    it(`parity prior=${f.prior} correct=${f.correct}`, async () => {
      const { data, error } = await sb.rpc('bkt_update', {
        p_prior: f.prior,
        p_correct: f.correct,
      });
      expect(error).toBeNull();
      const sqlValue = Number(data);
      const tsValue = updateMasteryBKT(f.prior, f.correct);
      expect(Math.abs(sqlValue - tsValue)).toBeLessThan(1e-9);
    });
  }
});
```

- [ ] **Step 2: If a local Supabase + the new migrations are in place, run it**

Run: `SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=... npx vitest run src/lib/tutor/bkt-sql.integration.test.ts`
Expected: PASS, 10/10 parity assertions within 1e-9.

If no local DB, skip (the `describe.skip` covers the unit-CI lane). Document in the PR description that staging must run it manually.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tutor/bkt-sql.integration.test.ts
git commit -m "test(tutor): SQL/TS BKT parity within 1e-9 (ADR-004 Phase 2 / PR 2 step 6)"
```

---

### Task 7: concept-mastery-projector subscriber (Node + Deno copies)

**Files:**
- Create: `src/lib/state/subscribers/concept-mastery-projector.ts`
- Create: `src/lib/state/subscribers/concept-mastery-projector.test.ts`
- Create: `supabase/functions/_shared/state-runtime/concept-mastery-projector.ts` (Deno copy)
- Modify: `src/lib/state/subscribers/dispatcher.ts` (register the subscriber)
- Modify: `supabase/functions/_shared/state-runtime/dispatcher.ts` (mirror)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/state/subscribers/concept-mastery-projector.test.ts
import { describe, it, expect, vi } from 'vitest';
import { conceptMasteryProjector } from './concept-mastery-projector';
import type { SubscriberContext } from './subscriber';
import type { DomainEvent } from '../events/registry';

function makeEvent(overrides: Partial<{ attemptId: string; prior: number; correct: boolean; seq: number }> = {}): DomainEvent {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-05-12T10:00:00.000Z',
    actorAuthUserId: '22222222-2222-4222-8222-222222222222',
    tenantId: null,
    idempotencyKey: 'tutor.answer.test',
    kind: 'learner.concept_check_answered',
    payload: {
      studentId:        '33333333-3333-4333-8333-333333333333',
      conceptId:        '44444444-4444-4444-8444-444444444444',
      attemptId:        overrides.attemptId ?? '55555555-5555-4555-8555-555555555555',
      questionId:       '44444444-4444-4444-8444-444444444444:practice:v1',
      correct:          overrides.correct ?? true,
      chosenIndex:      0,
      responseTimeMs:   1234,
      occurredAt:       '2026-05-12T10:00:00.000Z',
      attemptSequence:  overrides.seq ?? 1,
      priorMasteryMean: overrides.prior ?? 0.30,
      eventVersion:     1,
      subjectCode:      'math',
      chapterNumber:    1,
    },
  } as DomainEvent;
}

function makeCtx(opts: {
  existingRow?: { last_attempt_id: string | null; total_correct: number; streak_current: number } | null;
  upsertError?: Error | null;
}): { ctx: SubscriberContext; upsert: any } {
  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertError ?? null });
  const sb = {
    from(table: string) {
      if (table !== 'concept_mastery') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.existingRow ?? null, error: null }),
            }),
          }),
        }),
        upsert,
      };
    },
  } as unknown as SubscriberContext['sb'];
  return {
    ctx: { sb, dryRun: false, now: () => new Date('2026-05-12T10:00:00.000Z'), log: () => {} },
    upsert,
  };
}

describe('conceptMasteryProjector', () => {
  it('idempotent: skips upsert when existing row already records this attemptId', async () => {
    const event = makeEvent({ attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const { ctx, upsert } = makeCtx({
      existingRow: { last_attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', total_correct: 5, streak_current: 5 },
    });
    await conceptMasteryProjector.handle(event as any, ctx);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('happy path: recomputes posterior from event prior + upserts with correct fields', async () => {
    const event = makeEvent({ prior: 0.30, correct: true, seq: 1 });
    const { ctx, upsert } = makeCtx({ existingRow: null });
    await conceptMasteryProjector.handle(event as any, ctx);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'student_id,concept_id' });
    expect(payload.student_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(payload.concept_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(payload.last_attempt_id).toBe('55555555-5555-4555-8555-555555555555');
    expect(payload.total_attempts).toBe(1);
    expect(payload.total_correct).toBe(1);
    expect(payload.streak_current).toBe(1);
    expect(payload.bkt_version).toBe(1);
    // Posterior for prior=0.30, correct → ~0.693
    expect(payload.mastery_mean).toBeCloseTo(0.693, 2);
  });

  it('preserves total_correct + streak from existing when this attempt is correct', async () => {
    const event = makeEvent({ prior: 0.69, correct: true, seq: 2 });
    const { ctx, upsert } = makeCtx({
      existingRow: { last_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', total_correct: 3, streak_current: 3 },
    });
    await conceptMasteryProjector.handle(event as any, ctx);
    const [payload] = upsert.mock.calls[0];
    expect(payload.total_correct).toBe(4);
    expect(payload.streak_current).toBe(4);
  });

  it('resets streak_current to 0 on a wrong answer', async () => {
    const event = makeEvent({ prior: 0.69, correct: false, seq: 2 });
    const { ctx, upsert } = makeCtx({
      existingRow: { last_attempt_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', total_correct: 3, streak_current: 3 },
    });
    await conceptMasteryProjector.handle(event as any, ctx);
    const [payload] = upsert.mock.calls[0];
    expect(payload.total_correct).toBe(3);
    expect(payload.streak_current).toBe(0);
  });

  it('throws when upsert returns an error (caller retries via substrate)', async () => {
    const event = makeEvent();
    const { ctx } = makeCtx({ upsertError: new Error('connection lost') });
    await expect(conceptMasteryProjector.handle(event as any, ctx)).rejects.toThrow('connection lost');
  });

  it('exposes studentIdFromEvent → payload.studentId', () => {
    const event = makeEvent();
    expect(conceptMasteryProjector.studentIdFromEvent!(event as any))
      .toBe('33333333-3333-4333-8333-333333333333');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/state/subscribers/concept-mastery-projector.test.ts`
Expected: FAIL — module `./concept-mastery-projector` does not exist.

- [ ] **Step 3: Implement concept-mastery-projector.ts**

```ts
// src/lib/state/subscribers/concept-mastery-projector.ts
/**
 * concept-mastery-projector — ADR-004 Phase 2 / ADR-005 Path C v2.
 *
 * Canonical writer of public.concept_mastery for the new BKT path.
 * Consumes `learner.concept_check_answered` events published by the
 * atomic RPC tutor_commit_attempt and projects them into a roll-up row
 * keyed by (student_id, concept_id).
 *
 * Idempotency: skips the upsert if existing.last_attempt_id already
 * matches event.payload.attemptId.
 *
 * Determinism: recomputes posterior = updateMasteryBKT(event.priorMean,
 * event.correct). The event payload carries the prior, so this compute
 * is byte-identical to what the RPC computed → the projector cannot
 * disagree with the route's optimistic response.
 */

import { updateMasteryBKT } from '@/lib/tutor/bkt';
import type { Subscriber, SubscriberContext } from './subscriber';

export const conceptMasteryProjector: Subscriber<'learner.concept_check_answered'> = {
  name: 'concept-mastery-projector',
  kind: 'learner.concept_check_answered',
  maxRetries: 3,
  studentIdFromEvent(event) {
    return event.payload.studentId;
  },

  async handle(event, ctx: SubscriberContext) {
    const p = event.payload;

    const { data: existing } = await ctx.sb
      .from('concept_mastery')
      .select('last_attempt_id, total_correct, streak_current')
      .eq('student_id', p.studentId)
      .eq('concept_id', p.conceptId)
      .maybeSingle();

    if (existing?.last_attempt_id === p.attemptId) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'skipped',
        message: `attempt ${p.attemptId} already projected`,
      });
      return;
    }

    const newMean = updateMasteryBKT(p.priorMasteryMean, p.correct);

    const prevCorrect = (existing?.total_correct ?? 0) as number;
    const prevStreak = (existing?.streak_current ?? 0) as number;

    const { error } = await ctx.sb
      .from('concept_mastery')
      .upsert(
        {
          student_id:        p.studentId,
          concept_id:        p.conceptId,
          mastery_mean:      newMean,
          last_attempt_id:   p.attemptId,
          total_attempts:    p.attemptSequence,
          total_correct:     prevCorrect + (p.correct ? 1 : 0),
          streak_current:    p.correct ? prevStreak + 1 : 0,
          last_practiced_at: p.occurredAt,
          bkt_version:       1,
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'student_id,concept_id' },
      );

    if (error) {
      ctx.log({
        subscriber: this.name,
        eventKind: event.kind,
        eventId: event.eventId,
        outcome: 'error',
        message: error.message,
      });
      throw new Error(
        `concept-mastery-projector: upsert failed for ${event.eventId}: ${error.message}`,
      );
    }

    ctx.log({
      subscriber: this.name,
      eventKind: event.kind,
      eventId: event.eventId,
      outcome: 'ok',
      message: `mastery_mean=${newMean.toFixed(3)} seq=${p.attemptSequence}`,
    });
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/state/subscribers/concept-mastery-projector.test.ts`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Register the subscriber**

Edit `src/lib/state/subscribers/dispatcher.ts`:

- Add import after the `masteryStateWriter` import:
  ```ts
  import { conceptMasteryProjector } from './concept-mastery-projector';
  ```
- Add to `STANDARD_SUBSCRIBERS`:
  ```ts
  export const STANDARD_SUBSCRIBERS: ReadonlyArray<AnySubscriber> = [
    toAnySubscriber(masteryStateWriter),
    toAnySubscriber(conceptMasteryProjector),
  ];
  ```

- [ ] **Step 6: Mirror to Deno copy**

Copy `src/lib/state/subscribers/concept-mastery-projector.ts` to `supabase/functions/_shared/state-runtime/concept-mastery-projector.ts`, then rewrite the imports for Deno:

```ts
// supabase/functions/_shared/state-runtime/concept-mastery-projector.ts
//
// Deno-side copy of src/lib/state/subscribers/concept-mastery-projector.ts.
// Keep in sync by hand; cross-runtime parity is the registry test in
// src/__tests__/state/events-registry.test.ts.

import { updateMasteryBKT } from './bkt.ts'; // see Step 7 below
import type { Subscriber, SubscriberContext } from './subscriber.ts';

export const conceptMasteryProjector: Subscriber<'learner.concept_check_answered'> = {
  // (identical body to the Node version — copy verbatim)
  // …
};
```

Also create the Deno copy of `bkt.ts`: copy `src/lib/tutor/bkt.ts` to `supabase/functions/_shared/state-runtime/bkt.ts` (it has no imports, so just the file content).

Then edit `supabase/functions/_shared/state-runtime/dispatcher.ts` and add the subscriber to its `STANDARD_SUBSCRIBERS` (mirror the change exactly).

- [ ] **Step 7: Commit**

```bash
git add src/lib/state/subscribers/concept-mastery-projector.ts \
        src/lib/state/subscribers/concept-mastery-projector.test.ts \
        src/lib/state/subscribers/dispatcher.ts \
        supabase/functions/_shared/state-runtime/concept-mastery-projector.ts \
        supabase/functions/_shared/state-runtime/bkt.ts \
        supabase/functions/_shared/state-runtime/dispatcher.ts
git commit -m "feat(state): concept-mastery-projector subscriber (ADR-004 Phase 2 / PR 2 step 7)"
```

---

### Task 8: /api/tutor/next — return attemptId when flag ON

**Files:**
- Modify: `src/lib/tutor/types.ts`
- Modify: `src/app/api/tutor/next/route.ts`
- Create: `src/app/api/tutor/next/route.test.ts`

- [ ] **Step 1: Extend the response type**

In `src/lib/tutor/types.ts`, add `attemptId` to `TutorNextResponse`:

```ts
export interface TutorNextResponse {
  status: 'next_concept' | 'grade_complete' | 'no_content';
  concept?: TutorConceptRow;
  reason?:
    | 'first_unmastered_in_subject_order'
    | 'no_unmastered_concepts'
    | 'no_concepts_for_grade';
  progress?: { mastered: number; total: number };
  /** Phase 2 (ff_tutor_bkt_v1): a fresh UUID generated per /next call.
   *  Threaded into /answer's body so the atomic RPC can chain-head correctly.
   *  Omitted when the BKT flag is OFF. */
  attemptId?: string;
}
```

- [ ] **Step 2: Write the failing route test**

```ts
// src/app/api/tutor/next/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks (must mirror the route imports).
const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  resolveNextConcept: vi.fn(),
  capture: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/tutor/resolve-next-concept', () => ({ resolveNextConcept: mocks.resolveNextConcept }));
vi.mock('@/lib/posthog/server', () => ({ capture: mocks.capture }));

beforeEach(() => {
  mocks.isFeatureEnabled.mockReset();
  mocks.createSupabaseServerClient.mockReset();
  mocks.resolveNextConcept.mockReset();
  mocks.capture.mockReset();
});

function withSupabase(opts: { userId: string; studentId: string; grade: string; concepts: any[]; mastery: any[] }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: opts.userId } } }) },
    from(table: string) {
      if (table === 'students') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: opts.studentId, grade: opts.grade, preferred_language: 'en' }, error: null }) }) }) };
      if (table === 'chapter_concepts') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ order: () => ({ order: async () => ({ data: opts.concepts, error: null }) }) }) }) }) }) };
      if (table === 'concept_mastery') return { select: () => ({ eq: async () => ({ data: opts.mastery, error: null }) }) };
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

describe('GET /api/tutor/next attemptId behavior', () => {
  it('returns attemptId when ff_tutor_v1 AND ff_tutor_bkt_v1 are ON', async () => {
    mocks.isFeatureEnabled.mockImplementation(async (flag: string) => true);
    mocks.createSupabaseServerClient.mockResolvedValue(withSupabase({
      userId: 'u1', studentId: 's1', grade: '7', concepts: [], mastery: [],
    }));
    mocks.resolveNextConcept.mockReturnValue({ status: 'next_concept', concept: { id: 'c1' } });

    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/tutor/next'));
    const body = await res.json();

    expect(body.status).toBe('next_concept');
    expect(typeof body.attemptId).toBe('string');
    expect(body.attemptId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('omits attemptId when ff_tutor_bkt_v1 is OFF (legacy)', async () => {
    mocks.isFeatureEnabled.mockImplementation(async (flag: string) =>
      flag === 'ff_tutor_v1' ? true : false,
    );
    mocks.createSupabaseServerClient.mockResolvedValue(withSupabase({
      userId: 'u1', studentId: 's1', grade: '7', concepts: [], mastery: [],
    }));
    mocks.resolveNextConcept.mockReturnValue({ status: 'next_concept', concept: { id: 'c1' } });

    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/tutor/next'));
    const body = await res.json();

    expect(body.attemptId).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/app/api/tutor/next/route.test.ts`
Expected: FAIL — attemptId is missing.

- [ ] **Step 4: Modify the route**

In `src/app/api/tutor/next/route.ts`, add immediately after the existing `ff_tutor_v1` flag check (so when `ff_tutor_v1` is OFF, we still 404 the same way):

```ts
// Phase 2 flag — when ON, decorate the response with a fresh attemptId so
// /api/tutor/answer can pass it to the atomic RPC tutor_commit_attempt.
const bktFlagOn = await isFeatureEnabled('ff_tutor_bkt_v1', {
  userId,
  role: 'student',
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
});
```

Then, in the final `NextResponse.json(decision, { ... })`, attach the field:

```ts
const responseBody: TutorNextResponse = bktFlagOn
  ? { ...decision, attemptId: crypto.randomUUID() }
  : decision;

return NextResponse.json(responseBody, {
  headers: { 'Cache-Control': 'private, max-age=10' },
});
```

(Adjust the surrounding lines to keep the existing cache header and PostHog capture intact.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/api/tutor/next/route.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tutor/types.ts src/app/api/tutor/next/route.ts src/app/api/tutor/next/route.test.ts
git commit -m "feat(tutor): /next returns attemptId under ff_tutor_bkt_v1 (ADR-004 Phase 2 / PR 2 step 8)"
```

---

### Task 9: /api/tutor/answer — Path C v2 with RPC + fallback

**Files:**
- Modify: `src/app/api/tutor/answer/route.ts`
- Create: `src/app/api/tutor/answer/route.test.ts`

This is the most complex single task — the route has three flag-state branches and a critical fallback path. Implement carefully.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/tutor/answer/route.test.ts
//
// Covers:
//   - Flag-off parity (Phase 0 inline write unchanged)
//   - Flag-on happy path (RPC success → optimistic response)
//   - Flag-on RPC failure (fallback: status='excluded' + legacy write + posthog)
//   - Flag-on duplicate attemptId → 409 already_answered
//   - ff_event_bus_v1 OFF → skip RPC, legacy path

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  capture: vi.fn(),
  publishEvent: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock('@/lib/posthog/server', () => ({ capture: mocks.capture }));
vi.mock('@/lib/state/events/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() } }));

beforeEach(() => {
  for (const k of Object.keys(mocks)) {
    const v = (mocks as any)[k];
    if (typeof v?.mockReset === 'function') v.mockReset();
    if (typeof v === 'object' && v !== null) {
      for (const kk of Object.keys(v)) {
        if (typeof v[kk]?.mockReset === 'function') v[kk].mockReset();
      }
    }
  }
});

function setFlags(opts: { tutor: boolean; bkt: boolean; bus: boolean; projector: boolean }) {
  mocks.isFeatureEnabled.mockImplementation(async (flag: string) => {
    if (flag === 'ff_tutor_v1') return opts.tutor;
    if (flag === 'ff_tutor_bkt_v1') return opts.bkt;
    if (flag === 'ff_event_bus_v1') return opts.bus;
    if (flag === 'ff_projector_runner_v1') return opts.projector;
    return false;
  });
}

function setUser(userId: string) {
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from(table: string) {
      if (table === 'students') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'student-1' }, error: null }) }) }) };
      if (table === 'chapter_concepts') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'concept-1', subject: 'math', chapter_number: 1, difficulty: 2 }, error: null }) }) }) };
      throw new Error(`unexpected table: ${table}`);
    },
  });
}

function setAdminUpsert(result: { error: { message: string; code?: string } | null }) {
  const upsert = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({
    eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  });
  const insert = vi.fn().mockResolvedValue({ error: null });
  mocks.supabaseAdmin.from.mockImplementation((table: string) => {
    if (table === 'concept_mastery') return { upsert, select };
    if (table === 'concept_attempts') return { insert };
    throw new Error(`unexpected admin table: ${table}`);
  });
  return { upsert, insert };
}

const BODY = {
  attempt_id: '55555555-5555-4555-8555-555555555555',
  concept_id: '44444444-4444-4444-8444-444444444444',
  chosen_index: 0,
  correct: true,
  response_time_ms: 1200,
};

async function postBody(body: any) {
  const { POST } = await import('./route');
  return POST(new Request('http://localhost/api/tutor/answer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

describe('POST /api/tutor/answer Path C v2', () => {
  it('flag-off parity: writes via legacy upsert, no RPC, no event publish', async () => {
    setFlags({ tutor: true, bkt: false, bus: true, projector: true });
    setUser('user-1');
    const { upsert } = setAdminUpsert({ error: null });
    mocks.publishEvent.mockResolvedValue({ published: true });

    const res = await postBody({ ...BODY, attempt_id: undefined });
    const json = await res.json();

    expect(mocks.supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(json.optimistic ?? false).toBe(false);
    expect(json.path).toBe('legacy');
  });

  it('all flags ON: calls RPC and returns optimistic posterior', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');
    mocks.supabaseAdmin.from.mockReturnValue({}); // unused on success path
    mocks.supabaseAdmin.rpc.mockResolvedValue({
      data: [{ attempt_sequence: 1, prior_mastery_mean: 0.30, posterior_mastery_mean: 0.693, event_id: 'event-1' }],
      error: null,
    });

    const res = await postBody(BODY);
    const json = await res.json();

    expect(mocks.supabaseAdmin.rpc).toHaveBeenCalledWith('tutor_commit_attempt', expect.objectContaining({
      p_attempt_id: BODY.attempt_id,
      p_concept_id: BODY.concept_id,
      p_correct: true,
    }));
    expect(json.optimistic).toBe(true);
    expect(json.path).toBe('c');
    expect(json.mastery.mastery_mean).toBeCloseTo(0.693, 2);
    expect(json.mastery.attempts).toBe(1);
  });

  it('all flags ON, RPC throws: inserts excluded attempt + falls back to legacy + emits posthog', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');
    const { upsert, insert } = setAdminUpsert({ error: null });
    mocks.supabaseAdmin.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });

    const res = await postBody(BODY);
    const json = await res.json();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      attempt_id: BODY.attempt_id, status: 'excluded',
    }));
    expect(upsert).toHaveBeenCalledTimes(1); // legacy mastery write
    expect(json.optimistic).toBe(false);
    expect(json.path).toBe('legacy');
    expect(mocks.capture).toHaveBeenCalledWith('tutor_answer_path_c_fallback', 'user-1', expect.any(Object));
  });

  it('all flags ON, RPC returns UNIQUE violation on attempt_id: 409 already_answered', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');
    setAdminUpsert({ error: null });
    mocks.supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "concept_attempts_pkey"', code: '23505' },
    });

    const res = await postBody(BODY);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('already_answered');
  });

  it('all flags ON but ff_event_bus_v1 OFF: skips RPC, legacy path', async () => {
    setFlags({ tutor: true, bkt: true, bus: false, projector: true });
    setUser('user-1');
    const { upsert } = setAdminUpsert({ error: null });

    const res = await postBody(BODY);
    const json = await res.json();

    expect(mocks.supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(json.path).toBe('legacy');
  });

  it('rejects body without attempt_id when ff_tutor_bkt_v1 is ON', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');

    const res = await postBody({ ...BODY, attempt_id: undefined });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/tutor/answer/route.test.ts`
Expected: FAIL — the route doesn't implement Path C yet.

- [ ] **Step 3: Rewrite the route**

```ts
// src/app/api/tutor/answer/route.ts
/**
 * POST /api/tutor/answer — record a concept-check outcome.
 *
 * Flag matrix:
 *
 *   ff_tutor_v1     ff_tutor_bkt_v1  ff_event_bus_v1  ff_projector_runner_v1
 *   ──────────────────────────────────────────────────────────────────────
 *   OFF             —                —                —                       404 not_found
 *   ON              OFF              —                —                       Phase 0 legacy: naive concept_mastery upsert
 *   ON              ON               OFF              —                       Phase 0 legacy (bus required for Path C)
 *   ON              ON               ON               OFF                     Phase 0 legacy (projector required for Path C)
 *   ON              ON               ON               ON                      Path C v2 → atomic RPC
 *
 * Path C v2 flow:
 *   1. Validate body (attempt_id required when ff_tutor_bkt_v1 is ON).
 *   2. Call sb.rpc('tutor_commit_attempt', {…}) — atomic inside one Postgres
 *      transaction (advisory lock + concept_attempts insert + state_events
 *      insert + return seq/prior/posterior).
 *   3a. Success → return { ok, optimistic: true, path: 'c', mastery: {…} }.
 *   3b. UNIQUE-violation on attempt_id (23505) → return 409 already_answered.
 *   3c. Other failure → log critical, INSERT concept_attempts(status='excluded'),
 *       fall through to legacy block, emit tutor_answer_path_c_fallback.
 *
 * Why the legacy block stays: the rollback target. Removing it would mean
 * an RPC outage downgrades all student writes silently to /dev/null.
 *
 * ADR: docs/architecture/ADR-005-concept-first-adaptive-learning-spine.md
 * Spec: docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import { capture } from '@/lib/posthog/server';
import { MASTERY_THRESHOLD } from '@/lib/tutor/types';

export const dynamic = 'force-dynamic';

const TUTOR_FLAG = 'ff_tutor_v1';
const BKT_FLAG = 'ff_tutor_bkt_v1';
const BUS_FLAG = 'ff_event_bus_v1';
const PROJECTOR_FLAG = 'ff_projector_runner_v1';

const BodySchema = z.object({
  concept_id: z.string().uuid(),
  chosen_index: z.number().int().min(0).max(3),
  correct: z.boolean(),
  response_time_ms: z.number().int().nonnegative().optional(),
  attempt_id: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = userResult.user.id;
  const envHint = { userId, role: 'student' as const, environment: process.env.VERCEL_ENV || process.env.NODE_ENV };

  const tutorOn = await isFeatureEnabled(TUTOR_FLAG, envHint);
  if (!tutorOn) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: 'bad_request', detail: (err as Error).message.slice(0, 200) }, { status: 400 });
  }

  const [bktOn, busOn, projectorOn] = await Promise.all([
    isFeatureEnabled(BKT_FLAG, envHint),
    isFeatureEnabled(BUS_FLAG, envHint),
    isFeatureEnabled(PROJECTOR_FLAG, envHint),
  ]);

  if (bktOn && !body.attempt_id) {
    return NextResponse.json({ error: 'bad_request', detail: 'attempt_id required when ff_tutor_bkt_v1 is ON' }, { status: 400 });
  }

  // Look up student + concept (needed by all paths).
  const { data: studentRow } = await supabase
    .from('students').select('id').eq('auth_user_id', userId).maybeSingle();
  if (!studentRow) return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  const studentId = studentRow.id as string;

  const { data: conceptRow, error: cErr } = await supabase
    .from('chapter_concepts').select('id, subject, chapter_number, difficulty').eq('id', body.concept_id).maybeSingle();
  if (cErr || !conceptRow) return NextResponse.json({ error: 'concept_not_found' }, { status: 404 });

  // ── Path C v2 — atomic RPC ─────────────────────────────────────────
  const allFlagsOn = bktOn && busOn && projectorOn;
  if (allFlagsOn) {
    const occurredAt = new Date().toISOString();
    const rpcArgs = {
      p_attempt_id: body.attempt_id!,
      p_student_id: studentId,
      p_concept_id: body.concept_id,
      p_correct: body.correct,
      p_chosen_index: body.chosen_index,
      p_response_time_ms: body.response_time_ms ?? null,
      p_question_id: `${body.concept_id}:practice:v1`,
      p_subject_code: conceptRow.subject as string,
      p_chapter_number: conceptRow.chapter_number as number,
      p_occurred_at: occurredAt,
      p_event_id: crypto.randomUUID(),
      p_idempotency_key: `tutor.answer.${body.attempt_id}`,
    };

    const { data, error: rpcErr } = await supabaseAdmin.rpc('tutor_commit_attempt', rpcArgs);

    if (!rpcErr && data && (Array.isArray(data) ? data.length > 0 : data)) {
      const row = Array.isArray(data) ? data[0] : data;
      await capture('tutor_answer_recorded', userId, {
        concept_id: body.concept_id, correct: body.correct,
        new_mastery_mean: Number(row.posterior_mastery_mean),
        difficulty: (conceptRow.difficulty as number | null) ?? null, path: 'c',
      });
      return NextResponse.json({
        ok: true, optimistic: true, path: 'c',
        mastery: {
          concept_id: body.concept_id,
          mastery_mean: Number(row.posterior_mastery_mean),
          attempts: row.attempt_sequence,
          mastered: Number(row.posterior_mastery_mean) >= MASTERY_THRESHOLD,
        },
      });
    }

    // RPC failed. Distinguish the duplicate-attempt UNIQUE violation from
    // other errors. UNIQUE on concept_attempts.attempt_id (the PK) means
    // the client retried with the same attempt_id — the chain already has
    // a row, the projector will catch up; we 409 the user.
    if (rpcErr?.code === '23505') {
      return NextResponse.json({ error: 'already_answered' }, { status: 409 });
    }

    logger.error('tutor/answer: tutor_commit_attempt RPC failed; falling back to legacy', {
      userId, conceptId: body.concept_id, attemptId: body.attempt_id, rpcError: rpcErr?.message,
    });
    await capture('tutor_answer_path_c_fallback', userId, {
      concept_id: body.concept_id, attempt_id: body.attempt_id, reason: 'rpc_error', error: rpcErr?.message ?? 'unknown',
    });

    // Record the attempt as excluded so the audit trail is preserved.
    // Failure here is non-fatal — we still attempt the legacy write below.
    if (body.attempt_id) {
      const { error: excludedErr } = await supabaseAdmin.from('concept_attempts').insert({
        attempt_id: body.attempt_id,
        student_id: studentId,
        concept_id: body.concept_id,
        attempt_sequence: null,
        served_at: occurredAt,
        answered_at: occurredAt,
        correct: body.correct,
        chosen_index: body.chosen_index,
        response_time_ms: body.response_time_ms ?? null,
        prior_mastery_mean: null,
        posterior_mastery_mean: null,
        status: 'excluded',
      });
      if (excludedErr && excludedErr.code !== '23505') {
        // 23505 would mean the RPC partially committed (impossible per transaction
        // semantics, but log it anyway) — other failures we just log; legacy
        // write continues.
        logger.error('tutor/answer: excluded marker insert failed', {
          userId, attemptId: body.attempt_id, error: excludedErr.message,
        });
      }
    }
    // FALL THROUGH to legacy block.
  }

  // ── Legacy block (Phase 0 inline naive write) ───────────────────────
  const sbAdmin = supabaseAdmin;
  const { data: existing } = await sbAdmin
    .from('concept_mastery')
    .select('mastery_mean, total_attempts, total_correct, streak_current')
    .eq('student_id', studentId).eq('concept_id', body.concept_id).maybeSingle();

  const currentMean = (existing?.mastery_mean as number | null) ?? 0.5;
  const currentAttempts = (existing?.total_attempts as number | null) ?? 0;
  const currentCorrect = (existing?.total_correct as number | null) ?? 0;
  const currentStreak = (existing?.streak_current as number | null) ?? 0;

  const newMean = body.correct ? Math.max(currentMean, MASTERY_THRESHOLD + 0.05) : Math.min(currentMean, 0.5);
  const newStreak = body.correct ? currentStreak + 1 : 0;

  const { error: upsertErr } = await sbAdmin.from('concept_mastery').upsert(
    {
      student_id: studentId,
      concept_id: body.concept_id,
      mastery_mean: newMean,
      last_practiced_at: new Date().toISOString(),
      total_attempts: currentAttempts + 1,
      total_correct: currentCorrect + (body.correct ? 1 : 0),
      streak_current: newStreak,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,concept_id' },
  );

  if (upsertErr) {
    logger.error('tutor/answer: legacy concept_mastery upsert failed', {
      userId, conceptId: body.concept_id, error: upsertErr.message,
    });
    return NextResponse.json({ error: 'mastery_write_failed', detail: upsertErr.message }, { status: 500 });
  }

  await capture('tutor_answer_recorded', userId, {
    concept_id: body.concept_id, correct: body.correct, new_mastery_mean: newMean,
    difficulty: (conceptRow.difficulty as number | null) ?? null, path: 'legacy',
  });

  return NextResponse.json({
    ok: true, optimistic: false, path: 'legacy',
    mastery: {
      concept_id: body.concept_id,
      mastery_mean: newMean,
      attempts: currentAttempts + 1,
      streak_current: newStreak,
      mastered: newMean >= MASTERY_THRESHOLD,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/tutor/answer/route.test.ts`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tutor/answer/route.ts src/app/api/tutor/answer/route.test.ts
git commit -m "feat(tutor): Path C v2 RPC + fallback in /api/tutor/answer (ADR-004 Phase 2 / PR 2 step 9)"
```

---

### Task 10: Thread attemptId from /next response into /answer POST body on /tutor page

**Files:**
- Modify: `src/app/tutor/page.tsx`

- [ ] **Step 1: Modify the page**

In `src/app/tutor/page.tsx`:

1. Extend the component's local state to carry `attemptId`:

After the existing state hooks (around line 47), add:
```ts
const [attemptId, setAttemptId] = useState<string | null>(null);
```

2. In `fetchNext`, capture `attemptId` from the response. After `setData(json);` add:
```ts
setAttemptId(json.attemptId ?? null);
```

3. In `submitAnswer`, include `attempt_id` in the POST body when present:
```ts
await fetch('/api/tutor/answer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    concept_id: concept.id,
    chosen_index: chosenIdx,
    correct,
    response_time_ms: Date.now() - answerStartedAt,
    ...(attemptId ? { attempt_id: attemptId } : {}),
  }),
});
```

- [ ] **Step 2: Manually verify the page builds**

Run: `npx tsc --noEmit`
Expected: no type errors (attemptId is properly typed via the extended `TutorNextResponse`).

If the project has an existing build script:
Run: `npm run build` (or equivalent)
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/app/tutor/page.tsx
git commit -m "feat(tutor): thread attemptId from /next into /answer body (ADR-004 Phase 2 / PR 2 step 10)"
```

---

### Task 11: ADR-004 status row update

**Files:**
- Modify: `docs/architecture/ADR-004-adaptive-tutor.md`

- [ ] **Step 1: Update the Phase 2 row in the status table**

Find the Phase-2 / Phase status table in `docs/architecture/ADR-004-adaptive-tutor.md`. Update it to mark Phase 2 as shipped (or in-rollout) with a link to this plan and the spec:

Use the existing surrounding annotation style — typically a single line like:
```
| Phase 2 — BKT projector | Shipped 2026-05-12 (PR #XYZ) — Path C v2 with chained-prior atomic RPC. See [plan](../superpowers/plans/2026-05-12-adr-004-phase-2-bkt-projector.md), [spec](../superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md). Flag: ff_tutor_bkt_v1 (default OFF). |
```

(Don't replace the PR number until after Task 14 creates the PR. Leave it as `#XYZ` for now or skip this task until Task 14.)

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/ADR-004-adaptive-tutor.md
git commit -m "docs(adr-004): Phase 2 BKT shipped, link plan + spec (ADR-004 Phase 2 / PR 2 step 11)"
```

---

### Task 12: Full unit + integration test pass + lint + typecheck

**Files:** none (verification only).

- [ ] **Step 1: Run the full vitest suite**

Run: `npx vitest run`
Expected: all tests pass. If something else broke, investigate; this PR should not regress anything.

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Lint (if configured)**

Run: `npm run lint` (or `npx eslint . --ext .ts,.tsx`)
Expected: clean. Fix any new warnings introduced by this PR; don't touch pre-existing ones (out of scope).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean Next.js build.

- [ ] **Step 5: Commit anything that came up (only if lint auto-fixes mattered)**

```bash
# Only if there are changes from auto-fixes.
git status
git add <changed files>
git commit -m "chore: auto-fix lint after PR 2 changes"
```

---

### Task 13: Playwright E2E smoke (optional gate; skip if Playwright not configured)

**Files:**
- Create: `tests/e2e/tutor-bkt.spec.ts`

If the project doesn't already have Playwright wired up (no `playwright.config.ts` at the root), SKIP this task and document in the PR description that staging E2E must be manual. The plan's primary acceptance gate is the vitest suite + manual staging smoke.

- [ ] **Step 1: Check whether Playwright is configured**

Run: `ls tests/e2e/ 2>/dev/null && cat playwright.config.ts 2>/dev/null`
- If found: proceed to step 2.
- If not found: mark this task SKIPPED and move on.

- [ ] **Step 2: Write a minimal smoke spec**

```ts
// tests/e2e/tutor-bkt.spec.ts
import { test, expect } from '@playwright/test';

// Requires all three flags ON for the user under test.
test('tutor BKT: two consecutive corrects move mastery into mastered range', async ({ page }) => {
  test.skip(!process.env.TUTOR_BKT_E2E, 'set TUTOR_BKT_E2E=1 to run');

  await page.goto('/tutor');

  // First answer
  await page.getByRole('button', { name: /.+/ }).first().click(); // pick option 0
  await page.getByRole('button', { name: /Check|जाँचें/ }).click();
  await expect(page.getByText(/Correct|सही/)).toBeVisible();
  await page.getByRole('button', { name: /Next concept|अगली अवधारणा/ }).click();

  // Second answer (same concept since first one may have crossed threshold or not;
  // the smoke just verifies the loop functions under the BKT path)
  await page.getByRole('button', { name: /.+/ }).first().click();
  await page.getByRole('button', { name: /Check|जाँचें/ }).click();
  // Either Correct or Not quite is fine — we're verifying the round-trip works.
  await expect(page.getByText(/(Correct|Not quite|सही|अभी नहीं)/)).toBeVisible();
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/tutor-bkt.spec.ts
git commit -m "test(e2e): tutor BKT smoke (ADR-004 Phase 2 / PR 2 step 13)"
```

---

### Task 14: Push branch + open PR

**Files:** none (git operations).

- [ ] **Step 1: Confirm clean state**

Run: `git status`
Expected: only commits ahead of `origin/main`; no unstaged changes.

- [ ] **Step 2: Push branch**

Run: `git push -u origin feat/adr-004-phase-2-bkt-projector`
Expected: branch created on GitHub.

- [ ] **Step 3: Open PR with full description**

Use `gh pr create` with a body that covers:
- What ships (Path C v2 + concept-mastery-projector + atomic RPC)
- Flag matrix and how rollout works
- Rollback plan (flip `ff_tutor_bkt_v1` OFF — legacy path is intact)
- Pre-merge checklist (vitest, tsc, staging migration apply, staging RPC parity test)
- Post-merge checklist (apply migrations on staging → smoke → enable ff_tutor_bkt_v1 for CEO account → monitor `tutor_answer_path_c_fallback` PostHog event)
- Spec + plan links
- Reviewers: ai-engineer, backend, ops, testing

- [ ] **Step 4: Note any follow-ups in the PR body**

Carry forward the follow-up items still open from PR 1's description (logAdminAudit, drift-detection test, etc.) only if any of them landed in this PR's changes. Add new follow-ups discovered during PR 2 (calibration job, dead-letter alerting tuning, Phase 2.1 post-publish ad-hoc trigger).

- [ ] **Step 5: Update ADR-004 with the real PR number**

If you skipped the PR number substitution in Task 11, replace `#XYZ` with the actual PR number now and amend the docs commit (or open a tiny follow-up commit on the branch before merge).

```bash
# Either amend the existing docs commit:
# (only if the docs commit is still the HEAD or near-HEAD and we haven't been pushed-and-reviewed yet)
# Otherwise create a new commit:
git add docs/architecture/ADR-004-adaptive-tutor.md
git commit -m "docs(adr-004): fill in PR # after PR creation"
git push
```

---

## Verification matrix (run before requesting review)

| Gate | Command | Expected |
|---|---|---|
| BKT unit tests | `npx vitest run src/lib/tutor/bkt.test.ts` | 11/11 pass |
| BKT-SQL parity (if Supabase available) | `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx vitest run src/lib/tutor/bkt-sql.integration.test.ts` | 10/10 within 1e-9 |
| Projector unit tests | `npx vitest run src/lib/state/subscribers/concept-mastery-projector.test.ts` | 6/6 pass |
| /next route tests | `npx vitest run src/app/api/tutor/next/route.test.ts` | 2/2 pass |
| /answer route tests | `npx vitest run src/app/api/tutor/answer/route.test.ts` | 6/6 pass |
| Registry parity | `npx vitest run src/__tests__/state/events-registry.test.ts` | passes incl. new kind |
| Full suite | `npx vitest run` | no new failures |
| Typecheck | `npx tsc --noEmit` | clean |
| Build | `npm run build` | clean |
| Migrations apply (local or staging) | `npx supabase db push` | 3 migrations apply idempotently |

## Definition of done

- All gates in the verification matrix pass.
- Three migrations apply cleanly to staging.
- Manual staging smoke with all three flags ON for a test student:
  - `/api/tutor/next` returns `attemptId`.
  - `/api/tutor/answer` responds `{ optimistic: true, path: 'c', mastery.mastery_mean: 0.693 }` on first correct.
  - Within ≤ 1 minute of cron tick, `concept_mastery.mastery_mean` for that (student, concept) equals 0.693, `bkt_version = 1`, `last_attempt_id` set.
  - Two near-simultaneous answers chain correctly to seq=1 (0.30→0.693) and seq=2 (0.693→0.918) — verify via `SELECT * FROM concept_attempts WHERE student_id = … ORDER BY attempt_sequence;`.
  - Injected RPC failure path (temporarily revoke EXECUTE on `tutor_commit_attempt` from `service_role`) produces a `status='excluded'` row + legacy `concept_mastery` write + `tutor_answer_path_c_fallback` PostHog event. Restore grant after.
  - `subscriber_lag` for `concept-mastery-projector` is < 2 min p99 during a 5-minute soak.
- PR description includes the flag matrix and rollback plan.
- ADR-004 Phase 2 row updated with PR link.

## Rollback plan

Single switch: flip `ff_tutor_bkt_v1` OFF. The route falls back to the Phase 0 inline write immediately (no deploy required; the flag is read every request through the existing cached read in `feature-flags`). The projector continues running but receives no new events of this kind. The audit trail in `concept_attempts` for already-committed `status='answered'` rows is preserved; no data is destroyed.

If a deeper rollback is required (e.g. migration causes a problem):
1. `DROP FUNCTION public.tutor_commit_attempt;`
2. `DROP FUNCTION public.bkt_update;`
3. Newly-added columns on `concept_mastery` can stay (no consumer broken).
4. `concept_attempts` table can stay (empty after flag flip).

The legacy path never needed those, so existing reads keep working.
