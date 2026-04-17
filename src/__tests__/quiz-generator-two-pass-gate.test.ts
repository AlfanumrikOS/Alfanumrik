/**
 * Two-pass verifier gate tests for bulk-question-gen.
 *
 * The Edge Function lives in Deno (supabase/functions/bulk-question-gen/)
 * which can't be imported into the Vitest node runtime. We therefore mirror
 * the pure decision logic (parse + verification-state derivation) here so
 * quality review can catch drift between the two. The full Deno integration
 * is covered in supabase/functions/bulk-question-gen/__tests__/ which run
 * in CI.
 */

import { describe, it, expect } from 'vitest';

// ─── Mirror of parseDraftJson / parseVerifierJson / derivation logic ─────────
// Keep in sync with supabase/functions/bulk-question-gen/index.ts.

interface DraftQuestionFromService {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  difficulty?: string | number;
  bloom_level?: string;
  supporting_chunk_ids?: string[];
}

interface VerifierResponse {
  verified: boolean;
  reason: string;
  correct_option_index: number | null;
  supporting_chunk_ids: string[];
}

function parseDraftJson(rawAnswer: string): DraftQuestionFromService | null {
  let parsed: unknown;
  try {
    const stripped = rawAnswer
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim();
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if ('error' in obj) return null;
  if (typeof obj.question_text !== 'string') return null;
  if (!Array.isArray(obj.options) || obj.options.length !== 4) return null;
  if (!obj.options.every((o) => typeof o === 'string')) return null;
  if (typeof obj.correct_answer_index !== 'number') return null;
  if (
    !Number.isInteger(obj.correct_answer_index) ||
    obj.correct_answer_index < 0 ||
    obj.correct_answer_index > 3
  ) {
    return null;
  }
  if (typeof obj.explanation !== 'string') return null;
  return {
    question_text: obj.question_text,
    options: obj.options as string[],
    correct_answer_index: obj.correct_answer_index,
    explanation: obj.explanation,
  };
}

function parseVerifierJson(rawAnswer: string): VerifierResponse | null {
  try {
    const stripped = rawAnswer
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    if (typeof parsed.verified !== 'boolean') return null;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    const idxRaw = parsed.correct_option_index;
    const correct_option_index: number | null =
      idxRaw === null
        ? null
        : typeof idxRaw === 'number' &&
          Number.isInteger(idxRaw) &&
          idxRaw >= 0 &&
          idxRaw <= 3
        ? idxRaw
        : null;
    const supporting_chunk_ids = Array.isArray(parsed.supporting_chunk_ids)
      ? (parsed.supporting_chunk_ids as string[]).filter((x) => typeof x === 'string')
      : [];
    return {
      verified: parsed.verified,
      reason,
      correct_option_index,
      supporting_chunk_ids,
    };
  } catch {
    return null;
  }
}

function deriveVerificationState(
  draft: DraftQuestionFromService,
  verifier: VerifierResponse | null,
): 'verified' | 'failed' {
  if (!verifier) return 'failed';
  if (!verifier.verified) return 'failed';
  if (verifier.correct_option_index !== draft.correct_answer_index) return 'failed';
  return 'verified';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('bulk-question-gen generator JSON parser', () => {
  const goodDraft = {
    question_text: 'What is the SI unit of force?',
    options: ['newton', 'joule', 'pascal', 'watt'],
    correct_answer_index: 0,
    explanation: 'The newton is the SI unit of force (F = m·a).',
    difficulty: 'easy',
    bloom_level: 'remember',
    supporting_chunk_ids: ['11111111-1111-1111-1111-111111111111'],
  };

  it('parses strict JSON draft', () => {
    const result = parseDraftJson(JSON.stringify(goodDraft));
    expect(result).not.toBeNull();
    expect(result?.question_text).toBe('What is the SI unit of force?');
    expect(result?.correct_answer_index).toBe(0);
  });

  it('strips markdown fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify(goodDraft) + '\n```';
    const result = parseDraftJson(fenced);
    expect(result).not.toBeNull();
    expect(result?.question_text).toBe('What is the SI unit of force?');
  });

  it('returns null for {"error": "insufficient_source"} sentinel', () => {
    expect(parseDraftJson('{"error":"insufficient_source"}')).toBeNull();
  });

  it('returns null when options != 4', () => {
    const bad = { ...goodDraft, options: ['a', 'b', 'c'] };
    expect(parseDraftJson(JSON.stringify(bad))).toBeNull();
  });

  it('returns null when correct_answer_index out of range', () => {
    const bad = { ...goodDraft, correct_answer_index: 4 };
    expect(parseDraftJson(JSON.stringify(bad))).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseDraftJson('not json at all')).toBeNull();
  });
});

describe('bulk-question-gen verifier JSON parser', () => {
  const goodVerifier = {
    verified: true,
    reason: 'NCERT chapter 9 equation F=ma confirms newton is SI unit of force.',
    correct_option_index: 0,
    supporting_chunk_ids: ['22222222-2222-2222-2222-222222222222'],
  };

  it('parses strict verifier JSON', () => {
    const result = parseVerifierJson(JSON.stringify(goodVerifier));
    expect(result?.verified).toBe(true);
    expect(result?.correct_option_index).toBe(0);
  });

  it('accepts correct_option_index=null (no supporting option)', () => {
    const r = parseVerifierJson(
      JSON.stringify({
        verified: false,
        reason: 'none of the options match NCERT definition',
        correct_option_index: null,
        supporting_chunk_ids: [],
      }),
    );
    expect(r?.correct_option_index).toBeNull();
  });

  it('returns null on missing verified field', () => {
    expect(parseVerifierJson('{"reason":"x","correct_option_index":0,"supporting_chunk_ids":[]}')).toBeNull();
  });
});

describe('bulk-question-gen verification-state derivation', () => {
  const draft: DraftQuestionFromService = {
    question_text: 'q',
    options: ['a', 'b', 'c', 'd'],
    correct_answer_index: 2,
    explanation: 'e',
  };

  it('verified=true AND matching index → verified', () => {
    const v: VerifierResponse = {
      verified: true,
      reason: 'ok',
      correct_option_index: 2,
      supporting_chunk_ids: [],
    };
    expect(deriveVerificationState(draft, v)).toBe('verified');
  });

  it('verified=true but index mismatch → failed', () => {
    const v: VerifierResponse = {
      verified: true,
      reason: 'verifier agrees on a DIFFERENT option',
      correct_option_index: 1,
      supporting_chunk_ids: [],
    };
    expect(deriveVerificationState(draft, v)).toBe('failed');
  });

  it('verified=false → failed even if option index matches', () => {
    const v: VerifierResponse = {
      verified: false,
      reason: 'cannot confirm from chunks',
      correct_option_index: 2,
      supporting_chunk_ids: [],
    };
    expect(deriveVerificationState(draft, v)).toBe('failed');
  });

  it('verifier parse error (null) → failed', () => {
    expect(deriveVerificationState(draft, null)).toBe('failed');
  });
});

describe('bulk-question-gen trace_id sanitization', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeTraceId = (id: string | undefined): string | null =>
    id && UUID_RE.test(id) ? id : null;

  it('accepts a real UUID', () => {
    expect(safeTraceId('11111111-2222-3333-4444-555555555555')).toBe(
      '11111111-2222-3333-4444-555555555555',
    );
  });

  it('rejects the hop-timeout sentinel', () => {
    expect(safeTraceId('hop-timeout')).toBeNull();
  });

  it('rejects service-500 sentinel', () => {
    expect(safeTraceId('service-500')).toBeNull();
  });

  it('rejects undefined', () => {
    expect(safeTraceId(undefined)).toBeNull();
  });
});