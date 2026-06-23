// Tests for the PART B2 struggle-detection pure helpers
// (src/lib/foxy/struggle-detection.ts).
//
// B2 acceptance: a signal is detected from chat-observed confusion, mapped to
// the architect's registry enum (repeated_hint / explicit_confusion /
// repeated_wrong). These helpers are PURE and return enums only — no PII.

import { describe, it, expect } from 'vitest';
import {
  isExplicitConfusion,
  isReExplainRequest,
  detectStruggleSignal,
} from '@/lib/foxy/struggle-detection';

describe('isExplicitConfusion', () => {
  it('flags explicit "I don\'t get this" / "confused" (EN + Hinglish)', () => {
    expect(isExplicitConfusion("I don't get this")).toBe(true);
    expect(isExplicitConfusion("I'm so confused")).toBe(true);
    expect(isExplicitConfusion('this makes no sense')).toBe(true);
    expect(isExplicitConfusion('samajh nahi aaya')).toBe(true);
  });
  it('does not flag a normal question', () => {
    expect(isExplicitConfusion('What is photosynthesis?')).toBe(false);
    expect(isExplicitConfusion('')).toBe(false);
  });
});

describe('isReExplainRequest', () => {
  it('flags re-explain / simplify requests', () => {
    expect(isReExplainRequest('explain it again')).toBe(true);
    expect(isReExplainRequest('can you make it simpler')).toBe(true);
    expect(isReExplainRequest('dobara samjhao')).toBe(true);
  });
  it('does not flag a fresh topic ask', () => {
    expect(isReExplainRequest('teach me about acids')).toBe(false);
  });
});

describe('detectStruggleSignal', () => {
  it('returns repeated_wrong when sessionWrongCount >= 2 (strongest precedence)', () => {
    expect(
      detectStruggleSignal({
        message: 'ok',
        recentStudentMessages: ['ok'],
        sessionWrongCount: 2,
      }),
    ).toBe('repeated_wrong');
  });

  it('returns explicit_confusion for an explicit "I don\'t get it"', () => {
    expect(
      detectStruggleSignal({
        message: "I don't understand this at all",
        recentStudentMessages: ["I don't understand this at all"],
      }),
    ).toBe('explicit_confusion');
  });

  it('returns repeated_hint after >= 2 re-explain requests in the session', () => {
    const sig = detectStruggleSignal({
      message: 'explain again please',
      recentStudentMessages: ['explain it again', 'make it simpler', 'explain again please'],
    });
    expect(sig).toBe('repeated_hint');
  });

  it('counts a simplify coachDirective toward the repeat threshold', () => {
    const sig = detectStruggleSignal({
      message: 'hmm',
      recentStudentMessages: ['make it simpler', 'hmm'],
      coachDirective: 'simplify',
    });
    expect(sig).toBe('repeated_hint');
  });

  it('returns null when no struggle signal is present', () => {
    expect(
      detectStruggleSignal({
        message: 'Thanks, that makes sense!',
        recentStudentMessages: ['What is osmosis?', 'Thanks, that makes sense!'],
      }),
    ).toBeNull();
  });
});
