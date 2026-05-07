/**
 * Tenant-personality safety net for buildFoxySystemPrompt.
 *
 * Pins the contract introduced in this PR:
 *
 *   1. Byte-identical when no tenant overrides are passed.
 *      tenantPersonality / tenantTone / tenantPedagogy all undefined →
 *      output identical to the pre-tenant-personality builder. This is
 *      the safety contract that lets us ship behind ff_tenant_config_v2
 *      without disturbing B2C / non-tenant-configured production traffic.
 *
 *   2. Personality swap replaces the persona body.
 *      When tenantPersonality is set, the "## Your Persona" section's
 *      bullet block is replaced by the personality-specific block. The
 *      header anchor is preserved (downstream tooling greps for it).
 *      Other sections (Mode, Safety Rules) are byte-identical regardless
 *      of personality.
 *
 *   3. Tone + pedagogy modulate (don't replace).
 *      When tenantTone or tenantPedagogy are set, they appear as
 *      additional bullets inside the Persona section without replacing
 *      the personality block.
 *
 *   4. Independence — any combination works.
 *      Setting only personality, only tone, only pedagogy, or any
 *      subset all produce the expected diff. No coupling.
 */

import { describe, it, expect } from 'vitest';
import { buildFoxySystemPrompt } from '@/lib/ai/prompts/foxy-system';

const BASE_PARAMS = {
  grade: '7' as const,
  subject: 'math',
  board: 'CBSE',
  chapter: null,
  mode: 'learn' as const,
  ragContext: '',
};

describe('buildFoxySystemPrompt — tenant overrides', () => {
  it('is byte-identical when no tenant overrides are passed', () => {
    const a = buildFoxySystemPrompt({ ...BASE_PARAMS });
    const b = buildFoxySystemPrompt({
      ...BASE_PARAMS,
      tenantPersonality: undefined,
      tenantTone: undefined,
      tenantPedagogy: undefined,
    });
    expect(a).toBe(b);
    // Verify the legacy default warm-mentor copy is still there.
    expect(a).toContain('Warm, encouraging, and patient');
    expect(a).toContain('like a knowledgeable elder sibling');
  });

  it('warm_mentor explicit is identical to the legacy default', () => {
    const legacy = buildFoxySystemPrompt({ ...BASE_PARAMS });
    const explicit = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPersonality: 'warm_mentor' });
    expect(legacy).toBe(explicit);
  });

  describe('personality swap replaces the persona body', () => {
    it('rigorous_coach swaps in coach copy', () => {
      const out = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPersonality: 'rigorous_coach' });
      expect(out).toContain('Direct, demanding, and high-standards');
      expect(out).toContain('exam-prep coach');
      expect(out).toContain('past-paper traps');
      // Default warm-mentor-only phrases must be gone.
      expect(out).not.toContain('Bilkul sahi!');
      expect(out).not.toContain('like a knowledgeable elder sibling');
      // Header anchor preserved.
      expect(out).toContain('## Your Persona');
      // Other sections unchanged.
      expect(out).toContain('## Mode: LEARN');
      expect(out).toContain('## Safety Rules');
    });

    it('formal_examiner swaps in examiner copy', () => {
      const out = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPersonality: 'formal_examiner' });
      expect(out).toContain('Formal, neutral, and procedural');
      expect(out).toContain('official examiner');
      expect(out).toContain('marking scheme');
      expect(out).not.toContain('like a knowledgeable elder sibling');
    });

    it('playful_buddy swaps in buddy copy', () => {
      const out = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPersonality: 'playful_buddy' });
      expect(out).toContain('Light, playful, and energetic');
      expect(out).toContain('study buddy');
      expect(out).toContain('Hinglish');
      expect(out).not.toContain('like a knowledgeable elder sibling');
    });
  });

  describe('tone + pedagogy modulate without replacing', () => {
    it('tone alone is appended as a Persona bullet', () => {
      const out = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantTone: 'formal' });
      expect(out).toContain('Tone: formal');
      expect(out).toContain('avoid contractions and casual interjections');
      // Default persona body still present.
      expect(out).toContain('Warm, encouraging, and patient');
    });

    it('pedagogy alone is appended as a Persona bullet', () => {
      const out = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPedagogy: 'socratic' });
      expect(out).toContain('Teaching style: Socratic');
      expect(out).toContain('Lead with questions');
      expect(out).toContain('Warm, encouraging, and patient'); // default persona kept
    });

    it('all three together — personality replaces, tone + pedagogy append', () => {
      const out = buildFoxySystemPrompt({
        ...BASE_PARAMS,
        tenantPersonality: 'rigorous_coach',
        tenantTone: 'casual',
        tenantPedagogy: 'worked_example',
      });
      expect(out).toContain('Direct, demanding'); // personality swap
      expect(out).toContain('Tone: casual');       // tone modulation
      expect(out).toContain('Teaching style: worked example'); // pedagogy modulation
      expect(out).not.toContain('Warm, encouraging, and patient'); // default persona replaced
    });
  });

  it('all three pedagogy variants produce distinct lines', () => {
    const out1 = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPedagogy: 'socratic' });
    const out2 = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPedagogy: 'direct_instruction' });
    const out3 = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantPedagogy: 'worked_example' });
    expect(out1).toContain('Socratic');
    expect(out2).toContain('direct instruction');
    expect(out3).toContain('worked example');
    // Cross-contamination check.
    expect(out1).not.toContain('worked example');
    expect(out3).not.toContain('Socratic');
  });

  it('all three tone variants produce distinct lines', () => {
    const formal  = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantTone: 'formal' });
    const neutral = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantTone: 'neutral' });
    const casual  = buildFoxySystemPrompt({ ...BASE_PARAMS, tenantTone: 'casual' });
    expect(formal).toContain('Tone: formal');
    expect(neutral).toContain('Tone: neutral');
    expect(casual).toContain('Tone: casual');
    expect(formal).not.toContain('Tone: casual');
  });

  it('tenant overrides do not break the goal-section flow', () => {
    // Goal still rendered alongside tenant overrides.
    const out = buildFoxySystemPrompt({
      ...BASE_PARAMS,
      academicGoal: 'board_topper',
      tenantPersonality: 'rigorous_coach',
    });
    expect(out).toContain('Direct, demanding');                   // tenant persona
    expect(out).toContain("Student's Academic Goal");              // goal section header
    expect(out).toContain('Board Topper');                         // goal-specific copy
  });
});
