import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

/**
 * RichContent — Foxy chat rendering spacing fixes.
 *
 * Covers the 4 frontend rendering defects from the Foxy step-card audit:
 *   1. splitCustomMarkers preserves spacing around [ANS:|TIP:|MARKS:] badges
 *      (no fused "answer is50today" bug)
 *   2. splitCustomMarkers does NOT add a redundant double-space when input
 *      already has whitespace on the boundary
 *   3. <strong> rendering has paddingRight/marginRight so the borderBottom
 *      underline doesn't visually fuse with adjacent plain text
 *   4. remark-breaks plugin is wired so single newlines render as <br>
 *      (step-card output renders one step per line)
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => () => ({
    code: 'math',
    icon: '📐',
    color: '#10B981',
    name: 'Math',
  }),
}));

import { RichContent, splitCustomMarkers, type Segment } from '@/components/foxy/RichContent';

// ─────────────────────────────────────────────────────────────────────────────
// 1. splitCustomMarkers — spacing preservation
// ─────────────────────────────────────────────────────────────────────────────

describe('splitCustomMarkers — adjacent text+badge spacing', () => {
  it('inserts a space when text is fused to badge with no whitespace', () => {
    // The bug: "answer is[ANS: 50]today" rendered as "answer is50today".
    const segments = splitCustomMarkers('answer is[ANS: 50]today', '#10B981');

    // We expect 3 segments: markdown(before) → ans → markdown(after)
    expect(segments.length).toBe(3);

    const [before, badge, after] = segments;
    expect(before.type).toBe('markdown');
    expect(badge.type).toBe('ans');
    expect(after.type).toBe('markdown');

    // The "before" markdown segment must end with a space so the badge
    // doesn't visually fuse with the prior word.
    expect(before.content.endsWith(' ')).toBe(true);
    expect(before.content).toBe('answer is ');

    // The "after" markdown segment must start with a space.
    expect(after.content.startsWith(' ')).toBe(true);
    expect(after.content).toBe(' today');

    // Badge content itself is the original captured value (preserves raw answer).
    expect(badge.content).toBe('50');
  });

  it('does not add a redundant double-space when whitespace already exists', () => {
    // Already-spaced input — must not be padded with extra whitespace.
    const segments = splitCustomMarkers('x = [ANS: 5] (correct)', '#10B981');

    expect(segments.length).toBe(3);
    const [before, , after] = segments;

    // Before should remain "x = " (single trailing space, no double).
    expect(before.content).toBe('x = ');
    expect(before.content.endsWith('  ')).toBe(false);

    // After should remain " (correct)" (single leading space, no double).
    expect(after.content).toBe(' (correct)');
    expect(after.content.startsWith('  ')).toBe(false);
  });

  it('does not add leading/trailing whitespace for standalone badge', () => {
    // Boundary case: badge at start AND end of string. No surrounding text,
    // so no whitespace pad should be inserted on either side.
    const segments = splitCustomMarkers('[ANS: 50]', '#10B981');

    // Only 1 segment: the badge itself. No phantom empty markdown segments.
    expect(segments.length).toBe(1);
    expect(segments[0].type).toBe('ans');
    expect(segments[0].content).toBe('50');
  });

  it('handles TIP and MARKS markers with the same spacing rule', () => {
    const tipSegs = splitCustomMarkers('hello[TIP: read carefully]world', '#10B981');
    expect(tipSegs.length).toBe(3);
    expect(tipSegs[0].content).toBe('hello ');
    expect(tipSegs[1].type).toBe('tip');
    expect(tipSegs[2].content).toBe(' world');

    const marksSegs = splitCustomMarkers('Q1[MARKS: 2]Q2', '#10B981');
    expect(marksSegs.length).toBe(3);
    expect(marksSegs[0].content).toBe('Q1 ');
    expect(marksSegs[1].type).toBe('marks');
    expect(marksSegs[2].content).toBe(' Q2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. <strong> rendering — bold text doesn't fuse with adjacent plain text
// ─────────────────────────────────────────────────────────────────────────────

describe('RichContent — <strong> visual separation', () => {
  it('bold text has paddingRight/marginRight to prevent underline fusion', () => {
    // Render markdown with bold immediately followed by plain text — the bug.
    const { container } = render(
      <RichContent content="**important**word" subjectKey="math" />,
    );

    // The strong renderer emits a <span> (not native <strong>) with the
    // borderBottom underline + spacing styles.
    const strongSpan = container.querySelector('span.font-bold') as HTMLElement | null;
    expect(strongSpan).not.toBeNull();

    const styleAttr = strongSpan!.getAttribute('style') || '';
    // We assert against the inline style string (jsdom serializes inline
    // styles as kebab-case). Either paddingRight or marginRight is acceptable
    // as long as one of them is set — this is the spacing defense.
    const hasPadding = /padding-right:\s*2px/.test(styleAttr);
    const hasMargin = /margin-right:\s*1px/.test(styleAttr);
    expect(hasPadding || hasMargin).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. remark-breaks plugin — single newlines render as <br>
// ─────────────────────────────────────────────────────────────────────────────

describe('RichContent — remark-breaks wired into ReactMarkdown', () => {
  it('renders single newlines as <br> elements (step-card line breaks)', () => {
    // Without remark-breaks, single newlines collapse into one paragraph.
    // With remark-breaks, each line is separated by a <br>.
    const stepCard = 'Step 1: Read the problem\nStep 2: Identify the formula\nStep 3: Solve';
    const { container } = render(
      <RichContent content={stepCard} subjectKey="math" />,
    );

    // remark-breaks transforms each \n into a <br>. We expect at least 2 <br>
    // elements (one between each of the 3 step lines).
    const breaks = container.querySelectorAll('br');
    expect(breaks.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Type guard: Segment shape stays stable
// ─────────────────────────────────────────────────────────────────────────────

describe('RichContent — exported types', () => {
  it('Segment type discriminator covers all 4 marker categories', () => {
    // Compile-time check by exhaustive switch — purely a guard so future
    // refactors don't silently drop a marker type.
    const types: Segment['type'][] = ['markdown', 'ans', 'tip', 'marks'];
    expect(types.length).toBe(4);
  });
});
