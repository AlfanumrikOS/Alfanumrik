/**
 * Foxy `mermaid` block — schema accept/reject matrix (Wave 2, drawable diagrams).
 *
 * Pins the grammar-allowlist + XSS-reject validation for the new drawable
 * `mermaid` structured block. The block is the ONLY structured block whose
 * `code` is a diagram program that a client renderer executes, so the schema
 * layer is the FIRST hard gate (defense-in-depth with the renderer's
 * securityLevel:'strict'):
 *
 *   Contract: { type:'mermaid', code: string(1..2000), title?: string(<=120) }
 *   Rules:
 *     - `code`'s first non-whitespace token MUST be an allowlisted diagram header.
 *     - `code` MUST NOT contain `<script`, `javascript:`, a line-anchored
 *       `click ` interaction callback, or a `%%{init ...}` directive that
 *       overrides `htmlLabels` / `securityLevel`.
 *     - `text` / `latex` are forbidden on a mermaid block; `code` / `title`
 *       are forbidden on every OTHER block type.
 *
 * These tests assert the Zod schema (`FoxyBlockSchema` / `FoxyResponseSchema`),
 * the `validateMermaidCode` helper, and the `isFoxyMermaidBlock` guard directly,
 * and then re-run the same accept/reject matrix through the Deno-side mirror
 * validator (`validateFoxyResponse`) to prove the two copies agree byte-for-byte
 * on the grammar gate.
 *
 * P6 (question/output quality), P12 (AI safety): a hostile or malformed diagram
 * never reaches the renderer — it fails validation and the caller falls back to
 * safe prose.
 *
 * Owner: testing. Under test: ai-engineer (schema) + frontend (renderer).
 */

import { describe, it, expect } from 'vitest';
import {
  FoxyBlockSchema,
  FoxyResponseSchema,
  validateMermaidCode,
  isFoxyMermaidBlock,
  MERMAID_ALLOWED_HEADERS,
  FOXY_MAX_MERMAID_CODE_LEN,
  FOXY_MAX_MERMAID_TITLE_LEN,
  type FoxyBlock,
} from '@alfanumrik/lib/foxy/schema';
// Deno-side mirror validator (hand-rolled, no Zod). The file is pure TS (no
// `Deno.*` references, no imports), so Vitest can import it directly. If the two
// grammar gates ever drift, this parity block fails.
import { validateFoxyResponse } from '../../../../../../supabase/functions/grounded-answer/structured-schema';

// A minimal, syntactically-plausible diagram body for each allowlisted header.
// The schema does NOT run the mermaid grammar — it only checks the FIRST token —
// so a placeholder body is sufficient to prove header acceptance.
const HEADERS = [...MERMAID_ALLOWED_HEADERS];

function block(overrides: Partial<FoxyBlock> & { type: string }): unknown {
  return overrides;
}

function wrapOne(b: unknown) {
  return { title: 'Diagram', subject: 'science' as const, blocks: [b] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ACCEPT — every allowlisted header, with and without a title caption
// ─────────────────────────────────────────────────────────────────────────────

describe('mermaid block — accepts every allowlisted header', () => {
  it('has the exact 13-header allowlist (guards against silent widening)', () => {
    expect(HEADERS.sort()).toEqual(
      [
        'flowchart',
        'graph',
        'sequenceDiagram',
        'classDiagram',
        'stateDiagram',
        'stateDiagram-v2',
        'erDiagram',
        'mindmap',
        'pie',
        'timeline',
        'journey',
        'quadrantChart',
        'gitGraph',
      ].sort(),
    );
  });

  it.each(HEADERS)('accepts a valid `%s` diagram block (schema + validateMermaidCode)', (header) => {
    const code = `${header}\n  A[Start] --> B[End]`;
    const b = block({ type: 'mermaid', code });
    // validateMermaidCode passes (returns null).
    expect(validateMermaidCode(code)).toBeNull();
    // Block-level schema accepts.
    expect(FoxyBlockSchema.safeParse(b).success).toBe(true);
    // Response-level schema accepts.
    expect(FoxyResponseSchema.safeParse(wrapOne(b)).success).toBe(true);
  });

  it('accepts a mermaid block WITH an optional title caption', () => {
    const b = block({
      type: 'mermaid',
      code: 'flowchart TD\n  A[Evaporation] --> B[Condensation]\n  B --> C[Precipitation]\n  C --> A',
      title: 'The Water Cycle',
    });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(true);
  });

  it('accepts a Hindi (Devanagari) node/edge label — P7 bilingual', () => {
    const b = block({
      type: 'mermaid',
      code: 'flowchart TD\n  A[वाष्पीकरण] --> B[संघनन]',
      title: 'जल चक्र',
    });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(true);
  });

  it('accepts a benign `%%{init ...}` theme directive (only htmlLabels/securityLevel overrides are banned)', () => {
    const code = 'flowchart TD\n%%{init: {"theme":"base"}}%%\n  A --> B';
    expect(validateMermaidCode(code)).toBeNull();
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(true);
  });

  it('accepts a node LABEL that merely contains the word "click" (not a line-anchored callback)', () => {
    // The `click` gate must be statement-anchored: a label like [Click here]
    // is NOT an interaction callback and must pass.
    const code = 'flowchart TD\n  A[Click here to start] --> B[Done]';
    expect(validateMermaidCode(code)).toBeNull();
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(true);
  });

  it('accepts a title exactly at the 120-char cap', () => {
    const b = block({
      type: 'mermaid',
      code: 'graph LR\n  A --> B',
      title: 'x'.repeat(FOXY_MAX_MERMAID_TITLE_LEN),
    });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(true);
  });

  it('accepts code exactly at the 2000-char cap', () => {
    const filler = ' --> B\n  A'; // repeatable edge fragment
    let code = 'flowchart TD\n  A';
    while (code.length + filler.length <= FOXY_MAX_MERMAID_CODE_LEN) code += filler;
    expect(code.length).toBeLessThanOrEqual(FOXY_MAX_MERMAID_CODE_LEN);
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. REJECT — empty / oversize / non-allowlisted / XSS constructs
// ─────────────────────────────────────────────────────────────────────────────

describe('mermaid block — rejects invalid / hostile code', () => {
  it('rejects empty code', () => {
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code: '' })).success).toBe(false);
  });

  it('rejects whitespace-only code', () => {
    const code = '   \n  ';
    expect(validateMermaidCode(code)).not.toBeNull();
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(false);
  });

  it('rejects oversize code (> 2000 chars)', () => {
    const code = 'flowchart TD\n' + 'A-->B\n'.repeat(500); // ~3000 chars
    expect(code.length).toBeGreaterThan(FOXY_MAX_MERMAID_CODE_LEN);
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(false);
  });

  it('rejects a non-allowlisted first token', () => {
    for (const bad of ['sequence A-->B', 'mindmapp root', 'erdiagram X', 'FLOWCHART TD', 'digraph G']) {
      expect(validateMermaidCode(bad)).not.toBeNull();
      expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code: bad })).success).toBe(false);
    }
  });

  it("rejects a `<script` tag anywhere in the code", () => {
    const code = 'flowchart TD\n  A --> B\n  <script>alert(1)</script>';
    expect(validateMermaidCode(code)).toMatch(/<script/);
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(false);
  });

  it('rejects a `javascript:` URI anywhere in the code', () => {
    const code = 'flowchart TD\n  A[javascript:alert(1)] --> B';
    expect(validateMermaidCode(code)).toMatch(/javascript:/);
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(false);
  });

  it('rejects a line-anchored `click ` interaction callback', () => {
    const code = 'flowchart TD\n  A --> B\nclick A callback "doThing()"';
    expect(validateMermaidCode(code)).toMatch(/click/);
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(false);
  });

  it('rejects a `%%{init ...}` directive that overrides htmlLabels', () => {
    const code = 'flowchart TD\n%%{init: {"flowchart": {"htmlLabels": true}}}%%\n  A --> B';
    expect(validateMermaidCode(code)).toMatch(/htmlLabels|securityLevel/);
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(false);
  });

  it('rejects a `%%{init ...}` directive that overrides securityLevel', () => {
    const code = 'graph LR\n%%{init: {"securityLevel": "loose"}}%%\n  A --> B';
    expect(validateMermaidCode(code)).toMatch(/htmlLabels|securityLevel/);
    expect(FoxyBlockSchema.safeParse(block({ type: 'mermaid', code })).success).toBe(false);
  });

  it('rejects a title over the 120-char cap', () => {
    const b = block({
      type: 'mermaid',
      code: 'graph LR\n  A --> B',
      title: 'x'.repeat(FOXY_MAX_MERMAID_TITLE_LEN + 1),
    });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cross-field field coupling — text/latex on mermaid, code/title on others
// ─────────────────────────────────────────────────────────────────────────────

describe('mermaid block — field coupling (text/latex forbidden; code/title mermaid-only)', () => {
  it('rejects a mermaid block that also carries `text`', () => {
    const b = block({ type: 'mermaid', code: 'flowchart TD\n A-->B', text: 'a diagram' });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(false);
  });

  it('rejects a mermaid block that also carries `latex`', () => {
    const b = block({ type: 'mermaid', code: 'flowchart TD\n A-->B', latex: 'x = 1' });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(false);
  });

  it('rejects a mermaid block that carries an mcq-only field (`options`)', () => {
    const b = block({
      type: 'mermaid',
      code: 'flowchart TD\n A-->B',
      options: ['a', 'b', 'c', 'd'],
    });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(false);
  });

  it('rejects a non-mermaid block that carries `code`', () => {
    const b = block({ type: 'paragraph', text: 'hi', code: 'flowchart TD\n A-->B' });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(false);
  });

  it('rejects a non-mermaid block that carries `title`', () => {
    const b = block({ type: 'paragraph', text: 'hi', title: 'stray caption' });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(false);
  });

  it('rejects a `math` block that carries mermaid-only fields', () => {
    const b = block({ type: 'math', latex: 'x = 1', code: 'flowchart TD\n A-->B' });
    expect(FoxyBlockSchema.safeParse(b).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. isFoxyMermaidBlock guard
// ─────────────────────────────────────────────────────────────────────────────

describe('isFoxyMermaidBlock guard', () => {
  it('narrows a valid mermaid block to true', () => {
    const b = { type: 'mermaid', code: 'flowchart TD\n A-->B', title: 'Flow' } as FoxyBlock;
    expect(isFoxyMermaidBlock(b)).toBe(true);
    if (isFoxyMermaidBlock(b)) {
      // Type narrowing: `code` is a required string on the narrowed type.
      expect(typeof b.code).toBe('string');
    }
  });

  it('returns false for a mermaid block with empty/whitespace code', () => {
    expect(isFoxyMermaidBlock({ type: 'mermaid', code: '' } as unknown as FoxyBlock)).toBe(false);
    expect(isFoxyMermaidBlock({ type: 'mermaid', code: '   ' } as unknown as FoxyBlock)).toBe(false);
  });

  it('returns false for a mermaid block with no code field', () => {
    expect(isFoxyMermaidBlock({ type: 'mermaid' } as unknown as FoxyBlock)).toBe(false);
  });

  it('returns false for a non-mermaid block', () => {
    expect(isFoxyMermaidBlock({ type: 'paragraph', text: 'hi' } as FoxyBlock)).toBe(false);
    expect(isFoxyMermaidBlock({ type: 'diagram', search_query: 'heart' } as FoxyBlock)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Deno mirror parity — the Edge Function's hand-rolled validator agrees
// ─────────────────────────────────────────────────────────────────────────────

describe('Deno mirror validator (grounded-answer/structured-schema) — mermaid parity', () => {
  it.each(HEADERS)('accepts a valid `%s` mermaid block (mirror agrees with Zod)', (header) => {
    const code = `${header}\n  A[Start] --> B[End]`;
    const payload = wrapOne(block({ type: 'mermaid', code }));
    // Zod and the mirror must BOTH accept.
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(true);
    expect(validateFoxyResponse(payload).ok).toBe(true);
  });

  it('accepts a mermaid block with a title (mirror agrees)', () => {
    const payload = wrapOne(
      block({ type: 'mermaid', code: 'flowchart TD\n A-->B', title: 'Flow' }),
    );
    expect(validateFoxyResponse(payload).ok).toBe(true);
  });

  // These reject cases are mermaid-specific grammar/coupling rules that BOTH
  // validators enforce identically (empty/header/XSS/text-latex-on-mermaid).
  const REJECTS: Array<[string, unknown]> = [
    ['empty code', block({ type: 'mermaid', code: '' })],
    ['non-allowlisted header', block({ type: 'mermaid', code: 'sequence A-->B' })],
    ['<script tag', block({ type: 'mermaid', code: 'flowchart TD\n<script>x</script>' })],
    ['javascript: uri', block({ type: 'mermaid', code: 'flowchart TD\n A[javascript:x] --> B' })],
    ['click callback', block({ type: 'mermaid', code: 'flowchart TD\nclick A cb' })],
    ['%%{init htmlLabels}', block({ type: 'mermaid', code: 'flowchart TD\n%%{init:{"flowchart":{"htmlLabels":true}}}%%\n A-->B' })],
    ['text on mermaid', block({ type: 'mermaid', code: 'flowchart TD\n A-->B', text: 'x' })],
    ['latex on mermaid', block({ type: 'mermaid', code: 'flowchart TD\n A-->B', latex: 'x=1' })],
  ];

  it.each(REJECTS)('rejects %s (mirror agrees with Zod)', (_label, b) => {
    const payload = wrapOne(b);
    expect(FoxyResponseSchema.safeParse(payload).success).toBe(false);
    expect(validateFoxyResponse(payload).ok).toBe(false);
  });

  it('rejects oversize code in the mirror (> 2000 chars)', () => {
    const payload = wrapOne(
      block({ type: 'mermaid', code: 'flowchart TD\n' + 'A-->B\n'.repeat(500) }),
    );
    expect(validateFoxyResponse(payload).ok).toBe(false);
  });

  // ── Node<->Deno PARITY (drift reconciled) ───────────────────────────────────
  // The Zod schema forbids the mermaid-only fields (`code` / `title`) from riding
  // on a NON-mermaid block (see the "field coupling" describe above). The Deno
  // mirror `validateBlock` now enforces the same MERMAID_ONLY_FIELDS rule on
  // math + text-bearing blocks, so BOTH validators reject `{type:'paragraph',
  // text, code}` identically — honouring the mirror's own doc-comment ("mirror
  // the Zod schema EXACTLY"). This test PINS the parity so a future regression
  // that drops the enforcement on either side fails here. Do NOT weaken the
  // Zod-side rejection above — the Zod contract is the canonical one, and the
  // mirror now matches it.
  it('enforces Node<->Deno parity: BOTH Zod and the Deno mirror reject code/title on a non-mermaid block', () => {
    const paraWithCode = wrapOne(
      block({ type: 'paragraph', text: 'hi', code: 'flowchart TD\n A-->B' }),
    );
    // Zod = correct/strict: rejects the stray mermaid-only field.
    expect(FoxyResponseSchema.safeParse(paraWithCode).success).toBe(false);
    // Deno mirror = now equally strict: rejects it too (drift closed).
    expect(validateFoxyResponse(paraWithCode).ok).toBe(false);
  });
});
