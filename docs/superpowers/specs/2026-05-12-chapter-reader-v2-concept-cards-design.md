# Chapter Reader v2 — Concept Cards + Concept Checks

**Date:** 2026-05-12 (revised after live-prod schema audit)
**Author:** Claude (architect-on-record), with CEO Pradeep Sharma
**Status:** Proposed → Approved (pending user sign-off on this spec)
**Companion ADR:** [ADR-001 — The Learner Loop](../../architecture/ADR-001-learner-loop-unification.md)

> **Revision note (2026-05-12):** The first draft of this spec assumed `chapter_concepts` and `concept_checks` were new tables. Live-prod audit (via Supabase MCP) revealed `chapter_concepts` already exists with **339 rows / 133 chapters / 37 columns**, but the data is thin (2–3 concepts/chapter avg vs. the 6–10 we need), has **zero Hindi translations**, and at least some rows have title/MCQ mismatches (Grade 7 math Ch.1's only concept is titled "Operations on Integers" but the chapter is actually about place value; its MCQ asks about 6-digit numbers). The spec is rewritten to **reuse the existing table**, add **one** new sibling table for the second MCQ per concept, and treat **content regeneration as the bulk of the work** — not new table creation.

## 0. Problem

The current chapter reader dumps raw NCERT text (per the user's 2026-05-12 screenshot of Ganita Prakash Grade 7) with no segmentation, no checks-for-understanding, no progress signal, and no exit back to the Learner Loop.

A `chapter_concepts` table already exists with structured fields (`title`, `title_hi`, `explanation`, `explanation_hi`, `example_content`, `example_content_hi`, `practice_question`, `practice_options`, `practice_correct_index`, `practice_explanation`, `difficulty`, `bloom_level`, `estimated_minutes`, `key_formula`, `common_mistakes`, `exam_tips`). But the legacy reader doesn't render from it — and it's underpopulated and Hindi-empty anyway.

This is the *content presentation* layer, orthogonal to ADR-001's routing layer (which is itself currently dark in prod — see §11 Risks).

## 1. Goal

Three-line summary:

1. Render existing `chapter_concepts` rows as a Concept-Card → MCQ flow.
2. Gate behind `ff_chapter_reader_v2` (default OFF).
3. Backfill the pilot chapter (Grade 7 Math Ch.1) to publication quality first, prove the loop closes through real BKT mastery, then expand.

Non-goals: voice narration, AI-generated diagrams, adaptive concept ordering, teacher-authored overrides.

## 2. Architecture

```
                  /<existing chapter-reader route — Task 0 finds this>
                            │
                            ▼
       ┌────────────────────────────────────────────────┐
       │ ChapterReaderPage                              │
       │  • Reads ff_chapter_reader_v2                  │
       │  • Flag ON and ≥6 quality concepts for chapter │
       │     → renders <ConceptDeck>                    │
       │  • Otherwise → legacy reader (unchanged)       │
       └────────────────────────────────────────────────┘
                            │
                            ▼
       ┌────────────────────────────────────────────────┐
       │ <ConceptDeck> (client)                         │
       │  • Pure reducer state machine                  │
       │  • Reads chapter_concepts + concept_checks     │
       │     via /api/chapter-deck                      │
       │  • For each concept: ConceptCard → 2 MCQs      │
       │     (1st = chapter_concepts.practice_*,        │
       │      2nd = concept_checks row)                 │
       │  • Ends with 5-question micro-test pulled      │
       │     from ncert_exercises filtered to chapter   │
       │  • Emits 3 events to the state bus             │
       └────────────────────────────────────────────────┘
```

## 3. Data model

### 3.1 Reused: `chapter_concepts` (no schema change)

Map existing columns to the deck's needs:

| Deck need | `chapter_concepts` column |
|---|---|
| Concept order | `concept_number` |
| English title | `title` |
| Hindi title | `title_hi` (currently NULL on all rows — backfill task) |
| Body | `explanation` |
| Body Hindi | `explanation_hi` (NULL — backfill) |
| Worked example | `example_content` |
| Worked example Hindi | `example_content_hi` (NULL — backfill) |
| Key takeaway | new computed column? No — derive from `learning_objective` if present, else first sentence of `explanation`. (No schema change.) |
| Key takeaway Hindi | derive from `learning_objective_hi` similarly |
| Time estimate | `estimated_minutes` |
| 1st MCQ | `practice_question`, `practice_options` (jsonb array), `practice_correct_index`, `practice_explanation` |
| 1st MCQ Hindi | NOT present — backfill (no schema change, just regenerate row with both languages in one INSERT/UPDATE) |
| Active flag | `is_active` |
| Chapter key | `grade` + `subject` + `chapter_number` |
| Concept identity | `id` (uuid) |

**No DDL on `chapter_concepts`.** Data is regenerated/UPSERTed for pilot chapter only.

### 3.2 New: `concept_checks` (one new table)

Holds the **second MCQ per concept**. The first MCQ already lives in `chapter_concepts.practice_*`. We need 2 per concept for the Card → Check gate to feel substantial.

```sql
CREATE TABLE public.concept_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES public.chapter_concepts(id) ON DELETE CASCADE,
  prompt_en text NOT NULL,
  prompt_hi text NOT NULL,
  options_en jsonb NOT NULL,            -- [{id:"a",text:"…"}, ...4]
  options_hi jsonb NOT NULL,
  correct_option_id text NOT NULL,
  explanation_en text NOT NULL,
  explanation_hi text NOT NULL,
  difficulty int NOT NULL CHECK (difficulty IN (1,2,3)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id)                   -- exactly one extra per concept; the
                                        -- primary MCQ stays embedded on
                                        -- chapter_concepts
);
```

RLS: anon + authenticated SELECT.

### 3.3 Reused: `ncert_exercises` for the micro-test

The end-of-chapter micro-test pulls **5 questions from `ncert_exercises`** for the same `(grade, subject_code, chapter_number)`, filtered to `question_type = 'mcq'` (or whatever value indicates MCQ — to be confirmed in Task 0), `is_active = true`, ordered by `difficulty ASC` for the first 3 + `RANDOM()` for 2.

No schema change.

### 3.4 Quality gate

The deck only renders when `chapter_concepts` has **≥6 active rows for the chapter AND every row has non-null `title_hi`, `explanation_hi`, `example_content_hi` AND each row has a matching `concept_checks` row**. Below that bar, the page falls through to the legacy reader and we don't pretend otherwise.

This gate is checked server-side in `/api/chapter-deck`.

## 4. UI components

(unchanged from the prior draft — see ConceptCard, ConceptCheck, ChapterMicroTest, ConceptProgressRail in plan tasks)

## 5. Events into the state bus

Three new events extend `src/lib/state/events/registry.ts`. Naming follows the existing `learner.<verb_past_tense>` convention. All use `EventBaseSchema.extend({ kind, payload })`. Chapter is keyed by `subjectCode + chapterNumber` (matching `LearnerQuizCompletedSchema`).

### 5.1 `learner.concept_viewed`
```ts
payload: {
  subjectCode: string,
  chapterNumber: int>0,
  conceptId: uuid,
  conceptNumber: int>0,
  dwellMs: int>=0,
}
```

### 5.2 `learner.concept_check_answered`
```ts
payload: {
  subjectCode: string,
  chapterNumber: int>0,
  conceptId: uuid,
  // 'embedded' = practice_* on chapter_concepts; 'extra' = concept_checks row
  checkSource: 'embedded' | 'extra',
  checkId: uuid | null,           // null for embedded (no separate row id)
  chosenOptionId: string,
  correct: boolean,
  attemptNumber: int>=1,
  difficulty: 1 | 2 | 3,
}
```

### 5.3 `learner.chapter_micro_test_completed`
```ts
payload: {
  subjectCode: string,
  chapterNumber: int>0,
  correctCount: int(0..5),
  totalCount: literal(5),
  durationMs: int>=0,
}
```

## 6. Backfill — pilot chapter only

This is now the bulk of the work, not a side-step. Target: **Grade 7 Math Ch.1** (the chapter the user screenshotted).

Inputs available:
- `chapter_concepts` rows that may exist (likely 1, mismatched)
- `ncert_exercises` rows for the same chapter (high-quality, has options + answers)
- `chapters` row with the canonical title

Script: `scripts/backfill-chapter-deck.ts` (renamed from earlier draft).

Steps:
1. Read existing `chapter_concepts` rows for the chapter. Print them.
2. UPSERT 6–8 fresh concept rows: title + title_hi + explanation + explanation_hi + example_content + example_content_hi + key_formula + learning_objective + learning_objective_hi + practice_question + practice_options + practice_correct_index + practice_explanation + difficulty + bloom_level + estimated_minutes + is_active=true. Concept numbers are reassigned 1..N to match the new ordering. Source content from an LLM call with the NCERT chapter text as context (pulled from wherever the legacy reader gets it — Task 0 finds this; possibly `ncert_book_catalog.storage_path` PDFs).
3. INSERT a `concept_checks` row per concept (the second MCQ, different from `practice_question`).
4. Mark the chapter as "deck-ready" in `chapters.quality_status` (column already exists — value `'deck_ready_v2'`).

`--dry-run` prints, doesn't write. `--self-test` runs fixture-based assertions on the validator without LLM calls.

## 7. Flag & rollout

- **Flag:** `ff_chapter_reader_v2` (new). Seeded by migration. Default OFF.
- **CEO override:** writes `auth.uid()` into `metadata.target_user_ids` array on the flag row. Helper `isUserTargeted()` in `src/lib/feature-flags.ts` (verify exists; add if missing).
- Rollout:
  1. Backfill pilot chapter, mark `chapters.quality_status='deck_ready_v2'`.
  2. Flip flag ON with CEO in `target_user_ids`. Walk through pilot chapter on real device.
  3. Expand backfill to all Grade 7 Math chapters. Raise `rollout_percentage` to 100 for users on Grade 7 Math chapters that pass the quality gate.
  4. Other subjects gated by backfill completion, not by code.

## 8. Testing

| Layer | Test |
|---|---|
| Reducer | Pure `(state, event) => state` — 9+ Vitest cases |
| Quality gate | Unit-test the `isDeckReady(chapter)` function: 5 concepts → falls through, 6 + missing Hindi → falls through, 6 + Hindi + no `concept_checks` → falls through, all 6 ready → renders |
| `ConceptCheck` | Locks after click, reveals explanation, emits correct/chosen |
| Backfill validator | `--self-test` rejects bad fixtures (missing Hindi, MCQ correct_index out of range, <6 concepts) |
| Events registry | Parse all 3 new event shapes; +3 to `ALL_EVENT_KINDS.length` pin |
| Integration (gated) | End-to-end on pilot chapter: answer 1 check → row lands in `state_events` → resolver picks a coherent next action |

## 9. Code locations

| New | Path |
|---|---|
| Reducer + types | `src/lib/chapter-reader/{deck-reducer.ts,deck-types.ts}` |
| Deck client | `src/components/chapter-reader/ConceptDeck.tsx` |
| Leaves | `src/components/chapter-reader/{ConceptCard,ConceptCheck,ChapterMicroTest,ConceptProgressRail}.tsx` |
| API | `src/app/api/chapter-deck/route.ts` |
| Hook | `src/lib/chapter-reader/use-chapter-deck.ts` |
| Quality gate | `src/lib/chapter-reader/is-deck-ready.ts` (pure) |
| Migration: `concept_checks` | `supabase/migrations/<ts>_concept_checks.sql` |
| Migration: flag seed | `supabase/migrations/<ts+1>_ff_chapter_reader_v2.sql` |
| Events | extension to `src/lib/state/events/registry.ts` |
| Backfill | `scripts/backfill-chapter-deck.ts` |
| Page wiring | the existing chapter-reader page (Task 0 finds path) |

## 10. Out of scope (v2)

- Voice / audio narration.
- Generated diagrams.
- Adaptive concept ordering.
- Teacher-authored overrides.
- Mass backfill of all 133 chapters (pilot only this round).
- Fixing the existing 339 mismatched rows (the deck just won't render for those chapters — they continue to use the legacy reader until they're rebackfilled).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Backfill generates plausible-but-wrong content | Quality gate (§3.4) requires Hindi + 2 MCQs + 6+ concepts; pilot eyeballed by CEO before flag flips |
| Pulling NCERT source text fails (no `ncert_chunks` table in `public`) | Task 0 step 4 locates the real source — `ncert_book_catalog.storage_path` PDFs, or chunks in a non-public schema; if blocked, the script accepts `--input-file` to bypass |
| Loop is still dark in prod (only `ff_event_bus_v1` of 7 Loop flags exists; PR #748 unmerged) | Out of scope of this spec, but tracked: until #748 lands the chapter reader's emitted events won't drive resolver behaviour. The deck still works as a reader on its own — the Loop integration is a downstream benefit |
| Concept-check events arrive out of order | The reducer is server-rendered-independent; each event has `idempotencyKey` from `EventBaseSchema`; BKT projector dedupes |
| Hindi quality | Translator pass uses the LLM with a deterministic system prompt; CEO audit before flip |

## 12. Definition of done

- [ ] Pilot chapter (Grade 7 Math Ch.1) has 6–8 `chapter_concepts` rows with non-null Hindi for all text fields AND matching `concept_checks` row per concept.
- [ ] `chapters.quality_status = 'deck_ready_v2'` for the pilot chapter.
- [ ] `ff_chapter_reader_v2` exists in `feature_flags`, OFF by default, with empty `target_user_ids` metadata array.
- [ ] Visiting the chapter-reader page with the flag ON renders `ConceptDeck`. With the flag OFF renders the legacy reader. With the flag ON but a chapter that fails the quality gate, renders the legacy reader.
- [ ] All three new event kinds appear in `state_events` after a real session.
- [ ] BKT mastery for the pilot chapter changes after the session (verified via `concept_mastery` or `concept_mastery_score` — confirm which is canonical in Task 0).
- [ ] After completing the micro-test, the resolver's `/api/learner/next` response reflects the new mastery — but only **if `ff_learner_loop_v1` is live** (which it currently is not; that's PR #748's job, not this spec's).
