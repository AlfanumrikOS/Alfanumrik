/**
 * FoxyStudySheet — chapter mastery-ring label containment.
 *
 * CEO-reported 2026-08-25 (mobile): the mastery numbers painted straight over
 * the ring and into the chapter title. The screenshot showed labels like
 * `9877105500426` where a percentage belonged.
 *
 * It was not a layout bug. `masteryPercent` is handed through untouched from
 * `topic_mastery_rollup.mastery_percent` (apps/host/src/app/foxy/page.tsx:1879),
 * which is a FLOAT 0–100 — e.g. 98.77105500426. The component rendered it raw
 * into a 24px circle at font-size 9px, so a 14-character string had nowhere to
 * go. Widening the circle would have hidden the defect, not fixed it.
 *
 * These tests pin the real contract: whatever arrives, the label is an integer
 * in 0–100, so it can never exceed three glyphs.
 */

import { render } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import {
  FoxyStudySheet,
  type StudySheetSubject,
  type StudySheetMode,
} from '@alfanumrik/ui/foxy/mobile/FoxyStudySheet';

const SUBJECTS: StudySheetSubject[] = [
  { code: 'math', name: 'Math', icon: '📐', color: '#10B981' },
];

const MODES: StudySheetMode[] = [{ id: 'ask', label: 'Ask', labelHi: 'पूछो', icon: '💬' }];

type Topic = {
  id: string;
  title: string;
  chapter_number: number;
  masteryPercent?: number;
};

function makeProps(topics: Topic[]) {
  return {
    open: true,
    onClose: vi.fn(),
    isHi: false,
    subjects: SUBJECTS,
    activeSubjectCode: 'math',
    onSelectSubject: vi.fn(),
    onLockedSubject: vi.fn(),
    topics,
    activeTopicId: null,
    onSelectTopic: vi.fn(),
    modes: MODES,
    sessionMode: 'learn',
    resolveBackendMode: (id: string) => id,
    subjectColor: '#10B981',
    onSelectMode: vi.fn(),
    onStartQuiz: vi.fn(),
    lesson: null,
  } as unknown as React.ComponentProps<typeof FoxyStudySheet>;
}

function ringLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.foxy-os-ring-inner')).map(
    (el) => el.textContent ?? '',
  );
}

function topic(n: number, masteryPercent?: number): Topic {
  return {
    id: `t${n}`,
    title: `Chapter ${n}`,
    chapter_number: n,
    masteryPercent,
  };
}

describe('FoxyStudySheet — mastery ring label', () => {
  it('rounds a raw float instead of rendering it verbatim', () => {
    // The exact value shape from the report.
    const { container } = render(
      <FoxyStudySheet {...makeProps([topic(2, 98.77105500426)])} />,
    );
    expect(ringLabels(container)).toEqual(['99']);
  });

  it('never renders a label longer than three characters, whatever arrives', () => {
    const { container } = render(
      <FoxyStudySheet
        {...makeProps([
          topic(1, 100),
          topic(2, 98.77105500426),
          topic(3, 16.788321678),
          topic(4, 0),
          topic(5, undefined),
        ])}
      />,
    );
    const labels = ringLabels(container);
    expect(labels).toEqual(['100', '99', '17', '0', '0']);
    for (const label of labels) {
      expect(
        label.length,
        `"${label}" cannot fit a 24px ring and would paint over the chapter title`,
      ).toBeLessThanOrEqual(3);
    }
  });

  it('clamps out-of-range and non-finite input rather than trusting the caller', () => {
    // Defence at the render boundary: an out-of-range value would otherwise
    // sweep the conic gradient past 360deg or backwards.
    const { container } = render(
      <FoxyStudySheet
        {...makeProps([
          topic(1, 140),
          topic(2, -20),
          topic(3, Number.NaN),
          topic(4, Number.POSITIVE_INFINITY),
        ])}
      />,
    );
    // Non-finite input resolves to 0 ("unknown"), not to the clamp ceiling —
    // the same choice cosmic/MasteryRing makes. Reporting 100% mastery because
    // a number arrived corrupt would be a worse lie than reporting none.
    expect(ringLabels(container)).toEqual(['100', '0', '0', '0']);
  });
});
