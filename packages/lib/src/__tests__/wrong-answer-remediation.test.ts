import { describe, it, expect } from 'vitest';
import { lookupRemediation } from '../learn/wrong-answer-remediation';

function fakeClient(rowOrError: { data?: unknown; error?: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(rowOrError),
          }),
        }),
      }),
    }),
  };
}

describe('lookupRemediation', () => {
  it('returns null when supabase returns no rows', async () => {
    const result = await lookupRemediation(
      fakeClient({ data: null, error: null }) as never,
      'q1',
      2,
    );
    expect(result).toBeNull();
  });

  it('returns the remediation when both English and Hindi text exist', async () => {
    const result = await lookupRemediation(
      fakeClient({
        data: {
          question_id: 'q1',
          distractor_index: 2,
          remediation_text: 'Momentum is conserved, not kinetic energy.',
          remediation_text_hi: 'संवेग संरक्षित होता है, गतिज ऊर्जा नहीं।',
        },
        error: null,
      }) as never,
      'q1',
      2,
    );
    expect(result).not.toBeNull();
    expect(result?.questionId).toBe('q1');
    expect(result?.distractorIndex).toBe(2);
    expect(result?.remediationEn).toContain('Momentum');
    expect(result?.remediationHi).toContain('संवेग');
  });

  it('returns empty string for Hindi when only English text exists', async () => {
    const result = await lookupRemediation(
      fakeClient({
        data: {
          question_id: 'q1',
          distractor_index: 2,
          remediation_text: 'Confused units of mass and weight.',
          remediation_text_hi: null,
        },
        error: null,
      }) as never,
      'q1',
      2,
    );
    expect(result?.remediationEn).toContain('mass and weight');
    expect(result?.remediationHi).toBe('');
  });

  it('returns null and does not throw when supabase reports an error', async () => {
    const result = await lookupRemediation(
      fakeClient({ data: null, error: { message: 'boom' } }) as never,
      'q1',
      2,
    );
    expect(result).toBeNull();
  });
});
