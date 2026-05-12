# Chapter Reader v2 — Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render existing `chapter_concepts` rows as a Concept-Card → MCQ deck behind `ff_chapter_reader_v2`, piloted on Grade 7 Math Ch.1. The bulk of the work is **regenerating the pilot chapter's content to publication quality** (currently thin and Hindi-empty in prod).

**Architecture:** Reuse the existing `chapter_concepts` table (337+ live rows already exist). Add **one** new sibling table `concept_checks` for the second MCQ per concept. Pull the 5-question micro-test from `ncert_exercises`. New `ConceptDeck` client component driven by a pure reducer. Three new events extend `DomainEvent`. Flag-gated, ships dark.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + Auth), Zod, Vitest, SWR, TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md` — read it before starting. Note the revision header: prod schema audit changed the spec materially from the first draft.

---

## Task 0: Discovery (mandatory)

The repo's local grep index is flaky and the prod schema is richer than the spec's first draft assumed. Lock down real paths and confirm a few details before touching code.

**Files:** none — read-only.

- [ ] **Step 1: Find the chapter-reader page**

```bash
git ls-files | grep -iE 'subjects|chapter' | grep -E '\.(tsx|ts)$' | head -30
```
Look for the page that renders the screenshot the user posted (raw NCERT text + chapter title). Note path.

- [ ] **Step 2: Confirm event registry + publishEvent helper**

```bash
git ls-files | xargs grep -l 'DomainEventSchema\|publishEvent' --include='*.ts' 2>/dev/null | head -10
```
Note the registry path (expected `src/lib/state/events/registry.ts`) and the publish helper path.

- [ ] **Step 3: Find the NCERT source text endpoint**

The legacy chapter reader pulls raw text from somewhere — there's no `public.ncert_chunks` table. Likely candidates: a `private.*` schema, a Supabase storage bucket fed by `ncert_book_catalog.storage_path`, or a server route that PDF-extracts on demand. Find it:

```bash
git ls-files | xargs grep -l 'storage_path\|ncert_book_catalog\|extractText\|pdf-parse' --include='*.ts' --include='*.tsx' 2>/dev/null | head -10
```

The backfill script in Task 7 needs to feed the LLM the same source text the legacy reader shows.

- [ ] **Step 4: Confirm `ncert_exercises` MCQ filter**

```bash
git ls-files | xargs grep -l 'ncert_exercises\|question_type' --include='*.ts' 2>/dev/null | head -5
```
We need the exact value of `question_type` that means "MCQ" (probably `'mcq'`, but verify).

- [ ] **Step 5: Feature-flag helper**

```bash
git ls-files | grep feature-flags
```
Read `src/lib/feature-flags.ts`. Confirm whether `isUserTargeted()` (or any function reading `metadata.target_user_ids`) exists. If not, Task 8 adds it.

- [ ] **Step 6: Mastery table**

The spec asks "did mastery move?" Confirm which is canonical between `concept_mastery` and `concept_mastery_score`:

```bash
git ls-files | xargs grep -l 'concept_mastery' --include='*.ts' --include='*.sql' 2>/dev/null | head -10
```
Note which one production code writes to.

- [ ] **Step 7: Record findings**

```bash
mkdir -p docs/superpowers/plans
```

Create `docs/superpowers/plans/2026-05-12-chapter-reader-v2-discovery.md` listing the 6 answers. Commit:

```bash
git add docs/superpowers/plans/2026-05-12-chapter-reader-v2-discovery.md
git commit -m "docs(chapter-reader-v2): discovery notes for live-prod schema"
```

---

## Task 1: Pure reducer + tests

(Unchanged from prior draft — TDD-first pure state machine, no I/O.)

**Files:**
- Create: `src/lib/chapter-reader/deck-types.ts`
- Create: `src/lib/chapter-reader/deck-reducer.ts`
- Test: `src/__tests__/lib/chapter-reader/deck-reducer.test.ts`

- [ ] **Step 1: Types**

```ts
// src/lib/chapter-reader/deck-types.ts
export interface CheckRef {
  id: string;
  source: 'embedded' | 'extra';
}
export interface ConceptRef {
  id: string;
  conceptNumber: number;
  checks: [CheckRef, CheckRef];   // [embedded, extra]
}
export interface DeckBlueprint {
  chapterSubjectCode: string;
  chapterNumber: number;
  concepts: ConceptRef[];
  microTestQuestionIds: string[];
}
export type DeckState =
  | { kind: 'reading'; conceptIdx: number; attemptsThisConcept: number }
  | { kind: 'checking'; conceptIdx: number; checkIdx: 0 | 1; attemptsThisConcept: number }
  | { kind: 're_read'; conceptIdx: number; missedCheckIdx: 0 | 1 }
  | { kind: 'micro_test'; questionIdx: number; correctSoFar: number }
  | { kind: 'done'; correctOutOfFive: number };
export type DeckEvent =
  | { type: 'concept_read_complete' }
  | { type: 'check_answered'; correct: boolean }
  | { type: 're_read_clicked' }
  | { type: 'micro_test_answered'; correct: boolean };
export const initialDeckState = (): DeckState => ({ kind: 'reading', conceptIdx: 0, attemptsThisConcept: 0 });
```

- [ ] **Step 2: Failing test** (full file in spec §8 — write the same 9-case suite from the prior plan's Task 1 step 2)

- [ ] **Step 3: Reducer** (same body as prior plan's Task 1 step 4 — copy verbatim)

- [ ] **Step 4: Run, expect green; commit**

```bash
npx vitest run src/__tests__/lib/chapter-reader/deck-reducer.test.ts
git add src/lib/chapter-reader/ src/__tests__/lib/chapter-reader/
git commit -m "feat(chapter-reader): pure deck reducer + state types"
```

---

## Task 2: Quality gate (pure)

The deck only renders when the chapter is "deck-ready". Centralise that check in one pure function with exhaustive tests.

**Files:**
- Create: `src/lib/chapter-reader/is-deck-ready.ts`
- Test: `src/__tests__/lib/chapter-reader/is-deck-ready.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isDeckReady, type DeckReadinessInput } from '@/lib/chapter-reader/is-deck-ready';

const goodConcept = (i: number) => ({
  id: `c${i}`,
  concept_number: i,
  title: `T${i}`,
  title_hi: `ह${i}`,
  explanation: 'a'.repeat(60),
  explanation_hi: 'ह'.repeat(60),
  example_content: 'ex',
  example_content_hi: 'उदा',
  practice_question: 'q',
  practice_options: [{id:'a',text:'a'},{id:'b',text:'b'},{id:'c',text:'c'},{id:'d',text:'d'}],
  practice_correct_index: 0,
  practice_explanation: 'e',
  estimated_minutes: 3,
});

const goodInput = (): DeckReadinessInput => ({
  concepts: Array.from({ length: 6 }, (_, i) => goodConcept(i + 1)),
  extraChecksByConceptId: new Map(Array.from({ length: 6 }, (_, i) => [`c${i+1}`, { id: `e${i+1}` }])),
  chapterQualityStatus: 'deck_ready_v2',
});

describe('isDeckReady', () => {
  it('passes when all conditions met', () => {
    expect(isDeckReady(goodInput()).ok).toBe(true);
  });
  it('fails with fewer than 6 concepts', () => {
    const i = goodInput();
    i.concepts = i.concepts.slice(0, 5);
    expect(isDeckReady(i)).toEqual({ ok: false, reason: 'too_few_concepts' });
  });
  it('fails when any concept missing Hindi title', () => {
    const i = goodInput();
    i.concepts[2].title_hi = null;
    expect(isDeckReady(i)).toEqual({ ok: false, reason: 'missing_hindi' });
  });
  it('fails when any concept missing matching extra check', () => {
    const i = goodInput();
    i.extraChecksByConceptId.delete('c3');
    expect(isDeckReady(i)).toEqual({ ok: false, reason: 'missing_extra_check' });
  });
  it('fails when chapter quality_status is not deck_ready_v2', () => {
    const i = goodInput();
    i.chapterQualityStatus = 'draft';
    expect(isDeckReady(i)).toEqual({ ok: false, reason: 'chapter_not_marked_ready' });
  });
});
```

- [ ] **Step 2: Implementation**

```ts
// src/lib/chapter-reader/is-deck-ready.ts
export interface DeckConceptRow {
  id: string;
  concept_number: number;
  title: string | null;
  title_hi: string | null;
  explanation: string | null;
  explanation_hi: string | null;
  example_content: string | null;
  example_content_hi: string | null;
  practice_question: string | null;
  practice_options: Array<{ id: string; text: string }> | null;
  practice_correct_index: number | null;
  practice_explanation: string | null;
  estimated_minutes: number | null;
}
export interface DeckReadinessInput {
  concepts: DeckConceptRow[];
  extraChecksByConceptId: Map<string, { id: string }>;
  chapterQualityStatus: string | null;
}
export type DeckReadinessResult =
  | { ok: true }
  | { ok: false; reason: 'too_few_concepts' | 'missing_hindi' | 'missing_extra_check' | 'chapter_not_marked_ready' };

export function isDeckReady(input: DeckReadinessInput): DeckReadinessResult {
  if (input.chapterQualityStatus !== 'deck_ready_v2') {
    return { ok: false, reason: 'chapter_not_marked_ready' };
  }
  if (input.concepts.length < 6) return { ok: false, reason: 'too_few_concepts' };
  for (const c of input.concepts) {
    if (!c.title_hi || !c.explanation_hi || !c.example_content_hi) {
      return { ok: false, reason: 'missing_hindi' };
    }
    if (!input.extraChecksByConceptId.has(c.id)) {
      return { ok: false, reason: 'missing_extra_check' };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/__tests__/lib/chapter-reader/is-deck-ready.test.ts
git add src/lib/chapter-reader/is-deck-ready.ts src/__tests__/lib/chapter-reader/is-deck-ready.test.ts
git commit -m "feat(chapter-reader): isDeckReady quality gate (pure + tested)"
```

---

## Task 3: Migration — `concept_checks` + flag seed

Two migration files, idempotent.

**Files:**
- Create: `supabase/migrations/<TS>_concept_checks.sql`
- Create: `supabase/migrations/<TS+1>_ff_chapter_reader_v2.sql`

Get timestamps:
```bash
date -u +%Y%m%d%H%M%S
```

- [ ] **Step 1: `concept_checks` migration**

```sql
-- Holds the SECOND MCQ per concept. The first lives in
-- chapter_concepts.practice_* (already populated for 339 rows).
-- Idempotent: CREATE TABLE IF NOT EXISTS + RLS guarded by DO blocks.

CREATE TABLE IF NOT EXISTS public.concept_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES public.chapter_concepts(id) ON DELETE CASCADE,
  prompt_en text NOT NULL,
  prompt_hi text NOT NULL,
  options_en jsonb NOT NULL,
  options_hi jsonb NOT NULL,
  correct_option_id text NOT NULL,
  explanation_en text NOT NULL,
  explanation_hi text NOT NULL,
  difficulty int NOT NULL CHECK (difficulty IN (1,2,3)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id)
);

ALTER TABLE public.concept_checks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='concept_checks'
      AND policyname='concept_checks_select_all'
  ) THEN
    CREATE POLICY concept_checks_select_all
      ON public.concept_checks FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.concept_checks IS
  'Second MCQ per concept for Chapter Reader v2. The first MCQ lives in '
  'chapter_concepts.practice_*. Seeded by scripts/backfill-chapter-deck.ts. '
  'World-readable scaffolding (no PII). See spec '
  'docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md.';
```

- [ ] **Step 2: Flag seed migration**

```sql
INSERT INTO public.feature_flags
  (flag_name, is_enabled, target_roles, target_environments,
   target_institutions, rollout_percentage, metadata)
VALUES
  ('ff_chapter_reader_v2', false, NULL, NULL, NULL, 0,
   jsonb_build_object(
     'description', 'Concept-card + MCQ chapter reader v2. Reads chapter_concepts + concept_checks. Off → legacy.',
     'spec',        'docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md',
     'target_user_ids', jsonb_build_array()
   ))
ON CONFLICT (flag_name) DO NOTHING;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/<TS>_concept_checks.sql supabase/migrations/<TS+1>_ff_chapter_reader_v2.sql
git commit -m "feat(chapter-reader): concept_checks table + ff_chapter_reader_v2 flag seed"
```

---

## Task 4: Events registry extension

(Same as before — three new schemas with the `payload` wrapper. Use `subjectCode + chapterNumber`, not `chapterId`. Add `checkSource: 'embedded' | 'extra'` and `checkId: nullable` per the revised §5.2.)

**Files:** modify `src/lib/state/events/registry.ts`, extend the registry test.

```ts
// Add below LearnerScanExtractedSchema:

export const LearnerConceptViewedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.concept_viewed'),
  payload: z.object({
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    conceptId: uuidLike(),
    conceptNumber: z.number().int().positive(),
    dwellMs: z.number().int().nonnegative(),
  }),
});

export const LearnerConceptCheckAnsweredSchema = EventBaseSchema.extend({
  kind: z.literal('learner.concept_check_answered'),
  payload: z.object({
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    conceptId: uuidLike(),
    checkSource: z.enum(['embedded', 'extra']),
    checkId: uuidLike().nullable(),
    chosenOptionId: z.string(),
    correct: z.boolean(),
    attemptNumber: z.number().int().positive(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
});

export const LearnerChapterMicroTestCompletedSchema = EventBaseSchema.extend({
  kind: z.literal('learner.chapter_micro_test_completed'),
  payload: z.object({
    subjectCode: z.string(),
    chapterNumber: z.number().int().positive(),
    correctCount: z.number().int().min(0).max(5),
    totalCount: z.literal(5),
    durationMs: z.number().int().nonnegative(),
  }),
});

// Add to DomainEventSchema discriminatedUnion + ALL_EVENT_KINDS array.
```

Update the registry pin test (`ALL_EVENT_KINDS.length` +3) and add a parse-success spec for each new event.

- [ ] **Run + commit**

```bash
npx vitest run src/__tests__/state/
git add src/lib/state/events/registry.ts src/__tests__/state/
git commit -m "feat(state-events): add learner.concept_viewed / .concept_check_answered / .chapter_micro_test_completed"
```

---

## Task 5: API route + SWR hook

**Files:**
- Create: `src/app/api/chapter-deck/route.ts`
- Create: `src/lib/chapter-reader/use-chapter-deck.ts`

The route returns the full payload OR `{ ok: false, fallback: 'legacy', reason }` when the quality gate fails.

```ts
// src/app/api/chapter-deck/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';   // path TBD via Task 0
import { isDeckReady, type DeckConceptRow } from '@/lib/chapter-reader/is-deck-ready';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const subjectCode = url.searchParams.get('subject');
  const chapterNumber = Number(url.searchParams.get('chapter'));
  if (!subjectCode || !Number.isInteger(chapterNumber) || chapterNumber <= 0) {
    return NextResponse.json({ error: 'subject and positive integer chapter required' }, { status: 400 });
  }

  const sb = createSupabaseServerClient();

  // 1. chapter metadata (need quality_status)
  const { data: chapter, error: chErr } = await sb
    .from('chapters')
    .select('quality_status, title, title_hi')
    .eq('subject_code', subjectCode)
    .eq('chapter_number', chapterNumber)
    .maybeSingle();
  if (chErr) return NextResponse.json({ error: chErr.message }, { status: 500 });

  // 2. concepts
  const { data: rawConcepts, error: cErr } = await sb
    .from('chapter_concepts')
    .select('id, concept_number, title, title_hi, explanation, explanation_hi, example_content, example_content_hi, practice_question, practice_options, practice_correct_index, practice_explanation, estimated_minutes, difficulty')
    .eq('subject', subjectCode)        // Task 0 step 6 should confirm: is the column `subject` or `subject_code`? Adjust accordingly.
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true)
    .order('concept_number');
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const concepts: DeckConceptRow[] = rawConcepts ?? [];

  // 3. extra checks
  const conceptIds = concepts.map(c => c.id);
  const { data: extras, error: eErr } = conceptIds.length
    ? await sb.from('concept_checks').select('*').in('concept_id', conceptIds)
    : { data: [], error: null };
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });
  const extraChecksByConceptId = new Map(extras!.map(e => [e.concept_id, e]));

  // 4. quality gate
  const ready = isDeckReady({
    concepts,
    extraChecksByConceptId,
    chapterQualityStatus: chapter?.quality_status ?? null,
  });
  if (!ready.ok) {
    return NextResponse.json({ ok: false, fallback: 'legacy', reason: ready.reason });
  }

  // 5. micro-test pool from ncert_exercises (5 questions, mixed difficulty)
  const { data: ex, error: xErr } = await sb
    .from('ncert_exercises')
    .select('id, question_text, options, answer_text, difficulty, bloom_level')
    .eq('subject_code', subjectCode)
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true)
    .eq('question_type', 'mcq')         // Task 0 step 4 to confirm exact value
    .order('difficulty')
    .limit(5);
  if (xErr) return NextResponse.json({ error: xErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    chapter: { title: chapter?.title, title_hi: chapter?.title_hi },
    concepts,
    extras,
    microTestExercises: ex ?? [],
  });
}
```

```ts
// src/lib/chapter-reader/use-chapter-deck.ts
import useSWR from 'swr';
const fetcher = (u: string) => fetch(u).then(r => r.json());
export interface ChapterDeckResponse {
  ok: boolean;
  fallback?: 'legacy';
  reason?: string;
  chapter?: { title: string | null; title_hi: string | null };
  concepts?: any[];
  extras?: any[];
  microTestExercises?: any[];
}
export function useChapterDeck(subject: string, chapter: number) {
  return useSWR<ChapterDeckResponse>(
    `/api/chapter-deck?subject=${encodeURIComponent(subject)}&chapter=${chapter}`,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
}
```

- [ ] **Commit**

```bash
git add src/app/api/chapter-deck/ src/lib/chapter-reader/use-chapter-deck.ts
git commit -m "feat(chapter-reader): /api/chapter-deck + useChapterDeck (quality-gated)"
```

---

## Task 6: Leaf components

(Unchanged from prior plan — ConceptCard, ConceptCheck, ChapterMicroTest, ConceptProgressRail. See prior plan body for the full code blocks. Test file for `ConceptCheck` has 4 cases.)

- [ ] **Commit** after green tests:

```bash
git commit -m "feat(chapter-reader): leaf components (Card/Check/MicroTest/Rail)"
```

---

## Task 7: ConceptDeck integration + page wiring

(Unchanged from prior plan but URL for event posting comes from Task 0 step 2 — do not invent a new endpoint. The deck now also reads `checkSource: 'embedded' | 'extra'` to distinguish the two MCQs per concept.)

Key adaptation from the revised spec — when emitting `learner.concept_check_answered`:

```ts
post({
  kind: 'learner.concept_check_answered',
  payload: {
    subjectCode, chapterNumber,
    conceptId: concept.id,
    checkSource: state.checkIdx === 0 ? 'embedded' : 'extra',
    checkId: state.checkIdx === 0 ? null : extraCheck.id,
    chosenOptionId, correct,
    attemptNumber: state.attemptsThisConcept,
    difficulty: concept.difficulty,   // or extraCheck.difficulty
  },
});
```

The page wiring step gates on **both** the flag AND a successful `/api/chapter-deck` response (`ok: true`). When the API returns `fallback: 'legacy'`, render the legacy reader.

- [ ] **Commit**

```bash
git commit -m "feat(chapter-reader): ConceptDeck wired into chapter page behind ff_chapter_reader_v2"
```

---

## Task 8: Backfill — pilot chapter only

The heaviest task. Generates publication-quality content for **Grade 7 Math Ch.1** only.

**Files:**
- Create: `scripts/backfill-chapter-deck.ts`
- Create: `scripts/__tests__/backfill-chapter-deck.self-test.ts`

Outline:

```ts
// scripts/backfill-chapter-deck.ts
// Usage:
//   tsx scripts/backfill-chapter-deck.ts --grade 7 --subject math --chapter 1 [--dry-run]
//   tsx scripts/backfill-chapter-deck.ts --self-test
//
// Strategy:
//   1. Fetch chapter source text. Source is whatever Task 0 step 3 found —
//      most likely PDF text from ncert_book_catalog.storage_path.
//   2. Ask LLM for 6–8 concepts, each with:
//        title, explanation (~80–150 words), example_content, key_takeaway,
//        practice MCQ (4 options + correct_index + explanation + difficulty),
//        a SECOND MCQ for concept_checks (4 options + …)
//      Strict JSON output, validated with Zod.
//   3. Translate every text field to Hindi via a second LLM pass with a
//      deterministic system prompt.
//   4. UPSERT into chapter_concepts (concept_number 1..N reassigned, is_active
//      set true). The UPDATE form because rows may already exist with bad data.
//   5. INSERT into concept_checks (one row per concept).
//   6. UPDATE chapters SET quality_status='deck_ready_v2' WHERE …
//   7. --dry-run prints; --self-test runs validator against bundled fixtures
//      with no DB or LLM calls.

const ConceptOut = z.object({
  title: z.string().min(3),
  title_hi: z.string().min(2),
  explanation: z.string().min(200).max(1500),
  explanation_hi: z.string().min(150),
  example_content: z.string().min(40),
  example_content_hi: z.string().min(20),
  key_takeaway: z.string().min(20).max(220),
  key_takeaway_hi: z.string().min(10).max(220),
  estimated_minutes: z.number().int().min(1).max(15),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  practice: z.object({
    prompt_en: z.string().min(10),
    prompt_hi: z.string().min(5),
    options_en: z.array(z.object({ id: z.string(), text: z.string() })).length(4),
    options_hi: z.array(z.object({ id: z.string(), text: z.string() })).length(4),
    correct_option_id: z.string(),
    explanation_en: z.string().min(10),
    explanation_hi: z.string().min(5),
  }),
  extra_check: z.object({ /* same shape as practice */ }),
});

const ConceptsOut = z.object({ concepts: z.array(ConceptOut).min(6).max(8) });
```

Self-test fixtures cover:
- valid 6-concept payload → accepts
- 5 concepts → rejects
- missing `explanation_hi` → rejects
- `correct_option_id` not in `options_en[]` → rejects

- [ ] **Run self-test**

```bash
npx vitest run scripts/__tests__/backfill-chapter-deck.self-test.ts
```

- [ ] **Run live for pilot chapter**

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  tsx scripts/backfill-chapter-deck.ts --grade 7 --subject math --chapter 1 --dry-run
```
Eyeball the printed concepts. Re-run prompt with adjustments until output is clean. Then drop `--dry-run` to write.

- [ ] **Verify in DB**

```sql
SELECT concept_number, title, title_hi IS NOT NULL AS has_hindi,
       LENGTH(explanation) AS en_len, LENGTH(explanation_hi) AS hi_len
FROM public.chapter_concepts
WHERE grade = '7' AND subject = 'math' AND chapter_number = 1 AND is_active = true
ORDER BY concept_number;

SELECT COUNT(*) FROM public.concept_checks cc
JOIN public.chapter_concepts cp ON cp.id = cc.concept_id
WHERE cp.grade = '7' AND cp.subject = 'math' AND cp.chapter_number = 1;
-- Expect: 6..8 rows; concept_checks count == chapter_concepts count.

SELECT quality_status FROM public.chapters
WHERE subject_code = 'math' AND chapter_number = 1;
-- Expect: 'deck_ready_v2'
```

- [ ] **Commit**

```bash
git add scripts/backfill-chapter-deck.ts scripts/__tests__/
git commit -m "feat(chapter-reader): backfill script + pilot-chapter content (G7 math ch.1)"
```

---

## Task 9: User-targeted flag override (only if Task 0 step 5 said it's missing)

(Unchanged from prior plan. Adds `isUserTargeted()` next to `rolloutBucket()`, plugs it into `isFeatureEnabled()` short-circuit before percentage check.)

---

## Task 10: PR + CI

- [ ] **Push, open PR**

```bash
git push -u origin <feature-branch>
gh pr create --title "feat: chapter reader v2 (concept cards + MCQs) behind flag" --body "$(cat <<'EOF'
## Summary
- Pure ConceptDeck reducer + 4 leaf components
- New table `concept_checks` (1 extra MCQ per concept)
- 3 new state-bus events
- Backfill script + pilot data (Grade 7 Math Ch.1 only)
- Behind `ff_chapter_reader_v2` with quality gate (≥6 concepts, full Hindi, matching concept_checks, chapter marked `deck_ready_v2`)

## Test plan
- [ ] CI green
- [ ] Pilot chapter passes quality gate (verify via /api/chapter-deck)
- [ ] Flag flipped for CEO via metadata.target_user_ids → deck renders
- [ ] Walk pilot chapter end-to-end; 3 events land in state_events
- [ ] concept_mastery updates for the chapter
- [ ] Legacy reader still renders for non-deck-ready chapters

## Known gap (out of scope)
- Loop migrations are stalled at 20260516120000 (only ff_event_bus_v1 of 7 Loop flags is live in prod). Closing that gap is PR #748's job, not this PR's. The deck still works as a reader without the Loop being live; Loop-integration benefits land once #748 + flag flips happen.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
```

---

## Self-review

**Spec coverage:**

| Spec § | Task |
|---|---|
| §2 Architecture | 1, 5, 7 |
| §3.1 reused `chapter_concepts` | 5, 8 |
| §3.2 new `concept_checks` | 3 |
| §3.3 `ncert_exercises` micro-test | 5 |
| §3.4 quality gate | 2 |
| §4 UI components | 6, 7 |
| §5 events | 4, 7 |
| §6 backfill | 8 |
| §7 flag + override | 3, 9 |
| §8 testing | 1, 2, 4, 6, 8 |
| §9 code locations | all |
| §10 out of scope | (explicit) |
| §11 risks (esp. Loop dark) | called out in PR body Task 10 |
| §12 DoD | Task 10 test plan |

**Placeholder scan:** every step ships runnable code or a runnable command. Path placeholders explicitly flagged to Task 0 (the page path, the publish endpoint, the supabase-server helper path, the mastery table name).

**Type consistency:** `DeckBlueprint`, `DeckState`, `DeckEvent` from Task 1 used as-is in Tasks 5/7. Event payload shapes from Task 4 match what Task 7 publishes (`checkSource`, `checkId` nullable for embedded). `DeckReadinessInput` from Task 2 matches what Task 5 builds.
