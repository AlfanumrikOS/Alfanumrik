/**
 * Foxy CoachMode resolution — REG-38 (mastery-driven default).
 *
 * Phase 2 of the Foxy moat plan introduces a per-turn "coach mode" that
 * drives the pedagogy prompt:
 *
 *   - 'socratic' → Socratic scaffolding. Used when the student's mastery
 *                  is 'low' or 'medium' — the moat: ask, don't tell.
 *   - 'answer'   → Concise direct answer + one stretch question. Used
 *                  when mastery is 'high' (student is confident).
 *   - 'review'   → Spaced-recall framing. ONLY when explicitly requested
 *                  by the client (spaced-repetition surface). Never
 *                  auto-selected.
 *
 * Two-stage resolution in src/app/api/foxy/route.ts:
 *
 *   Stage A (input parsing, lines ~847-851):
 *     const VALID_COACH_MODES = ['answer', 'socratic', 'review'] as const;
 *     const requestedCoachMode: CoachMode | null =
 *       typeof body.coachMode === 'string'
 *         && VALID_COACH_MODES.includes(body.coachMode)
 *           ? body.coachMode as CoachMode
 *           : null;
 *
 *   Stage B (resolveCoachMode):
 *     function resolveCoachMode(
 *       requested: CoachMode | null,
 *       masteryLevel: 'low' | 'medium' | 'high',
 *     ): CoachMode {
 *       if (requested) return requested;
 *       if (masteryLevel === 'high') return 'answer';
 *       return 'socratic';
 *     }
 *
 * If either stage changes in route.ts, this file must update in lockstep.
 * Quality review rejects on divergence.
 */

import { describe, it, expect } from 'vitest';

const VALID_COACH_MODES = ['answer', 'socratic', 'review'] as const;
type CoachMode = typeof VALID_COACH_MODES[number];
type MasteryLevel = 'low' | 'medium' | 'high';

// ─── Stage A: parse `body.coachMode` to a strict CoachMode | null ───────

function parseRequestedCoachMode(raw: unknown): CoachMode | null {
  return typeof raw === 'string' &&
    (VALID_COACH_MODES as readonly string[]).includes(raw)
    ? (raw as CoachMode)
    : null;
}

// ─── Stage B: resolveCoachMode (parity copy of route.ts) ────────────────

function resolveCoachMode(
  requested: CoachMode | null,
  masteryLevel: MasteryLevel,
): CoachMode {
  if (requested) return requested;
  if (masteryLevel === 'high') return 'answer';
  return 'socratic';
}

// ─── Mastery-driven default (no explicit coachMode) ─────────────────────

describe('resolveCoachMode — mastery-driven default (no explicit request)', () => {
  it("masteryLevel 'low' → socratic", () => {
    expect(resolveCoachMode(null, 'low')).toBe('socratic');
  });

  it("masteryLevel 'medium' → socratic (the moat: ask, don't tell)", () => {
    expect(resolveCoachMode(null, 'medium')).toBe('socratic');
  });

  it("masteryLevel 'high' → answer (student is confident)", () => {
    expect(resolveCoachMode(null, 'high')).toBe('answer');
  });
});

// ─── Explicit coachMode override ─────────────────────────────────────────

describe('resolveCoachMode — explicit valid request wins over default', () => {
  it("explicit 'review' → review (regardless of mastery)", () => {
    expect(resolveCoachMode('review', 'low')).toBe('review');
    expect(resolveCoachMode('review', 'medium')).toBe('review');
    expect(resolveCoachMode('review', 'high')).toBe('review');
  });

  it("explicit 'socratic' wins even at high mastery", () => {
    expect(resolveCoachMode('socratic', 'high')).toBe('socratic');
  });

  it("explicit 'answer' wins even at low mastery", () => {
    expect(resolveCoachMode('answer', 'low')).toBe('answer');
  });

  it("explicit 'answer' at medium mastery → answer", () => {
    expect(resolveCoachMode('answer', 'medium')).toBe('answer');
  });
});

// ─── Stage A: invalid inputs collapse to null before reaching resolver ──

describe('parseRequestedCoachMode — input validation (Stage A)', () => {
  it("accepts canonical 'answer' / 'socratic' / 'review'", () => {
    expect(parseRequestedCoachMode('answer')).toBe('answer');
    expect(parseRequestedCoachMode('socratic')).toBe('socratic');
    expect(parseRequestedCoachMode('review')).toBe('review');
  });

  it("rejects unknown mode strings → null", () => {
    expect(parseRequestedCoachMode('interrogate')).toBe(null);
    expect(parseRequestedCoachMode('explain')).toBe(null);
    expect(parseRequestedCoachMode('teach')).toBe(null);
  });

  it("rejects case mismatch (whitelist is case-sensitive) → null", () => {
    expect(parseRequestedCoachMode('SOCRATIC')).toBe(null);
    expect(parseRequestedCoachMode('Answer')).toBe(null);
    expect(parseRequestedCoachMode('Review')).toBe(null);
  });

  it("rejects non-string types → null", () => {
    expect(parseRequestedCoachMode(42)).toBe(null);
    expect(parseRequestedCoachMode(true)).toBe(null);
    expect(parseRequestedCoachMode(null)).toBe(null);
    expect(parseRequestedCoachMode(undefined)).toBe(null);
    expect(parseRequestedCoachMode({ mode: 'answer' })).toBe(null);
  });

  it("rejects empty / whitespace-only strings → null", () => {
    expect(parseRequestedCoachMode('')).toBe(null);
    expect(parseRequestedCoachMode('   ')).toBe(null);
    expect(parseRequestedCoachMode(' answer ')).toBe(null);
  });
});

// ─── Stage A + Stage B integration: invalid request falls back to default

describe('end-to-end: invalid request → mastery-driven default', () => {
  it("'INTERROGATE' (invalid) at low mastery → socratic", () => {
    const parsed = parseRequestedCoachMode('INTERROGATE');
    expect(resolveCoachMode(parsed, 'low')).toBe('socratic');
  });

  it("number coercion attempt at high mastery → answer", () => {
    const parsed = parseRequestedCoachMode(99);
    expect(resolveCoachMode(parsed, 'high')).toBe('answer');
  });

  it("undefined body.coachMode at medium mastery → socratic", () => {
    const parsed = parseRequestedCoachMode(undefined);
    expect(resolveCoachMode(parsed, 'medium')).toBe('socratic');
  });

  it("explicit 'review' survives Stage A and overrides Stage B mastery", () => {
    const parsed = parseRequestedCoachMode('review');
    expect(resolveCoachMode(parsed, 'high')).toBe('review');
    expect(resolveCoachMode(parsed, 'low')).toBe('review');
  });
});

// ─── Output guarantees ──────────────────────────────────────────────────

describe('resolveCoachMode — output is always a valid CoachMode', () => {
  it('every mastery × every requested combination resolves to a valid mode', () => {
    const masteryLevels: MasteryLevel[] = ['low', 'medium', 'high'];
    const requestedOptions: (CoachMode | null)[] = [
      null,
      'answer',
      'socratic',
      'review',
    ];
    for (const m of masteryLevels) {
      for (const r of requestedOptions) {
        const out = resolveCoachMode(r, m);
        expect(VALID_COACH_MODES).toContain(out);
      }
    }
  });

  it("'review' is NEVER auto-selected when no request is made", () => {
    const masteryLevels: MasteryLevel[] = ['low', 'medium', 'high'];
    for (const m of masteryLevels) {
      expect(resolveCoachMode(null, m)).not.toBe('review');
    }
  });
});
