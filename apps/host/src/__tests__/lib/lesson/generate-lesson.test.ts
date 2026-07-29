/**
 * Lesson Generation Agent — grounded-generation ORCHESTRATOR conformance
 * (GenAI Phase 5b, REG-313).
 *
 * `generateLessonNotes(request, memory, deps)` is the impure orchestration layer
 * over the pure planner. It runs planLesson → ONE `callGroundedAnswer` (single RAG
 * retrieval, REG-50 spirit) → abstain ladder → tolerant JSON parse → node-side
 * `screenStudentFacingText` backstop on EVERY EN+Hindi field. It writes NOTHING
 * and NEVER throws (fail-soft to an abstain envelope). This suite injects fake
 * `callGroundedAnswer` + `screen` deps and pins:
 *
 *   - abstain when grounded=false (service abstain reason + alternatives surfaced)
 *   - abstain when confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD (0.75); the
 *     boundary value 0.75 does NOT abstain
 *   - abstain on empty / garbage / zero-citation answers (parse-empty)
 *   - happy path parses sections + citations + bilingual EN/Hindi fields
 *   - a section failing `screen` is DROPPED while the rest are kept
 *   - ALL sections unsafe → whole-lesson abstain
 *   - tolerant JSON parse (brace-slice recovery from surrounding prose)
 *   - each section's bloomLevel is clamped to plan.bloomCeiling
 *   - EXACTLY ONE `callGroundedAnswer` invocation (REG-50)
 *   - fail-soft — a throwing dep returns an abstain, never throws
 *   - writes nothing (only the two injected deps are ever touched)
 */
import { describe, it, expect, vi } from 'vitest';
import { generateLessonNotes } from '@alfanumrik/lib/lesson/generate-lesson';
import { STRICT_CONFIDENCE_ABSTAIN_THRESHOLD } from '@alfanumrik/lib/grounding-config';
import type {
  GroundedResponse,
  Citation,
  SuggestedAlternative,
  AbstainReason,
} from '@alfanumrik/lib/ai/grounded-client';
import type { OutputScreenResult } from '@alfanumrik/lib/ai/validation/output-screen';
import type { LessonRequest, LessonMemoryInput } from '@alfanumrik/lib/lesson/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function req(over: Partial<LessonRequest> = {}): LessonRequest {
  return {
    studentId: 'stu-1',
    subject: 'science',
    grade: '8', // P5 STRING
    chapter: { chapterNumber: 3, chapterTitle: 'Cell Structure' },
    artifactType: 'lesson_notes',
    language: 'en',
    ...over,
  };
}

function memory(band: LessonMemoryInput['masteryLevel'] = 'high'): LessonMemoryInput {
  return {
    masteryLevel: band,
    recentMisconceptions: [],
    weakTopics: [],
    knowledgeGaps: [],
    preferences: { learningStyle: null, preferredExplanationDepth: null },
  };
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

interface RawSection {
  kind: string;
  headingEn: string;
  headingHi: string;
  bodyEn: string;
  bodyHi: string;
  bloomLevel?: string;
  supportingCitationIndexes?: number[];
}

function section(over: Partial<RawSection> = {}): RawSection {
  return {
    kind: 'core_concepts',
    headingEn: 'What is a cell',
    headingHi: 'कोशिका क्या है',
    bodyEn: 'A cell is the basic unit of life.',
    bodyHi: 'कोशिका जीवन की मूल इकाई है।',
    bloomLevel: 'understand',
    supportingCitationIndexes: [0],
    ...over,
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

function answerJson(sections: RawSection[]): string {
  return JSON.stringify({ sections });
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
// Abstain ladder
// ════════════════════════════════════════════════════════════════════════════

describe('generateLessonNotes — abstain ladder', () => {
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

    const notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });

    expect(notes.abstained).toBe(true);
    expect(notes.sections).toEqual([]);
    expect(notes.abstain?.reason).toBe('no_chunks_retrieved');
    expect(notes.abstain?.suggestedAlternatives).toEqual([alt]);
    // Bilingual abstain copy present (P7).
    expect(notes.abstain?.messageEn && notes.abstain?.messageHi).toBeTruthy();
    // Single retrieval; screening never runs on an ungrounded response.
    expect(call).toHaveBeenCalledTimes(1);
    expect(screen).not.toHaveBeenCalled();
  });

  it('grounded=true but confidence < 0.75 → abstain (low_similarity)', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: answerJson([section()]), confidence: 0.5 }),
    );
    const screen = alwaysSafe();

    const notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });

    expect(notes.abstained).toBe(true);
    expect(notes.abstain?.reason).toBe('low_similarity');
    expect(notes.abstain?.suggestedAlternatives).toEqual([]);
    // Confidence-abstain happens BEFORE parsing/screening.
    expect(screen).not.toHaveBeenCalled();
  });

  it('confidence EXACTLY at the 0.75 threshold does NOT abstain', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({
        answer: answerJson([section()]),
        confidence: STRICT_CONFIDENCE_ABSTAIN_THRESHOLD, // 0.75 — not < 0.75
      }),
    );
    const notes = await generateLessonNotes(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(notes.abstained).toBe(false);
    expect(notes.sections).toHaveLength(1);
  });

  it('empty answer → parse-empty abstain (no_supporting_chunks)', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: '' }));
    const notes = await generateLessonNotes(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(notes.abstained).toBe(true);
    expect(notes.abstain?.reason).toBe('no_supporting_chunks');
  });

  it('garbage / non-JSON answer → parse-empty abstain', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: 'totally not json {{{ ]]]' }));
    const notes = await generateLessonNotes(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(notes.abstained).toBe(true);
    expect(notes.abstain?.reason).toBe('no_supporting_chunks');
  });

  it('zero retrieved citations → every section ungroundable → parse-empty abstain', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: answerJson([section()]), citations: [] }),
    );
    const notes = await generateLessonNotes(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(notes.abstained).toBe(true);
    expect(notes.abstain?.reason).toBe('no_supporting_chunks');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Happy path
// ════════════════════════════════════════════════════════════════════════════

describe('generateLessonNotes — happy path', () => {
  it('parses multi-section grounded, bilingual notes with citations', async () => {
    const citations = [mkCitation(0, 'chunk-0'), mkCitation(1, 'chunk-1')];
    const call = vi.fn().mockResolvedValue(
      groundedTrue({
        citations,
        answer: answerJson([
          section({ kind: 'hook', headingEn: 'Hook', bloomLevel: 'remember', supportingCitationIndexes: [0] }),
          section({
            kind: 'core_concepts',
            headingEn: 'Core',
            bloomLevel: 'understand',
            supportingCitationIndexes: [1],
          }),
        ]),
      }),
    );
    const screen = alwaysSafe();

    const notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });

    expect(notes.abstained).toBe(false);
    expect(notes.sections).toHaveLength(2);
    for (const s of notes.sections) {
      // Bilingual (P7): every human-readable field populated.
      expect(s.headingEn.length).toBeGreaterThan(0);
      expect(s.headingHi.length).toBeGreaterThan(0);
      expect(s.bodyEn.length).toBeGreaterThan(0);
      expect(s.bodyHi.length).toBeGreaterThan(0);
      // Grounded: >= 1 citation each.
      expect(s.citations.length).toBeGreaterThanOrEqual(1);
    }
    // The two distinct citations are de-duped into the union.
    expect(notes.citationsAll.map((c) => c.chunk_id).sort()).toEqual(['chunk-0', 'chunk-1']);
    // Meta carried through from the grounded response.
    expect(notes.meta.confidence).toBe(0.9);
    expect(notes.meta.model).toBe('claude-haiku');
    expect(notes.meta.traceId).toBe('trace-abc');
    // adaptationApplied codes present (PII-free HOW record).
    expect(notes.adaptationApplied.length).toBeGreaterThan(0);
    // REG-50: exactly ONE retrieval.
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('recovers JSON via brace-slice when wrapped in surrounding prose', async () => {
    const json = answerJson([section()]);
    const call = vi.fn().mockResolvedValue(
      groundedTrue({ answer: `Sure! Here are your lesson notes: ${json} Hope this helps!` }),
    );
    const notes = await generateLessonNotes(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(notes.abstained).toBe(false);
    expect(notes.sections).toHaveLength(1);
  });

  it('falls back to the full retrieved citation set when supportingCitationIndexes is absent', async () => {
    const citations = [mkCitation(0, 'chunk-0'), mkCitation(1, 'chunk-1')];
    const raw = section();
    delete raw.supportingCitationIndexes;
    const call = vi.fn().mockResolvedValue(groundedTrue({ citations, answer: answerJson([raw]) }));
    const notes = await generateLessonNotes(req(), memory(), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    expect(notes.abstained).toBe(false);
    expect(notes.sections[0].citations.map((c) => c.chunk_id)).toEqual(['chunk-0', 'chunk-1']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Node-side safety backstop (screen every EN + Hindi field)
// ════════════════════════════════════════════════════════════════════════════

describe('generateLessonNotes — per-field screen backstop', () => {
  it('drops ONLY the unsafe section and keeps the rest', async () => {
    const citations = [mkCitation(0, 'chunk-0'), mkCitation(1, 'chunk-1')];
    const call = vi.fn().mockResolvedValue(
      groundedTrue({
        citations,
        answer: answerJson([
          section({ kind: 'hook', headingEn: 'Safe hook', supportingCitationIndexes: [0] }),
          section({
            kind: 'core_concepts',
            headingEn: 'Bad core',
            bodyEn: 'This contains __UNSAFE__ content.',
            supportingCitationIndexes: [1],
          }),
        ]),
      }),
    );
    const screen = screenFlaggingSentinel();

    const notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });

    expect(notes.abstained).toBe(false);
    expect(notes.sections).toHaveLength(1);
    expect(notes.sections[0].kind).toBe('hook');
    expect(notes.sections[0].headingEn).toBe('Safe hook');
  });

  it('screens Hindi fields too — an unsafe Hindi body drops the section', async () => {
    const call = vi.fn().mockResolvedValue(
      groundedTrue({
        answer: answerJson([section({ bodyHi: 'यहाँ __UNSAFE__ है' })]),
      }),
    );
    const screen = screenFlaggingSentinel();
    const notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });
    // The only section was dropped on its Hindi field → whole-lesson abstain.
    expect(notes.abstained).toBe(true);
    expect(notes.abstain?.reason).toBe('upstream_error');
  });

  it('ALL sections unsafe → whole-lesson abstain (upstream_error)', async () => {
    const citations = [mkCitation(0, 'chunk-0'), mkCitation(1, 'chunk-1')];
    const call = vi.fn().mockResolvedValue(
      groundedTrue({
        citations,
        answer: answerJson([
          section({ kind: 'hook', bodyEn: '__UNSAFE__ one', supportingCitationIndexes: [0] }),
          section({ kind: 'core_concepts', bodyEn: '__UNSAFE__ two', supportingCitationIndexes: [1] }),
        ]),
      }),
    );
    const screen = screenFlaggingSentinel();
    const notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });
    expect(notes.abstained).toBe(true);
    expect(notes.sections).toEqual([]);
    expect(notes.abstain?.reason).toBe('upstream_error');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Bloom clamping
// ════════════════════════════════════════════════════════════════════════════

describe('generateLessonNotes — Bloom clamped to plan.bloomCeiling', () => {
  it('a section above the band ceiling is clamped; one below is left untouched', async () => {
    // low band → bloomCeiling 'understand'. A 'create' section must clamp down.
    const citations = [mkCitation(0, 'chunk-0'), mkCitation(1, 'chunk-1')];
    const call = vi.fn().mockResolvedValue(
      groundedTrue({
        citations,
        answer: answerJson([
          section({ kind: 'hook', bloomLevel: 'remember', supportingCitationIndexes: [0] }),
          section({ kind: 'core_concepts', bloomLevel: 'create', supportingCitationIndexes: [1] }),
        ]),
      }),
    );
    const notes = await generateLessonNotes(req(), memory('low'), {
      callGroundedAnswer: call,
      screen: alwaysSafe(),
    });
    const byKind = Object.fromEntries(notes.sections.map((s) => [s.kind, s.bloomLevel]));
    expect(byKind.hook).toBe('remember'); // below ceiling → unchanged
    expect(byKind.core_concepts).toBe('understand'); // 'create' clamped to ceiling
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Fail-soft + writes-nothing
// ════════════════════════════════════════════════════════════════════════════

describe('generateLessonNotes — fail-soft', () => {
  it('a throwing grounded call → abstain, never throws', async () => {
    const call = vi.fn().mockRejectedValue(new Error('boom'));
    const screen = alwaysSafe();
    let notes;
    await expect(
      (async () => {
        notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });
      })(),
    ).resolves.not.toThrow();
    expect(notes!.abstained).toBe(true);
    expect(notes!.abstain?.reason).toBe('upstream_error');
  });

  it('a throwing screen → abstain, never throws', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: answerJson([section()]) }));
    const screen = vi.fn(() => {
      throw new Error('screen blew up');
    });
    const notes = await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });
    expect(notes.abstained).toBe(true);
    expect(notes.abstain?.reason).toBe('upstream_error');
  });

  it('touches ONLY the two injected deps (writes nothing)', async () => {
    const call = vi.fn().mockResolvedValue(groundedTrue({ answer: answerJson([section()]) }));
    const screen = alwaysSafe();
    await generateLessonNotes(req(), memory(), { callGroundedAnswer: call, screen });
    // The grounded client is the sole I/O boundary; the screen is pure. Exactly
    // one retrieval, and screening happened (4 fields of the surviving section).
    expect(call).toHaveBeenCalledTimes(1);
    expect(screen).toHaveBeenCalledTimes(4);
  });
});
