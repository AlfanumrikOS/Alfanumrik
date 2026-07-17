// supabase/functions/grounded-answer/__tests__/rag-content-version-bump.test.ts
// Deno test runner:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Unit pins for the WRITE half of the content-version invalidation loop
// (REG-268): supabase/functions/_shared/rag-content-version.ts
// bumpRagContentVersion — called by the four ingestion writers after
// successful content writes. (The READ half — _content-version.ts +
// gen_ctx folding — is pinned in gen-ctx.test.ts / cache-durable-l3.test.ts.
// The test lives in this suite because the grounded-answer Deno lane is
// where the consumer runs; _shared/__tests__ is a vitest-only directory.)
//
// Pins:
//   - increment semantics: existing version N → upsert N+1 on the
//     (grade, subject_code) conflict key; missing row → 1.
//   - normalization: "Grade 10" → "10" (P5 short grade), display subject
//     name resolved via the subjects table → code; unresolvable subject
//     falls back to the lowercase/underscore heuristic.
//   - subject resolution uses TWO separate parameterized .eq() lookups
//     (code, then name) — NOT the old raw-interpolated .or() filter, which
//     silently diverted comma/paren-bearing subject names to the heuristic.
//   - the no-row heuristic fallback emits the DISTINCT structured warn
//     `rag_content_version_subject_heuristic_fallback` (missed bump +
//     no-TTL L3 = indefinite staleness — ops must see mis-normalized runs).
//   - unresolvable scope (empty grade/subject) → NO write.
//   - NEVER throws: a throwing client degrades to a logged no-op (a missed
//     bump only delays invalidation; it can never fail ingestion).

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { bumpRagContentVersion } from '../../_shared/rag-content-version.ts';

interface StubState {
  existingVersion: number | null;
  /** Rows in the stub `subjects` table; .eq(col, val) matches row[col] === val. */
  subjectRows: Array<{ code: string; name: string }>;
  upserts: Array<{ row: Record<string, unknown>; onConflict: string }>;
  /** Every .eq() issued against the subjects table (pins the two-query shape). */
  subjectLookups: Array<{ col: string; value: string }>;
}

function captureWarn(run: () => Promise<void>): Promise<unknown[][]> {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  return run().then(
    () => {
      console.warn = original;
      return calls;
    },
    (err) => {
      console.warn = original;
      throw err;
    },
  );
}

// deno-lint-ignore no-explicit-any
function buildSb(state: StubState): any {
  return {
    from(table: string) {
      if (table === 'subjects') {
        return {
          select: () => ({
            // The ONLY filter shape the stub supports is the parameterized
            // .eq(col, val) — the old raw-interpolated .or() path would
            // throw here, so this stub structurally enforces the fix.
            eq: (col: string, value: string) => ({
              limit: () => ({
                maybeSingle: () => {
                  state.subjectLookups.push({ col, value });
                  const row = state.subjectRows.find(
                    (r) => (r as Record<string, string>)[col] === value,
                  );
                  return Promise.resolve({
                    data: row ? { code: row.code } : null,
                    error: null,
                  });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'rag_content_versions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.existingVersion === null ? null : { version: state.existingVersion },
                    error: null,
                  }),
              }),
            }),
          }),
          upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => {
            state.upserts.push({ row, onConflict: opts.onConflict });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

Deno.test('bump increments an existing version N → N+1 on the (grade, subject_code) conflict key', async () => {
  const state: StubState = {
    existingVersion: 4,
    subjectRows: [{ code: 'science', name: 'Science' }],
    upserts: [],
    subjectLookups: [],
  };
  await bumpRagContentVersion(buildSb(state), '10', 'science');
  assertEquals(state.upserts.length, 1);
  assertEquals(state.upserts[0].row, { grade: '10', subject_code: 'science', version: 5 });
  assertEquals(state.upserts[0].onConflict, 'grade,subject_code');
  // Already-a-code input resolves on the FIRST (.eq on code) lookup — the
  // name lookup is never issued.
  assertEquals(state.subjectLookups, [{ col: 'code', value: 'science' }]);
});

Deno.test('bump seeds version 1 when no row exists for the scope', async () => {
  const state: StubState = {
    existingVersion: null,
    subjectRows: [{ code: 'math', name: 'Mathematics' }],
    upserts: [],
    subjectLookups: [],
  };
  await bumpRagContentVersion(buildSb(state), '8', 'math');
  assertEquals(state.upserts.length, 1);
  assertEquals(state.upserts[0].row.version, 1);
});

Deno.test('bump normalizes ingestion display forms: "Grade 10" → "10" (P5), subject name → code via subjects table', async () => {
  const state: StubState = {
    existingVersion: 0,
    subjectRows: [{ code: 'science', name: 'Science' }],
    upserts: [],
    subjectLookups: [],
  };
  await bumpRagContentVersion(buildSb(state), 'Grade 10', 'Science');
  assertEquals(state.upserts.length, 1);
  assertEquals(state.upserts[0].row.grade, '10', 'grade must be the P5 short form the cache reader queries with');
  assertEquals(state.upserts[0].row.subject_code, 'science');
  // Display-name input misses the code lookup, resolves on the name lookup —
  // pins the two-separate-.eq()-queries shape (no raw-interpolated .or()).
  assertEquals(state.subjectLookups, [
    { col: 'code', value: 'Science' },
    { col: 'name', value: 'Science' },
  ]);
});

Deno.test('subject NAME containing comma/parens resolves via the parameterized name .eq (old .or() filter silently diverted these to the heuristic)', async () => {
  const state: StubState = {
    existingVersion: 2,
    subjectRows: [{ code: 'social_science', name: 'History, Civics (Part 1)' }],
    upserts: [],
    subjectLookups: [],
  };
  await bumpRagContentVersion(buildSb(state), '9', 'History, Civics (Part 1)');
  assertEquals(state.upserts.length, 1);
  assertEquals(
    state.upserts[0].row.subject_code,
    'social_science',
    'comma/paren-bearing names must resolve via the subjects table, not the heuristic',
  );
  assertEquals(state.upserts[0].row.version, 3);
});

Deno.test('unresolvable subject falls back to the lowercase/underscore heuristic AND emits the distinct structured warn (bump still lands)', async () => {
  const state: StubState = {
    existingVersion: 0,
    subjectRows: [],
    upserts: [],
    subjectLookups: [],
  };
  const warns = await captureWarn(() =>
    bumpRagContentVersion(buildSb(state), '9', 'Social Studies'),
  );
  assertEquals(state.upserts.length, 1);
  assertEquals(state.upserts[0].row.subject_code, 'social_studies');
  // The no-row heuristic fallback MUST be observable: a mis-normalized
  // subject_code means the cache reader never sees this bump (missed bump +
  // the no-TTL L3 store = indefinite staleness).
  const fallbackWarns = warns.filter(
    (c) => c[0] === 'rag_content_version_subject_heuristic_fallback',
  );
  assertEquals(fallbackWarns.length, 1, 'expected exactly one heuristic-fallback warn event');
  const dims = fallbackWarns[0][1] as Record<string, unknown>;
  assertEquals(dims.subject_raw, 'Social Studies');
  assertEquals(dims.heuristic_code, 'social_studies');
});

Deno.test('successful bump emits rag_content_version_bumped at WARN level (house structured-metric pattern — log-explorer queries key on warn lines)', async () => {
  const state: StubState = {
    existingVersion: 4,
    subjectRows: [{ code: 'science', name: 'Science' }],
    upserts: [],
    subjectLookups: [],
  };
  const warns = await captureWarn(() =>
    bumpRagContentVersion(buildSb(state), '10', 'science'),
  );
  const bumped = warns.filter((c) => c[0] === 'rag_content_version_bumped');
  assertEquals(bumped.length, 1, 'the bump confirmation must arrive via console.warn, not console.info');
  const dims = bumped[0][1] as Record<string, unknown>;
  assertEquals(dims.grade, '10');
  assertEquals(dims.subject, 'science');
  assertEquals(dims.version, 5);
});

Deno.test('subjects-table resolution SUCCESS does not emit the heuristic-fallback warn', async () => {
  const state: StubState = {
    existingVersion: 0,
    subjectRows: [{ code: 'science', name: 'Science' }],
    upserts: [],
    subjectLookups: [],
  };
  const warns = await captureWarn(() =>
    bumpRagContentVersion(buildSb(state), '10', 'Science'),
  );
  assertEquals(
    warns.filter((c) => c[0] === 'rag_content_version_subject_heuristic_fallback').length,
    0,
    'a resolved subject must not fire the heuristic-fallback event',
  );
});

Deno.test('unresolvable scope (empty grade or subject) → no write at all', async () => {
  const state: StubState = {
    existingVersion: 0,
    subjectRows: [],
    upserts: [],
    subjectLookups: [],
  };
  await bumpRagContentVersion(buildSb(state), '', 'science');
  await bumpRagContentVersion(buildSb(state), '10', '');
  assertEquals(state.upserts.length, 0);
});

Deno.test('bump NEVER throws — a dead client degrades to a logged no-op (ingestion is never failed)', async () => {
  // deno-lint-ignore no-explicit-any
  const throwingSb: any = {
    from() {
      throw new Error('simulated: DB unreachable mid-ingestion');
    },
  };
  // Must resolve, not reject.
  await bumpRagContentVersion(throwingSb, '10', 'science');
  assert(true);
});
