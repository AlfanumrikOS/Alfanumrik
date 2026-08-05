import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

/**
 * FOXY MasteryAwareness — the mastery ring must not be squeezed by its text
 * sibling.
 *
 * WHY THIS EXISTS
 * ---------------
 * The nudge row is a flex container holding two children:
 *
 *     [ MasteryRing (fixed 40px) ]  [ text block: flex-1 min-w-0 ]
 *
 * `flex-1 min-w-0` lets the text block grow AND shrink past its content width —
 * that is deliberate, it is what makes the `truncate` on the topic title work.
 * But flex items default to `flex-shrink: 1`, so with a long topic title on a
 * narrow viewport the ring — which has no intrinsic minimum once it is a flex
 * item — gets compressed below its declared 40px and renders as an ellipse.
 * `MasteryRing` renders a fixed-size `<svg width={size} height={size}>`, so the
 * SVG keeps its 40px while the box around it shrinks: the stroke visibly clips.
 *
 * The fix wraps the ring in `shrink-0`. It has to be a WRAPPER because
 * `MasteryRing` accepts no `className` prop — so the guard is one line of markup
 * that is trivially lost in any future refactor of this row, with no type error
 * and no test failure to announce it.
 *
 * WHAT IS PINNED
 * --------------
 *   1. The element wrapping `MasteryRing` carries a no-shrink utility.
 *   2. Its flex sibling still carries `flex-1 min-w-0` — the condition that makes
 *      the guard NECESSARY. If that ever goes away the guard is merely harmless,
 *      but while it is there the guard is load-bearing, and pinning both together
 *      documents the coupling.
 *   3. Both live in the SAME flex row (parent has `flex`), so they really are
 *      competing flex items rather than incidentally-adjacent nodes.
 *
 * JSDOM applies no CSS and computes no layout, so this asserts the utility
 * classes on the RENDERED tree rather than a measured width. That is the
 * strongest check available below a visual-regression run — but it does mean the
 * test verifies the guard is PRESENT, not that the browser honours it.
 *
 * The component is rendered for real (only the `useMasteryOverview` data seam is
 * mocked), following the hook/fetch-seam convention in
 * momentum-wave2-visuals.test.tsx.
 */

// ── data seam ────────────────────────────────────────────────────────────────
const mockUseMasteryOverview = vi.fn();
vi.mock('@alfanumrik/lib/swr', () => ({
  useMasteryOverview: (...args: unknown[]) => mockUseMasteryOverview(...args),
}));

import MasteryAwareness from '@alfanumrik/ui/foxy/MasteryAwareness';

/**
 * One "started but not mastered" row, which is what `weakestStartedTopic()`
 * selects — the only state in which the nudge (and therefore the ring) renders.
 * The long title is the real-world trigger for the squeeze.
 */
const WEAK_ROW = {
  topic_id: 't1',
  title: 'Motion in a Straight Line — Uniform and Non-Uniform Acceleration',
  title_hi: 'सरल रेखा में गति',
  subject: 'science',
  mastery_level: 'learning',
  mastery_probability: 0.42,
  attempts: 10,
  correct_attempts: 4,
  due_for_review: false,
};

function renderNudge(isHi = false) {
  return render(
    <MasteryAwareness
      isHi={isHi}
      studentId="student-1"
      activeSubjectName="Science"
      activeSubjectIcon="🔬"
      activeSubject="science"
      onSuggest={() => {}}
    />,
  );
}

/** The element that actually wraps the ring's `role="img"` node. */
function ringWrapper(container: HTMLElement): HTMLElement {
  const ring = container.querySelector<HTMLElement>('[role="img"][aria-label^="Mastery:"]');
  if (!ring) throw new Error('MasteryAwareness rendered no MasteryRing');
  const wrapper = ring.parentElement;
  if (!wrapper) throw new Error('MasteryRing has no wrapping element');
  return wrapper;
}

const NO_SHRINK = /(^|\s)(shrink-0|flex-shrink-0)(\s|$)/;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMasteryOverview.mockReturnValue({ data: [WEAK_ROW], isLoading: false, error: null });
});

describe('MasteryAwareness — the nudge renders at all (premise of the guard)', () => {
  it('renders the weak-topic nudge with a mastery ring when a weak topic exists', () => {
    const { container } = renderNudge();
    const ring = container.querySelector('[role="img"][aria-label^="Mastery:"]');
    expect(ring).not.toBeNull();
    // 42% probability → the ring's accessible label.
    expect(ring!.getAttribute('aria-label')).toBe('Mastery: 42%');
  });

  it('renders no ring when there is no weak topic (guard is simply absent, not broken)', () => {
    mockUseMasteryOverview.mockReturnValue({
      data: [{ ...WEAK_ROW, mastery_level: 'mastered', due_for_review: false }],
      isLoading: false,
      error: null,
    });
    const { container } = renderNudge();
    expect(container.querySelector('[role="img"][aria-label^="Mastery:"]')).toBeNull();
  });
});

describe('MasteryAwareness — ring carries a no-shrink guard against its flex-1 sibling', () => {
  it('wraps the MasteryRing in an element with shrink-0', () => {
    const { container } = renderNudge();
    const wrapper = ringWrapper(container);
    expect(
      NO_SHRINK.test(wrapper.className),
      `the element wrapping MasteryRing has className "${wrapper.className}" — it needs shrink-0, ` +
        `otherwise the 40px ring is compressed by the flex-1 min-w-0 text block on narrow viewports`,
    ).toBe(true);
  });

  it('keeps the guard in Hindi too (the Hindi title is longer, so the squeeze is worse)', () => {
    const { container } = renderNudge(true);
    expect(NO_SHRINK.test(ringWrapper(container).className)).toBe(true);
  });

  it('still has the flex-1 min-w-0 sibling that makes the guard necessary', () => {
    const { container } = renderNudge();
    const wrapper = ringWrapper(container);
    const siblings = Array.from(wrapper.parentElement!.children).filter((el) => el !== wrapper);
    expect(siblings.length).toBeGreaterThan(0);
    const growing = siblings.filter(
      (el) => /(^|\s)flex-1(\s|$)/.test(el.className) && /(^|\s)min-w-0(\s|$)/.test(el.className),
    );
    expect(
      growing.length,
      'the ring no longer competes with a `flex-1 min-w-0` sibling — re-check whether shrink-0 is still the right guard',
    ).toBeGreaterThan(0);
  });

  it('places ring and text in the SAME flex row (they really are competing flex items)', () => {
    const { container } = renderNudge();
    const row = ringWrapper(container).parentElement!;
    expect(
      /(^|\s)flex(\s|$)/.test(row.className),
      `expected the ring's parent to be a flex row, got className "${row.className}"`,
    ).toBe(true);
  });

  it('does not shrink-protect the text block (that one MUST stay shrinkable for truncate)', () => {
    // Guarding both would break the title's `truncate`, which needs the text
    // block to shrink. Asserting the asymmetry stops an over-eager "fix".
    const { container } = renderNudge();
    const wrapper = ringWrapper(container);
    const textBlock = Array.from(wrapper.parentElement!.children).find(
      (el) => el !== wrapper && /(^|\s)flex-1(\s|$)/.test(el.className),
    );
    expect(textBlock).toBeDefined();
    expect(NO_SHRINK.test((textBlock as HTMLElement).className)).toBe(false);
    expect((textBlock as HTMLElement).querySelector('.truncate')).not.toBeNull();
  });
});

describe('MasteryAwareness — ring geometry request is unchanged (40px, stroke 4)', () => {
  it('asks MasteryRing for the 40px size the shrink-0 guard protects', () => {
    // If the call site ever moves to a different size, the mastery-ring-label-fit
    // suite's 40/4 case should move with it — this pins the coupling.
    const { container } = renderNudge();
    const svg = container.querySelector<SVGElement>('[role="img"][aria-label^="Mastery:"] svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('width')).toBe('40');
    expect(svg!.getAttribute('height')).toBe('40');
    expect(svg!.querySelector('circle')!.getAttribute('stroke-width')).toBe('4');
  });
});
