import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * PaperCard — PR-5 of the JEE/NEET/Olympiad roadmap.
 *
 * Covers:
 *  - English title rendering (isHi=false)
 *  - Hindi title rendering (isHi=true), Arabic numerals preserved
 *  - Locked variant: shows "Locked" button, no Start link
 *  - Unlocked variant: shows "Start" link with /exams/mock/<id> href
 *  - onStart callback fires with the paper id when Start is clicked
 *  - buildPaperTitle pure helper handles common families + missing subjects
 */

// next/link → plain <a> so the test can read href without a Next runtime.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    [key: string]: unknown;
  }) =>
    React.createElement('a', { href, onClick, ...rest }, children),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
import PaperCard, { buildPaperTitle, type PaperSummary } from '@alfanumrik/ui/exams/PaperCard';

const basePaper: PaperSummary = {
  id: 'paper-uuid-001',
  paper_code: 'JEE-MAIN-2025-S1',
  exam_family: 'jee_main',
  exam_year: 2025,
  subject_scope: ['physics'],
  total_questions: 30,
  duration_minutes: 60,
  marking_scheme: { correct: 4, wrong: -1 },
  source_attribution: 'NTA Pattern',
};

describe('<PaperCard />', () => {
  it('renders the title in English when isHi=false', () => {
    render(<PaperCard paper={basePaper} isLocked={false} isHi={false} />);
    expect(screen.getByText(/JEE Main 2025/)).toBeTruthy();
    expect(screen.getByText(/Physics/)).toBeTruthy();
    // English stat row labels
    expect(screen.getByText(/questions/)).toBeTruthy();
    expect(screen.getByText(/60/)).toBeTruthy();
  });

  it('renders the title in Hindi when isHi=true (technical exam names stay English)', () => {
    render(<PaperCard paper={basePaper} isLocked={false} isHi={true} />);
    // JEE Main is a technical term — stays English in Hindi locale.
    expect(screen.getByText(/JEE Main 2025/)).toBeTruthy();
    // Subject label flips to Hindi.
    expect(screen.getByText(/भौतिकी/)).toBeTruthy();
    // Hindi stat row label.
    expect(screen.getByText(/प्रश्न/)).toBeTruthy();
    // Arabic numerals preserved.
    expect(screen.getByText('30').textContent).toBe('30');
  });

  it('shows the Locked button (and hides Start) when isLocked=true', () => {
    render(<PaperCard paper={basePaper} isLocked={true} isHi={false} />);
    const lockedBtn = screen.getByTestId('paper-card-locked');
    expect(lockedBtn.textContent).toMatch(/Locked/);
    expect((lockedBtn as HTMLButtonElement).disabled).toBe(true);
    // Start link must not be rendered.
    expect(screen.queryByTestId('paper-card-start')).toBeNull();
  });

  it('shows the Start link with the correct href when isLocked=false', () => {
    render(<PaperCard paper={basePaper} isLocked={false} isHi={false} />);
    const link = screen.getByTestId('paper-card-start') as HTMLAnchorElement;
    expect(link.textContent).toMatch(/Start/);
    expect(link.getAttribute('href')).toBe('/exams/mock/paper-uuid-001');
    // Locked button must not be rendered.
    expect(screen.queryByTestId('paper-card-locked')).toBeNull();
  });

  it('fires onStart with the paper id when Start is clicked', () => {
    const handle = vi.fn();
    render(<PaperCard paper={basePaper} isLocked={false} isHi={false} onStart={handle} />);
    fireEvent.click(screen.getByTestId('paper-card-start'));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith('paper-uuid-001');
  });

  it('renders Hindi Start label when isHi=true', () => {
    render(<PaperCard paper={basePaper} isLocked={false} isHi={true} />);
    const link = screen.getByTestId('paper-card-start');
    expect(link.textContent).toMatch(/शुरू/);
  });

  it('renders Hindi Locked label when isLocked + isHi=true', () => {
    render(<PaperCard paper={basePaper} isLocked={true} isHi={true} />);
    const btn = screen.getByTestId('paper-card-locked');
    expect(btn.textContent).toMatch(/लॉक्ड/);
  });

  it('omits the stat row marking scheme when no marking_scheme is provided', () => {
    const stripped: PaperSummary = { ...basePaper, marking_scheme: undefined };
    render(<PaperCard paper={stripped} isLocked={false} isHi={false} />);
    expect(screen.queryByText(/\+4/)).toBeNull();
  });
});

describe('buildPaperTitle()', () => {
  it('builds an EN title with family + year + subject', () => {
    expect(
      buildPaperTitle({ exam_family: 'neet', exam_year: 2024, subject_scope: ['biology'] }, false),
    ).toBe('NEET 2024 · Biology');
  });

  it('builds an HI title with translated family and subject', () => {
    expect(
      buildPaperTitle({ exam_family: 'olympiad_math', exam_year: 2025, subject_scope: [] }, true),
    ).toBe('ओलंपियाड गणित 2025');
  });

  it('falls back to the raw family code when family is unknown', () => {
    expect(
      buildPaperTitle({ exam_family: 'custom_exam', exam_year: 2030, subject_scope: [] }, false),
    ).toBe('custom_exam 2030');
  });
});
