/**
 * StudyToolsBar — the two flag-gated GenAI affordances in the Foxy toolbar.
 *
 * This is the OFF-path no-op pin for the first user-visible surface of the
 * Lesson + Content(Diagram) GenAI agents. The declared contract:
 *
 *   - BOTH flags OFF  → the component renders literally NOTHING: no wrapper,
 *     no divider, no whitespace text node. The toolbar DOM must be
 *     byte-identical to today, so we assert on `container.innerHTML === ''`
 *     rather than merely "the buttons are absent".
 *   - Each flag independently ON → only that pill renders.
 *   - Rendering the bar performs NO network call at any flag combination
 *     (generation is student-initiated only — no speculative LLM spend).
 *   - No chapter selected → the pill does not dead-end; it routes to
 *     `onNeedChapter` instead of the generate handler.
 *   - P7: every label/title has an EN + Hindi pair.
 *
 * Owning agent: testing. Under test: frontend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import { StudyToolsBar } from '@/app/foxy/_components/StudyToolsBar';

const noop = () => {};

function baseProps(overrides: Partial<Parameters<typeof StudyToolsBar>[0]> = {}) {
  return {
    isHi: false,
    showDiagram: false,
    showLesson: false,
    hasChapter: true,
    accentColor: '#10B981',
    onDiagram: noop,
    onLesson: noop,
    onNeedChapter: noop,
    ...overrides,
  } as Parameters<typeof StudyToolsBar>[0];
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  global.fetch = fetchSpy as unknown as typeof fetch;
});

// ── 1. OFF path: byte-identical no-op ────────────────────────────────────────

describe('Foxy StudyToolsBar — both flags OFF renders nothing', () => {
  it('renders an EMPTY container (no wrapper, no divider, no whitespace)', () => {
    const { container } = render(
      <StudyToolsBar {...baseProps({ showDiagram: false, showLesson: false })} />,
    );
    expect(container.innerHTML).toBe('');
    expect(container.firstChild).toBeNull();
    expect(container.childNodes.length).toBe(0);
  });

  it('renders nothing in Hindi mode too', () => {
    const { container } = render(
      <StudyToolsBar
        {...baseProps({ isHi: true, showDiagram: false, showLesson: false })}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing even when a chapter IS selected', () => {
    const { container } = render(
      <StudyToolsBar {...baseProps({ hasChapter: true })} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('performs NO network call on the OFF path', () => {
    render(<StudyToolsBar {...baseProps()} />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 2. Independent per-flag ramps ────────────────────────────────────────────

describe('Foxy StudyToolsBar — flags resolve independently', () => {
  it('diagram flag ON → only the diagram pill renders', () => {
    const { queryByTestId } = render(
      <StudyToolsBar {...baseProps({ showDiagram: true, showLesson: false })} />,
    );
    expect(queryByTestId('foxy-tool-diagram')).toBeTruthy();
    expect(queryByTestId('foxy-tool-lesson')).toBeNull();
  });

  it('lesson flag ON → only the lesson pill renders', () => {
    const { queryByTestId } = render(
      <StudyToolsBar {...baseProps({ showDiagram: false, showLesson: true })} />,
    );
    expect(queryByTestId('foxy-tool-lesson')).toBeTruthy();
    expect(queryByTestId('foxy-tool-diagram')).toBeNull();
  });

  it('both flags ON → both pills render', () => {
    const { queryByTestId } = render(
      <StudyToolsBar {...baseProps({ showDiagram: true, showLesson: true })} />,
    );
    expect(queryByTestId('foxy-tool-diagram')).toBeTruthy();
    expect(queryByTestId('foxy-tool-lesson')).toBeTruthy();
  });

  it('performs NO network call on render even when BOTH flags are ON', () => {
    render(<StudyToolsBar {...baseProps({ showDiagram: true, showLesson: true })} />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 3. Click routing ─────────────────────────────────────────────────────────

describe('Foxy StudyToolsBar — click routing', () => {
  it('fires onDiagram when a chapter is selected', () => {
    const onDiagram = vi.fn();
    const onNeedChapter = vi.fn();
    const { getByTestId } = render(
      <StudyToolsBar
        {...baseProps({ showDiagram: true, hasChapter: true, onDiagram, onNeedChapter })}
      />,
    );
    fireEvent.click(getByTestId('foxy-tool-diagram'));
    expect(onDiagram).toHaveBeenCalledTimes(1);
    expect(onNeedChapter).not.toHaveBeenCalled();
  });

  it('fires onLesson when a chapter is selected', () => {
    const onLesson = vi.fn();
    const { getByTestId } = render(
      <StudyToolsBar {...baseProps({ showLesson: true, hasChapter: true, onLesson })} />,
    );
    fireEvent.click(getByTestId('foxy-tool-lesson'));
    expect(onLesson).toHaveBeenCalledTimes(1);
  });

  it('routes to onNeedChapter (never a dead end) when no chapter is selected', () => {
    const onDiagram = vi.fn();
    const onLesson = vi.fn();
    const onNeedChapter = vi.fn();
    const { getByTestId } = render(
      <StudyToolsBar
        {...baseProps({
          showDiagram: true,
          showLesson: true,
          hasChapter: false,
          onDiagram,
          onLesson,
          onNeedChapter,
        })}
      />,
    );
    fireEvent.click(getByTestId('foxy-tool-diagram'));
    fireEvent.click(getByTestId('foxy-tool-lesson'));
    expect(onDiagram).not.toHaveBeenCalled();
    expect(onLesson).not.toHaveBeenCalled();
    expect(onNeedChapter).toHaveBeenCalledTimes(2);
  });
});

// ── 4. P7 bilingual ──────────────────────────────────────────────────────────

describe('Foxy StudyToolsBar — P7 bilingual copy', () => {
  it('renders English labels when isHi=false', () => {
    const { getByTestId } = render(
      <StudyToolsBar {...baseProps({ showDiagram: true, showLesson: true })} />,
    );
    expect(getByTestId('foxy-tool-diagram').textContent).toContain('Diagram');
    expect(getByTestId('foxy-tool-lesson').textContent).toContain('Lesson notes');
  });

  it('renders Hindi labels when isHi=true', () => {
    const { getByTestId } = render(
      <StudyToolsBar
        {...baseProps({ isHi: true, showDiagram: true, showLesson: true })}
      />,
    );
    expect(getByTestId('foxy-tool-diagram').textContent).toContain('आरेख');
    expect(getByTestId('foxy-tool-lesson').textContent).toContain('पाठ नोट्स');
    // …and the English strings are gone.
    expect(getByTestId('foxy-tool-diagram').textContent).not.toContain('Diagram');
    expect(getByTestId('foxy-tool-lesson').textContent).not.toContain('Lesson notes');
  });

  it('keeps NCERT untranslated in the Hindi tooltip (technical term — P7)', () => {
    const { getByTestId } = render(
      <StudyToolsBar
        {...baseProps({ isHi: true, showDiagram: true, showLesson: true })}
      />,
    );
    expect(getByTestId('foxy-tool-diagram').getAttribute('title')).toContain('NCERT');
    expect(getByTestId('foxy-tool-lesson').getAttribute('title')).toContain('NCERT');
    // No Devanagari transliteration of the acronym.
    expect(getByTestId('foxy-tool-diagram').getAttribute('title')).not.toContain(
      'एनसीईआरटी',
    );
  });

  it('gives the no-chapter state a bilingual explanatory title', () => {
    const en = render(
      <StudyToolsBar {...baseProps({ showDiagram: true, hasChapter: false })} />,
    );
    expect(en.getByTestId('foxy-tool-diagram').getAttribute('title')).toBe(
      'Pick a chapter first',
    );
    en.unmount();

    const hi = render(
      <StudyToolsBar
        {...baseProps({ isHi: true, showDiagram: true, hasChapter: false })}
      />,
    );
    expect(hi.getByTestId('foxy-tool-diagram').getAttribute('title')).toBe(
      'पहले एक अध्याय चुनो',
    );
  });

  it('exposes a bilingual group label for assistive tech', () => {
    const en = render(
      <StudyToolsBar {...baseProps({ showDiagram: true })} />,
    );
    expect(en.getByRole('group').getAttribute('aria-label')).toBe(
      'Study tools for this chapter',
    );
    en.unmount();

    const hi = render(
      <StudyToolsBar {...baseProps({ isHi: true, showDiagram: true })} />,
    );
    expect(hi.getByRole('group').getAttribute('aria-label')).toBe(
      'अध्याय के लिए स्टडी टूल',
    );
  });
});

// ── 5. P13 — no identifiers leak into the rendered DOM ───────────────────────

describe('Foxy StudyToolsBar — P13 no PII in the rendered surface', () => {
  it('renders no student identifier, email or phone anywhere in the markup', () => {
    const { container } = render(
      <StudyToolsBar {...baseProps({ showDiagram: true, showLesson: true })} />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/studentId|student_id|@|\+91/i);
  });
});
