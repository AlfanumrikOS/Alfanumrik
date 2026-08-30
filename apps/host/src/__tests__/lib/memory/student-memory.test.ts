/**
 * Unified Student Memory — orchestrator + renderer unit tests (GenAI arch Phase 2).
 *
 * Covers:
 *  1. Fail-soft composition — a rejecting sub-reader degrades ONLY its slice to
 *     the canonical empty value; other slices still populate; never throws.
 *  2. Passthrough / byte-identity basis — the composed StudentMemory embeds the
 *     EXACT sub-context objects (reference identity). This is the parity
 *     guarantee that flag-ON == flag-OFF at the route.
 *  3. Renderer — empty ⇒ ''; populated ⇒ exactly the composition of the three
 *     EXISTING per-slice renderers; PII-clean output.
 *
 * Fully hermetic — every sub-read is injected via StudentMemoryDeps; no
 * Supabase client, no network.
 *
 * (This file used to also cover a DPDP erasure short-circuit — guard TRUE ⇒
 * fully-empty memory AND zero sub-reads. Removed 2026-08-30 along with the
 * DPDP erasure subsystem — see
 * supabase/migrations/20260830130000_remove_dpdp_erasure_system.sql.)
 */
import { describe, it, expect, vi } from 'vitest';

import {
  getStudentMemory,
  renderStudentMemoryPromptSection,
  type StudentMemory,
  type StudentMemoryDeps,
} from '@/lib/memory/student-memory';
import {
  EMPTY_COGNITIVE_CONTEXT,
  type CognitiveContext,
} from '@/app/api/foxy/_lib/constants';
import {
  EMPTY_LONG_MEMORY,
  buildLongMemoryPromptSection,
  type LongMemorySnapshot,
} from '@alfanumrik/lib/learn/foxy-long-memory';
import {
  renderTwinPromptSection,
  type TwinContext,
} from '@alfanumrik/lib/learn/build-twin-context';
import { buildCognitivePromptSection } from '@alfanumrik/lib/foxy/prompt-sections';
import {
  EMPTY_PREFERENCES,
  type StudentPreferences,
} from '@alfanumrik/lib/memory/preferences';

// ─── Content-only fakes (no PII, no UUID-shaped strings) ─────────────────────
const fakeCognitive: CognitiveContext = {
  weakTopics: [{ title: 'Photosynthesis', mastery: 40, attempts: 3 }],
  strongTopics: [],
  knowledgeGaps: [],
  revisionDue: [],
  recentErrors: [],
  nextAction: null,
  masteryLevel: 'low',
  loSkills: [],
  recentMisconceptions: [],
};

const fakeTwin: TwinContext = {
  weakTopics: [{ topicId: 'topic-a', mastery: 0.3 }],
  decayedTopics: [],
  dominantErrorTypes: ['conceptual'],
  misconceptionClusterCount: 1,
  cohortPercentile: null,
  highlights: [{ summaryCode: 'mastered_concept', topicId: null }],
  isEmpty: false,
};

const fakeLong: LongMemorySnapshot = {
  synthesis_month: null,
  synthesis_summary: null,
  high_concepts: ['Cell structure'],
  low_concepts: [],
  top_misconceptions: [],
};

const fakePrefs: StudentPreferences = {
  learningStyle: 'visual',
  preferredExplanationDepth: 'deep',
};

const OPTS = { subject: 'science', grade: '8', chapter: 'nutrition' } as const;
const STUDENT_ID = 'student-1';

// Build a full injectable dep-set of spies.
function makeDeps(overrides: Partial<StudentMemoryDeps> = {}): {
  deps: StudentMemoryDeps;
} {
  const deps: StudentMemoryDeps = {
    loadCognitive: vi.fn(async () => fakeCognitive),
    loadTwin: vi.fn(async () => fakeTwin),
    loadLongMemory: vi.fn(async () => fakeLong),
    loadPreferences: vi.fn(async () => fakePrefs),
    ...overrides,
  };
  return { deps };
}

describe('getStudentMemory — runs the sub-reads and passes their outputs through', () => {
  it('runs every sub-read exactly once and passes their outputs through', async () => {
    const { deps } = makeDeps();
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);

    expect(result.isEmpty).toBe(false);
    expect(result.cognitive).toBe(fakeCognitive);
    expect(result.twin).toBe(fakeTwin);
    expect(result.longMemory).toBe(fakeLong);
    expect(result.preferences).toBe(fakePrefs);

    expect(deps.loadCognitive).toHaveBeenCalledTimes(1);
    expect(deps.loadTwin).toHaveBeenCalledTimes(1);
    expect(deps.loadLongMemory).toHaveBeenCalledTimes(1);
    expect(deps.loadPreferences).toHaveBeenCalledTimes(1);
  });
});

describe('getStudentMemory — passthrough / byte-identity basis', () => {
  it('embeds the EXACT sub-context objects by reference (parity guarantee)', async () => {
    const { deps } = makeDeps();
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);
    // Reference identity — the orchestrator does not clone or re-derive.
    expect(result.cognitive).toBe(fakeCognitive);
    expect(result.twin).toBe(fakeTwin);
    expect(result.longMemory).toBe(fakeLong);
    expect(result.preferences).toBe(fakePrefs);
  });

  it('passes cognitive misconception labels into the long-memory reader (route ordering)', async () => {
    const cog: CognitiveContext = {
      ...fakeCognitive,
      recentMisconceptions: [
        { code: 'MC1', label: 'confuses-mass-weight', count: 3, remediationText: 'x' },
      ],
    };
    const loadLongMemory = vi.fn(async () => fakeLong);
    const { deps } = makeDeps({ loadCognitive: vi.fn(async () => cog), loadLongMemory });
    await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(loadLongMemory).toHaveBeenCalledWith(STUDENT_ID, OPTS.subject, ['confuses-mass-weight']);
  });

  it('reports isEmpty=true when every populated slice is actually empty', async () => {
    const { deps } = makeDeps({
      loadCognitive: vi.fn(async () => EMPTY_COGNITIVE_CONTEXT),
      loadTwin: vi.fn(async () => null),
      loadLongMemory: vi.fn(async () => EMPTY_LONG_MEMORY),
      loadPreferences: vi.fn(async () => EMPTY_PREFERENCES),
    });
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(result.isEmpty).toBe(true);
  });
});

describe('getStudentMemory — fail-soft composition (never throws)', () => {
  it('degrades ONLY the cognitive slice when its reader rejects; others populate', async () => {
    const { deps } = makeDeps({
      loadCognitive: vi.fn(async () => {
        throw new Error('cognitive down');
      }),
    });
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(result.cognitive).toBe(EMPTY_COGNITIVE_CONTEXT);
    // other slices unaffected
    expect(result.twin).toBe(fakeTwin);
    expect(result.longMemory).toBe(fakeLong);
    expect(result.preferences).toBe(fakePrefs);
  });

  it('degrades ONLY the twin slice to null when its reader rejects', async () => {
    const { deps } = makeDeps({
      loadTwin: vi.fn(async () => {
        throw new Error('twin down');
      }),
    });
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(result.twin).toBeNull();
    expect(result.cognitive).toBe(fakeCognitive);
    expect(result.preferences).toBe(fakePrefs);
  });

  it('degrades ONLY the long-memory slice when its reader rejects', async () => {
    const { deps } = makeDeps({
      loadLongMemory: vi.fn(async () => {
        throw new Error('long-mem down');
      }),
    });
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(result.longMemory).toBe(EMPTY_LONG_MEMORY);
    expect(result.cognitive).toBe(fakeCognitive);
  });

  it('degrades ONLY the preferences slice when its reader rejects', async () => {
    const { deps } = makeDeps({
      loadPreferences: vi.fn(async () => {
        throw new Error('prefs down');
      }),
    });
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(result.preferences).toBe(EMPTY_PREFERENCES);
    expect(result.cognitive).toBe(fakeCognitive);
  });

  it('does not reject the whole call even when every sub-reader throws', async () => {
    const { deps } = makeDeps({
      loadCognitive: vi.fn(async () => {
        throw new Error('a');
      }),
      loadTwin: vi.fn(async () => {
        throw new Error('b');
      }),
      loadLongMemory: vi.fn(async () => {
        throw new Error('c');
      }),
      loadPreferences: vi.fn(async () => {
        throw new Error('d');
      }),
    });
    const result = await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(result.isEmpty).toBe(true);
    expect(result.cognitive).toBe(EMPTY_COGNITIVE_CONTEXT);
    expect(result.twin).toBeNull();
    expect(result.longMemory).toBe(EMPTY_LONG_MEMORY);
    expect(result.preferences).toBe(EMPTY_PREFERENCES);
  });

  it('defaults chapter to null when omitted', async () => {
    const { deps } = makeDeps();
    const result = await getStudentMemory(STUDENT_ID, { subject: 'math', grade: '7' }, deps);
    expect(result.chapter).toBeNull();
  });
});

// ─── Renderer ────────────────────────────────────────────────────────────────

function populatedMemory(): StudentMemory {
  return {
    studentId: STUDENT_ID,
    subject: OPTS.subject,
    grade: OPTS.grade,
    chapter: OPTS.chapter,
    cognitive: fakeCognitive,
    twin: fakeTwin,
    longMemory: fakeLong,
    preferences: fakePrefs,
    isEmpty: false,
  };
}

describe('renderStudentMemoryPromptSection', () => {
  it('returns "" for empty memory', async () => {
    // Source an empty memory through the real path — every sub-read
    // resolves to its own canonical empty value.
    const { deps } = makeDeps({
      loadCognitive: vi.fn(async () => EMPTY_COGNITIVE_CONTEXT),
      loadTwin: vi.fn(async () => null),
      loadLongMemory: vi.fn(async () => EMPTY_LONG_MEMORY),
      loadPreferences: vi.fn(async () => EMPTY_PREFERENCES),
    });
    const empty = await getStudentMemory(STUDENT_ID, OPTS, deps);
    expect(empty.isEmpty).toBe(true);
    expect(renderStudentMemoryPromptSection(empty)).toBe('');
  });

  it('equals the composition of the EXISTING per-slice renderers', () => {
    const memory = populatedMemory();
    const expected = [
      buildCognitivePromptSection(memory.cognitive),
      renderTwinPromptSection(memory.twin as TwinContext),
      buildLongMemoryPromptSection(memory.longMemory),
    ]
      .filter(Boolean)
      .join('\n\n');

    const rendered = renderStudentMemoryPromptSection(memory);
    expect(rendered).toBe(expected);
    // sanity: this fixture actually produces content from all three renderers
    expect(rendered).toContain('STUDENT LEARNING STATE');
    expect(rendered).toContain('LONGITUDINAL LEARNING SIGNALS');
    expect(rendered).toContain('LEARNER MEMORY');
  });

  it('omits the twin section when twin is null (still valid, no throw)', () => {
    const memory: StudentMemory = { ...populatedMemory(), twin: null };
    const expected = [
      buildCognitivePromptSection(memory.cognitive),
      buildLongMemoryPromptSection(memory.longMemory),
    ]
      .filter(Boolean)
      .join('\n\n');
    expect(renderStudentMemoryPromptSection(memory)).toBe(expected);
  });

  it('produces PII-clean output (no email / phone / raw UUID / injected name)', () => {
    const rendered = renderStudentMemoryPromptSection(populatedMemory());
    // email
    expect(rendered).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    // 10-digit phone (Indian) / long digit runs
    expect(rendered).not.toMatch(/\b\d{10}\b/);
    // raw UUID
    expect(rendered).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    // studentId key must never appear verbatim in the prompt block
    expect(rendered).not.toContain(STUDENT_ID);
  });
});
