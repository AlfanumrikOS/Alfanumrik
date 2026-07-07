// src/__tests__/eval/rag/trace-mining.test.ts
//
// RED-first unit tests for the B1 retrieval-quality trace-mining tool (Task 4).
//
// This is the P13 GATE for the trace-mining path. It pins, with a MOCKED
// Supabase client (no live DB — the real read is service-role server-only /
// offline, B6):
//
//   A1 — column-allowlist projection:
//     - the exported per-table projection constant lists ONLY non-PII columns;
//     - it is a SUBSET of the documented spec §B1.3/A1 allowlist;
//     - it contains NONE of the forbidden identifier columns
//       (`grounded_ai_traces.student_id`, `retrieval_traces.user_id`,
//        `retrieval_traces.session_id`);
//     - the actual `.select(...)` string the tool sends to Supabase carries
//       NONE of the forbidden columns (an identifier never enters the query,
//       let alone harness memory).
//
//   B3 — PII scrub + sha256-default:
//     - every mined candidate carries a `query_sha256` BY DEFAULT;
//     - the sha256 matches the canonical SHA-256-hex of the source query text;
//     - a query preview is only ever stored AFTER `redactPIIInText` has run
//       (email / Indian-phone / Razorpay-id stripped);
//     - a row carrying a PII-shaped value (raw email / phone in the query text)
//       NEVER produces a candidate field containing that PII;
//     - grade / subject are pulled from the allowed non-PII columns.
//
// Pure/offline lane: the Supabase client is a hand-rolled fake — no DB, no LLM,
// no network. Runs in the normal `npm test` lane. Relative import (the `@/*`
// alias does not reach the eval harness, which lives outside src/).

import { createHash } from 'crypto';
import { describe, it, expect } from 'vitest';

import {
  GROUNDED_AI_TRACES_PROJECTION,
  RETRIEVAL_TRACES_PROJECTION,
  FORBIDDEN_TRACE_COLUMNS,
  GROUNDED_AI_TRACES_ALLOWLIST,
  RETRIEVAL_TRACES_ALLOWLIST,
  buildSelectColumns,
  mineTraceCandidates,
  type MinedCandidate,
} from '../../../../eval/rag/harness/trace-mining';
import { scrubText, sha256Hex } from '../../../../eval/rag/harness/scrub';

// ─── Fake Supabase client ────────────────────────────────────────────────────
//
// Records the exact column string passed to `.select(...)` and the table name,
// and returns canned rows. The minimal surface the tool uses is:
//   supabase.from(table).select(cols).limit(n)  →  Promise<{ data, error }>
// The chain is await-able (thenable) at the `.limit()` step.

interface SelectCapture {
  table: string;
  columns: string;
}

function makeFakeSupabase(
  rowsByTable: Record<string, Record<string, unknown>[]>,
  captures: SelectCapture[],
) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          captures.push({ table, columns });
          const result = { data: rowsByTable[table] ?? [], error: null };
          const builder = {
            limit(_n: number) {
              return Promise.resolve(result);
            },
            order() {
              return builder;
            },
            not() {
              return builder;
            },
            then(
              onFulfilled: (v: typeof result) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) {
              return Promise.resolve(result).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    },
  };
}

// A grounded_ai_traces row that DELIBERATELY carries a forbidden identifier and
// a PII-shaped query preview. The tool must (a) never SELECT student_id, and
// (b) never surface the email/phone in any candidate field.
const GROUNDED_ROW_WITH_PII = {
  caller: 'foxy',
  grade: '8',
  subject_code: 'science',
  chapter_number: 10,
  query_hash: 'abc123',
  query_preview: 'my email is ravi@example.com and phone 9876543210 — why light bends',
  retrieved_chunk_ids: ['11111111-1111-4111-8111-111111111111'],
  top_similarity: 0.031,
  chunk_count: 5,
  grounded: true,
  confidence: 0.82,
  created_at: '2026-06-10T00:00:00.000Z',
  // Forbidden — present in the canned row but must NEVER be SELECTed:
  student_id: '99999999-9999-4999-8999-999999999999',
};

const RETRIEVAL_ROW = {
  caller: 'foxy',
  grade: '10',
  subject: 'math',
  chapter_number: 4,
  concept: 'quadratic equations',
  query_text: 'how to solve a quadratic equation by factoring',
  query_sha256: createHash('sha256')
    .update('how to solve a quadratic equation by factoring')
    .digest('hex'),
  embedding_model: 'voyage/voyage-3',
  reranked: true,
  chunk_ids: ['22222222-2222-4222-8222-222222222222'],
  match_count: 5,
  latency_ms: 120,
  created_at: '2026-06-11T00:00:00.000Z',
  // Forbidden — present in the canned row but must NEVER be SELECTed:
  user_id: '88888888-8888-4888-8888-888888888888',
  session_id: '77777777-7777-4777-8777-777777777777',
};

describe('trace-mining — A1 column-allowlist projection (P13)', () => {
  const FORBIDDEN = ['student_id', 'user_id', 'session_id'];

  it('exports a forbidden-column denylist covering the three identifier columns', () => {
    for (const col of FORBIDDEN) {
      expect(FORBIDDEN_TRACE_COLUMNS).toContain(col);
    }
  });

  it('grounded_ai_traces projection lists ONLY allowlisted, non-PII columns', () => {
    for (const col of GROUNDED_AI_TRACES_PROJECTION) {
      expect(GROUNDED_AI_TRACES_ALLOWLIST).toContain(col);
      expect(FORBIDDEN_TRACE_COLUMNS).not.toContain(col);
    }
    // The three identifiers must NOT appear in the projection.
    expect(GROUNDED_AI_TRACES_PROJECTION).not.toContain('student_id');
    expect(GROUNDED_AI_TRACES_PROJECTION).not.toContain('user_id');
    expect(GROUNDED_AI_TRACES_PROJECTION).not.toContain('session_id');
  });

  it('retrieval_traces projection lists ONLY allowlisted, non-PII columns', () => {
    for (const col of RETRIEVAL_TRACES_PROJECTION) {
      expect(RETRIEVAL_TRACES_ALLOWLIST).toContain(col);
      expect(FORBIDDEN_TRACE_COLUMNS).not.toContain(col);
    }
    expect(RETRIEVAL_TRACES_PROJECTION).not.toContain('user_id');
    expect(RETRIEVAL_TRACES_PROJECTION).not.toContain('session_id');
    expect(RETRIEVAL_TRACES_PROJECTION).not.toContain('student_id');
  });

  it('buildSelectColumns produces a comma-joined string with no forbidden column', () => {
    const grounded = buildSelectColumns('grounded_ai_traces');
    const retrieval = buildSelectColumns('retrieval_traces');
    for (const col of FORBIDDEN) {
      expect(grounded).not.toContain(col);
      expect(retrieval).not.toContain(col);
    }
    // It is NOT a `SELECT *`.
    expect(grounded).not.toBe('*');
    expect(retrieval).not.toBe('*');
  });

  it('the actual .select() string sent to Supabase carries NONE of the forbidden columns', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [GROUNDED_ROW_WITH_PII],
        retrieval_traces: [RETRIEVAL_ROW],
      },
      captures,
    );

    await mineTraceCandidates(fake as never, { limit: 50 });

    expect(captures.length).toBeGreaterThan(0);
    for (const cap of captures) {
      for (const col of FORBIDDEN) {
        expect(cap.columns).not.toContain(col);
      }
      expect(cap.columns).not.toBe('*');
    }
  });
});

describe('trace-mining — B3 PII scrub + sha256-default', () => {
  it('every mined candidate carries a query_sha256 BY DEFAULT', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [GROUNDED_ROW_WITH_PII],
        retrieval_traces: [RETRIEVAL_ROW],
      },
      captures,
    );

    const candidates = await mineTraceCandidates(fake as never, { limit: 50 });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(typeof c.query_sha256).toBe('string');
      expect(c.query_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('a row whose query carries a raw email/phone NEVER produces a candidate field with that PII', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      { grounded_ai_traces: [GROUNDED_ROW_WITH_PII], retrieval_traces: [] },
      captures,
    );

    const candidates = await mineTraceCandidates(fake as never, { limit: 50 });
    expect(candidates.length).toBe(1);

    // The entire serialized candidate must not contain the raw PII.
    const serialized = JSON.stringify(candidates[0]);
    expect(serialized).not.toContain('ravi@example.com');
    expect(serialized).not.toContain('9876543210');
    // Nor the forbidden identifier (it was never SELECTed, so it cannot leak).
    expect(serialized).not.toContain('99999999-9999-4999-8999-999999999999');
  });

  it('a stored preview, when present, has been run through redactPIIInText', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      { grounded_ai_traces: [GROUNDED_ROW_WITH_PII], retrieval_traces: [] },
      captures,
    );

    const candidates = await mineTraceCandidates(fake as never, {
      limit: 50,
      retainPreview: true,
    });
    const c: MinedCandidate = candidates[0];
    if (c.query_preview !== undefined) {
      expect(c.query_preview).not.toContain('ravi@example.com');
      expect(c.query_preview).not.toContain('9876543210');
      // The redaction sentinels prove the scrubber ran.
      expect(c.query_preview).toContain('[REDACTED_EMAIL]');
      expect(c.query_preview).toContain('[REDACTED_PHONE]');
    }
  });

  it('defaults to sha256-ONLY: no preview field unless retainPreview is requested', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      { grounded_ai_traces: [GROUNDED_ROW_WITH_PII], retrieval_traces: [] },
      captures,
    );

    const candidates = await mineTraceCandidates(fake as never, { limit: 50 });
    expect(candidates[0].query_preview).toBeUndefined();
  });

  it('the candidate sha256 matches the canonical sha256 of the source query text', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      { grounded_ai_traces: [], retrieval_traces: [RETRIEVAL_ROW] },
      captures,
    );

    const candidates = await mineTraceCandidates(fake as never, { limit: 50 });
    const c = candidates[0];
    // retrieval_traces already carries a query_sha256 column — the tool must
    // preserve it (do NOT re-hash a redacted preview).
    expect(c.query_sha256).toBe(RETRIEVAL_ROW.query_sha256);
    expect(c.query_sha256).toBe(sha256Hex('how to solve a quadratic equation by factoring'));
  });

  it('grade / subject are pulled from the allowed non-PII columns', async () => {
    const captures: SelectCapture[] = [];
    const fake = makeFakeSupabase(
      {
        grounded_ai_traces: [GROUNDED_ROW_WITH_PII],
        retrieval_traces: [RETRIEVAL_ROW],
      },
      captures,
    );

    const candidates = await mineTraceCandidates(fake as never, { limit: 50 });
    const grounded = candidates.find((c) => c.trace_table === 'grounded_ai_traces');
    const retrieval = candidates.find((c) => c.trace_table === 'retrieval_traces');

    expect(grounded?.grade).toBe('8');
    expect(grounded?.subject).toBe('science'); // from subject_code
    expect(grounded?.chapter_number).toBe(10);

    expect(retrieval?.grade).toBe('10');
    expect(retrieval?.subject).toBe('math'); // from subject
    expect(retrieval?.chapter_number).toBe(4);
  });

  it('dedupes candidates that share a query_sha256', async () => {
    const captures: SelectCapture[] = [];
    const dup = { ...RETRIEVAL_ROW };
    const fake = makeFakeSupabase(
      { grounded_ai_traces: [], retrieval_traces: [RETRIEVAL_ROW, dup] },
      captures,
    );

    const candidates = await mineTraceCandidates(fake as never, { limit: 50 });
    const shas = candidates.map((c) => c.query_sha256);
    expect(new Set(shas).size).toBe(shas.length);
  });
});

describe('scrub — second-pass wrapper over redactPIIInText', () => {
  it('strips an embedded email and Indian phone from a sample string', () => {
    const out = scrubText('contact ravi@example.com or +91 98765 43210 please');
    expect(out.text).not.toContain('ravi@example.com');
    expect(out.text).not.toContain('9876543210');
    expect(out.applied).toContain('email');
  });

  it('strips a Razorpay id', () => {
    const out = scrubText('payment id pay_ABCDEFGHIJ1234 confirmed');
    expect(out.text).not.toContain('pay_ABCDEFGHIJ1234');
    expect(out.applied).toContain('razorpay_id');
  });

  it('sha256Hex is the canonical lowercase 64-hex digest of the input', () => {
    const h = sha256Hex('why does light bend');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(createHash('sha256').update('why does light bend').digest('hex'));
  });
});
