# Pedagogy v2 — Wave 1B (Rhythm Data + Surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-shipped daily-rhythm orchestrator to live student data and render it on the dashboard, replacing the original Wave 1 plan's incorrect `sm2_cards` assumption with the canonical CME (`concept_mastery`) schema.

**Architecture:** A small CME → DueSm2Card adapter, the `/api/rhythm/today` route over real data, the dashboard `<DailyRhythmQueue/>` component, an E2E smoke test. Reuses the already-merged `daily-rhythm-orchestrator.ts`, `pedagogy-content-rules.ts`, and `PEDAGOGY_V2_FLAGS.DAILY_RHYTHM` flag — no rework of those.

**Tech Stack:** Next.js 16 App Router, Supabase server client (`createSupabaseServerClient`), Vitest, Playwright. Same path alias `@/*` → `./src/*`.

**Spec:** [docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md](../specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md)

**Predecessor plan:** [2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md](2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md) — Wave 1A. Tasks 5, 8, 9 deferred from there land here, retargeted to actual canonical schema.

**Why this plan exists:** The Wave 1A plan assumed an `sm2_cards(student_id, question_id, next_review_at, is_ahead_of_grade)` table. Canonical re-audit during execution found that table doesn't exist. Canonical uses `concept_mastery` (with retention_half_life, current_retention, max_difficulty_succeeded, error_count_*, bloom_mastery JSONB). The orchestrator's `DueSm2Card` interface still works as the *output* shape — what changes is the source.

**Build size:** ~1 solo-developer week.

## Pre-flight audit (must complete before Task 1)

The Wave 1A execution turned up several schema unknowns. The implementer **must** answer these by reading canonical SQL and code before scoping any task. Each task assumes these answers are documented at the top of `/api/rhythm/today/route.ts` once known.

- [ ] **A1. Locate the student persona / goal_code source.**
      Search canonical for `goal_code` storage. Likely candidates: `profiles`, `student_profiles`, `learning_profile`, `users`, or a JSONB column on `auth.users`. Confirm with:
      ```bash
      grep -rl "goal_code" supabase/migrations/
      grep -rl "goal_code" src/lib/
      ```
      Document: `<table>.<column>` and the read path (RPC name or direct SELECT).

- [ ] **A2. Locate the student grade source.**
      `grade` is a string per P5. Find where it's persisted per student. Likely shares a row with `goal_code` (A1).

- [ ] **A3. Locate the IRT ability estimate.**
      `cognitive-engine.ts` exports `irtEstimateAbility`. Where is the per-student result stored? Candidates: `concept_mastery`, `student_irt_state`, `cognitive_session_metrics`. Document table.column.

- [ ] **A4. Locate "due for review" semantics in CME.**
      `concept_mastery` has `retention_half_life`, `current_retention`, possibly a computed `next_review_at`. Find:
      - Is there an existing RPC like `get_review_due_concepts(p_student_id, p_limit)`?
      - Or a view like `concepts_due_for_review`?
      - Or do we compute "due" client-side from `current_retention < threshold`?
      Document the read path.

- [ ] **A5. Locate the candidate ZPD problem pool.**
      Wave 1A assumed direct SELECT against `question_bank` with tag columns `is_board_pattern`, `is_olympiad`, `is_jee_neet`. Confirm those columns actually exist; if not, find the equivalent (likely on `question_bank.metadata` JSONB or a separate `question_tags` table).

If any of A1-A5 cannot be answered from canonical source, **stop and escalate** with the unknown listed plainly. Do not invent a schema.

## File Structure

### Created (new)

| Path | Responsibility |
|---|---|
| `src/lib/learn/cme-due-cards-adapter.ts` | Pure-function: maps `concept_mastery` rows → `DueSm2Card[]` for the orchestrator |
| `src/lib/__tests__/cme-due-cards-adapter.test.ts` | Unit tests with table-driven CME row fixtures |
| `src/app/api/rhythm/today/route.ts` | API route, gated by `ff_pedagogy_v2_daily_rhythm` |
| `src/components/dashboard/sections/DailyRhythmQueue.tsx` | Dashboard component rendering the 7-item queue |
| `e2e/daily-rhythm.spec.ts` | Playwright smoke test |

### Modified

| Path | Change |
|---|---|
| `src/app/dashboard/page.tsx` | Mount `<DailyRhythmQueue/>` above `<AboveFoldHero/>`. Component renders null when API returns 404 (flag off). |

## Task 1 — `cme-due-cards-adapter.ts` (TDD)

**Why:** The orchestrator already takes `DueSm2Card[]` as input. We don't change the orchestrator. We adapt CME concept-mastery rows into that shape on the way in.

**Files:**
- Create: `src/lib/learn/cme-due-cards-adapter.ts`
- Create: `src/lib/__tests__/cme-due-cards-adapter.test.ts`

- [ ] **Step 1: Confirm CME row shape.**
      Read `supabase/migrations/_legacy/timestamped/20260405000001_unified_learner_state.sql` and the table definition for `concept_mastery`. Document the columns the adapter needs: at minimum `concept_id` (or `topic_id`), `retention_half_life`, `current_retention`, `mastery_velocity`, and any column that maps to "ahead of grade." If "ahead of grade" isn't tracked at the concept level, derive it by joining to a curriculum table (the adapter takes both inputs).

- [ ] **Step 2: Write the failing test.**
      Test file fixture: an array of CME row objects. Adapter input: `{ rows: CmeRow[]; nowIso: string; aheadOfGradeConceptIds: Set<string> }`. Adapter output: `DueSm2Card[]` with `questionId` populated from a separate "next question for concept" map (the rhythm picks one question per due concept). For the unit test, mock `aheadOfGradeConceptIds` and assert the resulting `isAheadOfGrade` flags match.

      ```typescript
      import { describe, it, expect } from 'vitest';
      import { cmeRowsToDueCards } from '../learn/cme-due-cards-adapter';

      describe('cmeRowsToDueCards', () => {
        it('emits one due card per concept with current_retention < threshold', () => {
          const rows = [
            { concept_id: 'c1', current_retention: 0.2, mastery_velocity: 0.0 },
            { concept_id: 'c2', current_retention: 0.9, mastery_velocity: 0.0 }, // not due
            { concept_id: 'c3', current_retention: 0.4, mastery_velocity: 0.0 },
          ];
          const conceptToQuestion = new Map([['c1', 'q1'], ['c3', 'q3']]);
          const out = cmeRowsToDueCards({
            rows,
            conceptToQuestion,
            aheadOfGradeConceptIds: new Set(),
          });
          expect(out).toHaveLength(2);
          expect(out.map((c) => c.questionId).sort()).toEqual(['q1', 'q3']);
        });

        it('flags ahead-of-grade concepts', () => {
          const rows = [
            { concept_id: 'c1', current_retention: 0.2, mastery_velocity: 0.0 },
          ];
          const conceptToQuestion = new Map([['c1', 'q1']]);
          const out = cmeRowsToDueCards({
            rows,
            conceptToQuestion,
            aheadOfGradeConceptIds: new Set(['c1']),
          });
          expect(out[0].isAheadOfGrade).toBe(true);
        });

        it('orders by retention ascending (most-forgotten first)', () => {
          const rows = [
            { concept_id: 'c1', current_retention: 0.4, mastery_velocity: 0.0 },
            { concept_id: 'c2', current_retention: 0.1, mastery_velocity: 0.0 },
            { concept_id: 'c3', current_retention: 0.3, mastery_velocity: 0.0 },
          ];
          const conceptToQuestion = new Map([['c1', 'q1'], ['c2', 'q2'], ['c3', 'q3']]);
          const out = cmeRowsToDueCards({
            rows,
            conceptToQuestion,
            aheadOfGradeConceptIds: new Set(),
          });
          expect(out.map((c) => c.questionId)).toEqual(['q2', 'q3', 'q1']);
        });

        it('drops rows missing a mapped question', () => {
          const rows = [
            { concept_id: 'c1', current_retention: 0.2, mastery_velocity: 0.0 },
            { concept_id: 'cX', current_retention: 0.2, mastery_velocity: 0.0 },
          ];
          const conceptToQuestion = new Map([['c1', 'q1']]);
          const out = cmeRowsToDueCards({
            rows,
            conceptToQuestion,
            aheadOfGradeConceptIds: new Set(),
          });
          expect(out).toHaveLength(1);
        });
      });
      ```

- [ ] **Step 3: Run the test.**
      Expected: FAIL (module missing).

- [ ] **Step 4: Write the adapter.**

      ```typescript
      /**
       * Pedagogy v2 / Wave 1B
       * CME → DueSm2Card adapter.
       *
       * Translates rows from the canonical concept_mastery table into the
       * DueSm2Card shape that daily-rhythm-orchestrator.ts already consumes.
       * Pure function, ZERO IO.
       */
      import type { DueSm2Card } from './daily-rhythm-orchestrator';

      export interface CmeRow {
        concept_id: string;
        current_retention: number;
        mastery_velocity: number;
      }

      export interface AdapterInput {
        rows: CmeRow[];
        conceptToQuestion: Map<string, string>;
        aheadOfGradeConceptIds: Set<string>;
        retentionThreshold?: number; // default 0.7 — below this is "due"
      }

      export function cmeRowsToDueCards(input: AdapterInput): DueSm2Card[] {
        const threshold = input.retentionThreshold ?? 0.7;
        return input.rows
          .filter((r) => r.current_retention < threshold)
          .filter((r) => input.conceptToQuestion.has(r.concept_id))
          .sort((a, b) => a.current_retention - b.current_retention)
          .map((r) => ({
            questionId: input.conceptToQuestion.get(r.concept_id)!,
            topicId: r.concept_id,
            isAheadOfGrade: input.aheadOfGradeConceptIds.has(r.concept_id),
          }));
      }
      ```

- [ ] **Step 5: Run test.**
      Expected: PASS (4/4).

- [ ] **Step 6: Commit.**
      ```bash
      git add src/lib/learn/cme-due-cards-adapter.ts src/lib/__tests__/cme-due-cards-adapter.test.ts
      git commit -m "$(cat <<'EOF'
      feat(pedagogy-v2): CME -> DueSm2Card adapter for the rhythm orchestrator

      Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
      EOF
      )"
      ```

## Task 2 — `/api/rhythm/today` route over CME

**Why:** Live data path for the daily rhythm queue.

**Files:**
- Create: `src/app/api/rhythm/today/route.ts`

- [ ] **Step 1: Re-confirm pre-flight A1-A5 answers.** Top-of-file comment in the route documents the resolved schema paths so the next reader doesn't have to re-audit.

- [ ] **Step 2: Write the route handler.** The handler must:
      1. `await createSupabaseServerClient()` (note the actual export name).
      2. `auth.getUser()`. Return 401 on unauthenticated.
      3. Evaluate `PEDAGOGY_V2_FLAGS.DAILY_RHYTHM`. Return 404 when off.
      4. Fetch student `goal_code` and `grade` from the source identified in A1/A2.
      5. Fetch student IRT ability estimate from the source in A3.
      6. Fetch CME rows due for review via the path identified in A4.
      7. Build `conceptToQuestion` map by querying `question_bank` for one question per due concept (most informative by IRT preferred — use existing `select_questions_by_irt_info` RPC if it fits).
      8. Compute `aheadOfGradeConceptIds` by joining due concepts against the curriculum (whatever maps concept → grade).
      9. Build a `candidateProblemPool` for the ZPD slot from the question_bank tag columns identified in A5. If those columns don't exist, document and return 503 — do not fake them.
      10. Pass everything to `composeDailyRhythm(...)` and return the queue.

      The route handler is bounded — it should be ~120-180 lines. If it grows past 250, extract loaders into helpers (`loadStudentContext`, `loadDueRhythmCards`, `loadZpdPool`) but keep the route the orchestrator caller.

- [ ] **Step 3: Manual smoke against staging.**
      Same SQL toggles as the Wave 1A plan; same curl. Confirm 7-item JSON response. Confirm 404 when flag off.

- [ ] **Step 4: Commit.**

## Task 3 — Dashboard `<DailyRhythmQueue/>` integration

This task is functionally identical to the Wave 1A plan's Task 8 — the dashboard component is unchanged because `composeDailyRhythm`'s output contract didn't change. Lift verbatim from [Wave 1A plan §Task 8](2026-05-08-pedagogy-v2-wave-1-daily-rhythm.md), but with the Step 1 component spec and Step 2 dashboard mount unchanged. Bundle-size and smoke-test steps identical.

**Files:**
- Create: `src/components/dashboard/sections/DailyRhythmQueue.tsx` (verbatim from Wave 1A plan)
- Modify: `src/app/dashboard/page.tsx` (verbatim from Wave 1A plan)

- [ ] **Step 1-6:** Follow Wave 1A plan Task 8 verbatim.

## Task 4 — E2E Playwright smoke

Functionally identical to Wave 1A plan's Task 9. Lift verbatim. Pre-conditions list updates to reference `concept_mastery` rows instead of `sm2_cards`, but assertions stay the same.

**Files:**
- Create: `e2e/daily-rhythm.spec.ts` (verbatim from Wave 1A plan §Task 9 with the pre-condition list updated)

- [ ] **Step 1-3:** Follow Wave 1A plan Task 9 verbatim with updated pre-conditions.

## Self-review

**1. Spec coverage:** Spec §5.1 (Daily layer), §11 Wave 1 success metrics — both addressed by Tasks 2-4.

**2. Placeholders:** None. The pre-flight A1-A5 audit IS the answer to the prior plan's blind spots; each task references the audited paths.

**3. Type consistency:** `cmeRowsToDueCards` produces `DueSm2Card[]` which matches the orchestrator's existing input. No interface drift.

**4. Scope:** One subsystem (rhythm data + dashboard surface + e2e). 4 tasks, ~1 solo-developer week. Independent of any further wave.

## Plan complete

Saved to `docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-1b-rhythm-data-and-surface.md`. Execute via subagent-driven-development or executing-plans.
