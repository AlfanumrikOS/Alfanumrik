// supabase/functions/grounded-answer/__tests__/coverage.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies coverage precheck against a stubbed Supabase client:
//   - chapter_not_ready when rag_status != 'ready'
//   - returns up to 3 alternatives
//   - ready:true when rag_status == 'ready'
//   - subject-wide query (chapter_number = null) handled separately

import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { checkCoverage, suggestAlternatives } from '../coverage.ts';

// Query-specific stub: the coverage precheck uses two distinct call paths.
//   (1) Specific chapter:  from(...).select().eq().eq().eq().maybeSingle()
//   (2) Alternatives query:from(...).select().eq().eq().eq().eq().order().limit()
//   (3) Subject-wide query (same shape as alternatives but limit 1)
// We emulate the chainable API with small objects that return the same
// fixture at every terminal method so the test stays readable.

interface Fixtures {
  syllabus_row?: { rag_status: string } | null;
  alternatives?: Array<{
    grade: string;
    subject_code: string;
    chapter_number: number;
    chapter_title: string;
  }>;
  subject_has_ready?: boolean;
}

function stubSupabase(fixtures: Fixtures) {
  // Alternatives / subject-wide branch (has .order().limit())
  const listBuilder = {
    // deno-lint-ignore no-explicit-any
    eq(this: any) {
      return this;
    },
    order() {
      return {
        limit: (n: number) => {
          if (fixtures.subject_has_ready !== undefined) {
            // Subject-wide query path in checkCoverage expects data with
            // length >= 1 when subject has at least one ready chapter.
            return Promise.resolve({
              data: fixtures.subject_has_ready
                ? [{ chapter_number: 1, chapter_title: 'Stub' }]
                : [],
              error: null,
            });
          }
          return Promise.resolve({
            data: (fixtures.alternatives ?? []).slice(0, n),
            error: null,
          });
        },
      };
    },
  };

  // Specific chapter branch (ends at .maybeSingle())
  const chapterBuilder = {
    // deno-lint-ignore no-explicit-any
    eq(this: any) {
      return this;
    },
    maybeSingle: () =>
      Promise.resolve({ data: fixtures.syllabus_row ?? null, error: null }),
  };

  return {
    from(_table: string) {
      return {
        select(cols: string) {
          // Heuristic: the chapter-check select asks for 'rag_status' only;
          // the other paths ask for the richer column list.
          if (cols.trim() === 'rag_status') {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      eq() {
                        return chapterBuilder;
                      },
                    };
                  },
                };
              },
            };
          }
          // alternatives / subject-wide: chained .eq().eq().eq().eq().order().limit()
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        eq() {
                          return listBuilder;
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

Deno.test('returns chapter_not_ready for missing chapter', async () => {
  const stub = stubSupabase({
    syllabus_row: { rag_status: 'missing' },
    alternatives: [
      {
        grade: '10',
        subject_code: 'science',
        chapter_number: 1,
        chapter_title: 'Light',
      },
    ],
  });
  const result = await checkCoverage(stub, {
    grade: '10',
    subject_code: 'science',
    chapter_number: 7,
  });
  assertEquals(result.ready, false);
  assertEquals(result.abstain_reason, 'chapter_not_ready');
  assertEquals(result.alternatives.length, 1);
  assertEquals(result.alternatives[0].rag_status, 'ready');
  assertEquals(result.alternatives[0].chapter_number, 1);
});

Deno.test('returns chapter_not_ready for partial chapter', async () => {
  const stub = stubSupabase({
    syllabus_row: { rag_status: 'partial' },
    alternatives: [],
  });
  const result = await checkCoverage(stub, {
    grade: '10',
    subject_code: 'science',
    chapter_number: 7,
  });
  assertEquals(result.ready, false);
  assertEquals(result.abstain_reason, 'chapter_not_ready');
});

Deno.test('returns chapter_not_ready when syllabus row is absent', async () => {
  const stub = stubSupabase({ syllabus_row: null, alternatives: [] });
  const result = await checkCoverage(stub, {
    grade: '10',
    subject_code: 'science',
    chapter_number: 99,
  });
  assertEquals(result.ready, false);
  assertEquals(result.abstain_reason, 'chapter_not_ready');
});

Deno.test('returns ready:true for ready chapter', async () => {
  const stub = stubSupabase({ syllabus_row: { rag_status: 'ready' } });
  const result = await checkCoverage(stub, {
    grade: '10',
    subject_code: 'science',
    chapter_number: 1,
  });
  assertEquals(result.ready, true);
  assertEquals(result.alternatives.length, 0);
});

Deno.test('subject-wide query: ready:true when subject has at least one ready chapter', async () => {
  const stub = stubSupabase({ subject_has_ready: true });
  const result = await checkCoverage(stub, {
    grade: '10',
    subject_code: 'science',
    chapter_number: null,
  });
  assertEquals(result.ready, true);
});

Deno.test('subject-wide query: chapter_not_ready when subject has no ready chapters', async () => {
  const stub = stubSupabase({ subject_has_ready: false });
  const result = await checkCoverage(stub, {
    grade: '10',
    subject_code: 'science',
    chapter_number: null,
  });
  assertEquals(result.ready, false);
  assertEquals(result.abstain_reason, 'chapter_not_ready');
});

Deno.test('suggestAlternatives caps at 3', async () => {
  const stub = stubSupabase({
    alternatives: [
      { grade: '10', subject_code: 'science', chapter_number: 1, chapter_title: 'A' },
      { grade: '10', subject_code: 'science', chapter_number: 2, chapter_title: 'B' },
      { grade: '10', subject_code: 'science', chapter_number: 3, chapter_title: 'C' },
      { grade: '10', subject_code: 'science', chapter_number: 4, chapter_title: 'D' },
      { grade: '10', subject_code: 'science', chapter_number: 5, chapter_title: 'E' },
    ],
  });
  const result = await suggestAlternatives(stub, '10', 'science');
  assertEquals(result.length, 3);
  assertEquals(result[0].chapter_number, 1);
  assertEquals(result[2].chapter_number, 3);
});

Deno.test('suggestAlternatives returns empty array when none exist', async () => {
  const stub = stubSupabase({ alternatives: [] });
  const result = await suggestAlternatives(stub, '10', 'science');
  assertEquals(result.length, 0);
});