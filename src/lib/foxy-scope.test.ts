import { describe, expect, it } from 'vitest';
import { resolveFoxyEnrollmentScope } from './foxy-scope';

describe('resolveFoxyEnrollmentScope', () => {
  it('uses the enrolled grade and normalizes legacy plan aliases', () => {
    const scope = resolveFoxyEnrollmentScope({
      grade: 'Grade 9',
      subscription_plan: 'premium_yearly',
    });

    expect(scope.grade).toBe('9');
    expect(scope.plan).toBe('pro');
  });

  it('falls back to free plan and null grade when the student row is incomplete', () => {
    const scope = resolveFoxyEnrollmentScope({});

    expect(scope.grade).toBeNull();
    expect(scope.plan).toBe('free');
  });
});
