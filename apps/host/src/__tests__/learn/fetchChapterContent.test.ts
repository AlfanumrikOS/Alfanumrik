import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the supabase admin client BEFORE importing the fetcher.
// Each query() call returns one chained builder; the test sets the next
// `data`/`error` payload via mockOrder.mockResolvedValueOnce.
const mockOrder = vi.fn();
const mockEq = vi.fn(() => ({ eq: mockEq, order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

// Bypass the in-process cache so each test gets a fresh DB call.
vi.mock('@alfanumrik/lib/cache', () => ({
  CACHE_TTL: { STATIC: 0 },
  cacheFetch: async <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
}));

import { fetchChapterContent } from '@alfanumrik/lib/learn/fetchChapterContent';

describe('fetchChapterContent', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockEq.mockClear();
    mockOrder.mockReset();
  });

  it('returns null when rag_content_chunks has no rows for the chapter', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });

    const result = await fetchChapterContent({
      subjectCode: 'math',
      grade: '9',
      chapterNumber: 1,
    });

    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('rag_content_chunks');
  });

  it('returns null when supabase errors', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const result = await fetchChapterContent({
      subjectCode: 'math',
      grade: '9',
      chapterNumber: 1,
    });

    expect(result).toBeNull();
  });

  it('concatenates chunk_text in chunk_index order', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { id: 'a', chapter_title: 'Chapter 1', chunk_index: 0, page_number: 1, chunk_text: 'First.' },
        { id: 'b', chapter_title: 'Chapter 1', chunk_index: 1, page_number: 1, chunk_text: 'Second.' },
      ],
      error: null,
    });

    const result = await fetchChapterContent({
      subjectCode: 'science',
      grade: '7',
      chapterNumber: 3,
    });

    expect(result).not.toBeNull();
    expect(result!.markdown).toBe('First.\n\nSecond.');
    expect(result!.sources).toHaveLength(2);
    expect(result!.sources[0].chunk_id).toBe('a');
    expect(result!.truncated).toBe(false);
  });

  it('truncates at 50 KB and sets truncated=true', async () => {
    const big = 'x'.repeat(40_000); // each chunk ~40 KB
    mockOrder.mockResolvedValueOnce({
      data: [
        { id: 'a', chapter_title: 'C', chunk_index: 0, page_number: 1, chunk_text: big },
        { id: 'b', chapter_title: 'C', chunk_index: 1, page_number: 1, chunk_text: big },
        { id: 'c', chapter_title: 'C', chunk_index: 2, page_number: 1, chunk_text: big },
      ],
      error: null,
    });

    const result = await fetchChapterContent({
      subjectCode: 'science',
      grade: '7',
      chapterNumber: 1,
    });

    expect(result).not.toBeNull();
    expect(result!.truncated).toBe(true);
    // First chunk fits (40k); second pushes past 50k cap so it's dropped before append.
    expect(result!.sources).toHaveLength(1);
  });

  it('skips empty chunk_text rows but keeps the rest', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { id: 'a', chapter_title: 'C', chunk_index: 0, page_number: 1, chunk_text: '' },
        { id: 'b', chapter_title: 'C', chunk_index: 1, page_number: 1, chunk_text: 'Real.' },
      ],
      error: null,
    });

    const result = await fetchChapterContent({
      subjectCode: 'math',
      grade: '6',
      chapterNumber: 2,
    });

    expect(result).not.toBeNull();
    expect(result!.markdown).toBe('Real.');
    expect(result!.sources.map((s) => s.chunk_id)).toEqual(['b']);
  });

  // ── Phase 3 follow-up: language filter + Hindi→English fallback ───
  it('returns the requested language when chunks exist (hi requested, hi available)', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{ id: 'a', chapter_title: 'अध्याय 1', chunk_index: 0, page_number: 1, chunk_text: 'पाठ' }],
      error: null,
    });

    const result = await fetchChapterContent({
      subjectCode: 'math',
      grade: '9',
      chapterNumber: 1,
      language: 'hi',
    });

    expect(result).not.toBeNull();
    expect(result!.language).toBe('hi');
    expect(result!.fellBackFromHindi).toBe(false);
  });

  it('falls back to English when Hindi requested but unavailable', async () => {
    // First call (hi): no rows. Second call (en): has rows.
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    mockOrder.mockResolvedValueOnce({
      data: [{ id: 'a', chapter_title: 'Chapter 1', chunk_index: 0, page_number: 1, chunk_text: 'English text.' }],
      error: null,
    });

    const result = await fetchChapterContent({
      subjectCode: 'math',
      grade: '9',
      chapterNumber: 1,
      language: 'hi',
    });

    expect(result).not.toBeNull();
    expect(result!.language).toBe('en');
    expect(result!.fellBackFromHindi).toBe(true);
    expect(result!.markdown).toBe('English text.');
  });

  it('does NOT fall back to Hindi when English is requested but missing', async () => {
    // English request finds nothing → return null. Don't try Hindi.
    mockOrder.mockResolvedValueOnce({ data: [], error: null });

    const result = await fetchChapterContent({
      subjectCode: 'math',
      grade: '9',
      chapterNumber: 1,
      language: 'en',
    });

    expect(result).toBeNull();
  });
});
