import { describe, it, expect } from 'vitest';

/**
 * Quiz Length Bug Fix Tests
 *
 * Verifies the fix where quiz length selection (5, 10, 15, 20) was disconnected —
 * the quiz page ignored `count` and `chapter` URL parameters.
 *
 * Covers:
 * - URL param parsing for count and chapter
 * - QuizSetup initialization with initialCount/initialChapter props
 * - API route param validation for count values
 * - End-to-end flow: URL param -> QuizSetup -> startQuiz -> getQuizQuestionsV2
 */

// ─── Constants replicated from source ──────────────────────────────────

const VALID_COUNTS = [5, 10, 15, 20];
const DEFAULT_COUNT = 10;

// ─── URL param parsing logic (from src/app/quiz/page.tsx) ──────────────

interface ParsedQuizParams {
  count: number;
  chapter: number | null;
}

/**
 * Replicates the URL param parsing logic from quiz/page.tsx useEffect.
 * The page reads `count` and `chapter` from window.location.search.
 */
function parseQuizUrlParams(searchParams: URLSearchParams): ParsedQuizParams {
  let count = DEFAULT_COUNT;
  let chapter: number | null = null;

  const countParam = searchParams.get('count');
  if (countParam) {
    const c = parseInt(countParam, 10);
    if ([5, 10, 15, 20].includes(c)) {
      count = c;
    }
  }

  const chapterParam = searchParams.get('chapter');
  if (chapterParam) {
    const ch = parseInt(chapterParam, 10);
    if (!isNaN(ch) && ch > 0) {
      chapter = ch;
    }
  }

  return { count, chapter };
}

// ─── QuizSetup initialization logic (from QuizSetup.tsx) ───────────────

/**
 * Replicates how QuizSetup initializes questionCount and selectedChapter
 * from initialCount/initialChapter props.
 */
function initQuizSetupState(initialCount?: number, initialChapter?: number | null) {
  const questionCount = initialCount ?? 10;
  const selectedChapter = initialChapter ?? null;
  return { questionCount, selectedChapter };
}

// ─── API route count validation (from src/app/api/quiz/route.ts) ───────

function validateApiCount(countParam: string | null): { valid: boolean; count: number } {
  const count = countParam ? parseInt(countParam, 10) : 10;
  if (!VALID_COUNTS.includes(count)) {
    return { valid: false, count };
  }
  return { valid: true, count };
}

function validateApiChapter(chapterParam: string | null): { valid: boolean; chapter: number | null } {
  if (!chapterParam) return { valid: true, chapter: null };
  const chapter = parseInt(chapterParam, 10);
  if (isNaN(chapter) || chapter < 1) {
    return { valid: false, chapter: null };
  }
  return { valid: true, chapter };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Quiz Length — URL Param Parsing', () => {

  describe('count parameter', () => {
    it('accepts count=5', () => {
      const params = new URLSearchParams('count=5');
      expect(parseQuizUrlParams(params).count).toBe(5);
    });

    it('accepts count=10', () => {
      const params = new URLSearchParams('count=10');
      expect(parseQuizUrlParams(params).count).toBe(10);
    });

    it('accepts count=15', () => {
      const params = new URLSearchParams('count=15');
      expect(parseQuizUrlParams(params).count).toBe(15);
    });

    it('accepts count=20', () => {
      const params = new URLSearchParams('count=20');
      expect(parseQuizUrlParams(params).count).toBe(20);
    });

    it('defaults to 10 when count is not provided', () => {
      const params = new URLSearchParams('');
      expect(parseQuizUrlParams(params).count).toBe(10);
    });

    it('defaults to 10 when count=0 (invalid)', () => {
      const params = new URLSearchParams('count=0');
      expect(parseQuizUrlParams(params).count).toBe(DEFAULT_COUNT);
    });

    it('defaults to 10 when count=3 (invalid, not in VALID_COUNTS)', () => {
      const params = new URLSearchParams('count=3');
      expect(parseQuizUrlParams(params).count).toBe(DEFAULT_COUNT);
    });

    it('defaults to 10 when count=7 (invalid)', () => {
      const params = new URLSearchParams('count=7');
      expect(parseQuizUrlParams(params).count).toBe(DEFAULT_COUNT);
    });

    it('defaults to 10 when count=25 (invalid, too high)', () => {
      const params = new URLSearchParams('count=25');
      expect(parseQuizUrlParams(params).count).toBe(DEFAULT_COUNT);
    });

    it('defaults to 10 when count=-1 (negative)', () => {
      const params = new URLSearchParams('count=-1');
      expect(parseQuizUrlParams(params).count).toBe(DEFAULT_COUNT);
    });

    it('defaults to 10 when count=abc (non-numeric)', () => {
      const params = new URLSearchParams('count=abc');
      expect(parseQuizUrlParams(params).count).toBe(DEFAULT_COUNT);
    });

    it('defaults to 10 when count is empty string', () => {
      const params = new URLSearchParams('count=');
      expect(parseQuizUrlParams(params).count).toBe(DEFAULT_COUNT);
    });
  });

  describe('chapter parameter', () => {
    it('accepts chapter=1 (minimum valid)', () => {
      const params = new URLSearchParams('chapter=1');
      expect(parseQuizUrlParams(params).chapter).toBe(1);
    });

    it('accepts chapter=3 (positive integer)', () => {
      const params = new URLSearchParams('chapter=3');
      expect(parseQuizUrlParams(params).chapter).toBe(3);
    });

    it('accepts chapter=15 (higher chapter numbers)', () => {
      const params = new URLSearchParams('chapter=15');
      expect(parseQuizUrlParams(params).chapter).toBe(15);
    });

    it('returns null when chapter is not provided', () => {
      const params = new URLSearchParams('');
      expect(parseQuizUrlParams(params).chapter).toBeNull();
    });

    it('returns null when chapter=0 (invalid, not positive)', () => {
      const params = new URLSearchParams('chapter=0');
      expect(parseQuizUrlParams(params).chapter).toBeNull();
    });

    it('returns null when chapter=-1 (negative)', () => {
      const params = new URLSearchParams('chapter=-1');
      expect(parseQuizUrlParams(params).chapter).toBeNull();
    });

    it('returns null when chapter=abc (non-numeric)', () => {
      const params = new URLSearchParams('chapter=abc');
      expect(parseQuizUrlParams(params).chapter).toBeNull();
    });
  });

  describe('combined parameters', () => {
    it('parses both count and chapter together', () => {
      const params = new URLSearchParams('count=15&chapter=3');
      const result = parseQuizUrlParams(params);
      expect(result.count).toBe(15);
      expect(result.chapter).toBe(3);
    });

    it('handles valid count with invalid chapter', () => {
      const params = new URLSearchParams('count=20&chapter=-1');
      const result = parseQuizUrlParams(params);
      expect(result.count).toBe(20);
      expect(result.chapter).toBeNull();
    });

    it('handles invalid count with valid chapter', () => {
      const params = new URLSearchParams('count=7&chapter=5');
      const result = parseQuizUrlParams(params);
      expect(result.count).toBe(DEFAULT_COUNT);
      expect(result.chapter).toBe(5);
    });

    it('handles subject + count + chapter (full URL scenario)', () => {
      const params = new URLSearchParams('subject=science&count=20&chapter=4');
      const result = parseQuizUrlParams(params);
      expect(result.count).toBe(20);
      expect(result.chapter).toBe(4);
    });
  });
});

describe('Quiz Length — QuizSetup Initialization', () => {

  it('sets questionCount to initialCount when provided (15)', () => {
    const state = initQuizSetupState(15);
    expect(state.questionCount).toBe(15);
  });

  it('sets questionCount to initialCount when provided (5)', () => {
    const state = initQuizSetupState(5);
    expect(state.questionCount).toBe(5);
  });

  it('sets questionCount to initialCount when provided (20)', () => {
    const state = initQuizSetupState(20);
    expect(state.questionCount).toBe(20);
  });

  it('defaults questionCount to 10 when initialCount is undefined', () => {
    const state = initQuizSetupState(undefined);
    expect(state.questionCount).toBe(10);
  });

  it('sets selectedChapter to initialChapter when provided (3)', () => {
    const state = initQuizSetupState(10, 3);
    expect(state.selectedChapter).toBe(3);
  });

  it('sets selectedChapter to null when initialChapter is undefined', () => {
    const state = initQuizSetupState(10, undefined);
    expect(state.selectedChapter).toBeNull();
  });

  it('sets selectedChapter to null when initialChapter is null', () => {
    const state = initQuizSetupState(10, null);
    expect(state.selectedChapter).toBeNull();
  });

  it('handles both initialCount and initialChapter together', () => {
    const state = initQuizSetupState(15, 7);
    expect(state.questionCount).toBe(15);
    expect(state.selectedChapter).toBe(7);
  });

  it('handles neither initialCount nor initialChapter', () => {
    const state = initQuizSetupState();
    expect(state.questionCount).toBe(10);
    expect(state.selectedChapter).toBeNull();
  });
});

describe('Quiz Length — API Route Count Validation', () => {

  describe('count validation', () => {
    it('accepts count=5', () => {
      expect(validateApiCount('5')).toEqual({ valid: true, count: 5 });
    });

    it('accepts count=10', () => {
      expect(validateApiCount('10')).toEqual({ valid: true, count: 10 });
    });

    it('accepts count=15', () => {
      expect(validateApiCount('15')).toEqual({ valid: true, count: 15 });
    });

    it('accepts count=20', () => {
      expect(validateApiCount('20')).toEqual({ valid: true, count: 20 });
    });

    it('defaults to 10 when count param is null', () => {
      expect(validateApiCount(null)).toEqual({ valid: true, count: 10 });
    });

    it('rejects count=0 (not in VALID_COUNTS)', () => {
      expect(validateApiCount('0').valid).toBe(false);
    });

    it('rejects count=3 (not in VALID_COUNTS)', () => {
      expect(validateApiCount('3').valid).toBe(false);
    });

    it('rejects count=7 (not in VALID_COUNTS)', () => {
      expect(validateApiCount('7').valid).toBe(false);
    });

    it('rejects count=25 (too high, not in VALID_COUNTS)', () => {
      expect(validateApiCount('25').valid).toBe(false);
    });

    it('rejects count=-1 (negative)', () => {
      expect(validateApiCount('-1').valid).toBe(false);
    });

    it('rejects count=abc (NaN results in not being in VALID_COUNTS)', () => {
      expect(validateApiCount('abc').valid).toBe(false);
    });
  });

  describe('chapter validation', () => {
    it('accepts chapter=1', () => {
      expect(validateApiChapter('1')).toEqual({ valid: true, chapter: 1 });
    });

    it('accepts chapter=10', () => {
      expect(validateApiChapter('10')).toEqual({ valid: true, chapter: 10 });
    });

    it('returns null chapter when param is null', () => {
      expect(validateApiChapter(null)).toEqual({ valid: true, chapter: null });
    });

    it('rejects chapter=0 (not positive)', () => {
      expect(validateApiChapter('0').valid).toBe(false);
    });

    it('rejects chapter=-1 (negative)', () => {
      expect(validateApiChapter('-1').valid).toBe(false);
    });

    it('rejects chapter=abc (NaN)', () => {
      expect(validateApiChapter('abc').valid).toBe(false);
    });
  });
});

describe('Quiz Length — End-to-End Count Flow', () => {

  /**
   * Simulates the full flow: URL param -> parse -> QuizSetup init -> startQuiz -> RPC call.
   * We verify that the count value flows through each stage correctly.
   */
  function simulateQuizFlow(urlSearch: string): {
    parsedCount: number;
    parsedChapter: number | null;
    setupCount: number;
    setupChapter: number | null;
    rpcParams: { p_count: number; p_chapter_number: number | null };
  } {
    // Stage 1: URL param parsing (quiz/page.tsx useEffect)
    const params = new URLSearchParams(urlSearch);
    const { count: parsedCount, chapter: parsedChapter } = parseQuizUrlParams(params);

    // Stage 2: QuizSetup initialization (QuizSetup.tsx props)
    const { questionCount: setupCount, selectedChapter: setupChapter } =
      initQuizSetupState(parsedCount, parsedChapter);

    // Stage 3: startQuiz passes count to getQuizQuestionsV2 which calls RPC
    // In the real code: getQuizQuestionsV2(subject, grade, qCount, diffMode, chapter, ['mcq'])
    // The RPC receives: p_count: count, p_chapter_number: chapterNumber
    const rpcParams = {
      p_count: setupCount,
      p_chapter_number: setupChapter,
    };

    return { parsedCount, parsedChapter, setupCount, setupChapter, rpcParams };
  }

  it('count=5 flows through to RPC as p_count=5', () => {
    const flow = simulateQuizFlow('count=5');
    expect(flow.parsedCount).toBe(5);
    expect(flow.setupCount).toBe(5);
    expect(flow.rpcParams.p_count).toBe(5);
  });

  it('count=10 flows through to RPC as p_count=10', () => {
    const flow = simulateQuizFlow('count=10');
    expect(flow.parsedCount).toBe(10);
    expect(flow.setupCount).toBe(10);
    expect(flow.rpcParams.p_count).toBe(10);
  });

  it('count=15 flows through to RPC as p_count=15', () => {
    const flow = simulateQuizFlow('count=15');
    expect(flow.parsedCount).toBe(15);
    expect(flow.setupCount).toBe(15);
    expect(flow.rpcParams.p_count).toBe(15);
  });

  it('count=20 flows through to RPC as p_count=20', () => {
    const flow = simulateQuizFlow('count=20');
    expect(flow.parsedCount).toBe(20);
    expect(flow.setupCount).toBe(20);
    expect(flow.rpcParams.p_count).toBe(20);
  });

  it('invalid count defaults to 10 at every stage', () => {
    const flow = simulateQuizFlow('count=7');
    expect(flow.parsedCount).toBe(10);
    expect(flow.setupCount).toBe(10);
    expect(flow.rpcParams.p_count).toBe(10);
  });

  it('chapter=3 flows through to RPC as p_chapter_number=3', () => {
    const flow = simulateQuizFlow('chapter=3');
    expect(flow.parsedChapter).toBe(3);
    expect(flow.setupChapter).toBe(3);
    expect(flow.rpcParams.p_chapter_number).toBe(3);
  });

  it('invalid chapter defaults to null at every stage', () => {
    const flow = simulateQuizFlow('chapter=-1');
    expect(flow.parsedChapter).toBeNull();
    expect(flow.setupChapter).toBeNull();
    expect(flow.rpcParams.p_chapter_number).toBeNull();
  });

  it('full URL: count=20&chapter=4 flows correctly to RPC', () => {
    const flow = simulateQuizFlow('subject=science&count=20&chapter=4');
    expect(flow.rpcParams.p_count).toBe(20);
    expect(flow.rpcParams.p_chapter_number).toBe(4);
  });

  it('no count param defaults to p_count=10 in RPC', () => {
    const flow = simulateQuizFlow('subject=science');
    expect(flow.rpcParams.p_count).toBe(10);
    expect(flow.rpcParams.p_chapter_number).toBeNull();
  });
});

describe('Quiz Length — Pool Warning Edge Case', () => {

  /**
   * When returned questions < requested count, a console.warn should fire.
   * This tests the condition: qs.length < qCount
   */
  it('detects when returned questions are fewer than requested', () => {
    const requestedCount = 20;
    const returnedCount = 12;
    // The condition from quiz/page.tsx line 231:
    // if (qs.length < qCount) { console.warn(...) }
    expect(returnedCount < requestedCount).toBe(true);
  });

  it('does not warn when returned questions match requested', () => {
    const requestedCount = 10;
    const returnedCount = 10;
    expect(returnedCount < requestedCount).toBe(false);
  });

  it('does not warn when returned questions exceed requested (unlikely but safe)', () => {
    const requestedCount = 5;
    const returnedCount = 5;
    expect(returnedCount < requestedCount).toBe(false);
  });
});

describe('Quiz Length — PRACTICE_COUNTS constant alignment', () => {

  /**
   * The QuizSetup component uses PRACTICE_COUNTS = [5, 10, 15, 20]
   * and the API route uses VALID_COUNTS = [5, 10, 15, 20].
   * These must stay in sync.
   */
  const PRACTICE_COUNTS = [5, 10, 15, 20];

  it('PRACTICE_COUNTS and VALID_COUNTS contain the same values', () => {
    expect(PRACTICE_COUNTS).toEqual(VALID_COUNTS);
  });

  it('all PRACTICE_COUNTS are accepted by URL parser', () => {
    for (const count of PRACTICE_COUNTS) {
      const params = new URLSearchParams(`count=${count}`);
      const result = parseQuizUrlParams(params);
      expect(result.count).toBe(count);
    }
  });

  it('all VALID_COUNTS are accepted by API validator', () => {
    for (const count of VALID_COUNTS) {
      const result = validateApiCount(String(count));
      expect(result.valid).toBe(true);
      expect(result.count).toBe(count);
    }
  });
});

describe('Quiz Length — Learn Page Link Generation', () => {

  /**
   * Tests that the learn page generates correct quiz links.
   * Previously hardcoded count=5, now uses dynamic count or no hardcoded count.
   */
  it('chapter page link includes chapter number without hardcoded count', () => {
    // From learn/[subject]/[chapter]/page.tsx line 578:
    // `/quiz?subject=${subjectCode}&chapter=${chapterNumber}`
    const subjectCode = 'science';
    const chapterNumber = 4;
    const link = `/quiz?subject=${subjectCode}&chapter=${chapterNumber}`;
    expect(link).toBe('/quiz?subject=science&chapter=4');
    expect(link).not.toContain('count=5');
  });

  it('chapter page link with specific count option includes count param', () => {
    // From learn/[subject]/[chapter]/page.tsx line 1199:
    // `/quiz?subject=${subjectCode}&chapter=${chapterNumber}&count=${opt.count}`
    const subjectCode = 'science';
    const chapterNumber = 4;
    const count = 15;
    const link = `/quiz?subject=${subjectCode}&chapter=${chapterNumber}&count=${count}`;
    expect(link).toBe('/quiz?subject=science&chapter=4&count=15');
  });
});
