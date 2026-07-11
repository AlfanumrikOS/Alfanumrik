import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyMath } from '@alfanumrik/lib/math-python-client';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('private Python math containment', () => {
  it('fails soft without a private trusted-proxy URL and performs no fetch', async () => {
    vi.stubEnv('PYTHON_AI_BASE_URL', '');
    vi.stubEnv(
      'NEXT_PUBLIC_PYTHON_AI_BASE_URL',
      'https://ai-services.invalid.run.app',
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await verifyMath(
      {
        problem_expression: '1 + 1',
        claimed_answer: '2',
        kind: 'evaluate',
      },
      { jwt: 'student-jwt' },
    );

    expect(result).toEqual({ is_correct: null, confidence: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
