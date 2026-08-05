/**
 * Hint-ladder state machine pins (Foxy North-Star Phase 3, L5/U4).
 *
 * The load-bearing pins are the P3 locks: rungs 2-5 (per-distractor
 * remediation and beyond) must be unreachable before a wrong attempt, no
 * matter how many times a caller pumps nextRung(). Per-distractor
 * remediation served pre-answer is a correctness oracle.
 */

import { describe, it, expect } from 'vitest';
import {
  createLadder,
  recordWrongAttempt,
  nextRung,
  rungContentSpec,
  toHintLevel,
  extractFirstSentence,
  type HintLadderState,
} from '../../learn/hint-ladder';

const QID = '11111111-1111-1111-1111-111111111111';

function fresh(): HintLadderState {
  return createLadder({ questionId: QID });
}

describe('createLadder', () => {
  it('starts at rung 0, no wrong attempt, no distractor', () => {
    const s = fresh();
    expect(s.currentRung).toBe(0);
    expect(s.wrongAttempted).toBe(false);
    expect(s.distractorIndex).toBeNull();
    expect(toHintLevel(s)).toBe(0);
  });
});

describe('P3 lock — rungs 2-5 unreachable before a wrong attempt', () => {
  it('rung 1 is available pre-attempt (gentle prompt only)', () => {
    const r = nextRung(fresh());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rung).toBe(1);
  });

  it('cannot reach rung 2 pre-wrong — refuses with locked_pre_attempt', () => {
    const r1 = nextRung(fresh());
    if (!r1.ok) throw new Error('rung 1 should be available');
    const r2 = nextRung(r1.state);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('locked_pre_attempt');
  });

  it('pumping nextRung in a loop pre-wrong NEVER passes rung 1 (UI cannot bypass)', () => {
    let state = fresh();
    for (let i = 0; i < 50; i++) {
      const r = nextRung(state);
      if (r.ok) state = r.state;
    }
    expect(state.currentRung).toBe(1);
    expect(toHintLevel(state)).toBe(1);
  });

  it('locked result does not mutate/advance the state', () => {
    const r1 = nextRung(fresh());
    if (!r1.ok) throw new Error('unreachable');
    const locked = nextRung(r1.state);
    if (locked.ok) throw new Error('should be locked');
    expect(locked.state.currentRung).toBe(1);
  });
});

describe('full walk after a wrong attempt', () => {
  it('walks 1→2→3→4→5 sequentially, then exhausts', () => {
    let state = fresh();
    const r1 = nextRung(state);
    if (!r1.ok) throw new Error('unreachable');
    state = recordWrongAttempt(r1.state, 2);

    const rungs: number[] = [1];
    for (;;) {
      const r = nextRung(state);
      if (!r.ok) {
        expect(r.reason).toBe('exhausted');
        break;
      }
      rungs.push(r.rung);
      state = r.state;
    }
    expect(rungs).toEqual([1, 2, 3, 4, 5]);
    expect(toHintLevel(state)).toBe(5);
  });

  it('wrong attempt without ever taking rung 1 still walks 1 first (no skipping)', () => {
    const state = recordWrongAttempt(fresh(), 0);
    const r = nextRung(state);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rung).toBe(1);
  });
});

describe('recordWrongAttempt', () => {
  it('keeps the FIRST distractor index (remediate the original misconception)', () => {
    let s = recordWrongAttempt(fresh(), 1);
    s = recordWrongAttempt(s, 3);
    expect(s.distractorIndex).toBe(1);
  });

  it('invalid distractor index unlocks the ladder but carries no distractor', () => {
    const s = recordWrongAttempt(fresh(), 7);
    expect(s.wrongAttempted).toBe(true);
    expect(s.distractorIndex).toBeNull();
  });
});

describe('rungContentSpec — content descriptors', () => {
  const unlocked = recordWrongAttempt(fresh(), 2);

  it('rung 1 = question_bank.hint (EN only — schema has no hint_hi)', () => {
    const spec = rungContentSpec(1, fresh());
    expect(spec.source).toBe('question_bank');
    expect(spec.fetchKey).toEqual({ questionId: QID });
    expect(spec.fields).toEqual({ en: 'hint', hi: null });
    expect(spec.kind).toBe('text');
  });

  it('rung 2 = first sentence of the per-distractor remediation (bilingual)', () => {
    const spec = rungContentSpec(2, unlocked);
    expect(spec.source).toBe('wrong_answer_remediations');
    expect(spec.fetchKey).toEqual({ questionId: QID, distractorIndex: 2 });
    expect(spec.fields).toEqual({ en: 'remediation_text', hi: 'remediation_text_hi' });
    expect(spec.transform).toBe('first_sentence');
  });

  it('rung 3 = full remediation snippet', () => {
    const spec = rungContentSpec(3, unlocked);
    expect(spec.source).toBe('wrong_answer_remediations');
    expect(spec.transform).toBe('full');
  });

  it('rungs 2-3 with unknown distractor resolve to null fields (caller skips forward)', () => {
    const noDistractor = recordWrongAttempt(fresh(), -1);
    expect(rungContentSpec(2, noDistractor).fields).toBeNull();
    expect(rungContentSpec(3, noDistractor).fields).toBeNull();
  });

  it('rung 4 = question_bank explanation/explanation_hi', () => {
    const spec = rungContentSpec(4, unlocked);
    expect(spec.source).toBe('question_bank');
    expect(spec.fields).toEqual({ en: 'explanation', hi: 'explanation_hi' });
  });

  it('rung 5 = skip / move on (v1 assessment mandate 2026-08-05 — same-topic twin deferred, see TODO(L5))', () => {
    const spec = rungContentSpec(5, unlocked);
    expect(spec.source).toBe('skip');
    expect(spec.kind).toBe('skip');
    expect(spec.fields).toBeNull();
    expect(spec.transform).toBeNull();
  });
});

describe('extractFirstSentence (rung-2 transform)', () => {
  it('cuts at the first period', () => {
    expect(extractFirstSentence('Check the units. Then redo the sum.')).toBe('Check the units.');
  });

  it('handles Devanagari danda for Hindi remediation text', () => {
    expect(extractFirstSentence('इकाइयाँ जाँचें। फिर जोड़ दोहराएँ।')).toBe('इकाइयाँ जाँचें।');
  });

  it('falls back to the whole trimmed string when no terminator exists', () => {
    expect(extractFirstSentence('  no terminator here  ')).toBe('no terminator here');
  });
});
