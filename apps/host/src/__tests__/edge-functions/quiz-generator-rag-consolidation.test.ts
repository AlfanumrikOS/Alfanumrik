/**
 * REG-255 — quiz-generator RAG retrieval goes ONLY through the unified
 * module (`_shared/rag/retrieve.ts`), never the deprecated `_shared/retrieval.ts`.
 *
 * Consolidation 2026-07-15: quiz-generator previously imported `retrieveChunks`
 * from the DEPRECATED `_shared/retrieval.ts`, whose primary backend RPC
 * (`match_rag_chunks_v2`) was NEVER applied to production. At runtime the path
 * always degraded to the legacy `match_rag_chunks` fallback, which returns no
 * Q&A columns — so the RAG Q&A question source silently yielded zero questions.
 * The fix repoints quiz-generator onto the canonical unified retrieve() via a
 * thin local adapter (`quiz-generator/retrieval.ts`), following the
 * grounded-answer precedent.
 *
 * This is a static import-contract canary (same style as REG-63 in
 * quiz-generator-422.test.ts and the REG-47/REG-118 static-source canaries):
 * Deno + the Edge runtime are not in process for Vitest, so we pin the source
 * text. It fails loudly if anyone:
 *   1. reintroduces an import of the deprecated `_shared/retrieval.ts` anywhere
 *      under quiz-generator/ (the silent-zero divergence coming back);
 *   2. detaches the adapter from the unified module, drops the
 *      caller='quiz-generator' attribution, or turns reranking on for the
 *      bare-subject-code query;
 *   3. weakens the qa-only TS filter (non-'qa' chunks carry no question_text /
 *      MCQ options — letting them through feeds P6-violating rows upstream);
 *   4. removes the adapter's never-throws posture (the old contract: retrieval
 *      failure degrades to { chunks: [], error }, never a thrown error on the
 *      quiz-serving path);
 *   5. re-enables the DORMANT selectRAGQuestions() call site without a non-MCQ
 *      question_mode gate. RAG Q&A rows are stubbed with options: '[]' and
 *      correct_answer_index: 0 — shipping them into an MCQ quiz violates P6
 *      (exactly 4 distinct options). Re-enabling is a deliberate act that must
 *      update this pin + the regression catalog together (P14 review chain:
 *      ai-engineer + assessment + testing).
 *
 * Invariants: P6 (question quality), P12-adjacent (single audited retrieval
 * path for AI content), REG-50/REG-140-adjacent (unified retrieval contract).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const QUIZ_GENERATOR_DIR = resolve(process.cwd(), 'supabase/functions/quiz-generator');
const INDEX_PATH = join(QUIZ_GENERATOR_DIR, 'index.ts');
const ADAPTER_PATH = join(QUIZ_GENERATOR_DIR, 'retrieval.ts');

/** Recursively collect .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Matches actual import/export-from statements targeting the deprecated
// module, NOT prose mentions in comments (which quote the path in backticks
// without the from '<quoted specifier>' form).
const DEPRECATED_IMPORT_RE = /from\s+['"][^'"]*_shared\/retrieval\.ts['"]/;

describe('quiz-generator RAG consolidation — unified retrieval module only (REG-255)', () => {
  it('quiz-generator index.ts and adapter exist', () => {
    expect(existsSync(INDEX_PATH)).toBe(true);
    expect(existsSync(ADAPTER_PATH)).toBe(true);
  });

  it('no file under quiz-generator/ imports the deprecated _shared/retrieval.ts', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(QUIZ_GENERATOR_DIR)) {
      const src = readFileSync(file, 'utf8');
      if (DEPRECATED_IMPORT_RE.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      'quiz-generator must not import the deprecated _shared/retrieval.ts ' +
        '(dead match_rag_chunks_v2 backend — silently yields zero Q&A rows). ' +
        'Use the local adapter ./retrieval.ts → _shared/rag/retrieve.ts.',
    ).toEqual([]);
  });

  it('index.ts imports retrieveQAChunks from the local adapter', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    expect(src).toMatch(/import\s*\{\s*retrieveQAChunks\s*\}\s*from\s*['"]\.\/retrieval\.ts['"]/);
    // And the old symbol is gone entirely.
    expect(src).not.toContain('retrieveChunks(');
  });

  it('adapter routes through the unified module with quiz-generator attribution and rerank off', () => {
    const src = readFileSync(ADAPTER_PATH, 'utf8');
    expect(src).toMatch(/from\s+['"]\.\.\/_shared\/rag\/retrieve\.ts['"]/);
    expect(src).toContain("caller: 'quiz-generator'");
    // Bare subject-code query — cross-encoder reranking adds no signal; parity
    // with the old call which never set useReranking.
    expect(src).toMatch(/rerank:\s*false/);
  });

  it('adapter keeps the qa-only TS filter (question_text present, content_type qa when surfaced)', () => {
    const src = readFileSync(ADAPTER_PATH, 'utf8');
    // Only Q&A chunks carry question_text; non-qa chunks must be dropped.
    expect(src).toMatch(
      /typeof\s+c\.question_text\s*!==\s*'string'\s*\|\|\s*c\.question_text\.trim\(\)\.length\s*===\s*0/,
    );
    // Defense-in-depth: when the RPC surfaces content_type, require 'qa'.
    expect(src).toMatch(/c\.content_type\s*!==\s*'qa'/);
  });

  it('adapter never throws — retrieval failure degrades to { chunks: [], error }', () => {
    const src = readFileSync(ADAPTER_PATH, 'utf8');
    // The retrieve() call is wrapped, and the catch branch returns the
    // empty-degraded shape rather than rethrowing.
    expect(src).toMatch(/catch\s*\(\s*err\s*\)\s*\{[\s\S]*?return\s*\{\s*chunks:\s*\[\]\s*,\s*error/);
    expect(src).not.toMatch(/catch[\s\S]{0,200}?throw\b/);
  });

  it('selectRAGQuestions call site stays dormant (P6 — RAG Q&A rows have no MCQ options)', () => {
    const src = readFileSync(INDEX_PATH, 'utf8');
    const activeCalls = src
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed.includes('selectRAGQuestions(')) return false;
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false; // commented / docstring
        if (/^(async\s+)?function\s+selectRAGQuestions\(/.test(trimmed)) return false; // definition
        return true;
      });
    expect(
      activeCalls,
      'selectRAGQuestions() was re-enabled. Its rows carry options: [] and ' +
        'correct_answer_index: 0 — serving them in an MCQ quiz violates P6. ' +
        'Re-enabling requires a non-MCQ question_mode gate + updating this pin ' +
        'and the regression catalog (review chain: ai-engineer, assessment, testing).',
    ).toEqual([]);
  });
});
