/**
 * REGRESSION — writeTrace deploy-ordering fallback for the shadow columns.
 *
 * File under test: supabase/functions/grounded-answer/trace.ts
 *
 * Pin (6): `writeTrace` retries ONCE with the four shadow keys stripped when
 * the first insert fails, and ONLY when (i) the row actually carried them AND
 * (ii) the error is a MISSING-COLUMN signal. Every other failure takes the
 * byte-identical old path (exactly one insert, then the placeholder).
 *
 * WHY THIS MATTERS
 * ----------------
 * Edge Functions and migrations deploy independently. If the function ships
 * ahead of migration 20260727130100, PostgREST rejects the WHOLE insert
 * (PGRST204 "column ... does not exist"). Without the retry, a purely
 * observational change would destroy the trace row and hand the caller a
 * placeholder trace_id — a real behaviour change smuggled in under
 * "instrumentation". The retry is what keeps the change zero-behaviour.
 *
 * The converse is equally load-bearing. A retry on ANY error would:
 *   (a) write a DUPLICATE trace row when the first insert actually COMMITTED
 *       and only the response was lost — a failure mode that did not exist
 *       before the instrumentation;
 *   (b) MASK and MISATTRIBUTE a genuine non-column failure (the
 *       confidence_v2_source CHECK, a numeric overflow, an RLS denial) as a
 *       missing migration;
 *   (c) double the round-trip on every failed insert — and on the streaming
 *       path that write is awaited in front of the metadata frame.
 * Hence BOTH guards: `'key' in row` and `isMissingShadowColumnError(error)`.
 *
 * P12 (AI safety / grounding observability), P13-adjacent (trace integrity).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTrace(): Promise<any> {
  return await import('../../../../../supabase/functions/grounded-answer/trace');
}

interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}

type Outcome = {
  data: { id: string } | null;
  error: { message: string; code?: string } | null;
};

/** The shape PostgREST actually returns when a column is not in its cache. */
function schemaCacheMiss(column = 'confidence_v2'): { message: string; code: string } {
  return {
    code: 'PGRST204',
    message: `Could not find the '${column}' column of 'grounded_ai_traces' in the schema cache`,
  };
}

/**
 * Minimal PostgREST-shaped stub: `.from(t).insert(p).select('id').single()`.
 * Each call consumes the next queued outcome.
 */
function makeStubClient(outcomes: Array<Outcome | 'throw'>) {
  const calls: InsertCall[] = [];
  let i = 0;
  return {
    calls,
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          calls.push({ table, payload });
          const outcome = outcomes[i] ?? { data: null, error: { message: 'exhausted' } };
          i += 1;
          return {
            select() {
              return {
                single: async () => {
                  if (outcome === 'throw') throw new Error('connection reset');
                  return outcome;
                },
              };
            },
          };
        },
      };
    },
  };
}

const PLACEHOLDER_PREFIX = '00000000-';

function baseRow(): Record<string, unknown> {
  return {
    caller: 'foxy',
    student_id: null,
    grade: '10',
    subject_code: 'science',
    chapter_number: 7,
    query_hash: 'sha256:deadbeef',
    query_preview: 'what is refraction',
    embedding_model: 'voyage-3',
    retrieved_chunk_ids: ['a', 'b'],
    top_similarity: 0.0328,
    chunk_count: 2,
    claude_model: 'claude-haiku',
    prompt_template_id: 'tpl-1',
    prompt_hash: 'sha256:cafe',
    grounded: true,
    grounded_from_chunks: true,
    abstain_reason: null,
    confidence: 0.647606,
    answer_length: 812,
    input_tokens: 900,
    output_tokens: 200,
    latency_ms: 1234,
    client_reported_issue_id: null,
  };
}

function shadowRow(): Record<string, unknown> {
  return {
    ...baseRow(),
    confidence_v2: 0.7123,
    confidence_v2_source: 'cosine',
    top_cosine_similarity: 0.4211,
    signal_coverage: 3,
  };
}

const SHADOW_KEYS = [
  'confidence_v2',
  'confidence_v2_source',
  'top_cosine_similarity',
  'signal_coverage',
];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('REGRESSION — writeTrace happy path is a single plain insert', () => {
  it('inserts the shadow columns and does NOT retry when the insert succeeds', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([{ data: { id: 'trace-1' }, error: null }]);
    const id = await writeTrace(sb, shadowRow());

    expect(id).toBe('trace-1');
    expect(sb.calls).toHaveLength(1);
    expect(sb.calls[0].table).toBe('grounded_ai_traces');
    expect(sb.calls[0].payload).toMatchObject({
      confidence: 0.647606,
      confidence_v2: 0.7123,
      confidence_v2_source: 'cosine',
      top_cosine_similarity: 0.4211,
      signal_coverage: 3,
    });
  });

  it('null shadow values are still sent (null is a meaningful record)', async () => {
    const { writeTrace } = await loadTrace();
    const row = {
      ...baseRow(),
      confidence_v2: null,
      confidence_v2_source: null,
      top_cosine_similarity: null,
      signal_coverage: null,
    };
    const sb = makeStubClient([{ data: { id: 'trace-2' }, error: null }]);
    await writeTrace(sb, row);

    expect(sb.calls).toHaveLength(1);
    for (const k of SHADOW_KEYS) {
      expect(k in sb.calls[0].payload).toBe(true);
      expect(sb.calls[0].payload[k]).toBeNull();
    }
  });
});

describe('REGRESSION — writeTrace retries ONCE without the shadow columns', () => {
  it('strips exactly the four shadow keys on a PGRST204-style failure', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([
      { data: null, error: schemaCacheMiss() },
      { data: { id: 'trace-retry' }, error: null },
    ]);
    const row = shadowRow();
    const id = await writeTrace(sb, row);

    expect(id).toBe('trace-retry');
    expect(sb.calls).toHaveLength(2);

    const retryPayload = sb.calls[1].payload;
    for (const k of SHADOW_KEYS) {
      expect(k in retryPayload).toBe(false);
    }
    // Every OTHER field must be byte-identical to the original row — the
    // fallback strips instrumentation, it does not degrade the trace.
    expect(retryPayload).toEqual(baseRow());
  });

  it('retries on a bare 42703 "does not exist" naming a shadow column (no PGRST204 code)', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([
      {
        data: null,
        error: {
          message: 'column "signal_coverage" of relation "grounded_ai_traces" does not exist',
        },
      },
      { data: { id: 'trace-42703' }, error: null },
    ]);
    expect(await writeTrace(sb, shadowRow())).toBe('trace-42703');
    expect(sb.calls).toHaveLength(2);
  });

  it('retries at most ONCE — a second failure yields the placeholder, not a third insert', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([
      { data: null, error: schemaCacheMiss() },
      { data: null, error: schemaCacheMiss('top_cosine_similarity') },
    ]);
    const id = await writeTrace(sb, shadowRow());

    expect(sb.calls).toHaveLength(2);
    expect(id.startsWith(PLACEHOLDER_PREFIX)).toBe(true);
  });

  it('does NOT retry when the insert returns no error but also no id', async () => {
    const { writeTrace } = await loadTrace();
    // "No error, no row" is not a missing-column signal. It is precisely the
    // shape a lost response after a COMMITTED insert takes — retrying would
    // write a DUPLICATE trace row, a failure mode that did not exist before
    // the instrumentation.
    const sb = makeStubClient([
      { data: null, error: null },
      { data: { id: 'must-not-be-used' }, error: null },
    ]);
    const id = await writeTrace(sb, shadowRow());
    expect(sb.calls).toHaveLength(1);
    expect(id.startsWith(PLACEHOLDER_PREFIX)).toBe(true);
  });

  it('does not mutate the caller-supplied row while stripping', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([
      { data: null, error: schemaCacheMiss() },
      { data: { id: 'x' }, error: null },
    ]);
    const row = shadowRow();
    const before = JSON.stringify(row);
    await writeTrace(sb, row);
    expect(JSON.stringify(row)).toBe(before);
  });

  it('a THROWN first insert is not retried (that is not a schema-cache miss)', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient(['throw', { data: { id: 'never' }, error: null }]);
    const id = await writeTrace(sb, shadowRow());
    // The throw path is the pre-existing outer catch — unchanged behaviour.
    expect(sb.calls).toHaveLength(1);
    expect(id.startsWith(PLACEHOLDER_PREFIX)).toBe(true);
  });
});

describe('REGRESSION — rows WITHOUT shadow keys take the byte-identical old path', () => {
  it('a legacy row that fails to insert issues exactly ONE insert', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([
      { data: null, error: { message: 'new row violates row-level security policy' } },
      { data: { id: 'must-not-be-used' }, error: null },
    ]);
    const id = await writeTrace(sb, baseRow());

    // The guard exists so a genuine failure (RLS, dead connection, constraint)
    // is not silently doubled into two writes on an already-degraded path.
    expect(sb.calls).toHaveLength(1);
    expect(id.startsWith(PLACEHOLDER_PREFIX)).toBe(true);
  });

  it('a legacy row that succeeds issues exactly ONE insert with no shadow keys', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([{ data: { id: 'trace-legacy' }, error: null }]);
    const id = await writeTrace(sb, baseRow());

    expect(id).toBe('trace-legacy');
    expect(sb.calls).toHaveLength(1);
    for (const k of SHADOW_KEYS) {
      expect(k in sb.calls[0].payload).toBe(false);
    }
  });

  it('a row carrying even ONE shadow key (explicitly undefined) still qualifies for the retry', async () => {
    const { writeTrace } = await loadTrace();
    const sb = makeStubClient([
      { data: null, error: schemaCacheMiss() },
      { data: { id: 'trace-partial' }, error: null },
    ]);
    // `in` semantics, not truthiness: a present-but-undefined key is still a
    // key PostgREST will reject.
    const row = { ...baseRow(), confidence_v2: undefined };
    expect(await writeTrace(sb, row)).toBe('trace-partial');
    expect(sb.calls).toHaveLength(2);
    expect('confidence_v2' in sb.calls[1].payload).toBe(false);
  });
});

describe('REGRESSION — a NON-column failure is never retried (no duplicate, no masking)', () => {
  // Each of these carries a shadow-bearing row, so the `'key' in row` guard
  // alone would let it through. The error-shape guard is what stops it.
  const nonColumnErrors: Array<[string, { message: string; code?: string }]> = [
    [
      // The CHECK this very migration adds. Its NAME contains a shadow column,
      // so a naive substring match would retry AND misreport it as a missing
      // migration while silently dropping the offending value.
      'the confidence_v2_source vocabulary CHECK',
      {
        code: '23514',
        message:
          'new row for relation "grounded_ai_traces" violates check constraint ' +
          '"grounded_ai_traces_confidence_v2_source_chk"',
      },
    ],
    [
      'the signal_coverage range CHECK',
      {
        code: '23514',
        message:
          'new row for relation "grounded_ai_traces" violates check constraint ' +
          '"grounded_ai_traces_signal_coverage_chk"',
      },
    ],
    [
      'a numeric overflow on confidence_v2',
      { code: '22003', message: 'numeric field overflow for column confidence_v2' },
    ],
    ['an RLS denial', { code: '42501', message: 'new row violates row-level security policy' }],
    ['a dead connection', { message: 'fetch failed' }],
    ['a foreign-key violation', { code: '23503', message: 'insert or update violates foreign key constraint' }],
  ];

  for (const [label, error] of nonColumnErrors) {
    it(`${label} issues exactly ONE insert`, async () => {
      const { writeTrace } = await loadTrace();
      const sb = makeStubClient([
        { data: null, error },
        { data: { id: 'must-not-be-used' }, error: null },
      ]);
      const id = await writeTrace(sb, shadowRow());
      expect(sb.calls).toHaveLength(1);
      expect(id.startsWith(PLACEHOLDER_PREFIX)).toBe(true);
    });
  }

  it('the warn text does not assert that migration 20260727130100 is missing', async () => {
    const { writeTrace } = await loadTrace();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Success-through-retry: the only path that emits the shadow-specific warn.
    await writeTrace(
      makeStubClient([
        { data: null, error: schemaCacheMiss() },
        { data: { id: 'ok' }, error: null },
      ]),
      shadowRow(),
    );
    const texts = warn.mock.calls.map((c) => String(c[0]));
    expect(texts.join('\n')).not.toMatch(/20260727130100/);
    expect(texts.join('\n')).toMatch(/schema cache/i);
  });
});

describe('REGRESSION — writeTrace never propagates a failure to the caller', () => {
  it('always returns a string trace id, on every path', async () => {
    const { writeTrace } = await loadTrace();
    const scenarios: Array<Array<Outcome | 'throw'>> = [
      [{ data: { id: 'ok' }, error: null }],
      [{ data: null, error: schemaCacheMiss() }, { data: { id: 'ok2' }, error: null }],
      [{ data: null, error: schemaCacheMiss() }, { data: null, error: { message: 'x' } }],
      [{ data: null, error: schemaCacheMiss() }, 'throw'],
      [{ data: null, error: { code: '23514', message: 'violates check constraint' } }],
      [{ data: null, error: null }],
      ['throw'],
    ];
    for (const outcomes of scenarios) {
      const id = await writeTrace(makeStubClient(outcomes), shadowRow());
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });
});
