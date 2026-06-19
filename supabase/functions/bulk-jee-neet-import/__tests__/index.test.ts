/**
 * bulk-jee-neet-import — PR-2 of the JEE/NEET scaling roadmap.
 *
 * Strategy mirrors the rest of `src/__tests__/edge-functions/` and the
 * account-purge test file: static-source inspection of the Deno-runtime
 * `index.ts` plus exhaustive pure-function tests of the Deno-free
 * `validation.ts` companion (parser / oracle / cache key helpers).
 *
 * What's pinned:
 *   1. Edge Function file shape (Deno.serve, esm.sh import, shared CORS).
 *   2. Constant-time Bearer-token auth on admin secret (no timing oracle).
 *   3. 401 on missing / invalid auth BEFORE any DB read or Claude call.
 *   4. 422 on schema-invalid bodies; full error report (no partial inserts).
 *   5. Dry-run mode produces a report but never writes to DB or calls Claude.
 *   6. Idempotency: ON CONFLICT (exam_session, exam_year, question_number)
 *      DO NOTHING via supabase.upsert(... ignoreDuplicates: true).
 *   7. Oracle gate (REG-54): MCQ candidates are validated via
 *      `validateCandidate` from `_shared/quiz-oracle.ts` before insert;
 *      rejections fire ops_events with `category='content.pyq_ingestion'`.
 *   8. RAG chunks are inserted with `source` ∈ {jee_archive, neet_archive,
 *      olympiad} and matching `exam_relevance`.
 *   9. Embeddings are NOT generated inline (embed-questions cron handles it).
 *  10. Cost-relevant constants: 4 Claude calls per accepted MCQ, ~$0.001
 *      per question (documented in the runbook + reflected in the prompt
 *      structure pinned here).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  parseBulkImportBody,
  parsePaper,
  parseQuestion,
  parseConceptResponse,
  parseDifficultyResponse,
  parseExplanationResponse,
  extractJsonObject,
  examRelevanceForSource,
  buildIdempotencyKey,
  VALID_PYQ_SOURCE_TYPES,
  VALID_PAPER_PATTERNS,
  VALID_GRADES,
  type BulkImportInput,
} from '../validation';

const FN_PATH = resolve(
  process.cwd(),
  'supabase/functions/bulk-jee-neet-import/index.ts',
);
const VALIDATION_PATH = resolve(
  process.cwd(),
  'supabase/functions/bulk-jee-neet-import/validation.ts',
);
const RUNBOOK_PATH = resolve(
  process.cwd(),
  'docs/runbooks/2026-05-19-bulk-jee-neet-import.md',
);

// ─── 1. Edge Function file shape ─────────────────────────────────────────────

describe('bulk-jee-neet-import Edge Function — file shape', () => {
  it('exists at supabase/functions/bulk-jee-neet-import/index.ts', () => {
    expect(existsSync(FN_PATH)).toBe(true);
  });

  it('uses Deno.serve (Edge Function runtime contract)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/Deno\.serve\s*\(/);
  });

  it('imports @supabase/supabase-js@2 from esm.sh (no node_modules)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain("from 'https://esm.sh/@supabase/supabase-js@2'");
  });

  it('imports shared CORS / auth / ops-events helpers (sibling parity)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from ['"]\.\.\/_shared\/cors\.ts['"]/);
    // Phase 4: auth is now via the Platform Security Layer (ai-admission.ts),
    // not the legacy _shared/auth.ts constantTimeEqual check.
    expect(src).toMatch(/from ['"]\.\.\/_shared\/security\/ai-admission\.ts['"]/);
    expect(src).toMatch(/from ['"]\.\.\/_shared\/ops-events\.ts['"]/);
  });

  it('imports the REG-54 quiz-oracle from the SAME shared module other functions use', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from ['"]\.\.\/_shared\/quiz-oracle\.ts['"]/);
    expect(src).toMatch(/validateCandidate/);
  });

  it('imports the Deno-free validation module for body parsing', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from ['"]\.\/validation\.ts['"]/);
    expect(src).toMatch(/parseBulkImportBody/);
  });

  it('uses Claude Haiku model (sibling parity, cost-controlled per spec)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/claude-haiku-4-5-20251001/);
  });
});

// ─── 2. Platform Security Layer auth (Phase 4 migration) ─────────────────────

describe('bulk-jee-neet-import — auth (Platform Security Layer)', () => {
  it('uses admitAiRoute from _shared/security/ai-admission (Phase 4 migration)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Phase 4: HMAC internal-caller signing replaced the old x-admin-key / ADMIN_API_KEY pattern.
    expect(src).toMatch(/admitAiRoute/);
    expect(src).toMatch(/finalizeAiRoute/);
    expect(src).toMatch(/from ['"]\.\.\/_shared\/security\/ai-admission\.ts['"]/);
  });

  it('restricts callerTypes to internal_service only', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Only internal callers (the /super-admin/ai proxy) may reach this function.
    expect(src).toMatch(/callerTypes.*internal_service/s);
  });

  it('calls admitAiRoute BEFORE any callClaude (auth before business logic)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    const handlerStart = src.indexOf('Deno.serve(');
    expect(handlerStart).toBeGreaterThan(0);
    const handler = src.slice(handlerStart);

    const admitPos = handler.indexOf('admitAiRoute(');
    const claudePos = handler.indexOf('callClaude(');
    expect(admitPos).toBeGreaterThan(0);
    // Claude call (if present) must come AFTER admitAiRoute.
    if (claudePos > 0) expect(admitPos).toBeLessThan(claudePos);
  });

  it('propagates admitResult.response when admission fails (deny-before-IO pattern)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The deny path: `if (!admitResult.ok) return admitResult.response`
    // This ensures rejected requests never reach DB reads or Claude calls.
    expect(src).toMatch(/admitResult\.ok/);
    expect(src).toMatch(/admitResult\.response/);
  });
});

// ─── 3. Body schema validation (422) ─────────────────────────────────────────

describe('bulk-jee-neet-import — body validation (422)', () => {
  it('uses 422 for validation_failed (not 400 — semantic match)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/status:\s*422|422,/);
    expect(src).toMatch(/validation_failed/);
  });

  it('rejects invalid JSON body with 422', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toContain('invalid JSON body');
  });

  it('caps batch at 100 questions per call (operator-runbook guidance)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/MAX_QUESTIONS_PER_BATCH\s*=\s*100/);
    expect(src).toMatch(/status:\s*413|413,/);
  });
});

// ─── 4. Dry-run never writes ─────────────────────────────────────────────────

describe('bulk-jee-neet-import — dry-run mode', () => {
  it('the pipeline returns the synthetic accept and skips Claude when dry_run=true', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Pin the control-flow branch: when ctx.dryRun is true, return BEFORE
    // any callClaude / upsert call inside processQuestion.
    expect(src).toMatch(/if\s*\(\s*ctx\.dryRun\s*\)/);
    expect(src).toMatch(/dry_run/);
  });

  it('dry_run is a required boolean in the parsed body (no implicit default)', () => {
    const r = parseBulkImportBody({
      source_type: 'jee_archive',
      papers: [{ exam_session: 'X', exam_year: 2024, subject: 'physics', grade: '12', questions: [] }],
    } as unknown);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.dry_run')).toBe(true);
  });
});

// ─── 5. Idempotency contract ─────────────────────────────────────────────────

describe('bulk-jee-neet-import — idempotency (ON CONFLICT DO NOTHING)', () => {
  it('uses supabase.upsert with ignoreDuplicates: true on question_bank', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The upsert must be on question_bank specifically, not on rag_content_chunks.
    expect(src).toMatch(
      /from\(['"]question_bank['"]\)\s*\.upsert\([\s\S]*?ignoreDuplicates:\s*true/,
    );
  });

  it('the onConflict tuple is (exam_session, exam_year, question_number)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(
      /onConflict:\s*['"]exam_session,exam_year,question_number['"]/,
    );
  });

  it('returns status="duplicate" when the upsert reports zero rows back', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The runtime checks `insertedQB.length === 0` and returns
    // `{ status: 'duplicate', reason: 'idempotency_skip' }`.
    expect(src).toMatch(/idempotency_skip/);
    expect(src).toMatch(/status:\s*['"]duplicate['"]/);
  });

  it('buildIdempotencyKey produces the same string for the same (session,year,number)', () => {
    const a = buildIdempotencyKey(
      { exam_session: 'JEE_MAIN', exam_year: 2024 },
      { question_number: 'Q15' },
    );
    const b = buildIdempotencyKey(
      { exam_session: 'JEE_MAIN', exam_year: 2024 },
      { question_number: 'Q15' },
    );
    expect(a).toBe(b);
    const c = buildIdempotencyKey(
      { exam_session: 'JEE_MAIN', exam_year: 2024 },
      { question_number: 'Q16' },
    );
    expect(a).not.toBe(c);
  });
});

// ─── 6. Oracle gate (REG-54) ─────────────────────────────────────────────────

describe('bulk-jee-neet-import — REG-54 oracle gate', () => {
  it('runs validateCandidate on MCQ candidates before insert', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/validateCandidate\s*\(/);
  });

  it('passes a real LlmGrader (callOracleGrader) into validateCandidate', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/llmGrade:\s*callOracleGrader/);
    expect(src).toMatch(/enableLlmGrader:\s*true/);
  });

  it('returns status="rejected" and logs ops_events on oracle rejection', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/oracle_rejection/);
    // The ops_events insert must use the dedicated category code.
    expect(src).toMatch(/category:\s*['"]content\.pyq_ingestion['"]/);
    expect(src).toMatch(/source:\s*['"]bulk-jee-neet-import['"]/);
  });

  it('fails CLOSED when the oracle grader throws (P12 spirit)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // The catch block must coerce the throw into an `llm_grader_unavailable`
    // OracleRejectResult and continue down the rejection path.
    expect(src).toContain("'llm_grader_unavailable'");
  });

  it('skips oracle (and logs the skip) when paper_pattern=mcq_5 (PR-3 widens)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/Oracle skipped \(paper_pattern=mcq_5/);
  });

  it('does NOT modify quiz-oracle.ts itself (PR-3 scope per spec)', () => {
    // The shared oracle file is the authoritative source. If this PR ever
    // had to change it, the test would be loud — but the spec explicitly
    // forbids touching it. Confirm we only IMPORT it.
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).not.toMatch(/export\s+function\s+validateCandidate/);
    expect(src).not.toMatch(/export\s+function\s+runDeterministicChecks/);
  });
});

// ─── 7. RAG chunks + exam_relevance mapping ──────────────────────────────────

describe('bulk-jee-neet-import — rag_content_chunks insert', () => {
  it('inserts a row with source=source_type for every accepted question', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/from\(['"]rag_content_chunks['"]\)\s*\.insert\(/);
    expect(src).toMatch(/source:\s*ctx\.sourceType/);
  });

  it('exam_relevance derives from source_type (jee_archive → JEE, etc.)', () => {
    expect(examRelevanceForSource('jee_archive')).toEqual(['JEE']);
    expect(examRelevanceForSource('neet_archive')).toEqual(['NEET']);
    expect(examRelevanceForSource('olympiad')).toEqual(['OLYMPIAD']);
  });

  it('continues even if rag_content_chunks insert fails (question_bank row stays)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/rag_content_chunks insert failed/);
    // The accepted-status return MUST still fire — the rag insert is non-fatal.
    expect(src).toMatch(/return\s*\{\s*status:\s*['"]accepted['"]\s*\}/);
  });
});

// ─── 8. Embeddings NOT inline ────────────────────────────────────────────────

describe('bulk-jee-neet-import — embeddings discipline', () => {
  it('does NOT call generateEmbeddings inline (the cron handles it)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).not.toMatch(/generateEmbeddings\(/);
    expect(src).not.toMatch(/from ['"].*embeddings\.ts['"]/);
  });

  it('does NOT set the embedding column on insert (left null for cron to fill)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).not.toMatch(/embedding:\s*JSON\.stringify\(/);
  });
});

// ─── 9. Telemetry / PII discipline ───────────────────────────────────────────

describe('bulk-jee-neet-import — telemetry (P13 — no PII in ops_events)', () => {
  it('only logs IDs, codes, counts (no email/name/phone fields)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    // Generated content is not PII per P13, but defensively scan for the
    // common PII fields anyway — any literal key like `email:` inside a
    // logged context block would be a footgun.
    const forbidden = [
      /context:\s*\{[\s\S]*?\bemail\s*:/,
      /context:\s*\{[\s\S]*?\bphone\s*:/,
      /context:\s*\{[\s\S]*?\bfull_name\s*:/,
      /context:\s*\{[\s\S]*?\bparent_name\s*:/,
      /context:\s*\{[\s\S]*?\bparent_phone\s*:/,
    ];
    for (const re of forbidden) {
      expect(src).not.toMatch(re);
    }
  });

  it('the batch summary fires an ops_events at category=content.pyq_ingestion', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(
      /category:\s*['"]content\.pyq_ingestion['"][\s\S]{0,500}message:\s*['"]Bulk PYQ ingestion batch completed['"]/,
    );
  });
});

// ─── 10. Circuit breaker (P12) ───────────────────────────────────────────────

describe('bulk-jee-neet-import — circuit breaker (P12)', () => {
  it('declares a circuit breaker with 3-in-60s open threshold', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/circuitBreaker/);
    expect(src).toMatch(/FAILURE_THRESHOLD[\s:]*=?\s*3/);
    expect(src).toMatch(/RESET_TIMEOUT_MS[\s:]*=?\s*60_000/);
  });

  it('callClaude consults the breaker before fetching', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/circuitBreaker\.canRequest\(\)/);
  });
});

// ─── 11. Pure validation helpers — parseBulkImportBody ───────────────────────

describe('parseBulkImportBody — happy path', () => {
  const validBody = (): BulkImportInput => ({
    source_type: 'jee_archive',
    dry_run: false,
    papers: [
      {
        exam_session: 'JEE_MAIN_JAN_SHIFT1',
        exam_year: 2024,
        subject: 'physics',
        grade: '12',
        questions: [
          {
            question_number: 'Q1',
            paper_pattern: 'mcq_4',
            question_text: 'A block of mass 2 kg slides down a frictionless incline at 30 degrees. Find acceleration.',
            options: ['5 m/s^2', '4.9 m/s^2', '9.8 m/s^2', '2.45 m/s^2'],
            correct_answer_index: 1,
            marks_correct: 4,
            marks_wrong: -1,
            time_estimate_seconds: 120,
          },
        ],
      },
    ],
  });

  it('accepts a fully-valid body', () => {
    const r = parseBulkImportBody(validBody());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.value?.papers).toHaveLength(1);
    expect(r.value?.papers[0].questions).toHaveLength(1);
  });

  it('accepts all three source types', () => {
    for (const s of VALID_PYQ_SOURCE_TYPES) {
      const body = validBody();
      body.source_type = s;
      const r = parseBulkImportBody(body);
      expect(r.ok).toBe(true);
    }
  });
});

describe('parseBulkImportBody — rejects', () => {
  it('rejects when body is null', () => {
    const r = parseBulkImportBody(null);
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe('$');
  });

  it('rejects when body is an array (must be object)', () => {
    const r = parseBulkImportBody([]);
    expect(r.ok).toBe(false);
  });

  it('rejects when source_type is missing or unknown', () => {
    const r = parseBulkImportBody({ dry_run: false, papers: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.source_type')).toBe(true);

    const r2 = parseBulkImportBody({
      dry_run: false,
      source_type: 'cbse_archive',
      papers: [],
    });
    expect(r2.ok).toBe(false);
    expect(r2.errors.some((e) => e.path === '$.source_type')).toBe(true);
  });

  it('rejects when dry_run is not a boolean', () => {
    const r = parseBulkImportBody({
      source_type: 'jee_archive',
      dry_run: 'no',
      papers: [],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.dry_run')).toBe(true);
  });

  it('rejects when papers is missing or not an array', () => {
    const r = parseBulkImportBody({
      source_type: 'jee_archive',
      dry_run: false,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.papers')).toBe(true);
  });
});

// ─── 12. parsePaper — per-paper validation ───────────────────────────────────

describe('parsePaper — schema enforcement', () => {
  const goodQuestion = () => ({
    question_number: 'Q1',
    paper_pattern: 'mcq_4',
    question_text: 'A block slides down an incline. Find acceleration.',
    options: ['5 m/s^2', '4.9 m/s^2', '9.8 m/s^2', '2.45 m/s^2'],
    correct_answer_index: 1,
    marks_correct: 4,
    marks_wrong: -1,
    time_estimate_seconds: 120,
  });

  it('rejects missing exam_session', () => {
    const r = parsePaper(
      { exam_year: 2024, subject: 'physics', grade: '12', questions: [goodQuestion()] },
      '$.papers[0]',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.papers[0].exam_session')).toBe(true);
  });

  it('rejects exam_year outside 2000..2100', () => {
    const r = parsePaper(
      {
        exam_session: 'JEE',
        exam_year: 1999,
        subject: 'physics',
        grade: '12',
        questions: [goodQuestion()],
      },
      '$.papers[0]',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.papers[0].exam_year')).toBe(true);
  });

  it('rejects unknown subject', () => {
    const r = parsePaper(
      {
        exam_session: 'JEE',
        exam_year: 2024,
        subject: 'sociology',
        grade: '12',
        questions: [goodQuestion()],
      },
      '$.papers[0]',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.papers[0].subject')).toBe(true);
  });

  it('rejects integer grade (P5: must be string)', () => {
    const r = parsePaper(
      {
        exam_session: 'JEE',
        exam_year: 2024,
        subject: 'physics',
        grade: 12,
        questions: [goodQuestion()],
      },
      '$.papers[0]',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.papers[0].grade')).toBe(true);
  });

  it('rejects empty questions[]', () => {
    const r = parsePaper(
      {
        exam_session: 'JEE',
        exam_year: 2024,
        subject: 'physics',
        grade: '12',
        questions: [],
      },
      '$.papers[0]',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.papers[0].questions')).toBe(true);
  });

  it('detects duplicate question_number within a paper', () => {
    const r = parsePaper(
      {
        exam_session: 'JEE',
        exam_year: 2024,
        subject: 'physics',
        grade: '12',
        questions: [goodQuestion(), goodQuestion()],
      },
      '$.papers[0]',
    );
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e) =>
          e.message.includes('duplicate question_number') &&
          e.path === '$.papers[0].questions[1].question_number',
      ),
    ).toBe(true);
  });
});

// ─── 13. parseQuestion — pattern-specific validation ─────────────────────────

describe('parseQuestion — pattern-specific shape', () => {
  it('mcq_4 requires exactly 4 distinct options and index 0..3', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'Two plus two equals what?',
        options: ['1', '2', '3'],
        correct_answer_index: 1,
        marks_correct: 4,
        marks_wrong: -1,
        time_estimate_seconds: 60,
      },
      '$.q',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.q.options')).toBe(true);
  });

  it('mcq_4 rejects non-distinct options', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'Pick the duplicate test option.',
        options: ['a', 'a', 'b', 'c'],
        correct_answer_index: 0,
        marks_correct: 4,
        marks_wrong: -1,
        time_estimate_seconds: 60,
      },
      '$.q',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('distinct'))).toBe(true);
  });

  it('mcq_4 rejects correct_answer_index out of range', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'Sample question with four options provided.',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 4,
        marks_correct: 4,
        marks_wrong: -1,
        time_estimate_seconds: 60,
      },
      '$.q',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.q.correct_answer_index')).toBe(true);
  });

  it('mcq_5 requires exactly 5 options and index 0..4', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_5',
        question_text: 'A five-option MCQ used by some JEE shifts.',
        options: ['a', 'b', 'c', 'd', 'e'],
        correct_answer_index: 4,
        marks_correct: 4,
        marks_wrong: -1,
        time_estimate_seconds: 60,
      },
      '$.q',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.options).toHaveLength(5);
  });

  it('integer pattern requires correct_answer_text (no options/index)', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'integer',
        question_text: 'How many lattice points are on a face of a BCC unit cell?',
        correct_answer_text: '4',
        marks_correct: 4,
        marks_wrong: 0,
        time_estimate_seconds: 180,
      },
      '$.q',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.correct_answer_text).toBe('4');
  });

  it('integer pattern rejects when correct_answer_text is missing', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'integer',
        question_text: 'How many lattice points on a face of a BCC unit cell?',
        marks_correct: 4,
        marks_wrong: 0,
        time_estimate_seconds: 180,
      },
      '$.q',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === '$.q.correct_answer_text')).toBe(true);
  });

  it('rejects placeholder {{ in question_text (P6)', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'What is {{ value }} of x?',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 0,
        marks_correct: 4,
        marks_wrong: -1,
        time_estimate_seconds: 60,
      },
      '$.q',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('placeholder'))).toBe(true);
  });

  it('rejects question_text shorter than 11 chars (matches DB CHECK)', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'Short Q?',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 0,
        marks_correct: 4,
        marks_wrong: -1,
        time_estimate_seconds: 60,
      },
      '$.q',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes('chk_question_not_empty'))).toBe(true);
  });

  it('accepts marks_wrong = 0 (NEET / Olympiad: no negative marking)', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'A NEET-style question without negative marking.',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 2,
        marks_correct: 4,
        marks_wrong: 0,
        time_estimate_seconds: 90,
      },
      '$.q',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.marks_wrong).toBe(0);
  });

  it('accepts marks_wrong as negative (JEE: -1)', () => {
    const r = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'A JEE-Main style question with negative marking.',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 2,
        marks_correct: 4,
        marks_wrong: -1,
        time_estimate_seconds: 90,
      },
      '$.q',
    );
    expect(r.ok).toBe(true);
    expect(r.value?.marks_wrong).toBe(-1);
  });

  it('rejects time_estimate_seconds outside [5, 3600]', () => {
    const tooSmall = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'A NEET-style question with too-small timer.',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 0,
        marks_correct: 4,
        marks_wrong: 0,
        time_estimate_seconds: 3,
      },
      '$.q',
    );
    expect(tooSmall.ok).toBe(false);

    const tooLarge = parseQuestion(
      {
        question_number: 'Q1',
        paper_pattern: 'mcq_4',
        question_text: 'A NEET-style question with too-large timer.',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 0,
        marks_correct: 4,
        marks_wrong: 0,
        time_estimate_seconds: 4000,
      },
      '$.q',
    );
    expect(tooLarge.ok).toBe(false);
  });
});

// ─── 14. Claude response parsers ─────────────────────────────────────────────

describe('extractJsonObject — strips fences + parses JSON', () => {
  it('parses bare JSON', () => {
    const r = extractJsonObject('{"a":1,"b":"x"}');
    expect(r).toEqual({ a: 1, b: 'x' });
  });

  it('strips ```json fences', () => {
    const r = extractJsonObject('```json\n{"a":1}\n```');
    expect(r).toEqual({ a: 1 });
  });

  it('strips plain ``` fences', () => {
    const r = extractJsonObject('```\n{"a":1}\n```');
    expect(r).toEqual({ a: 1 });
  });

  it('returns null on parse error', () => {
    expect(extractJsonObject('{ not valid }')).toBeNull();
  });

  it('returns null on non-object JSON', () => {
    expect(extractJsonObject('[1,2,3]')).toBeNull();
    expect(extractJsonObject('"hi"')).toBeNull();
  });

  it('handles non-string input defensively', () => {
    expect(extractJsonObject(null as unknown as string)).toBeNull();
  });
});

describe('parseConceptResponse', () => {
  it('accepts a well-formed classifier output', () => {
    const r = parseConceptResponse(
      '{"concept_code":"Kinematics Motion","chapter_title":"Motion in a Straight Line","chapter_number":2}',
    );
    expect(r).not.toBeNull();
    // snake_case + lowercase normalisation
    expect(r?.concept_code).toBe('kinematics_motion');
    expect(r?.chapter_title).toBe('Motion in a Straight Line');
    expect(r?.chapter_number).toBe(2);
  });

  it('accepts chapter_number omitted', () => {
    const r = parseConceptResponse(
      '{"concept_code":"organic_chem","chapter_title":"Haloalkanes"}',
    );
    expect(r).not.toBeNull();
    expect(r?.chapter_number).toBeNull();
  });

  it('returns null on missing fields', () => {
    expect(parseConceptResponse('{"chapter_title":"X"}')).toBeNull();
    expect(parseConceptResponse('{"concept_code":"x"}')).toBeNull();
  });
});

describe('parseDifficultyResponse', () => {
  it('accepts valid difficulty + bloom', () => {
    const r = parseDifficultyResponse('{"difficulty":4,"bloom_level":"analyze"}');
    expect(r).toEqual({ difficulty: 4, bloom_level: 'analyze' });
  });

  it('rejects out-of-range difficulty', () => {
    expect(parseDifficultyResponse('{"difficulty":6,"bloom_level":"analyze"}')).toBeNull();
    expect(parseDifficultyResponse('{"difficulty":0,"bloom_level":"analyze"}')).toBeNull();
  });

  it('rejects unknown bloom_level', () => {
    expect(parseDifficultyResponse('{"difficulty":3,"bloom_level":"intuit"}')).toBeNull();
  });

  it('rejects non-integer difficulty', () => {
    expect(parseDifficultyResponse('{"difficulty":3.5,"bloom_level":"apply"}')).toBeNull();
  });
});

describe('parseExplanationResponse', () => {
  it('accepts explanation + hint', () => {
    const r = parseExplanationResponse(
      '{"explanation":"a = g sin θ = 9.8 × 0.5 = 4.9 m/s²","hint":"resolve gravity along incline"}',
    );
    expect(r?.explanation).toContain('4.9');
    expect(r?.hint).toContain('gravity');
  });

  it('accepts explanation only (hint optional)', () => {
    const r = parseExplanationResponse('{"explanation":"some text"}');
    expect(r?.explanation).toBe('some text');
    expect(r?.hint).toBeUndefined();
  });

  it('rejects empty explanation', () => {
    expect(parseExplanationResponse('{"explanation":""}')).toBeNull();
  });
});

// ─── 15. Constants & runbook ─────────────────────────────────────────────────

describe('bulk-jee-neet-import — exported constants', () => {
  it('VALID_PYQ_SOURCE_TYPES matches the spec set', () => {
    expect(new Set(VALID_PYQ_SOURCE_TYPES)).toEqual(
      new Set(['jee_archive', 'neet_archive', 'olympiad']),
    );
  });

  it('VALID_PAPER_PATTERNS covers all PR-1 patterns', () => {
    // PR-1 widens question_bank to accept these. PR-3 will widen the oracle
    // to grade mcq_5 / integer. If anyone shrinks this set, downstream
    // pipelines break.
    for (const p of ['mcq_4', 'mcq_5', 'integer', 'matrix_match', 'numerical', 'subjective']) {
      expect(VALID_PAPER_PATTERNS).toContain(p);
    }
  });

  it('VALID_GRADES is P5-compliant (strings "6".."12")', () => {
    expect(VALID_GRADES).toEqual(['6', '7', '8', '9', '10', '11', '12']);
    // None of them are integers.
    for (const g of VALID_GRADES) {
      expect(typeof g).toBe('string');
    }
  });
});

describe('bulk-jee-neet-import — validation.ts file shape', () => {
  it('exists', () => {
    expect(existsSync(VALIDATION_PATH)).toBe(true);
  });

  it('does not import Deno-specific APIs (vitest can load it)', () => {
    const src = readFileSync(VALIDATION_PATH, 'utf8');
    // Strip block + line comments so docstrings that mention Deno don't
    // false-positive the check. We only care about executable references.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/Deno\.env\.get\(/);
    expect(code).not.toMatch(/Deno\.serve\(/);
    expect(code).not.toMatch(/from\s+['"]https:\/\/esm\.sh/);
  });
});

describe('bulk-jee-neet-import — operator runbook', () => {
  it('runbook file exists at the documented path', () => {
    expect(existsSync(RUNBOOK_PATH)).toBe(true);
  });

  it('runbook covers required topics: format, invocation, monitoring, cost', () => {
    const md = readFileSync(RUNBOOK_PATH, 'utf8');
    expect(md).toMatch(/JSONL/i);
    expect(md).toMatch(/curl/);
    expect(md).toMatch(/source_type/);
    expect(md).toMatch(/dry_run/);
    expect(md).toMatch(/0\.001|\$0\.001/);
    expect(md).toMatch(/100 questions/);
    expect(md).toMatch(/embed-questions/);
  });
});
