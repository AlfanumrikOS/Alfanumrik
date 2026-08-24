/**
 * Foxy North-Star Phase 2 — foxy page mastery read re-point,
 * plus the `?topic_id=` deep-link resolver (defect #10).
 *
 * Pins that the Foxy page's mastery read targets `topic_mastery_rollup`
 * (the fixed view contract) with an EXPLICIT column list — never the old
 * writerless `topic_mastery` table (always empty → every chapter chip
 * rendered 'not_started') and never `select('*')`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromCalls: string[] = [];
const selectCalls: string[] = [];
const eqCalls: Array<[string, string]> = [];
const orderCalls: Array<[string, unknown]> = [];
let rows: unknown[] | null = [];
/** Terminal result for the `.maybeSingle()` chain (resolveTopicId). */
let singleResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock('@alfanumrik/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((cols: string) => { selectCalls.push(cols); return chain; });
  chain.eq = vi.fn((col: string, val: string) => { eqCalls.push([col, val]); return chain; });
  chain.order = vi.fn((col: string, opts: unknown) => { orderCalls.push([col, opts]); return chain; });
  chain.limit = vi.fn(async () => ({ data: rows, error: null }));
  chain.maybeSingle = vi.fn(async () => singleResult);
  return {
    supabase: {
      from: vi.fn((table: string) => { fromCalls.push(table); return chain; }),
    },
  };
});

import {
  fetchMastery,
  TOPIC_MASTERY_ROLLUP_COLUMNS,
} from '@/app/foxy/_lib/fetch-mastery';
import { resolveTopicId, TOPIC_LOOKUP_COLUMNS } from '@/app/foxy/_lib/resolve-topic-id';

beforeEach(() => {
  fromCalls.length = 0;
  selectCalls.length = 0;
  eqCalls.length = 0;
  orderCalls.length = 0;
  rows = [];
  singleResult = { data: null, error: null };
});

describe('foxy fetchMastery — topic_mastery_rollup re-point', () => {
  it('reads from topic_mastery_rollup, never the writerless topic_mastery table', async () => {
    await fetchMastery('student-1', 'science');
    expect(fromCalls).toEqual(['topic_mastery_rollup']);
  });

  it('selects the explicit view-contract columns (no select *)', async () => {
    await fetchMastery('student-1', 'science');
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]).toBe(TOPIC_MASTERY_ROLLUP_COLUMNS);
    expect(selectCalls[0]).not.toContain('*');
    // Every contract column is present.
    for (const col of [
      'student_id', 'subject', 'grade', 'topic_tag', 'chapter_number',
      'mastery_percent', 'mastery_level', 'mastery_probability', 'next_review_at',
    ]) {
      expect(selectCalls[0]).toContain(col);
    }
  });

  it('filters by student_id + subject and orders by chapter_number (view has no updated_at)', async () => {
    await fetchMastery('student-1', 'math');
    expect(eqCalls).toEqual([
      ['student_id', 'student-1'],
      ['subject', 'math'],
    ]);
    expect(orderCalls).toEqual([['chapter_number', { ascending: true }]]);
  });

  it('returns rows with the fields downstream chips read (topic_tag / mastery_level / mastery_percent)', async () => {
    rows = [{
      student_id: 'student-1', subject: 'science', grade: '9',
      topic_tag: 'Light', chapter_number: 10,
      mastery_percent: 72, mastery_level: 'proficient',
      mastery_probability: 0.72, next_review_at: null,
    }];
    const result = await fetchMastery('student-1', 'science');
    expect(result).toHaveLength(1);
    expect(result[0].topic_tag).toBe('Light');
    expect(result[0].mastery_level).toBe('proficient');
    expect(result[0].mastery_percent).toBe(72);
  });

  it('degrades to [] when the view returns null', async () => {
    rows = null;
    await expect(fetchMastery('student-1', 'science')).resolves.toEqual([]);
  });
});

/* ── resolveTopicId — `?topic_id=` becomes a real deep link (defect #10) ────
 *
 * /progress' low-mastery list, the Revision Center's due buckets and its
 * primary CTA all hold a `concept_mastery.topic_id` and no topic name. They
 * linked `/foxy?topic_id=<uuid>`, and the Foxy page read only `topic`,
 * `chapter`, `subject`, `mode`, `grade` — so the tap landed on a completely
 * unscoped Foxy. Resolving the id here is what turns that into a real
 * subject + topic handoff through the existing switchSubject path.
 */
describe('foxy resolveTopicId — topic_id deep-link resolution', () => {
  const ROW = {
    id: 'topic-uuid-1',
    title: 'Real Numbers',
    title_hi: 'वास्तविक संख्याएँ',
    chapter_number: 1,
    subjects: { code: 'math' },
  };

  it('resolves a topic_id to {title, titleHi, chapter, subject CODE}', async () => {
    singleResult = { data: ROW, error: null };
    const resolved = await resolveTopicId('topic-uuid-1');

    expect(fromCalls).toEqual(['curriculum_topics']);
    expect(selectCalls[0]).toBe(TOPIC_LOOKUP_COLUMNS);
    expect(selectCalls[0]).not.toContain('*');
    expect(eqCalls).toEqual([['id', 'topic-uuid-1']]);
    expect(resolved).toEqual({
      topicId: 'topic-uuid-1',
      title: 'Real Numbers',
      titleHi: 'वास्तविक संख्याएँ',
      chapterNumber: 1,
      subjectCode: 'math',
    });
  });

  it('accepts the embedded relation as an array too (PostgREST client variance)', async () => {
    singleResult = { data: { ...ROW, subjects: [{ code: 'science' }] }, error: null };
    const resolved = await resolveTopicId('topic-uuid-1');
    expect(resolved?.subjectCode).toBe('science');
  });

  it('returns null (never a partial guess) for a missing id, an empty id, or a query error', async () => {
    expect(await resolveTopicId(null)).toBeNull();
    expect(await resolveTopicId('   ')).toBeNull();
    // No query is issued for an absent id.
    expect(fromCalls).toEqual([]);

    singleResult = { data: null, error: { message: 'no rows' } };
    expect(await resolveTopicId('topic-uuid-1')).toBeNull();
  });

  it('never issues a query without a lookup — a failed resolve must not block the page', async () => {
    singleResult = { data: null, error: null };
    await expect(resolveTopicId('topic-uuid-1')).resolves.toBeNull();
  });
});
