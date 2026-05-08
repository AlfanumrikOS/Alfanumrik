/**
 * Locks in the cold-start prompt section for Foxy first interactions.
 *
 * Pre-fix: when `loadCognitiveContext()` returned no signal at all (new
 * student, no quiz history, no mastery rows), `buildCognitivePromptSection`
 * returned '' and the system prompt had NO calibration directive. The most
 * important Foxy turn — the first one — was the *least* personalised one.
 *
 * Post-fix: cold-start branch returns a directive section that:
 *   1. Answers the student's question first (don't ignore it).
 *   2. Asks ONE light calibration follow-up.
 *   3. Hints at quizzes for personalisation from the next turn.
 *   4. Avoids assuming proficiency or struggle without data.
 */
import { describe, it, expect } from 'vitest';

// ── Mocks for the route module's runtime deps ────────────────────────────────
// The Foxy route file imports a lot of server-side machinery (rbac, supabase,
// posthog, the grounded-answer client, etc.). We don't exercise any of that
// here — we only call two pure helpers — so we stub the heaviest imports to
// keep the unit test fast and deterministic.

import { vi } from 'vitest';

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn(),
  logAudit: vi.fn(),
}));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: vi.fn(),
  callGroundedAnswerStream: vi.fn(),
}));
vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  buildCognitivePromptSection,
  buildColdStartPromptSection,
  EMPTY_COGNITIVE_CONTEXT,
  type CognitiveContext,
} from '@/app/api/foxy/route';

describe('buildColdStartPromptSection', () => {
  it('emits the FIRST-INTERACTION header so the model can recognise the branch', () => {
    const out = buildColdStartPromptSection();
    expect(out).toContain('FIRST-INTERACTION CONTEXT');
    expect(out).toContain('no prior mastery data');
  });

  it('directs the model to answer first, then calibrate (not the other way around)', () => {
    const out = buildColdStartPromptSection();
    // Order matters: "answer first" must come before "calibration follow-up"
    // so the model doesn't quiz the student before answering their question.
    const answerIdx = out.indexOf('Answer their actual question first');
    const calibrateIdx = out.indexOf('calibration follow-up');
    expect(answerIdx).toBeGreaterThanOrEqual(0);
    expect(calibrateIdx).toBeGreaterThanOrEqual(0);
    expect(answerIdx).toBeLessThan(calibrateIdx);
  });

  it('forbids assuming proficiency or struggle without data', () => {
    const out = buildColdStartPromptSection();
    expect(out).toContain('Do NOT assume');
    expect(out).toContain('PROFICIENT');
    expect(out).toContain('STRUGGLING');
  });

  it('hints at quizzes for personalisation on the next turn', () => {
    const out = buildColdStartPromptSection();
    expect(out.toLowerCase()).toContain('quiz');
    expect(out.toLowerCase()).toContain('personalisation');
  });

  it('handles meta questions (where to start) by offering a diagnostic', () => {
    const out = buildColdStartPromptSection();
    expect(out).toMatch(/diagnostic/i);
    expect(out).toMatch(/where do I start|what should I study/i);
  });
});

describe('buildCognitivePromptSection cold-start branch', () => {
  it('returns the cold-start section when context is fully empty', () => {
    const out = buildCognitivePromptSection(EMPTY_COGNITIVE_CONTEXT);
    expect(out).toContain('FIRST-INTERACTION CONTEXT');
    // Must NOT contain the regular cognitive sections
    expect(out).not.toContain('STUDENT LEARNING STATE');
    expect(out).not.toContain('WEAK TOPICS');
  });

  it('returns the regular section when context has any signal', () => {
    const ctx: CognitiveContext = {
      ...EMPTY_COGNITIVE_CONTEXT,
      weakTopics: [{ title: 'Photosynthesis', mastery: 35, attempts: 4 }],
    };
    const out = buildCognitivePromptSection(ctx);
    expect(out).not.toContain('FIRST-INTERACTION CONTEXT');
    expect(out).toContain('STUDENT LEARNING STATE');
    expect(out).toContain('WEAK TOPICS');
    expect(out).toContain('Photosynthesis');
  });

  it('returns the regular section even with only knowledge gaps populated', () => {
    const ctx: CognitiveContext = {
      ...EMPTY_COGNITIVE_CONTEXT,
      knowledgeGaps: [
        { target: 'Quadratic equations', prerequisite: 'Linear equations', gapType: 'missing_prereq' },
      ],
    };
    const out = buildCognitivePromptSection(ctx);
    expect(out).not.toContain('FIRST-INTERACTION CONTEXT');
    expect(out).toContain('KNOWLEDGE GAPS');
    expect(out).toContain('Linear equations');
  });

  it('returns the regular section even with only revisionDue populated', () => {
    const ctx: CognitiveContext = {
      ...EMPTY_COGNITIVE_CONTEXT,
      revisionDue: [{ title: 'Fractions', lastReviewed: '2026-04-01', mastery: 70 }],
    };
    const out = buildCognitivePromptSection(ctx);
    expect(out).not.toContain('FIRST-INTERACTION CONTEXT');
    expect(out).toContain('CONCEPTS DUE FOR REVISION');
  });

  it('returns the regular section even with only nextAction populated', () => {
    const ctx: CognitiveContext = {
      ...EMPTY_COGNITIVE_CONTEXT,
      nextAction: { actionType: 'review', conceptName: 'Newton\'s laws', reason: 'forgetting curve' },
    };
    const out = buildCognitivePromptSection(ctx);
    expect(out).not.toContain('FIRST-INTERACTION CONTEXT');
    expect(out).toContain('RECOMMENDED ACTION');
  });

  it('treats recentMisconceptions as signal (regression: pre-fix this field was not in the early-return check)', () => {
    const ctx: CognitiveContext = {
      ...EMPTY_COGNITIVE_CONTEXT,
      recentMisconceptions: [
        { code: 'sign_error', label: 'Sign errors in linear equations', count: 3, remediationText: 'Review +/- rules' },
      ],
    };
    const out = buildCognitivePromptSection(ctx);
    expect(out).not.toContain('FIRST-INTERACTION CONTEXT');
    expect(out).toContain('STUDENT LEARNING STATE');
  });
});
