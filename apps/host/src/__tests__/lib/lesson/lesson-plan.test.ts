/**
 * Lesson Generation Agent — PURE planner conformance (GenAI Phase 5b, REG-313).
 *
 * `planLesson(request, memory)` is the assessment-owned pure core that maps the
 * platform's EXISTING unified-memory adaptation signals onto a `LessonPlan` (the
 * pre-generation blueprint). It re-derives NO mastery and contains NO numeric
 * threshold — the mastery decision is `memory.masteryLevel` VERBATIM. This suite
 * pins the HOW mapping and PII-free code rendering:
 *
 *   1. Each mastery band → the correct bloomCeiling / scaffolding / section set.
 *   2. Misconceptions → codes (empty codes filtered) + `misconception_callouts`
 *      section gating (present iff the student has misconceptions).
 *   3. `emphasisTopics` = weakTopics then knowledge-gap prerequisites, de-duped,
 *      order-stable, blank-filtered.
 *   4. Preferences → depth + persona tone (explicit request.depth WINS).
 *   5. `targetBloom` only LOWERS the ceiling, never raises it.
 *   6. The section order is non-decreasing in Bloom.
 *   7. `renderAdaptationCodes` emits codes/enums ONLY — never a topic title or a
 *      misconception LABEL (P13).
 *   8. Purity — deterministic, never throws on well-formed / empty input.
 *
 * The planner runs REAL (no mocks) alongside the REAL cognitive-engine enums it
 * reuses (BLOOM_ORDER / LESSON_STEPS), so a drift in either surfaces here.
 */
import { describe, it, expect } from 'vitest';
import { planLesson, renderAdaptationCodes } from '@alfanumrik/lib/lesson/lesson-plan';
import { BLOOM_ORDER, type BloomLevel } from '@alfanumrik/lib/cognitive-engine';
import type {
  LessonRequest,
  LessonMemoryInput,
  MasteryBand,
  LessonSectionKind,
} from '@alfanumrik/lib/lesson/types';

// ── Test-side spec of each section's teaching Bloom (independent of the impl's
//    private SECTION_BASE_BLOOM constant), from spec §2.1. Used to assert the
//    returned order is non-decreasing in Bloom purely from behavior. ──────────
const SECTION_SPEC_BLOOM: Record<LessonSectionKind, BloomLevel> = {
  hook: 'remember',
  core_concepts: 'understand',
  misconception_callouts: 'understand',
  active_recall: 'apply',
  application: 'analyze',
  revision_summary: 'analyze',
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseRequest(over: Partial<LessonRequest> = {}): LessonRequest {
  return {
    studentId: 'stu-1',
    subject: 'science',
    grade: '8', // P5: STRING
    chapter: { chapterNumber: 3, chapterTitle: 'Cell Structure' },
    artifactType: 'lesson_notes',
    language: 'en',
    ...over,
  };
}

function emptyMemory(band: MasteryBand = 'medium'): LessonMemoryInput {
  return {
    masteryLevel: band,
    recentMisconceptions: [],
    weakTopics: [],
    knowledgeGaps: [],
    preferences: { learningStyle: null, preferredExplanationDepth: null },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// (1) Mastery band → bloomCeiling / scaffolding / section selection
// ════════════════════════════════════════════════════════════════════════════

describe('planLesson — mastery band anchors', () => {
  it('low band → understand ceiling, heavy scaffolding, NO application section', () => {
    const plan = planLesson(baseRequest(), emptyMemory('low'));
    expect(plan.bloomCeiling).toBe('understand');
    expect(plan.scaffoldingLevel).toBe('heavy');
    // low omits `application` to reduce load; misconception_callouts absent (no misconceptions).
    expect(plan.sectionKinds).toEqual([
      'hook',
      'core_concepts',
      'active_recall',
      'revision_summary',
    ]);
    expect(plan.sectionKinds).not.toContain('application');
    expect(plan.sectionKinds).not.toContain('misconception_callouts');
  });

  it('medium band → apply ceiling, moderate scaffolding, application present', () => {
    const plan = planLesson(baseRequest(), emptyMemory('medium'));
    expect(plan.bloomCeiling).toBe('apply');
    expect(plan.scaffoldingLevel).toBe('moderate');
    expect(plan.sectionKinds).toContain('application');
    expect(plan.sectionKinds).toEqual([
      'hook',
      'core_concepts',
      'active_recall',
      'application',
      'revision_summary',
    ]);
  });

  it('high band → evaluate ceiling, light scaffolding, application present', () => {
    const plan = planLesson(baseRequest(), emptyMemory('high'));
    expect(plan.bloomCeiling).toBe('evaluate');
    expect(plan.scaffoldingLevel).toBe('light');
    expect(plan.sectionKinds).toContain('application');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (2) Misconceptions → codes + callout section gating
// ════════════════════════════════════════════════════════════════════════════

describe('planLesson — misconception codes + callout gating', () => {
  it('recent misconceptions → codes populated AND misconception_callouts section added', () => {
    const memory = emptyMemory('medium');
    memory.recentMisconceptions = [
      { code: 'MC_MASS_WEIGHT', label: 'Confuses mass and weight', count: 3, remediationText: 'Mass is...' },
      { code: 'MC_CELL_WALL', label: 'Thinks animal cells have walls', count: 2, remediationText: 'Only plant...' },
    ];
    const plan = planLesson(baseRequest(), memory);
    expect(plan.misconceptionCodes).toEqual(['MC_MASS_WEIGHT', 'MC_CELL_WALL']);
    expect(plan.sectionKinds).toContain('misconception_callouts');
  });

  it('no misconceptions → empty codes AND no misconception_callouts section', () => {
    const plan = planLesson(baseRequest(), emptyMemory('medium'));
    expect(plan.misconceptionCodes).toEqual([]);
    expect(plan.sectionKinds).not.toContain('misconception_callouts');
  });

  it('empty-string misconception codes are filtered out', () => {
    const memory = emptyMemory('medium');
    memory.recentMisconceptions = [
      { code: '', label: 'blank code', count: 1, remediationText: 'x' },
      { code: 'MC_REAL', label: 'real', count: 1, remediationText: 'y' },
    ];
    const plan = planLesson(baseRequest(), memory);
    expect(plan.misconceptionCodes).toEqual(['MC_REAL']);
    // Still has a real code, so the callout section IS added.
    expect(plan.sectionKinds).toContain('misconception_callouts');
  });

  it('ONLY blank codes → no codes AND no callout section', () => {
    const memory = emptyMemory('medium');
    memory.recentMisconceptions = [{ code: '', label: 'blank', count: 1, remediationText: 'x' }];
    const plan = planLesson(baseRequest(), memory);
    expect(plan.misconceptionCodes).toEqual([]);
    expect(plan.sectionKinds).not.toContain('misconception_callouts');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (3) emphasisTopics — weakTopics then gaps, de-duped, order-stable, blank-filtered
// ════════════════════════════════════════════════════════════════════════════

describe('planLesson — emphasisTopics assembly', () => {
  it('weak topics first, then knowledge-gap prerequisites, in order', () => {
    const memory = emptyMemory('medium');
    memory.weakTopics = [
      { title: 'Diffusion', mastery: 0.2, attempts: 4 },
      { title: 'Osmosis', mastery: 0.3, attempts: 3 },
    ];
    memory.knowledgeGaps = [
      { target: 'Transport', prerequisite: 'Cell membrane', gapType: 'prerequisite' },
    ];
    const plan = planLesson(baseRequest(), memory);
    expect(plan.emphasisTopics).toEqual(['Diffusion', 'Osmosis', 'Cell membrane']);
  });

  it('de-dupes across weak topics and gap prerequisites (order-stable, first wins)', () => {
    const memory = emptyMemory('medium');
    memory.weakTopics = [
      { title: 'Osmosis', mastery: 0.2, attempts: 4 },
      { title: 'Osmosis', mastery: 0.2, attempts: 4 }, // dupe within weak topics
    ];
    memory.knowledgeGaps = [
      { target: 'x', prerequisite: 'Osmosis', gapType: 'prerequisite' }, // dupe vs weak topic
      { target: 'y', prerequisite: 'Turgor', gapType: 'prerequisite' },
    ];
    const plan = planLesson(baseRequest(), memory);
    expect(plan.emphasisTopics).toEqual(['Osmosis', 'Turgor']);
  });

  it('blank / whitespace-only titles are dropped', () => {
    const memory = emptyMemory('medium');
    memory.weakTopics = [
      { title: '   ', mastery: 0.2, attempts: 4 },
      { title: 'Photosynthesis', mastery: 0.2, attempts: 4 },
    ];
    memory.knowledgeGaps = [{ target: 'z', prerequisite: '', gapType: 'prerequisite' }];
    const plan = planLesson(baseRequest(), memory);
    expect(plan.emphasisTopics).toEqual(['Photosynthesis']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (4) Preferences → depth + persona tone (explicit request.depth wins)
// ════════════════════════════════════════════════════════════════════════════

describe('planLesson — depth + persona from preferences', () => {
  it('preferredExplanationDepth maps to a LessonDepth (case-insensitive)', () => {
    const memory = emptyMemory('medium');
    memory.preferences.preferredExplanationDepth = 'Detailed';
    expect(planLesson(baseRequest(), memory).depth).toBe('deep');

    memory.preferences.preferredExplanationDepth = 'short';
    expect(planLesson(baseRequest(), memory).depth).toBe('brief');
  });

  it("'quick' maps to brief (assessment-mandated D9 mapping fix, Phase 2 review)", () => {
    const memory = emptyMemory('medium');
    memory.preferences.preferredExplanationDepth = 'quick';
    expect(planLesson(baseRequest(), memory).depth).toBe('brief');
  });

  it('unknown preferred depth falls back to standard', () => {
    const memory = emptyMemory('medium');
    memory.preferences.preferredExplanationDepth = 'wibble';
    expect(planLesson(baseRequest(), memory).depth).toBe('standard');
  });

  it('explicit request.depth WINS over the preference', () => {
    const memory = emptyMemory('medium');
    memory.preferences.preferredExplanationDepth = 'deep';
    const plan = planLesson(baseRequest({ depth: 'brief' }), memory);
    expect(plan.depth).toBe('brief');
  });

  it('learningStyle maps to a persona tone (unknown → balanced)', () => {
    const memory = emptyMemory('medium');
    memory.preferences.learningStyle = 'visual';
    expect(planLesson(baseRequest(), memory).personaTone).toBe('visual');

    memory.preferences.learningStyle = 'kinesthetic';
    expect(planLesson(baseRequest(), memory).personaTone).toBe('concrete');

    memory.preferences.learningStyle = 'somethingElse';
    expect(planLesson(baseRequest(), memory).personaTone).toBe('balanced');

    memory.preferences.learningStyle = null;
    expect(planLesson(baseRequest(), memory).personaTone).toBe('balanced');
  });

  it("D9 contract enum coverage: 'example-first' → concrete; no D9 style falls to the default", () => {
    // The D9 implicit-preference writer emits exactly
    // visual | verbal | example-first | balanced. Each must map deliberately
    // (assessment-mandated, Phase 2 review: 'example-first' → 'concrete').
    const memory = emptyMemory('medium');
    memory.preferences.learningStyle = 'example-first';
    expect(planLesson(baseRequest(), memory).personaTone).toBe('concrete');

    const expected: Record<string, string> = {
      visual: 'visual',
      verbal: 'narrative',
      'example-first': 'concrete',
      balanced: 'balanced',
    };
    for (const [style, tone] of Object.entries(expected)) {
      memory.preferences.learningStyle = style;
      expect(planLesson(baseRequest(), memory).personaTone).toBe(tone);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (5) targetBloom only LOWERS the ceiling, never raises it
// ════════════════════════════════════════════════════════════════════════════

describe('planLesson — targetBloom only lowers the ceiling', () => {
  it('a targetBloom BELOW the band ceiling lowers it', () => {
    // high band ceiling = evaluate (4); targetBloom apply (2) lowers to apply.
    const plan = planLesson(baseRequest({ targetBloom: 'apply' }), emptyMemory('high'));
    expect(plan.bloomCeiling).toBe('apply');
  });

  it('a targetBloom ABOVE the band ceiling does NOT raise it', () => {
    // high band ceiling = evaluate (4); targetBloom create (5) must NOT push above → stays evaluate.
    const plan = planLesson(baseRequest({ targetBloom: 'create' }), emptyMemory('high'));
    expect(plan.bloomCeiling).toBe('evaluate');
  });

  it('cannot raise a LOW band above its understand ceiling', () => {
    // low ceiling = understand (1); targetBloom analyze (3) is above → stays understand.
    const raised = planLesson(baseRequest({ targetBloom: 'analyze' }), emptyMemory('low'));
    expect(raised.bloomCeiling).toBe('understand');
    // targetBloom remember (0) IS below → lowers to remember.
    const lowered = planLesson(baseRequest({ targetBloom: 'remember' }), emptyMemory('low'));
    expect(lowered.bloomCeiling).toBe('remember');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (6) Section order is non-decreasing in Bloom
// ════════════════════════════════════════════════════════════════════════════

describe('planLesson — section order is non-decreasing in Bloom', () => {
  const bands: MasteryBand[] = ['low', 'medium', 'high'];
  for (const band of bands) {
    it(`non-decreasing Bloom sequence for band=${band} (with misconceptions)`, () => {
      const memory = emptyMemory(band);
      memory.recentMisconceptions = [
        { code: 'MC_X', label: 'x', count: 1, remediationText: 'r' },
      ];
      const plan = planLesson(baseRequest(), memory);
      const blooms = plan.sectionKinds.map((k) => BLOOM_ORDER[SECTION_SPEC_BLOOM[k]]);
      for (let i = 1; i < blooms.length; i++) {
        expect(blooms[i]).toBeGreaterThanOrEqual(blooms[i - 1]);
      }
      // misconception_callouts (understand) is ordered AFTER core_concepts (understand)
      // by the stable LESSON_STEPS tie-break, never before it.
      const ci = plan.sectionKinds.indexOf('core_concepts');
      const mi = plan.sectionKinds.indexOf('misconception_callouts');
      expect(mi).toBeGreaterThan(ci);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (7) renderAdaptationCodes — codes/enums ONLY (P13, no titles / labels)
// ════════════════════════════════════════════════════════════════════════════

describe('renderAdaptationCodes — PII-free codes only', () => {
  it('emits stable enum/count codes and NEVER a topic title or misconception label', () => {
    const memory = emptyMemory('medium');
    memory.weakTopics = [{ title: 'Photosynthesis in leaves', mastery: 0.2, attempts: 4 }];
    memory.recentMisconceptions = [
      { code: 'MC_MASS_WEIGHT', label: 'Confuses mass and weight', count: 3, remediationText: 'Mass is...' },
    ];
    memory.preferences.learningStyle = 'visual';
    const plan = planLesson(baseRequest(), memory);
    const codes = renderAdaptationCodes(plan);

    // Contains the expected structural codes.
    expect(codes).toContain('scaffolding:moderate');
    expect(codes).toContain('bloom_ceiling:apply');
    expect(codes).toContain('depth:standard');
    expect(codes).toContain('persona:visual');
    expect(codes).toContain('sections:6'); // hook, core, callouts, recall, application, revision
    expect(codes).toContain('emphasis_count:1');
    expect(codes).toContain('misconception_callouts:on');
    expect(codes).toContain('application:on');
    // The misconception CODE is surfaced (curated, non-PII).
    expect(codes).toContain('misconception:MC_MASS_WEIGHT');

    // P13: the free-text topic TITLE and the misconception LABEL never appear.
    const joined = codes.join('|');
    expect(joined).not.toContain('Photosynthesis in leaves');
    expect(joined).not.toContain('Confuses mass and weight');
    // Every element is a short "key:value" code, never prose (no spaces).
    for (const code of codes) {
      expect(code).not.toMatch(/\s/);
    }
  });

  it('omits misconception_callouts:on and application:on when those sections are absent', () => {
    const plan = planLesson(baseRequest(), emptyMemory('low')); // low: no application, no callouts
    const codes = renderAdaptationCodes(plan);
    expect(codes).not.toContain('application:on');
    expect(codes).not.toContain('misconception_callouts:on');
    expect(codes).toContain('emphasis_count:0');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (8) Purity — deterministic, never throws
// ════════════════════════════════════════════════════════════════════════════

describe('planLesson — purity', () => {
  it('identical inputs produce deeply-equal plans (deterministic)', () => {
    const req = baseRequest();
    const mem = emptyMemory('high');
    mem.weakTopics = [{ title: 'A', mastery: 0.2, attempts: 1 }];
    expect(planLesson(req, mem)).toEqual(planLesson(req, mem));
  });

  it('does not mutate its inputs', () => {
    const mem = emptyMemory('medium');
    mem.weakTopics = [{ title: 'A', mastery: 0.2, attempts: 1 }];
    const snapshot = JSON.parse(JSON.stringify(mem));
    planLesson(baseRequest(), mem);
    expect(mem).toEqual(snapshot);
  });

  it('never throws on minimal well-formed input across all bands', () => {
    for (const band of ['low', 'medium', 'high'] as MasteryBand[]) {
      expect(() => planLesson(baseRequest(), emptyMemory(band))).not.toThrow();
      expect(() => renderAdaptationCodes(planLesson(baseRequest(), emptyMemory(band)))).not.toThrow();
    }
  });
});
