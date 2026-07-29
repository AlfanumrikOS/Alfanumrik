/**
 * Content Generation Agent — grounded-generation ORCHESTRATOR conformance
 * (GenAI Phase 5c, REG-314).
 *
 * `generateDiagram(request, memory, deps)` is the impure orchestration layer over
 * the pure planner. It runs planDiagram → ONE `callGroundedAnswer` (single RAG
 * retrieval, REG-50 spirit) → abstain ladder → tolerant JSON parse → DUAL safety
 * gate: Gate 1 = `validateMermaidCode` (REUSED verbatim, injection/grammar gate)
 * + v1-kind header enforcement; Gate 2 = `screenStudentFacingText` over titleEn/Hi
 * + captionEn/Hi + the WHOLE mermaidCode. Either gate failing → whole-diagram
 * abstain. NO raw-SVG fallback. It writes NOTHING and NEVER throws (fail-soft to an
 * abstain envelope). This suite injects a fake `callGroundedAnswer` + `screen`
 * (Gate 1's `validateMermaidCode` runs REAL) and pins:
 *
 *   - happy path → valid DiagramSpec with bilingual title/caption + citations
 *   - abstain when grounded=false / confidence<0.75 (0.75 exactly does NOT abstain)
 *   - Gate 1: malformed mermaid / injection payload / out-of-v1-set header → abstain
 *   - Gate 2: an unsafe title/caption/mermaid node label → abstain
 *   - NO raw-SVG fallback, fail-soft (never throws)
 *   - REG-50: exactly ONE `callGroundedAnswer`
 *   - P13: no studentId / PII in any logged value
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDiagram } from '@alfanumrik/lib/diagram/generate-diagram';
import { STRICT_CONFIDENCE_ABSTAIN_THRESHOLD } from '@alfanumrik/lib/grounding-config';
import type {
  GroundedResponse,
  Citation,
  SuggestedAlternative,
  AbstainReason,
} from '@alfanumrik/lib/ai/grounded-client';
import type { OutputScreenResult } from '@alfanumrik/lib/ai/validation/output-screen';
import type { DiagramRequest, DiagramMemoryInput } from '@alfanumrik/lib/diagram/types';

// ── Logger mock (P13 assertion — capture every logged value) ──────────────────
const holders = vi.hoisted(() => ({ logCalls: [] as unknown[][] }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (...a: unknown[]) => holders.logCalls.push(a),
    warn: (...a: unknown[]) => holders.logCalls.push(a),
    error: (...a: unknown[]) => holders.logCalls.push(a),
    debug: (...a: unknown[]) => holders.logCalls.push(a),
  },
}));

beforeEach(() => {
  holders.logCalls = [];
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STUDENT_ID = 'stu-secret-abc-123'; // distinctive so a P13 leak is unmistakable.

function req(over: Partial<DiagramRequest> = {}): DiagramRequest {
  return {
    studentId: STUDENT_ID,
    subject: 'science',
    grade: '8', // P5 STRING
    chapter: { chapterNumber: 3, chapterTitle: 'Cell Structure' },
    artifactType: 'diagram',
    language: 'en',
    ...over,
  };
}

function memory(band: DiagramMemoryInput['masteryLevel'] = 'high'): DiagramMemoryInput {
  return { masteryLevel: band, preferences: { learningStyle: 'visual' } };
}

function mkCitation(index: number, chunkId: string): Citation {
  return {
    index,
    chunk_id: chunkId,
    chapter_number: 3,
    chapter_title: 'Cell Structure',
    page_number: 10 + index,
    similarity: 0.9,
    excerpt: `excerpt ${index}`,
    media_url: null,
  };
}

function groundedTrue(over: {
  answer?: string;
  citations?: Citation[];
  confidence?: number;
}): GroundedResponse {
  return {
    grounded: true,
    answer: over.answer ?? '',
    citations: over.citations ?? [mkCitation(0, 'chunk-0')],
    confidence: over.confidence ?? 0.9,
    trace_id: 'trace-abc',
    meta: { claude_model: 'claude-haiku', tokens_used: 1234, latency_ms: 900 },
  };
}

function groundedFalse(
  reason: AbstainReason,
  alternatives: SuggestedAlternative[] = [],
): GroundedResponse {
  return {
    grounded: false,
    abstain_reason: reason,
    suggested_alternatives: alternatives,
    trace_id: 'trace-xyz',
    meta: { latency_ms: 42 },
  };
}

// A minimal, valid v1 mindmap (first token 'mindmap' → allowlisted + in v1 set).
const VALID_MINDMAP = 'mindmap\n  root((Cell))\n    Nucleus\n    Membrane';

function diagramJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    mermaidCode: VALID_MINDMAP,
    titleEn: 'The Animal Cell',
    titleHi: 'पशु कोशिका',
    captionEn: 'Parts of an animal cell',
    captionHi: 'पशु कोशिका के भाग',
    supportingCitationIndexes: [0],
    ...over,
  });
}

/** A screen that flags any field containing the sentinel; else safe. */
function screenFlaggingSentinel(sentinel = '__UNSAFE__') {
  return vi.fn((text: string): OutputScreenResult =>
    text.includes(sentinel)
      ? { safe: false, categories: ['blocklist'] }
      : { safe: true, categories: [] },
  );
}

const alwaysSafe = () => vi.fn((): OutputScreenResult => ({ safe: true, categories: [] }));

// ════════════════════════════════════════════════════════════════════════════
// Happy path
// ════════════════════════════════════════════════════════════════════════════

describe('generateDiagram — happy path', () => {
  it('parses a grounded, bilingual, validated Mermaid spec with citations', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson() }));
    const screen = alwaysSafe();

    const spec = await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen });

    expect(spec.abstained).toBe(false);
    expect(spec.mermaidCode).toBe(VALID_MINDMAP);
    expect(spec.diagramKind).toBe('mindmap');
    // Bilingual (P7).
    expect(spec.titleEn.length).toBeGreaterThan(0);
    expect(spec.titleHi.length).toBeGreaterThan(0);
    expect(spec.captionEn.length).toBeGreaterThan(0);
    expect(spec.captionHi.length).toBeGreaterThan(0);
    // Grounded provenance.
    expect(spec.citations.length).toBeGreaterThanOrEqual(1);
    // Meta carried through.
    expect(spec.meta.confidence).toBe(0.9);
    expect(spec.meta.model).toBe('claude-haiku');
    expect(spec.meta.traceId).toBe('trace-abc');
    // REG-50: exactly ONE retrieval.
    expect(call).toHaveBeenCalledTimes(1);
    // Gate 2 screened all 5 student-facing fields (title x2, caption x2, mermaid).
    expect(screen).toHaveBeenCalledTimes(5);
  });

  it("a 'graph' header maps to the flowchart kind", async () => {
    const code = 'graph TD\n  A[Start] --> B[End]';
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson({ mermaidCode: code }) }));
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(false);
    expect(spec.diagramKind).toBe('flowchart');
  });

  it('recovers JSON via brace-slice when wrapped in surrounding prose', async () => {
    const json = diagramJson();
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: `Sure! Here is your diagram: ${json} Hope this helps!` }),
    );
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(false);
    expect(spec.mermaidCode).toBe(VALID_MINDMAP);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Abstain ladder
// ════════════════════════════════════════════════════════════════════════════

describe('generateDiagram — abstain ladder', () => {
  it('grounded=false → abstain surfacing the service reason + suggested alternatives', async () => {
    const alt: SuggestedAlternative = {
      grade: '8',
      subject_code: 'science',
      chapter_number: 4,
      chapter_title: 'Tissues',
      rag_status: 'ready',
    };
    const call = vi.fn().mockResolvedValue(groundedFalse('no_chunks_retrieved', [alt]));
    const screen = alwaysSafe();

    const spec = await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen });

    expect(spec.abstained).toBe(true);
    expect(spec.mermaidCode).toBe('');
    expect(spec.abstain?.reason).toBe('no_chunks_retrieved');
    expect(spec.abstain?.suggestedAlternatives).toEqual([alt]);
    // Bilingual abstain copy present (P7).
    expect(spec.abstain?.messageEn && spec.abstain?.messageHi).toBeTruthy();
    expect(call).toHaveBeenCalledTimes(1);
    expect(screen).not.toHaveBeenCalled();
  });

  it('grounded=true but confidence < 0.75 → abstain (low_similarity)', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson(), confidence: 0.5 }));
    const screen = alwaysSafe();
    const spec = await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('low_similarity');
    // Confidence abstain happens BEFORE any gate/screen work.
    expect(screen).not.toHaveBeenCalled();
  });

  it('confidence EXACTLY at the 0.75 threshold does NOT abstain', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: diagramJson(), confidence: STRICT_CONFIDENCE_ABSTAIN_THRESHOLD }),
    );
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(false);
  });

  it('empty answer → parse-empty abstain (no_supporting_chunks)', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: '' }));
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('no_supporting_chunks');
  });

  it('an {"error":...} insufficient-source payload → parse-empty abstain', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: JSON.stringify({ error: 'insufficient_source' }) }),
    );
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('no_supporting_chunks');
  });

  it('zero retrieved citations → ungroundable → parse-empty abstain', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson(), citations: [] }));
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('no_supporting_chunks');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SAFETY GATE 1 — validateMermaidCode (injection/grammar) + v1-kind header
// ════════════════════════════════════════════════════════════════════════════

describe('generateDiagram — Gate 1 structure/injection', () => {
  it('malformed mermaid (no allowlisted header) → abstain, NOT raw-SVG, NOT throw', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: diagramJson({ mermaidCode: 'totally not a diagram foobar' }) }),
    );
    const screen = alwaysSafe();
    const spec = await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('upstream_error');
    expect(spec.mermaidCode).toBe('');
    // Gate 1 fails BEFORE Gate 2 — the node-side screen never runs.
    expect(screen).not.toHaveBeenCalled();
  });

  const injectionPayloads: Array<[string, string]> = [
    ['<script>', 'flowchart TD\n  A["<script>alert(1)</script>"] --> B'],
    ['javascript:', 'flowchart TD\n  A["javascript:alert(1)"] --> B'],
    ['click callback', 'flowchart TD\n  A --> B\nclick A callback "x"'],
    ['%%{init htmlLabels}', "flowchart TD\n%%{init: {'htmlLabels': true}}%%\n  A --> B"],
  ];
  for (const [label, code] of injectionPayloads) {
    it(`rejects an injection payload (${label}) → abstain, never raw-SVG`, async () => {
      const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson({ mermaidCode: code }) }));
      const screen = alwaysSafe();
      const spec = await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen });
      expect(spec.abstained).toBe(true);
      expect(spec.abstain?.reason).toBe('upstream_error');
      expect(spec.mermaidCode).toBe('');
      expect(screen).not.toHaveBeenCalled();
    });
  }

  it('a header allowlisted by Mermaid but OUTSIDE the v1 set → abstain (v1-kind enforcement)', async () => {
    // 'sequenceDiagram' passes validateMermaidCode but is not flowchart/mindmap/timeline.
    const code = 'sequenceDiagram\n  Alice->>Bob: Hello';
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson({ mermaidCode: code }) }));
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('upstream_error');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SAFETY GATE 2 — screenStudentFacingText on every field + mermaid node labels
// ════════════════════════════════════════════════════════════════════════════

describe('generateDiagram — Gate 2 age/toxicity screen', () => {
  it('an unsafe titleHi → whole-diagram abstain', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: diagramJson({ titleHi: 'यहाँ __UNSAFE__ है' }) }),
    );
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: screenFlaggingSentinel(),
    });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('upstream_error');
    expect(spec.mermaidCode).toBe('');
  });

  it('an unsafe node label inside the mermaidCode → whole-diagram abstain', async () => {
    const code = 'mindmap\n  root((__UNSAFE__))\n    Nucleus';
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson({ mermaidCode: code }) }));
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: screenFlaggingSentinel(),
    });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('upstream_error');
  });

  it('an unsafe captionEn → whole-diagram abstain', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: diagramJson({ captionEn: 'This shows __UNSAFE__ content' }) }),
    );
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: screenFlaggingSentinel(),
    });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('upstream_error');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Fail-soft + writes-nothing + P13
// ════════════════════════════════════════════════════════════════════════════

describe('generateDiagram — fail-soft', () => {
  it('a throwing grounded call → abstain, never throws', async () => {
    const call = vi.fn().mockRejectedValue(new Error('boom'));
    let spec;
    await expect(
      (async () => {
        spec = await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen: alwaysSafe() });
      })(),
    ).resolves.not.toThrow();
    expect(spec!.abstained).toBe(true);
    expect(spec!.abstain?.reason).toBe('upstream_error');
  });

  it('a throwing screen → abstain, never throws', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson() }));
    const screen = vi.fn(() => {
      throw new Error('screen blew up');
    });
    const spec = await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen });
    expect(spec.abstained).toBe(true);
    expect(spec.abstain?.reason).toBe('upstream_error');
  });

  it('a malformed grounded envelope (missing fields) → abstain, never throws', async () => {
    const call = vi.fn().mockResolvedValue({ grounded: true } as unknown as GroundedResponse);
    const spec = await generateDiagram(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(spec.abstained).toBe(true);
  });

  it('touches ONLY the injected grounded client for I/O (writes nothing)', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson() }));
    await generateDiagram(req(), memory(), { callGroundedAnswer: call, screen: alwaysSafe() });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('P13: no studentId or PII appears in any logged value', async () => {
    // Drive several logging paths (grounded-false, low-confidence, gate1 fail).
    await generateDiagram(req(), memory(), {
      callGroundedAnswer: vi.fn().mockResolvedValue(groundedFalse('scope_mismatch')),
      screen: alwaysSafe(),
    });
    await generateDiagram(req(), memory(), {
      callGroundedAnswer: vi.fn().mockResolvedValue(groundedTrue({ answer: diagramJson(), confidence: 0.1 })),
      screen: alwaysSafe(),
    });
    await generateDiagram(req(), memory(), {
      callGroundedAnswer: vi.fn().mockResolvedValue(
        groundedTrue({ answer: diagramJson({ mermaidCode: 'garbage no header' }) }),
      ),
      screen: alwaysSafe(),
    });

    expect(holders.logCalls.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(holders.logCalls);
    expect(serialized).not.toContain(STUDENT_ID);
    expect(serialized).not.toMatch(/email|phone/i);
  });
});
