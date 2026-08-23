/**
 * REG-<next> — ncert-solver prompt-parity canary for the
 * ff_grounded_ai_ncert_solver migration (legacy shim → grounded-answer service).
 *
 * Background
 *   ncert-solver currently has two retrieval paths:
 *     1. LEGACY (flag OFF): fetchRAGContext(_shared/rag-retrieval.ts → _shared/retrieval.ts)
 *        → tries match_rag_chunks_v2, falls back to legacy match_rag_chunks (dead v2, always
 *        degrades to V1). Then builds its own solver prompt (buildSolverSystemPrompt +
 *        buildSolverPrompt + estimateConfidence) and calls Claude directly.
 *     2. SERVICE (flag ON): callGroundedAnswer(grounded-client.ts) → POST to
 *        /functions/v1/grounded-answer → runPipeline() → unified retrieve() →
 *        match_rag_chunks_ncert (RRF k=60, 0.22 cosine floor, MMR, overload-binding fix).
 *
 *   The service path is the better pipeline (single source of truth for retrieval, grounding
 *   check, coverage precheck, response cache, content-version invalidation, bilingual
 *   handling, richer trace observability). But migration loses the solver's own prompt
 *   engineering unless the ncert_solver_v1 template carries it.
 *
 * This canary pins the GAP so a flag flip cannot silently regress prompt quality.
 * It fails loudly if anyone flips ff_grounded_ai_ncert_solver ON before the template
 * parity work in items 1-3 below is done.
 *
 * Invariants: P12 (AI safety — prompt guardrails), P6 (question/answer quality).
 * Review chain: ai-engineer + assessment.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const NCERT_SOLVER_INDEX = resolve(process.cwd(), 'supabase/functions/ncert-solver/index.ts');
const INLINE_PROMPTS = resolve(process.cwd(), 'supabase/functions/grounded-answer/prompts/inline.ts');

/**
 * Extract the NCERT_SOLVER_V1 template body from inline.ts.
 *
 * inline.ts is not pinned to `eol=lf` in .gitattributes (unlike the .sql /
 * .sh files — see the .gitattributes header comment for the prior instance
 * of this exact failure class), so a Windows checkout with the common
 * `core.autocrlf=true` setting materializes it with CRLF line endings while
 * CI/Linux sees LF. Normalize before searching so this helper works on both.
 */
function extractTemplate(src: string): string {
  const normalized = src.replace(/\r\n/g, '\n');
  const templateStart = normalized.indexOf('export const NCERT_SOLVER_V1 = String.raw`');
  expect(templateStart).toBeGreaterThanOrEqual(0);
  const after = normalized.slice(templateStart);
  const templateEnd = after.indexOf('`;\n\nexport const QUIZ_QUESTION_GENERATOR_V1');
  expect(templateEnd).toBeGreaterThan(0);
  return after.slice(0, templateEnd);
}

describe('ncert-solver → grounded-answer migration: prompt-parity canary (REG-<next>)', () => {
  it('ncert-solver/index.ts exists and imports retrieveSolverContext from the local retrieval module', () => {
    expect(existsSync(NCERT_SOLVER_INDEX)).toBe(true);
    const src = readFileSync(NCERT_SOLVER_INDEX, 'utf8');
    // 2026-08-22 retrieval refactor: fetchRAGContext (_shared/rag-retrieval.ts)
    // was replaced by retrieveSolverContext in a new local retrieval.ts. This
    // assertion pins the CURRENT import so a future accidental revert back to
    // the old shim is caught.
    expect(src).toMatch(
      /import\s*\{\s*retrieveSolverContext\s*\}\s*from\s*['"]\.\/retrieval\.ts['"]/,
    );
    expect(src).toMatch(/callGroundedAnswer/);
    expect(src).toMatch(/isFeatureFlagEnabled\s*\(\s*['"]ff_grounded_ai_ncert_solver['"]/);
  });

  it('the ncert_solver_v1 template lives in grounded-answer/prompts/inline.ts', () => {
    expect(existsSync(INLINE_PROMPTS)).toBe(true);
    const src = readFileSync(INLINE_PROMPTS, 'utf8');
    expect(src).toMatch(/export\s+const\s+NCERT_SOLVER_V1\s*=/);
    expect(src).toMatch(/ncert_solver_v1:\s*NCERT_SOLVER_V1/);
  });

  // ── GAP 1 & GAP 2: NOW CLOSED ────────────────────────────────────────────────
  // 2026-08-22: NCERT_SOLVER_V1 was patched to carry the solver's subject-specific safety
  // rules (GAP-1) and marks-depth handling (GAP-2). These assertions now PASS, proving parity.
  // See supabase/functions/grounded-answer/prompts/inline.ts for the added sections.
  it("GAP-1 CLOSED: NCERT_SOLVER_V1 carries the solver's subject-specific safety rules", () => {
    const src = readFileSync(INLINE_PROMPTS, 'utf8');
    const template = extractTemplate(src);

    // Math safety rule: L'Hopital / integration-by-parts exclusion for higher-grade methods
    expect(template).toMatch(/L'Hopital/);
    expect(template).toMatch(/integration by parts/);
    // Science safety rule: only NCERT formulas/values, no invented constants
    expect(template).toMatch(/specific numerical values/);
    expect(template).toMatch(/experimental results/);
    // Social Science safety rule: only NCERT-sourced dates/events/names
    expect(template).toMatch(/specific dates, events, names/);
    expect(template).toMatch(/historical claims/);
  });

  it('GAP-2 CLOSED: NCERT_SOLVER_V1 has the marks-depth channel', () => {
    const src = readFileSync(INLINE_PROMPTS, 'utf8');
    const template = extractTemplate(src);

    // The template carries a {{marks}} variable and the depth rules (there is
    // no separate {{mark_depth}} placeholder — the depth guidance is inline
    // prose keyed off {{marks}} itself).
    expect(template).toMatch(/{{marks}}/);
    // marks 1 -> 1-2 sentences
    expect(template).toMatch(/1-2 sentences/);
    // marks 2-3 -> 3-5 sentences with the key concept
    expect(template).toMatch(/3-5 sentences/);
    // marks 4+ -> detailed with definition, explanation, and example
    expect(template).toMatch(/detailed with definition, explanation, and example/);
  });

  // ── GAP 3: solver-type routing stays in the solver ─────────────────────────
  // The legacy solver's routeToSolver routes by question type. The template does not need
  // to carry this — solver-type routing is a routing-layer concern, not a prompt concern,
  // and lives correctly in ncert-solver/index.ts. This assertion remains as a guard:
  // if anyone tries to move solver-type branching into the template, it fails.
  it('GAP-3 (unchanged): NCERT_SOLVER_V1 has no solver-type routing concept', () => {
    const src = readFileSync(INLINE_PROMPTS, 'utf8');
    const template = extractTemplate(src);

    const lower = template.toLowerCase();
    expect(lower).not.toMatch(/route to solver|solver type|solver-type|deterministic solver|rule_based solver/i);
  });

  // ── What the template DOES have (positive assertions — these are fine) ──────
  it('NCERT_SOLVER_V1 has the generic grounding rules the service expects', () => {
    const src = readFileSync(INLINE_PROMPTS, 'utf8');
    const template = extractTemplate(src);

    expect(template).toMatch(/Answer ONLY from the Reference Material/);
    expect(template).toMatch(/{{INSUFFICIENT_CONTEXT}}/);
    expect(template).toMatch(/Solve step-by-step/);
    expect(template).toMatch(/\\boxed{/);
    expect(template).toMatch(/\\frac\{}/);
  });

  // ── The service request shape is already correct ────────────────────────────
  it('the flag-ON request carries the service-expected shape (static pin of the request builder)', () => {
    const src = readFileSync(NCERT_SOLVER_INDEX, 'utf8');
    expect(src).toMatch(/mode:\s*['"]strict['"]/);
    expect(src).toMatch(/cache_scope:\s*['"]shared['"]/);
    expect(src).toMatch(/system_prompt_template:\s*['"]ncert_solver_v1['"]/);
    expect(src).toMatch(/match_count:\s*\d+/);
    expect(src).toMatch(/caller:\s*['"]ncert-solver['"]/);
  });
});
