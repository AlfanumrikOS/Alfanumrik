import { describe, expect, it } from 'vitest';
import type { TodayQueueItem } from '@alfanumrik/lib/today/types';
import { safeTodayHref, studentRecommendationReason } from '../app/(student)/_components/student-v3-contract';

function item(route: string, params?: Record<string, string | number>): TodayQueueItem {
  return {
    type: 'weak_topic_zpd',
    rank: 1,
    labelKey: 'today.item.weak_topic_zpd.label',
    subtitleKey: 'today.item.weak_topic_zpd.subtitle',
    estMinutes: 8,
    deepLink: { route, params },
    iconHint: 'target',
    reason: 'todays_zpd',
  };
}

describe('Student V3 recommendation contract', () => {
  it('preserves the resolver-owned deep link and encodes query values', () => {
    expect(safeTodayHref(item('/quiz', { subject: 'social science', chapter: 3 })))
      .toBe('/quiz?subject=social+science&chapter=3');
  });

  it('fails closed to Today when a resolver returns a non-application route', () => {
    expect(safeTodayHref(item('https://untrusted.example/path'))).toBe('/today');
  });

  it('rejects protocol-relative routes instead of handing Next.js an external URL', () => {
    expect(safeTodayHref(item('//untrusted.example/path', { student: 'student-1' })))
      .toBe('/today');
  });

  it('explains why the adaptive activity is next in English and Hindi', () => {
    expect(studentRecommendationReason('srs_due', false)).toContain('due');
    expect(studentRecommendationReason('srs_due', true)).toContain('दोहराना');
  });
});
