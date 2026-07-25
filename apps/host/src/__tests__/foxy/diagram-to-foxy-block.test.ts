/**
 * diagramSpecToFoxyResponse — the adapter that turns a `DiagramSpec` from the
 * Content(Diagram) GenAI agent into the EXISTING one-block Foxy structured
 * render envelope, so the diagram is drawn by the same `MermaidBlock` renderer
 * every Foxy chat turn already uses (REG-55 envelope, unchanged).
 *
 * The safety contract this pins (P12, defense-in-depth over the server gates):
 *
 *   The adapter re-runs `validateMermaidCode` CLIENT-SIDE and returns `null`
 *   for anything that fails. `null` means the sheet shows a calm fallback —
 *   the untrusted source is NEVER handed to the renderer and never surfaces
 *   as raw text. Injection shapes explicitly covered: `<script`,
 *   `javascript:`, `click` interaction callbacks, and a `%%{init}` directive
 *   that overrides `securityLevel` / `htmlLabels`. Over-length code is
 *   rejected too (bundle + render-cost guard).
 *
 * Owning agent: testing. Under test: frontend (adapter) + ai-engineer (schema).
 */

import { describe, it, expect } from 'vitest';
import {
  diagramSpecToFoxyResponse,
  toFoxySubject,
} from '@/app/foxy/_lib/diagram-to-foxy-block';
import { FOXY_MAX_MERMAID_CODE_LEN } from '@alfanumrik/lib/foxy/schema';
import type { DiagramSpec } from '@alfanumrik/lib/diagram/types';

const VALID_CODE = 'flowchart TD\n  A[Atom] --> B[Molecule]\n  B --> C[Compound]';

function spec(overrides: Partial<DiagramSpec> = {}): DiagramSpec {
  return {
    abstained: false,
    mermaidCode: VALID_CODE,
    diagramKind: 'flowchart',
    titleEn: 'From atoms to molecules',
    titleHi: 'परमाणु से अणु तक',
    captionEn: 'How atoms combine into molecules.',
    captionHi: 'परमाणु अणु में कैसे जुड़ते हैं।',
    citations: [],
    meta: {},
    ...overrides,
  } as DiagramSpec;
}

const OPTS = { subjectCode: 'science', isHi: false, fallbackTitle: 'Chapter diagram' };

// ── 1. Happy path ────────────────────────────────────────────────────────────

describe('Foxy diagram adapter — valid spec becomes a one-block FoxyResponse', () => {
  it('emits exactly ONE mermaid block carrying the code verbatim', () => {
    const res = diagramSpecToFoxyResponse(spec(), OPTS);
    expect(res).not.toBeNull();
    expect(res!.blocks).toHaveLength(1);
    expect(res!.blocks[0].type).toBe('mermaid');
    expect(res!.blocks[0].code).toBe(VALID_CODE);
  });

  it('uses the English title in EN mode and the Hindi title in HI mode (P7)', () => {
    expect(diagramSpecToFoxyResponse(spec(), OPTS)!.title).toBe(
      'From atoms to molecules',
    );
    expect(
      diagramSpecToFoxyResponse(spec(), { ...OPTS, isHi: true })!.title,
    ).toBe('परमाणु से अणु तक');
  });

  it('falls back to the other language when the primary title is empty', () => {
    const res = diagramSpecToFoxyResponse(spec({ titleEn: '' }), OPTS);
    expect(res!.title).toBe('परमाणु से अणु तक');
  });

  it('falls back to the caller-supplied fallbackTitle when BOTH titles are empty', () => {
    const res = diagramSpecToFoxyResponse(spec({ titleEn: '', titleHi: '' }), OPTS);
    expect(res!.title).toBe('Chapter diagram');
  });

  it('maps the caption into the block title, per language', () => {
    expect(diagramSpecToFoxyResponse(spec(), OPTS)!.blocks[0].title).toBe(
      'How atoms combine into molecules.',
    );
    expect(
      diagramSpecToFoxyResponse(spec(), { ...OPTS, isHi: true })!.blocks[0].title,
    ).toBe('परमाणु अणु में कैसे जुड़ते हैं।');
  });

  it('omits the block title entirely when there is no caption', () => {
    const res = diagramSpecToFoxyResponse(
      spec({ captionEn: '', captionHi: '' }),
      OPTS,
    );
    expect('title' in res!.blocks[0]).toBe(false);
  });

  it('clamps an over-long title to the schema max (120) with an ellipsis', () => {
    const res = diagramSpecToFoxyResponse(spec({ titleEn: 'A'.repeat(400) }), OPTS);
    expect(res!.title.length).toBe(120);
    expect(res!.title.endsWith('…')).toBe(true);
  });

  it('clamps an over-long caption to the mermaid title max (120)', () => {
    const res = diagramSpecToFoxyResponse(spec({ captionEn: 'B'.repeat(400) }), OPTS);
    expect((res!.blocks[0].title as string).length).toBe(120);
  });

  it('trims surrounding whitespace off the mermaid source', () => {
    const res = diagramSpecToFoxyResponse(
      spec({ mermaidCode: `\n\n  ${VALID_CODE}  \n` }),
      OPTS,
    );
    expect(res!.blocks[0].code).toBe(VALID_CODE);
  });

  it('accepts the other v1 diagram kinds (mindmap, timeline)', () => {
    expect(
      diagramSpecToFoxyResponse(
        spec({ diagramKind: 'mindmap', mermaidCode: 'mindmap\n  root((Atoms))' }),
        OPTS,
      ),
    ).not.toBeNull();
    expect(
      diagramSpecToFoxyResponse(
        spec({ diagramKind: 'timeline', mermaidCode: 'timeline\n  1857 : Revolt' }),
        OPTS,
      ),
    ).not.toBeNull();
  });
});

// ── 2. Injection / untrusted source → null, never rendered ───────────────────

describe('Foxy diagram adapter — injection payloads are REJECTED (return null)', () => {
  const payloads: Array<[string, string]> = [
    ['<script> tag in a node label', 'flowchart TD\n  A["<script>alert(1)</script>"] --> B'],
    ['javascript: URI', 'flowchart TD\n  A["javascript:alert(1)"] --> B'],
    ['click interaction callback', 'flowchart TD\n  A --> B\n  click A callback "x"'],
    [
      'click callback with leading whitespace',
      'flowchart TD\n  A --> B\n     click A href "https://evil.test"',
    ],
    [
      '%%{init} overriding securityLevel',
      "flowchart TD\n  %%{init: {'securityLevel':'loose'}}%%\n  A --> B",
    ],
    [
      '%%{init} overriding htmlLabels',
      "flowchart TD\n  %%{init: {'flowchart':{'htmlLabels':true}}}%%\n  A --> B",
    ],
    ['non-allowlisted header', "alert('pwned')\n  A --> B"],
    ['raw HTML instead of a diagram', '<img src=x onerror=alert(1)>'],
    ['uppercase SCRIPT tag', 'flowchart TD\n  A["<SCRIPT>x</SCRIPT>"] --> B'],
  ];

  it.each(payloads)('rejects %s', (_label, code) => {
    expect(diagramSpecToFoxyResponse(spec({ mermaidCode: code }), OPTS)).toBeNull();
  });

  it('returns null — so nothing renders — rather than a response carrying the payload', () => {
    for (const [, code] of payloads) {
      const res = diagramSpecToFoxyResponse(spec({ mermaidCode: code }), OPTS);
      expect(res).toBeNull();
      // Belt and braces: no partially-built envelope can leak the source.
      expect(JSON.stringify(res)).not.toContain('script');
      expect(JSON.stringify(res)).not.toContain('javascript:');
    }
  });

  it('does NOT false-positive on a node LABEL that merely contains the word "click"', () => {
    const res = diagramSpecToFoxyResponse(
      spec({ mermaidCode: 'flowchart TD\n  A["Click the switch"] --> B[Bulb glows]' }),
      OPTS,
    );
    expect(res).not.toBeNull();
  });
});

// ── 3. Degenerate / over-length source → null ────────────────────────────────

describe('Foxy diagram adapter — degenerate source returns null', () => {
  it('rejects empty mermaidCode', () => {
    expect(diagramSpecToFoxyResponse(spec({ mermaidCode: '' }), OPTS)).toBeNull();
  });

  it('rejects whitespace-only mermaidCode', () => {
    expect(diagramSpecToFoxyResponse(spec({ mermaidCode: '   \n\t ' }), OPTS)).toBeNull();
  });

  it('rejects a missing mermaidCode field', () => {
    expect(
      diagramSpecToFoxyResponse(
        spec({ mermaidCode: undefined as unknown as string }),
        OPTS,
      ),
    ).toBeNull();
  });

  it(`rejects code longer than FOXY_MAX_MERMAID_CODE_LEN (${FOXY_MAX_MERMAID_CODE_LEN})`, () => {
    const long = `flowchart TD\n${'  A --> B\n'.repeat(400)}`;
    expect(long.length).toBeGreaterThan(FOXY_MAX_MERMAID_CODE_LEN);
    expect(diagramSpecToFoxyResponse(spec({ mermaidCode: long }), OPTS)).toBeNull();
  });

  it('accepts code exactly AT the length ceiling (boundary, not off-by-one)', () => {
    const head = 'flowchart TD\n';
    const filler = 'A-->B\n';
    let code = head;
    while (code.length + filler.length <= FOXY_MAX_MERMAID_CODE_LEN) code += filler;
    expect(code.trim().length).toBeLessThanOrEqual(FOXY_MAX_MERMAID_CODE_LEN);
    expect(diagramSpecToFoxyResponse(spec({ mermaidCode: code }), OPTS)).not.toBeNull();
  });
});

// ── 4. Subject mapping (renderer icon/colour fallback only) ──────────────────

describe('Foxy diagram adapter — toFoxySubject mapping', () => {
  it('maps math codes', () => {
    expect(toFoxySubject('math')).toBe('math');
    expect(toFoxySubject('mathematics')).toBe('math');
  });

  it('maps the science family', () => {
    for (const code of ['science', 'physics', 'chemistry', 'biology']) {
      expect(toFoxySubject(code)).toBe('science');
    }
  });

  it('maps the social-studies family to sst', () => {
    for (const code of [
      'social_studies',
      'history',
      'history_sr',
      'geography',
      'political_science',
      'economics',
    ]) {
      expect(toFoxySubject(code)).toBe('sst');
    }
  });

  it('maps english, and falls back to general for anything unknown', () => {
    expect(toFoxySubject('english')).toBe('english');
    expect(toFoxySubject('sanskrit')).toBe('general');
    expect(toFoxySubject('')).toBe('general');
  });

  it('threads the mapped subject onto the response envelope', () => {
    expect(
      diagramSpecToFoxyResponse(spec(), { ...OPTS, subjectCode: 'history' })!.subject,
    ).toBe('sst');
  });
});
