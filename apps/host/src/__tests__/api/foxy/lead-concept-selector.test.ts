// PART A (proactive weak-area targeting) — pure selector + directive unit tests.
//
// The route exports three PURE helpers from src/app/api/foxy/route.ts:
//   - selectLeadConcept(ctx)        — deterministic pick over an ALREADY-loaded
//                                      CognitiveContext (NO DB, NO mastery write).
//   - buildLeadConceptDirective(lead) — the prompt fragment naming the target.
//   - isBareOpen(message)           — "bare opener" classifier that decides when
//                                      Foxy should proactively lead with the
//                                      weakest concept vs. answer a real question.
//
// Acceptance:
//   A1 — selection precedence: overdue-weakest > weakest-topic > nextAction;
//        tie-break inside overdue is weakest-mastery then oldest review date.
//   A2 — all-empty context → null → the no-fabrication rail (no concept named).
//   A3 — a weak pick (mastery < 50) → analogy-before-definition + Bloom
//        ceiling+1 wording present in the directive.
//   A4 — selector + directive are PURE: byte-identical output for the same
//        frozen input and zero side effects (no mastery write surface to touch —
//        the functions take a plain object and return a string/object).
//
// P13: the directive only ever names a CONCEPT TITLE — never a student id or PII.

import { describe, it, expect } from 'vitest';
import {
  selectLeadConcept,
  buildLeadConceptDirective,
  isBareOpen,
  EMPTY_COGNITIVE_CONTEXT,
  type CognitiveContext,
} from '@/app/api/foxy/_lib/test-surface';

function ctx(over: Partial<CognitiveContext> = {}): CognitiveContext {
  return { ...EMPTY_COGNITIVE_CONTEXT, ...over };
}

describe('PART A — selectLeadConcept precedence (A1)', () => {
  it('prefers OVERDUE review (weakest first) over weakTopics and nextAction', () => {
    const lead = selectLeadConcept(
      ctx({
        revisionDue: [
          { title: 'Acids', lastReviewed: '2026-06-10', mastery: 55 },
          { title: 'Bases', lastReviewed: '2026-06-09', mastery: 30 },
        ],
        weakTopics: [{ title: 'Cells', mastery: 12, attempts: 4 }],
        nextAction: { actionType: 'practice', conceptName: 'Light', reason: 'x' },
      }),
    );
    expect(lead).not.toBeNull();
    // Weakest overdue concept wins (Bases @30 < Acids @55) — overdue beats the
    // even-weaker weakTopic (Cells @12) because overdue has higher precedence.
    expect(lead!.title).toBe('Bases');
    expect(lead!.source).toBe('overdue_review');
    expect(lead!.mastery).toBe(30);
  });

  it('tie-break inside overdue: equal mastery → OLDEST next_review_date first', () => {
    const lead = selectLeadConcept(
      ctx({
        revisionDue: [
          { title: 'Newer', lastReviewed: '2026-06-12', mastery: 40 },
          { title: 'Older', lastReviewed: '2026-06-01', mastery: 40 },
        ],
      }),
    );
    expect(lead!.title).toBe('Older');
    expect(lead!.source).toBe('overdue_review');
  });

  it('falls back to weakTopics[0] when there is no overdue review', () => {
    const lead = selectLeadConcept(
      ctx({
        weakTopics: [
          { title: 'Photosynthesis', mastery: 22, attempts: 3 },
          { title: 'Respiration', mastery: 35, attempts: 2 },
        ],
        nextAction: { actionType: 'practice', conceptName: 'Light', reason: 'x' },
      }),
    );
    expect(lead!.title).toBe('Photosynthesis'); // weakTopics is weakest-first at load time
    expect(lead!.source).toBe('weak_topic');
    expect(lead!.mastery).toBe(22);
  });

  it('falls back to nextAction.conceptName when no overdue + no weak topics', () => {
    const lead = selectLeadConcept(
      ctx({ nextAction: { actionType: 'practice', conceptName: 'Trigonometry', reason: 'y' } }),
    );
    expect(lead!.title).toBe('Trigonometry');
    expect(lead!.source).toBe('next_action');
    // nextAction has no numeric mastery → sentinel -1 (directive must not assert %).
    expect(lead!.mastery).toBe(-1);
  });
});

describe('PART A — no-fabrication when context is empty (A2)', () => {
  it('returns null for a fully-empty cognitive context', () => {
    expect(selectLeadConcept(EMPTY_COGNITIVE_CONTEXT)).toBeNull();
  });

  it('directive for null lead names NO concept and instructs to ASK, not invent', () => {
    const directive = buildLeadConceptDirective(null);
    expect(directive).toMatch(/no mastery signal/i);
    expect(directive).toMatch(/do not invent/i);
    // No concept title is fabricated — the rail never quotes a topic name.
    expect(directive).not.toMatch(/"[^"]+"/);
  });

  it('an empty/whitespace lastReviewed sorts as oldest but a titleless pick is skipped', () => {
    // A revisionDue entry without a title must not produce a lead.
    const lead = selectLeadConcept(ctx({ revisionDue: [{ title: '', lastReviewed: '', mastery: 10 }] }));
    expect(lead).toBeNull();
  });
});

describe('PART A — weak-pick scaffolding wording (A3)', () => {
  it('weak concept (mastery < 50) → analogy-before-definition + Bloom ceiling+1 present', () => {
    const directive = buildLeadConceptDirective({
      title: 'Photosynthesis',
      mastery: 22,
      source: 'weak_topic',
    });
    expect(directive).toContain('Photosynthesis'); // names the target
    expect(directive).toMatch(/analogy|worked\s+example/i);
    expect(directive).toMatch(/before introducing the formal definition/i);
    // Bloom ceiling+1 wording (never more than one Bloom level above the ceiling).
    expect(directive).toMatch(/one Bloom level above/i);
    // Overdue-source phrasing must NOT appear for a weak_topic pick.
    expect(directive).not.toMatch(/OVERDUE/);
  });

  it('non-weak pick (mastery >= 50) → recap-then-recall, still Bloom-capped', () => {
    const directive = buildLeadConceptDirective({
      title: 'Fractions',
      mastery: 70,
      source: 'weak_topic',
    });
    expect(directive).toMatch(/recap/i);
    expect(directive).toMatch(/one Bloom level above/i);
    // A non-weak pick does NOT push analogy-before-definition.
    expect(directive).not.toMatch(/before introducing the formal definition/i);
  });

  it('next_action (unknown mastery, -1) is treated conservatively as weak (analogy path)', () => {
    const directive = buildLeadConceptDirective({
      title: 'Light',
      mastery: -1,
      source: 'next_action',
    });
    // -1 < 50 → weak branch → analogy-before-definition.
    expect(directive).toMatch(/before introducing the formal definition/i);
    // No "(current mastery ~-1%)" clause — unknown mastery is suppressed.
    expect(directive).not.toMatch(/-1%/);
    expect(directive).toMatch(/Cognitive Mastery Engine/i);
  });

  it('overdue pick surfaces the OVERDUE-for-review phrasing', () => {
    const directive = buildLeadConceptDirective({
      title: 'Acids',
      mastery: 45,
      source: 'overdue_review',
    });
    expect(directive).toMatch(/OVERDUE for review/i);
  });
});

describe('PART A — selector + directive are PURE (A4)', () => {
  it('selectLeadConcept does not mutate its input and is referentially stable', () => {
    const input = ctx({ weakTopics: [{ title: 'X', mastery: 10, attempts: 1 }] });
    const snapshot = JSON.stringify(input);
    const a = selectLeadConcept(input);
    const b = selectLeadConcept(input);
    expect(JSON.stringify(input)).toBe(snapshot); // input untouched
    expect(a).toEqual(b); // deterministic
  });

  it('buildLeadConceptDirective is deterministic for the same lead', () => {
    const lead = { title: 'X', mastery: 10, source: 'weak_topic' as const };
    expect(buildLeadConceptDirective(lead)).toBe(buildLeadConceptDirective(lead));
  });

  it('selector does NOT touch the overdue array ordering of the caller (sorts a copy)', () => {
    const revisionDue = [
      { title: 'B', lastReviewed: '2026-06-02', mastery: 40 },
      { title: 'A', lastReviewed: '2026-06-01', mastery: 20 },
    ];
    selectLeadConcept(ctx({ revisionDue }));
    // Original array order is preserved (selector sorts a [...copy]).
    expect(revisionDue.map((r) => r.title)).toEqual(['B', 'A']);
  });
});

describe('PART A — isBareOpen classifier', () => {
  it('true for greetings + "what should I study" openers (EN + Hinglish)', () => {
    expect(isBareOpen('hi')).toBe(true);
    expect(isBareOpen('hey foxy')).toBe(true);
    expect(isBareOpen('What should I study today?')).toBe(true);
    expect(isBareOpen('where do I start')).toBe(true);
    expect(isBareOpen('aaj kya padhu')).toBe(true);
    expect(isBareOpen('')).toBe(true); // empty is the barest open
  });

  it('false for a real subject question (normal Q&A stays byte-identical)', () => {
    expect(isBareOpen('Why does ice float on water?')).toBe(false);
    expect(isBareOpen('Explain the process of photosynthesis in detail please')).toBe(false);
    // Long messages are never bare opens even if they start with a greeting.
    expect(
      isBareOpen('hi, can you explain in detail how the nitrogen cycle works in soil ecosystems?'),
    ).toBe(false);
  });
});
