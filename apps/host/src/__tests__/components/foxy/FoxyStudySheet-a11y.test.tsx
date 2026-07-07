/**
 * FoxyStudySheet — Phase 3 accessibility contract (Foxy OS, ff_foxy_os_v1).
 *
 * Presentation-only component on the shared SheetModal primitive. `isHi` is a
 * plain prop (no AuthContext) and SheetModal renders inline (no portal), so we
 * render the open sheet and query its DOM directly.
 *
 * These tests pin the ARIA / keyboard surface added in Phase 3:
 *   1. Subject tabs are a true tablist: container role="tablist", each subject
 *      role="tab" with aria-selected, and a roving tabindex (only the active tab
 *      is tabIndex=0; the rest are -1).
 *   2. Arrow-key roving focus: ArrowRight/ArrowLeft move DOM focus to the
 *      adjacent tab (wrapping); Home/End jump to the first/last tab. Selection is
 *      NOT triggered by arrows (no onSelectSubject call) — only focus moves.
 *   3. Clicking a tab fires onSelectSubject (locked subjects route to
 *      onLockedSubject instead).
 *   4. Mode chips are a labelled group; each chip exposes aria-pressed, with the
 *      active mode pressed.
 *
 * NOTE (manual-validation-only): the SheetModal focus-trap, focus-return-to-
 * trigger, and real screen-reader announcement of tablist/tab semantics cannot
 * be exercised in JSDOM. The arrow-key tests assert document.activeElement moves
 * (JSDOM supports .focus()), which is the closest faithful proxy.
 */

import { render, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import {
  FoxyStudySheet,
  type StudySheetSubject,
  type StudySheetMode,
} from '@alfanumrik/ui/foxy/mobile/FoxyStudySheet';

const SUBJECTS: StudySheetSubject[] = [
  { code: 'math', name: 'Math', icon: '📐', color: '#10B981' },
  { code: 'science', name: 'Science', icon: '🔬', color: '#3B82F6' },
  { code: 'english', name: 'English', icon: '📖', color: '#F59E0B' },
  { code: 'social', name: 'Social', icon: '🌍', color: '#8B5CF6', isLocked: true },
];

const MODES: StudySheetMode[] = [
  { id: 'ask', label: 'Ask', labelHi: 'पूछो', icon: '💬' },
  { id: 'explain', label: 'Explain', labelHi: 'समझाओ', icon: '💡' },
  { id: 'revise', label: 'Revise', labelHi: 'दोहराओ', icon: '🔁' },
];

function makeProps(overrides: Partial<React.ComponentProps<typeof FoxyStudySheet>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    isHi: false,
    subjects: SUBJECTS,
    activeSubjectCode: 'math',
    onSelectSubject: vi.fn(),
    onLockedSubject: vi.fn(),
    topics: [],
    activeTopicId: null,
    onSelectTopic: vi.fn(),
    modes: MODES,
    sessionMode: 'learn', // maps to the 'ask' chip (active)
    resolveBackendMode: (id: string) => id,
    subjectColor: '#10B981',
    onSelectMode: vi.fn(),
    onStartQuiz: vi.fn(),
    lesson: null,
    ...overrides,
  } satisfies React.ComponentProps<typeof FoxyStudySheet>;
}

describe('FoxyStudySheet a11y — subject tablist', () => {
  it('renders a tablist with one tab per subject', () => {
    const { getByRole } = render(<FoxyStudySheet {...makeProps()} />);
    const tablist = getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(SUBJECTS.length);
  });

  it('exposes aria-selected on each tab with the active subject selected', () => {
    const { getByRole } = render(
      <FoxyStudySheet {...makeProps({ activeSubjectCode: 'science' })} />,
    );
    const tablist = getByRole('tablist');
    const science = within(tablist).getByRole('tab', { name: 'Science' });
    expect(science).toHaveAttribute('aria-selected', 'true');
    const math = within(tablist).getByRole('tab', { name: 'Math' });
    expect(math).toHaveAttribute('aria-selected', 'false');
  });

  it('uses a roving tabindex: only the active tab is in the Tab order', () => {
    const { getByRole } = render(
      <FoxyStudySheet {...makeProps({ activeSubjectCode: 'science' })} />,
    );
    const tablist = getByRole('tablist');
    expect(within(tablist).getByRole('tab', { name: 'Science' })).toHaveAttribute('tabindex', '0');
    expect(within(tablist).getByRole('tab', { name: 'Math' })).toHaveAttribute('tabindex', '-1');
    expect(within(tablist).getByRole('tab', { name: 'English' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight on a focused tab moves roving focus to the next tab without selecting', () => {
    const onSelectSubject = vi.fn();
    const { getByRole } = render(
      <FoxyStudySheet {...makeProps({ activeSubjectCode: 'math', onSelectSubject })} />,
    );
    const tablist = getByRole('tablist');
    const math = within(tablist).getByRole('tab', { name: 'Math' });
    const science = within(tablist).getByRole('tab', { name: 'Science' });

    math.focus();
    expect(document.activeElement).toBe(math);

    fireEvent.keyDown(math, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(science);
    // Arrow navigation must not activate the subject.
    expect(onSelectSubject).not.toHaveBeenCalled();
  });

  it('ArrowLeft wraps from the first tab to the last', () => {
    const { getByRole } = render(<FoxyStudySheet {...makeProps()} />);
    const tablist = getByRole('tablist');
    const math = within(tablist).getByRole('tab', { name: 'Math' }); // idx 0
    const social = within(tablist).getByRole('tab', { name: /Social/ }); // idx 3 (last)

    math.focus();
    fireEvent.keyDown(math, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(social);
  });

  it('Home and End jump to the first and last tab', () => {
    const { getByRole } = render(<FoxyStudySheet {...makeProps()} />);
    const tablist = getByRole('tablist');
    const math = within(tablist).getByRole('tab', { name: 'Math' });
    const science = within(tablist).getByRole('tab', { name: 'Science' });
    const social = within(tablist).getByRole('tab', { name: /Social/ });

    science.focus();
    fireEvent.keyDown(science, { key: 'End' });
    expect(document.activeElement).toBe(social);

    fireEvent.keyDown(social, { key: 'Home' });
    expect(document.activeElement).toBe(math);
  });

  it('clicking an unlocked tab fires onSelectSubject; a locked tab routes to onLockedSubject', () => {
    const onSelectSubject = vi.fn();
    const onLockedSubject = vi.fn();
    const { getByRole } = render(
      <FoxyStudySheet {...makeProps({ onSelectSubject, onLockedSubject })} />,
    );
    const tablist = getByRole('tablist');
    fireEvent.click(within(tablist).getByRole('tab', { name: 'Science' }));
    expect(onSelectSubject).toHaveBeenCalledWith('science');

    fireEvent.click(within(tablist).getByRole('tab', { name: /Social/ }));
    expect(onLockedSubject).toHaveBeenCalledWith('social');
  });
});

describe('FoxyStudySheet a11y — mode chips', () => {
  it('wraps the mode chips in a labelled group', () => {
    const { getByRole } = render(<FoxyStudySheet {...makeProps()} />);
    // role="group" with aria-labelledby pointing at the "Choose a mode" heading.
    const group = getByRole('group', { name: /choose a mode/i });
    expect(group).toBeTruthy();
  });

  it('each mode chip exposes aria-pressed with the active mode pressed', () => {
    // sessionMode 'learn' maps to the 'ask' chip (per the component's matching).
    const { getByRole } = render(
      <FoxyStudySheet {...makeProps({ sessionMode: 'learn' })} />,
    );
    const group = getByRole('group', { name: /choose a mode/i });

    const ask = within(group).getByRole('button', { name: 'Ask' });
    expect(ask).toHaveAttribute('aria-pressed', 'true');

    const explain = within(group).getByRole('button', { name: 'Explain' });
    expect(explain).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a mode chip fires onSelectMode with its id', () => {
    const onSelectMode = vi.fn();
    const { getByRole } = render(
      <FoxyStudySheet {...makeProps({ onSelectMode })} />,
    );
    const group = getByRole('group', { name: /choose a mode/i });
    fireEvent.click(within(group).getByRole('button', { name: 'Revise' }));
    expect(onSelectMode).toHaveBeenCalledWith('revise');
  });
});
