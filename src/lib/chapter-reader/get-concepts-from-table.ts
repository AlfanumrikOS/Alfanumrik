/**
 * src/lib/chapter-reader/get-concepts-from-table.ts
 *
 * The CHAPTER READER V2 data source.
 *
 * Reads from the curated `chapter_concepts` table (one row per concept, with
 * title + explanation + worked example + key formula + embedded MCQ + Hindi
 * fields) and returns the same `CurriculumTopic` shape the existing Practice
 * mode UI in `src/app/learn/[subject]/[chapter]/page.tsx` already expects.
 *
 * This is a drop-in replacement for the chunk-grouped output of
 * `getChapterTopics()` in `src/lib/supabase.ts`. That helper currently groups
 * raw RAG chunks by heuristics and produces excerpts that look like a
 * textbook dump. This helper produces structured concept cards instead.
 *
 * Quality gate (`isUsableChapterDeck`): caller decides whether to use these
 * rows or fall back to legacy. Reasons it might fall back:
 *   - fewer than `MIN_CONCEPTS` active rows for the chapter
 *   - explanations too short (likely placeholders)
 *
 * Spec: docs/superpowers/specs/2026-05-12-chapter-reader-v2-concept-cards-design.md
 */

import { supabase } from '@/lib/supabase-client';
import type { CurriculumTopic } from '@/lib/types';

/** Minimum number of concepts a chapter needs to render the v2 deck.
 *  Set to 3 (not 6) because some smaller chapters legitimately have fewer
 *  concepts; the quality of the rows matters more than the count. */
export const MIN_CONCEPTS = 3;

/** Minimum length of `explanation` (chars) for a concept row to count as
 *  "usable". 80 chars filters out the 1-line placeholder LPs we saw on
 *  Grade 7 math ch.1 ("Addition, Subtraction, Multiplication, Division.
 *  Key approach: Apply sign rules step by step.") while letting genuine
 *  100-word explanations through. */
const MIN_EXPLANATION_LEN = 80;

/** Subset of `chapter_concepts` columns the UI actually needs. */
interface ChapterConceptRow {
  id: string;
  concept_number: number;
  title: string | null;
  title_hi: string | null;
  explanation: string | null;
  explanation_hi: string | null;
  example_content: string | null;
  example_content_hi: string | null;
  learning_objective: string | null;
  learning_objective_hi: string | null;
  key_formula: string | null;
  difficulty: number | null;
  estimated_minutes: number | null;
  bloom_level: string | null;
}

/**
 * Fetch curated concept rows for a chapter from `chapter_concepts`.
 * Returns the same `CurriculumTopic[]` shape `getChapterTopics()` returns
 * so the caller can swap data sources without touching the render path.
 *
 * Returns `[]` (not null) when the chapter has no active rows — let the
 * caller fall through to the legacy RAG-chunks path.
 */
export async function getChapterTopicsFromConcepts(
  subject: string,
  grade: string,
  chapterNumber: number,
): Promise<CurriculumTopic[]> {
  // The table stores `grade` as text — sometimes "7", sometimes "Grade 7".
  // Normalise to bare digits for the eq() match; the live data we audited
  // (2026-05-12) uses bare digits.
  const normalisedGrade = grade.replace(/^Grade\s*/i, '').trim();

  const { data, error } = await supabase
    .from('chapter_concepts')
    .select(
      'id, concept_number, title, title_hi, explanation, explanation_hi, ' +
      'example_content, example_content_hi, learning_objective, learning_objective_hi, ' +
      'key_formula, difficulty, estimated_minutes, bloom_level, slug',
    )
    .eq('subject', subject)
    .eq('grade', normalisedGrade)
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true)
    .order('concept_number', { ascending: true });

  if (error) {
    console.error('[chapter-reader] getChapterTopicsFromConcepts:', error.message);
    return [];
  }
  // Supabase's typed client treats `.select(literal-string)` as a loose
  // PostgrestResponse whose row type is `GenericStringError | …` when the
  // schema typings aren't generated. Cast through unknown to our locally
  // declared row shape; the column list above matches ChapterConceptRow.
  const rows = (data ?? []) as unknown as ChapterConceptRow[];
  return rows.map(rowToTopic);
}

/**
 * Pure: decide whether a set of concept rows is good enough to render the
 * v2 deck. Tested in isolation in is-deck-usable.test.ts.
 */
export function isUsableChapterDeck(rows: CurriculumTopic[]): boolean {
  if (rows.length < MIN_CONCEPTS) return false;
  for (const r of rows) {
    if (!r.title || r.title.trim().length < 3) return false;
    if (!r.description || r.description.trim().length < MIN_EXPLANATION_LEN) return false;
  }
  return true;
}

/** Internal — keep at the bottom so the public exports come first. */
function rowToTopic(r: ChapterConceptRow): CurriculumTopic {
  // Build description = explanation + (worked example if present), so the
  // existing UI's <p>{topic.description}</p> renders one cohesive concept.
  // Whitespace preserved by the consumer's `white-space: pre-wrap`.
  const exampleBlock = r.example_content
    ? `\n\nWorked example:\n${r.example_content}`
    : '';
  const description = `${r.explanation ?? ''}${exampleBlock}`.trim();

  // `learning_objectives` is an array column on `curriculum_topics` (the
  // legacy table). Here we split the single text field into 1-3 bullets
  // for parity, on full-stops or newlines.
  const lo = r.learning_objective
    ? r.learning_objective
        .split(/[\n.]+/)
        .map(s => s.trim())
        .filter(s => s.length > 3)
        .slice(0, 3)
    : null;

  return {
    id: r.id,
    subject_id: '',
    title: r.title ?? `Concept ${r.concept_number}`,
    title_hi: r.title_hi,
    description,
    grade: '',                             // not surfaced by the page
    board: 'CBSE',
    chapter_number: null,                  // page passes this independently
    difficulty_level: r.difficulty ?? 1,
    estimated_minutes: r.estimated_minutes,
    tags: null,
    is_active: true,
    display_order: r.concept_number,
    learning_objectives: lo,
    bloom_focus: r.bloom_level,
    ncert_page_range: null,
    topic_type: 'curated_concept',
    explanation: r.explanation,
    explanation_hi: r.explanation_hi,
    example_content: r.example_content,
    example_content_hi: r.example_content_hi,
    key_formula: r.key_formula,
    slug: r.slug,
  } as any;
}
