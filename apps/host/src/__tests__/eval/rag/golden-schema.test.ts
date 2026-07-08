// src/__tests__/eval/rag/golden-schema.test.ts
//
// RED-first schema gate for the B1 retrieval-quality golden set (Task 1).
//
// This test pins every shape rule from spec §B1.3:
//   - P5: every `grade` is a STRING "6".."12" (never an integer).
//   - Subject allowlist uses the canonical snake_case `subject_code` set,
//     incl. `social_studies` (A6 — NOT "social science" / "social_science").
//   - per-chunk `relevance ∈ {0,1,2}`; `query_type` in the allowed set.
//   - optional `off_grade_scope: boolean` (A2) — present or absent both valid.
//   - every `relevant_chunk_id` a valid UUID; `corpus_ref` present (the live
//     UUID-resolve against rag_content_chunks is the live-DB runner's job —
//     here we only assert the field SHAPE).
//   - NO PII-shaped key (`student_id`/`user_id`/`session_id`/`email`/`phone`)
//     anywhere in the document, at ANY nesting depth (recursive).
//
// Path mapping: the `@/* → ./src/*` Vitest alias does not reach the eval
// harness (it lives outside src/), so we use a relative import — matching the
// convention in `src/__tests__/eval/rag-scoring.test.ts`.
//
// This is a PURE/offline test: no DB, no LLM, no network. It runs in the
// normal `npm test` lane.

import { describe, it, expect } from 'vitest';

import {
  validateGoldenSet,
  CANONICAL_SUBJECT_CODES,
  QUERY_TYPES,
  PII_FORBIDDEN_KEYS,
} from '../../../../eval/rag/harness/golden-schema';
import type { GoldenSet, GoldenItem } from '../../../../eval/rag/harness/golden-schema';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** A valid 2-item inline golden set the validator MUST accept. */
function validGoldenSet(): unknown {
  return {
    version: 'v1',
    created_at: '2026-06-13',
    corpus_ref: {
      source: 'ncert_2025',
      snapshot_note: 'matches baseline_from_prod corpus as of 2026-06-13',
    },
    judge: {
      model: 'claude-sonnet-4-20250514',
      rubric_version: 'rag-relevance-v1',
      temperature: 0,
    },
    items: [
      {
        id: 'g8-sci-light-refraction-001',
        tier: 'seed',
        query: 'Why does light bend when it enters water?',
        query_type: 'conceptual',
        grade: '8',
        subject: 'science',
        chapter_number: 10,
        relevant_chunks: [
          {
            chunk_id: '11111111-1111-4111-8111-111111111111',
            relevance: 2,
            off_grade_scope: false,
            label_source: 'assessment',
          },
          {
            // off_grade_scope omitted here on purpose — must be valid absent (A2).
            chunk_id: '22222222-2222-4222-8222-222222222222',
            relevance: 1,
            label_source: 'judge',
            judge_reason: 'partial context on refraction',
            spot_checked: true,
          },
        ],
        provenance: null,
      },
      {
        id: 'g6-soc-medieval-india-001',
        tier: 'trace_mined',
        query_type: 'multi_hop',
        grade: '6',
        subject: 'social_studies',
        chapter_number: null,
        relevant_chunks: [
          {
            chunk_id: '33333333-3333-4333-8333-333333333333',
            relevance: 2,
            off_grade_scope: true,
            label_source: 'judge',
          },
        ],
        provenance: {
          trace_table: 'grounded_ai_traces',
          query_sha256:
            'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
          mined_at: '2026-06-13',
        },
      },
    ],
  };
}

/** Deep-clone helper so each mutation case starts from a clean valid doc. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('validateGoldenSet — happy path', () => {
  it('accepts a valid inline 2-item fixture', () => {
    const result = validateGoldenSet(validGoldenSet());
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The validator returns a typed value on success.
      expect(result.value.items).toHaveLength(2);
      const item: GoldenItem = result.value.items[0];
      expect(item.grade).toBe('8');
      expect(item.subject).toBe('science');
    }
  });

  it('accepts items both with and without off_grade_scope (A2 optional)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<{ relevant_chunks: Array<Record<string, unknown>> }> };
    // item[0].chunk[1] already omits off_grade_scope; assert that path is OK.
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(true);
  });

  it('exposes the canonical metadata as named exports', () => {
    expect(CANONICAL_SUBJECT_CODES).toContain('social_studies');
    expect(CANONICAL_SUBJECT_CODES).toContain('math');
    expect(CANONICAL_SUBJECT_CODES).toContain('physics');
    // Hindi is a core CBSE subject with live corpus (must be on the allowlist).
    expect(CANONICAL_SUBJECT_CODES).toContain('hindi');
    // history_sr is the canonical senior-secondary History code.
    expect(CANONICAL_SUBJECT_CODES).toContain('history_sr');
    expect(QUERY_TYPES).toEqual(
      expect.arrayContaining(['factual', 'conceptual', 'definition', 'multi_hop']),
    );
    expect(PII_FORBIDDEN_KEYS).toEqual(
      expect.arrayContaining(['student_id', 'user_id', 'session_id', 'email', 'phone']),
    );
  });

  it('allowlist EXACTLY matches the canonical subject-governance seed (17 codes)', () => {
    // Byte-aligned with subjects.code seeded by
    // 20260415000004_subject_governance_seed.sql. `history` (legacy alias) and
    // `civics` (not a real code) are deliberately ABSENT.
    expect([...CANONICAL_SUBJECT_CODES].sort()).toEqual(
      [
        'accountancy',
        'biology',
        'business_studies',
        'chemistry',
        'coding',
        'computer_science',
        'economics',
        'english',
        'geography',
        'hindi',
        'history_sr',
        'math',
        'physics',
        'political_science',
        'sanskrit',
        'science',
        'social_studies',
      ].sort(),
    );
    expect(CANONICAL_SUBJECT_CODES).not.toContain('history');
    expect(CANONICAL_SUBJECT_CODES).not.toContain('civics');
  });
});

describe('validateGoldenSet — P5 grade-string enforcement', () => {
  it('rejects an integer grade (8 instead of "8")', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[0] as { grade: unknown }).grade = 8; // integer — illegal per P5
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/grade/i);
    }
  });

  it('rejects an out-of-range grade string ("13")', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[0] as { grade: unknown }).grade = '13';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
  });
});

describe('validateGoldenSet — subject allowlist (A6)', () => {
  it('rejects subject "social science" (must be social_studies)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[1] as { subject: unknown }).subject = 'social science';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/subject/i);
    }
  });

  it('rejects subject "social_science" (canonical code is social_studies)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[1] as { subject: unknown }).subject = 'social_science';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
  });

  it('accepts subject social_studies', () => {
    const result = validateGoldenSet(validGoldenSet());
    expect(result.ok).toBe(true);
  });

  it('accepts subject hindi (core CBSE subject with live corpus)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[1] as { subject: unknown; grade: unknown }).subject = 'hindi';
    (doc.items[1] as { grade: unknown }).grade = '8';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(true);
  });

  it('accepts subject history_sr (canonical senior-secondary History code)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[1] as { subject: unknown; grade: unknown }).subject = 'history_sr';
    (doc.items[1] as { grade: unknown }).grade = '11';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(true);
  });

  it('rejects subject "civics" (not a real platform subject_code)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[1] as { subject: unknown }).subject = 'civics';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/subject/i);
    }
  });

  it('rejects subject "history" (legacy alias — canonical code is history_sr)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[1] as { subject: unknown }).subject = 'history';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/subject/i);
    }
  });
});

describe('validateGoldenSet — relevance + query_type enums', () => {
  it('rejects relevance: 3 (must be 0|1|2)', () => {
    const doc = clone(validGoldenSet()) as {
      items: Array<{ relevant_chunks: Array<Record<string, unknown>> }>;
    };
    doc.items[0].relevant_chunks[0].relevance = 3;
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/relevance/i);
    }
  });

  it('rejects an unknown query_type', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[0] as { query_type: unknown }).query_type = 'opinion';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/query_type/i);
    }
  });
});

describe('validateGoldenSet — UUID shape', () => {
  it('rejects a chunk_id that is not a valid UUID', () => {
    const doc = clone(validGoldenSet()) as {
      items: Array<{ relevant_chunks: Array<Record<string, unknown>> }>;
    };
    doc.items[0].relevant_chunks[0].chunk_id = 'not-a-uuid';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/uuid|chunk_id/i);
    }
  });
});

describe('validateGoldenSet — corpus_ref shape', () => {
  it('rejects a document missing corpus_ref', () => {
    const doc = clone(validGoldenSet()) as Record<string, unknown>;
    delete doc.corpus_ref;
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/corpus_ref/i);
    }
  });

  it('rejects a corpus_ref whose source is not ncert_2025', () => {
    const doc = clone(validGoldenSet()) as { corpus_ref: { source: unknown } };
    doc.corpus_ref.source = 'some_other_corpus';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
  });

  // ── Optional project_ref (Option-1 prod binding) — backward-compatible ─────

  it('accepts a corpus_ref WITHOUT project_ref (backward-compatible)', () => {
    // The base fixture carries no project_ref — same-corpus golden sets and the
    // inline smoke fixture must still validate.
    const doc = clone(validGoldenSet()) as { corpus_ref: Record<string, unknown> };
    expect(doc.corpus_ref.project_ref).toBeUndefined();
    expect(validateGoldenSet(doc).ok).toBe(true);
  });

  it('accepts a corpus_ref WITH a string project_ref (prod-bound golden set)', () => {
    const doc = clone(validGoldenSet()) as { corpus_ref: Record<string, unknown> };
    doc.corpus_ref.project_ref = 'shktyoxqhundlvkiwguu';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.corpus_ref.project_ref).toBe('shktyoxqhundlvkiwguu');
    }
  });

  it('rejects a project_ref of the wrong type (number) when present', () => {
    const doc = clone(validGoldenSet()) as { corpus_ref: Record<string, unknown> };
    doc.corpus_ref.project_ref = 123;
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/project_ref/i);
    }
  });

  it('rejects an empty-string project_ref when present', () => {
    const doc = clone(validGoldenSet()) as { corpus_ref: Record<string, unknown> };
    doc.corpus_ref.project_ref = '';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/project_ref/i);
    }
  });
});

describe('validateGoldenSet — PII-key recursion (P13)', () => {
  it('rejects a fixture containing a student_id key at the item level', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[0] as Record<string, unknown>).student_id = 'leaked';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/student_id|PII/i);
    }
  });

  it('rejects a forbidden key nested deep inside provenance', () => {
    const doc = clone(validGoldenSet()) as {
      items: Array<{ provenance: Record<string, unknown> | null }>;
    };
    doc.items[1].provenance = {
      trace_table: 'grounded_ai_traces',
      query_sha256: 'a'.repeat(64),
      mined_at: '2026-06-13',
      nested: { deeper: { email: 'kid@example.com' } },
    };
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/email|PII/i);
    }
  });

  it('rejects a forbidden key carried inside an array element', () => {
    const doc = clone(validGoldenSet()) as {
      items: Array<{ relevant_chunks: Array<Record<string, unknown>> }>;
    };
    doc.items[0].relevant_chunks.push({
      chunk_id: '44444444-4444-4444-8444-444444444444',
      relevance: 0,
      session_id: 'leaked-in-array',
    });
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/session_id|PII/i);
    }
  });
});

describe('validateGoldenSet — structural rejects', () => {
  it('rejects a non-object document', () => {
    expect(validateGoldenSet(null).ok).toBe(false);
    expect(validateGoldenSet('nope').ok).toBe(false);
    expect(validateGoldenSet(42).ok).toBe(false);
  });

  it('rejects an items field that is not an array', () => {
    const doc = clone(validGoldenSet()) as Record<string, unknown>;
    doc.items = {};
    expect(validateGoldenSet(doc).ok).toBe(false);
  });

  it('rejects an item with an empty relevant_chunks array', () => {
    const doc = clone(validGoldenSet()) as { items: Array<{ relevant_chunks: unknown[] }> };
    doc.items[0].relevant_chunks = [];
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing version field', () => {
    const doc = clone(validGoldenSet()) as Record<string, unknown>;
    delete doc.version;
    expect(validateGoldenSet(doc).ok).toBe(false);
  });

  it('narrows the returned value to GoldenSet on success', () => {
    const result = validateGoldenSet(validGoldenSet());
    // Type-level: result.value is GoldenSet. This is a compile-time assertion
    // that the success branch is typed (no `any` leak).
    if (result.ok) {
      const set: GoldenSet = result.value;
      expect(set.version).toBe('v1');
    }
  });

  it('rejects an empty items array', () => {
    const doc = clone(validGoldenSet()) as { items: unknown[] };
    doc.items = [];
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/items/i);
    }
  });

  it('corpus_ref must be an object (rejects an array)', () => {
    const doc = clone(validGoldenSet()) as Record<string, unknown>;
    doc.corpus_ref = [];
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/corpus_ref/i);
    }
  });

  it('rejects an unknown label_source', () => {
    const doc = clone(validGoldenSet()) as {
      items: Array<{ relevant_chunks: Array<Record<string, unknown>> }>;
    };
    doc.items[0].relevant_chunks[0].label_source = 'self_reported';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/label_source/i);
    }
  });

  it('rejects a non-integer chapter_number (10.5)', () => {
    const doc = clone(validGoldenSet()) as { items: Array<Record<string, unknown>> };
    (doc.items[0] as { chapter_number: unknown }).chapter_number = 10.5;
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/chapter_number/i);
    }
  });

  it('rejects off_grade_scope of the wrong type ("yes" instead of boolean)', () => {
    const doc = clone(validGoldenSet()) as {
      items: Array<{ relevant_chunks: Array<Record<string, unknown>> }>;
    };
    doc.items[0].relevant_chunks[0].off_grade_scope = 'yes';
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/off_grade_scope/i);
    }
  });
});

describe('validateGoldenSet — duplicate item-id hard reject', () => {
  it('rejects duplicate item ids', () => {
    const doc = clone(validGoldenSet()) as { items: Array<{ id: string }> };
    // Force the second item to collide with the first item's id. A duplicate id
    // would be silently double-counted by the scorer — this must HARD-reject.
    doc.items[1].id = doc.items[0].id;
    const result = validateGoldenSet(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/duplicate|unique/i);
    }
  });

  it('accepts distinct item ids (control)', () => {
    const result = validateGoldenSet(validGoldenSet());
    expect(result.ok).toBe(true);
  });
});
