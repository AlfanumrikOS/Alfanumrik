import { describe, it, expect } from 'vitest';
import { buildFoxySystemPrompt } from '@alfanumrik/lib/ai/prompts/foxy-system';
import { buildExpandedPersona, type FoxyMode } from '@alfanumrik/lib/goals/goal-personas';

/**
 * Wave 2 — Foxy explorer mode
 *
 * Verifies the new 'explorer' mode is properly wired into the Foxy system
 * prompt builder and the expanded persona builder. The mode itself does
 * not change any persona text; it adds a new MODE_INSTRUCTIONS entry and
 * a new MODE_ADJUSTERS entry that together carry the explorer behavior.
 */

const baseParams = {
  grade: '9',
  subject: 'physics',
  board: 'CBSE',
  chapter: 'Light',
  ragContext: '',
};

describe('Foxy explorer mode — buildFoxySystemPrompt', () => {
  it('renders "Mode: EXPLORER" header for mode=explorer', () => {
    const prompt = buildFoxySystemPrompt({ ...baseParams, mode: 'explorer' });
    expect(prompt).toContain('## Mode: EXPLORER');
  });

  it('includes the explorer-specific mode instruction with key behaviors', () => {
    const prompt = buildFoxySystemPrompt({ ...baseParams, mode: 'explorer' });
    expect(prompt).toContain('Curiosity Dive');
    expect(prompt).toContain('Socratically');
    expect(prompt).toContain('UNLIKE homework mode');
    expect(prompt).toContain('artifact draft');
    expect(prompt).toContain('NCERT Reference Material');
  });

  it('does NOT contaminate the homework prompt with explorer-mode wording', () => {
    const prompt = buildFoxySystemPrompt({ ...baseParams, mode: 'homework' });
    expect(prompt).not.toContain('Curiosity Dive');
    expect(prompt).not.toContain('artifact draft');
    expect(prompt).toContain('Never solve homework outright');
  });

  it('emits the expanded persona block when useExpandedPersona is true and goal is known', () => {
    const prompt = buildFoxySystemPrompt({
      ...baseParams,
      mode: 'explorer',
      academicGoal: 'school_topper',
      useExpandedPersona: true,
    });
    expect(prompt).toContain("## Student's Academic Goal");
    // The expanded persona's mode-emphasis line for explorer must appear.
    expect(prompt).toContain('curiosity dive');
  });

  it('falls back to no goal section when useExpandedPersona is true but goal is unknown', () => {
    const prompt = buildFoxySystemPrompt({
      ...baseParams,
      mode: 'explorer',
      academicGoal: 'not_a_goal',
      useExpandedPersona: true,
    });
    // Builder is conservative: emit no goal section rather than a degraded one.
    expect(prompt).not.toContain("## Student's Academic Goal");
  });
});

describe('Foxy explorer mode — buildExpandedPersona', () => {
  const personas = [
    'improve_basics',
    'pass_comfortably',
    'school_topper',
    'board_topper',
    'competitive_exam',
    'olympiad',
  ] as const;

  for (const persona of personas) {
    it(`builds a non-empty explorer-mode persona block for ${persona}`, () => {
      const block = buildExpandedPersona(persona, 'explorer' as FoxyMode);
      expect(block.length).toBeGreaterThan(0);
      // The mode-emphasis line for explorer must appear inside the block.
      expect(block).toContain('Mode emphasis (explorer)');
      expect(block).toContain('curiosity dive');
      // Persona-specific content must also appear (Tone/Pacing/Challenge/Mistakes lines).
      expect(block).toContain('Tone:');
      expect(block).toContain('Pacing:');
      expect(block).toContain('Challenge:');
      expect(block).toContain('Mistakes:');
    });
  }

  it('explorer mode emphasises Socratic with allowed exposition (differentiator from homework)', () => {
    const block = buildExpandedPersona('school_topper', 'explorer' as FoxyMode);
    expect(block).toContain('Socratic-led');
    expect(block).toContain('direct exposition');
  });

  it('explorer mode keeps RAG-grounding (P11) instruction', () => {
    const block = buildExpandedPersona('competitive_exam', 'explorer' as FoxyMode);
    expect(block).toMatch(/RAG-grounded/i);
  });
});
