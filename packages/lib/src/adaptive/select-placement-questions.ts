// packages/lib/src/adaptive/select-placement-questions.ts
//
// Cold-start question selection for the first-run placement check.
//
// WHY A SIBLING AND NOT selectAdaptiveQuestions: that selector starts from the
// student's concept_mastery rows. A placement student has none — it would
// return an empty set every time. This module is the cold-start branch of the
// same family: same table, same column vocabulary, same P6 shape guard, same
// grade-as-string invariant (P5). It is NOT a second question source.
//
// Selection rule: one question per distinct chapter_number, spread across the
// subject's spine for the grade, capped at the lower Bloom levels. Six items.
// The point is coverage, not difficulty — we are establishing priors, not
// measuring ceiling.
//
// Parity fixes applied vs. the reviewed handoff draft (assessment review):
//   (a) `isUsable()` now bounds `correct_answer_index` to 0..3, matching the
//       real live selector's `isUsableCandidate()` in
//       select-adaptive-questions.ts. Previously this only checked
//       `typeof === 'number'`, which is safe today only because of the DB
//       CHECK constraint `chk_valid_answer_index` on question_bank acting as
//       a backstop, not because the selector code itself enforced P6.
//   (b) `SELECT_COLS` now includes `topic_id`, so `PlacementQuestionRow.topicId`
//       actually resolves from the row instead of always being null (the
//       column was never selected, so `q.topic_id` was always `undefined`).

export interface PlacementQueryBuilder {
  select: (cols: string) => PlacementQueryBuilder;
  eq: (col: string, val: unknown) => PlacementQueryBuilder;
  in: (col: string, vals: unknown[]) => PlacementQueryBuilder;
  order: (col: string, opts: { ascending: boolean }) => PlacementQueryBuilder;
  limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
}

export interface PlacementClient {
  from: (table: string) => PlacementQueryBuilder;
}

export interface SelectPlacementQuestionsParams {
  /** subject CODE — question_bank.subject is the text code. */
  subject: string;
  /** P5: grade is a string "6".."12". Passed through verbatim, never coerced. */
  grade: string;
  /** How many probes to return. Product default is 6. */
  count?: number;
}

export interface PlacementQuestionRow {
  id: string;
  topicId: string | null;
  chapterNumber: number | null;
  stem: string;
  options: Array<{ id: string; label: string }>;
}

/** Placement probes stay at recall/comprehension/application. */
const PLACEMENT_BLOOMS = ['remember', 'understand', 'apply'];

const SELECT_COLS =
  'id, question_text, question_hi, question_type, options, correct_answer_index, ' +
  'bloom_level, chapter_number, concept_tag, subject, grade, is_active, topic_id';

function parseOptions(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Subset of the downstream P6 gate — enough to not surface an unusable probe. */
function isUsable(q: any): boolean {
  if (!q || typeof q.id !== 'string') return false;
  if (typeof q.question_text !== 'string' || q.question_text.length === 0) return false;
  if ((q.question_type ?? 'mcq').toLowerCase() !== 'mcq') return false;
  const opts = parseOptions(q.options);
  if (opts.length !== 4) return false;
  // P6 bound check (parity fix (a)): correct_answer_index must be 0..3, same
  // guard the real live selector's isUsableCandidate() applies. The DB CHECK
  // constraint chk_valid_answer_index is a backstop, not a substitute — this
  // selector must not depend on it to serve a well-shaped probe.
  if (typeof q.correct_answer_index !== 'number' || q.correct_answer_index < 0 || q.correct_answer_index > 3) {
    return false;
  }
  return true;
}

function toRow(q: any, isHi: boolean): PlacementQuestionRow {
  const opts = parseOptions(q.options).map((o, i) => ({
    id: String(i),
    label: typeof o === 'string' ? o : String((o as { text?: unknown })?.text ?? ''),
  }));
  return {
    id: q.id,
    topicId: typeof q.topic_id === 'string' ? q.topic_id : null,
    chapterNumber: typeof q.chapter_number === 'number' ? q.chapter_number : null,
    stem: isHi && typeof q.question_hi === 'string' && q.question_hi.length > 0 ? q.question_hi : q.question_text,
    options: opts,
  };
}

/**
 * Returns up to `count` placement probes, at most one per chapter.
 * Never throws: on any data-layer failure it returns an empty array and the
 * caller skips the placement check rather than blocking first run.
 */
export async function selectPlacementQuestions(
  client: PlacementClient,
  params: SelectPlacementQuestionsParams,
  isHi = false,
): Promise<PlacementQuestionRow[]> {
  const count = params.count ?? 6;
  if (count <= 0) return [];

  let rows: any[] = [];
  try {
    const { data, error } = await client
      .from('question_bank')
      .select(SELECT_COLS)
      .eq('subject', params.subject)
      .eq('grade', params.grade)
      .eq('is_active', true)
      .in('bloom_level', PLACEMENT_BLOOMS)
      .order('chapter_number', { ascending: true })
      .limit(count * 12);
    if (error || !Array.isArray(data)) return [];
    rows = data;
  } catch {
    return [];
  }

  // One per chapter, in chapter order — coverage over depth.
  const seenChapters = new Set<number>();
  const picked: PlacementQuestionRow[] = [];
  for (const q of rows) {
    if (picked.length >= count) break;
    if (!isUsable(q)) continue;
    const ch = typeof q.chapter_number === 'number' ? q.chapter_number : -1;
    if (seenChapters.has(ch)) continue;
    seenChapters.add(ch);
    picked.push(toRow(q, isHi));
  }

  // Thin bank for this grade: top up ignoring the one-per-chapter rule rather
  // than returning fewer probes than asked for.
  if (picked.length < count) {
    const chosen = new Set(picked.map((p) => p.id));
    for (const q of rows) {
      if (picked.length >= count) break;
      if (!isUsable(q) || chosen.has(q.id)) continue;
      picked.push(toRow(q, isHi));
      chosen.add(q.id);
    }
  }

  return picked;
}
