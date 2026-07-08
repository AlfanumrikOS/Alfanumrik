/**
 * Principal AI Assistant — system-prompt + safety-rail contract (P12 + REG-67).
 *
 * The prompt is the ONLY thing between the principal's question and the model,
 * so these rails are product invariants. Tests pin:
 *   - the refusal categories (other-school/benchmark, individual-student
 *     PII/aggregates-only, out-of-scope),
 *   - the honest syllabus-PACING decline,
 *   - the new POINT-IN-TIME / no-trends rail,
 *   - buildContextSection rendering avg_mastery through fmtPct as a percent
 *     (the 0..1-scale presentation fix) and emitting "Data as of" when
 *     generated_at is present,
 *   - the empty-context abstain (returns null so the caller never prompts the
 *     model with nothing to ground on).
 *
 * Owning agent: testing (assessment reviews scope/age-appropriateness on rail
 * changes per the prompt header).
 */

import { describe, it, expect } from 'vitest';
import {
  PRINCIPAL_AI_SAFETY_RAILS,
  buildContextSection,
  buildPrincipalAiSystemPrompt,
} from '@alfanumrik/lib/ai/principal-ai/prompt';
import type { PrincipalAiContext } from '@alfanumrik/lib/ai/principal-ai/types';

describe('PRINCIPAL_AI_SAFETY_RAILS — scope-lock refusal categories', () => {
  const rails = PRINCIPAL_AI_SAFETY_RAILS.toLowerCase();

  it('locks to ONE school and refuses other-school / benchmark comparisons', () => {
    expect(rails).toContain('one school');
    expect(rails).toContain('benchmark');
    expect(rails).toMatch(/other schools|average\s*school/);
  });

  it('refuses individual-student PII and speaks in aggregates only', () => {
    expect(rails).toContain('personally-identifiable');
    expect(rails).toContain('aggregate');
    // names / emails / phone numbers enumerated as PII to refuse
    // ([\s\S] so the match can span the wrapped line in the rails text)
    expect(rails).toMatch(/names[\s\S]*emails[\s\S]*phone/);
  });

  it('refuses out-of-scope (non-academic) asks', () => {
    expect(rails).toMatch(/outside school academic analytics|off-topic/);
  });

  it('DATA-ONLY grounding: never invent numbers/names/dates/trends', () => {
    expect(rails).toContain('data-only');
    expect(rails).toMatch(/never invent/);
  });
});

describe('PRINCIPAL_AI_SAFETY_RAILS — honest pacing decline', () => {
  const rails = PRINCIPAL_AI_SAFETY_RAILS.toLowerCase();

  it('declines syllabus completion-timing / "finish on time" predictions', () => {
    expect(rails).toContain('content readiness');
    expect(rails).toMatch(/finish.*time|completion (date|timing)/);
    expect(rails).toMatch(/cannot predict|do not fabricate a date/);
  });

  it('distinguishes content readiness from teaching pace', () => {
    expect(rails).toMatch(/teacher-marked chapter completion|teaching (pace|calendar)/);
  });
});

describe('PRINCIPAL_AI_SAFETY_RAILS — point-in-time / no-trends rail', () => {
  const rails = PRINCIPAL_AI_SAFETY_RAILS.toLowerCase();

  it('declares the data a single point-in-time snapshot with no history', () => {
    expect(rails).toContain('point-in-time');
    expect(rails).toMatch(/no history|no trends/);
  });

  it('refuses change-over-time / period-over-period comparisons', () => {
    expect(rails).toMatch(/change-over-time|over time/);
    expect(rails).toMatch(/vs last week|last month|since last term/);
    expect(rails).toMatch(/cannot report trends|do not fabricate a\s*\n?\s*direction/);
  });
});

describe('buildContextSection — avg_mastery rendered as a percent via fmtPct', () => {
  it('renders a 0..1 avg_mastery as a % (the 0..1-scale fix, not a raw decimal)', () => {
    const ctx: PrincipalAiContext = {
      overview: { avg_mastery: 0.42, active_students: 30, seat_utilization_pct: 75 },
    };
    const section = buildContextSection(ctx);
    expect(section).not.toBeNull();
    expect(section!).toContain('42%'); // 0.42 → 42%
    expect(section!).not.toContain('0.42'); // raw decimal must NOT leak
  });

  it('renders seat_utilization_pct (already 0-100) without rescaling', () => {
    const ctx: PrincipalAiContext = {
      overview: { avg_mastery: 0.5, seat_utilization_pct: 75 },
    };
    const section = buildContextSection(ctx)!;
    expect(section).toContain('75%'); // not 7500% and not 1%
  });

  it('renders at-risk class avg mastery (0..1) as a percent too', () => {
    const ctx: PrincipalAiContext = {
      classes_at_risk: [
        { class_name: '6-A', grade: '6', student_count: 30, at_risk_count: 5, avg_mastery: 0.31 },
      ],
    };
    const section = buildContextSection(ctx)!;
    expect(section).toContain('31%');
  });
});

describe('buildContextSection — "Data as of" snapshot dating', () => {
  it('emits a "Data as of" line when generated_at is present', () => {
    const ctx: PrincipalAiContext = {
      overview: { avg_mastery: 0.6 },
      generated_at: '2026-06-11T08:00:00Z',
    };
    const section = buildContextSection(ctx)!;
    expect(section).toContain('Data as of 2026-06-11T08:00:00Z');
    expect(section).toMatch(/no history|no trends/i);
  });

  it('omits the "Data as of" line when generated_at is absent', () => {
    const ctx: PrincipalAiContext = { overview: { avg_mastery: 0.6 } };
    const section = buildContextSection(ctx)!;
    expect(section).not.toContain('Data as of');
  });
});

describe('buildContextSection — empty-context abstain', () => {
  it('returns null for a null context', () => {
    expect(buildContextSection(null)).toBeNull();
  });
  it('returns null when no section has any signal', () => {
    const ctx: PrincipalAiContext = {
      overview: {},
      classes_at_risk: [],
      teacher_engagement: [],
      mastery_by_subject: [],
      syllabus_readiness: { total_chapters: 0 },
    };
    expect(buildContextSection(ctx)).toBeNull();
  });
});

describe('buildPrincipalAiSystemPrompt — always carries the rails', () => {
  it('includes the safety rails and a language line', () => {
    const prompt = buildPrincipalAiSystemPrompt({ contextSection: '=== ctx ===', lang: 'en' });
    expect(prompt).toContain('SAFETY RAILS');
    expect(prompt).toContain('=== ctx ===');
  });
  it('Hindi lang line keeps figures/technical terms in English (P7 exception)', () => {
    const prompt = buildPrincipalAiSystemPrompt({ contextSection: null, lang: 'hi' });
    expect(prompt).toContain('SAFETY RAILS');
    expect(prompt.toLowerCase()).toContain('hindi');
    // null context → defensive placeholder, never an empty prompt
    expect(prompt).toMatch(/no data is available/i);
  });
});
