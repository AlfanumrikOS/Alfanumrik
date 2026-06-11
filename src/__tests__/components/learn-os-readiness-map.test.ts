/**
 * learn/os readiness-map — pure presentation mappers for the Alfa OS Subjects
 * experience. These translate the EXISTING readiness signal (engine output)
 * into RoadmapNode statuses + bilingual labels + deep-link routes. No mastery,
 * scoring, or XP is computed here.
 *
 * Tests pin the level→node-status mapping faithfully, plus the overall-readiness
 * collapse and the route/label mappers (which reuse existing routes only).
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  nodeStatusForLevel,
  statusLabel,
  bucketMeta,
  overallReadiness,
  nextActionRoute,
  nextActionLabel,
} from '@/components/learn/os/readiness-map';

describe('nodeStatusForLevel — readiness level → RoadmapNode status', () => {
  it('ready → mastered', () => {
    expect(nodeStatusForLevel('ready', 0)).toBe('mastered');
    expect(nodeStatusForLevel('ready', 90)).toBe('mastered');
  });
  it('almost → learning', () => {
    expect(nodeStatusForLevel('almost', 0)).toBe('learning');
  });
  it('building → needs-revision', () => {
    expect(nodeStatusForLevel('building', 0)).toBe('needs-revision');
  });
  it('not_yet with zero score → locked', () => {
    expect(nodeStatusForLevel('not_yet', 0)).toBe('locked');
  });
  it('not_yet with some score → learning (greyed only when truly untouched)', () => {
    expect(nodeStatusForLevel('not_yet', 1)).toBe('learning');
    expect(nodeStatusForLevel('not_yet', 42)).toBe('learning');
  });
});

describe('statusLabel — bilingual status word', () => {
  it('English labels', () => {
    expect(statusLabel('mastered', false)).toBe('Ready');
    expect(statusLabel('learning', false)).toBe('Learning');
    expect(statusLabel('needs-revision', false)).toBe('Revise');
    expect(statusLabel('locked', false)).toBe('Not started');
  });
  it('Hindi labels are non-empty and differ from English', () => {
    for (const s of ['mastered', 'learning', 'needs-revision', 'locked'] as const) {
      const hi = statusLabel(s, true);
      expect(hi.length).toBeGreaterThan(0);
      expect(hi).not.toBe(statusLabel(s, false));
    }
  });
});

describe('bucketMeta — glyph + label, never colour-only', () => {
  it('every bucket carries a text glyph (WCAG 1.4.1, not colour alone)', () => {
    for (const b of ['ready', 'almost', 'building', 'not_yet'] as const) {
      const meta = bucketMeta(b, false);
      expect(meta.glyph.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.color.length).toBeGreaterThan(0);
    }
  });
});

describe('overallReadiness — collapse per-bucket counts', () => {
  it('zero total → not_yet, 0%', () => {
    expect(overallReadiness({ ready: 0, almost: 0, building: 0, not_yet: 0 })).toEqual({
      bucket: 'not_yet',
      percent: 0,
      total: 0,
    });
  });
  it('percent is the share of ready chapters (rounded)', () => {
    const r = overallReadiness({ ready: 1, almost: 0, building: 0, not_yet: 2 });
    expect(r.percent).toBe(33); // 1/3 → 33, not 33.33
    expect(r.total).toBe(3);
  });
  it('>=60% ready → ready bucket', () => {
    expect(overallReadiness({ ready: 6, almost: 0, building: 0, not_yet: 4 }).bucket).toBe('ready');
  });
  it('ready+almost >=50% (but <60% ready) → almost', () => {
    expect(overallReadiness({ ready: 0, almost: 5, building: 0, not_yet: 5 }).bucket).toBe('almost');
  });
  it('mostly building/started but below thresholds → building', () => {
    expect(overallReadiness({ ready: 0, almost: 0, building: 3, not_yet: 2 }).bucket).toBe('building');
  });
});

describe('nextActionRoute — reuses existing routes only', () => {
  it('quiz actions route into the existing /quiz engine', () => {
    expect(nextActionRoute('take_quiz', 'Math', 3)).toBe('/quiz?subject=Math&chapter=3');
    expect(nextActionRoute('mock_exam', 'Math', 3)).toBe('/quiz?subject=Math&chapter=3');
  });
  it('spaced_review adds the review mode', () => {
    expect(nextActionRoute('spaced_review', 'Science', 2)).toBe('/quiz?subject=Science&chapter=2&mode=review');
  });
  it('concept actions route to /learn', () => {
    expect(nextActionRoute('introduce_concept', 'Math', 1)).toBe('/learn/Math/1');
    expect(nextActionRoute('review_concept', 'Math', 1)).toBe('/learn/Math/1');
  });
  it('unknown action falls back to Foxy doubt mode', () => {
    expect(nextActionRoute('something_new', 'Math', 1)).toBe('/foxy?subject=Math&chapter=1&mode=doubt');
  });
  it('URL-encodes the subject (no broken deep links)', () => {
    expect(nextActionRoute('take_quiz', 'Social Science', 4)).toBe('/quiz?subject=Social%20Science&chapter=4');
  });
});

describe('nextActionLabel — bilingual CTA verb', () => {
  it('English/Hindi differ and are non-empty for known actions', () => {
    for (const a of ['mock_exam', 'take_quiz', 'spaced_review', 'introduce_concept', 'review_concept'] as const) {
      expect(nextActionLabel(a, false).length).toBeGreaterThan(0);
      expect(nextActionLabel(a, true).length).toBeGreaterThan(0);
    }
  });
});
