/**
 * AlternativesGrid — render + interaction tests.
 *
 * Server picks the semantic top-3. This component just renders them and
 * offers a "See all N" escape hatch when totalReady > 3.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SuggestedAlternative } from '@/components/foxy/ChatBubble';

const mockIsHi = { value: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

import { AlternativesGrid } from '@/components/grounding/AlternativesGrid';

const alt = (num: number, title: string): SuggestedAlternative => ({
  grade: '9',
  subject_code: 'science',
  chapter_number: num,
  chapter_title: title,
  rag_status: 'ready',
});

describe('AlternativesGrid', () => {
  beforeEach(() => { mockIsHi.value = false; });

  it('returns null when alternatives is empty', () => {
    const { container } = render(<AlternativesGrid alternatives={[]} onPick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when alternatives is not provided sensibly (edge case)', () => {
    const { container } = render(
      <AlternativesGrid alternatives={[] as SuggestedAlternative[]} onPick={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders up to 3 cards from props', () => {
    render(
      <AlternativesGrid
        alternatives={[alt(1, 'Matter'), alt(2, 'Atoms'), alt(3, 'Tissues'), alt(4, 'Cells')]}
        onPick={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // Only 3 rendered (top-3), 4th is dropped
    expect(buttons).toHaveLength(3);
    expect(screen.getByText('Matter')).toBeInTheDocument();
    expect(screen.getByText('Atoms')).toBeInTheDocument();
    expect(screen.getByText('Tissues')).toBeInTheDocument();
    expect(screen.queryByText('Cells')).not.toBeInTheDocument();
  });

  it('calls onPick with the clicked alternative', () => {
    const onPick = vi.fn();
    const alts = [alt(1, 'Matter'), alt(2, 'Atoms')];
    render(<AlternativesGrid alternatives={alts} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /atoms/i }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(alts[1]);
  });

  it('does NOT show "See all" when totalReady <= 3', () => {
    render(
      <AlternativesGrid
        alternatives={[alt(1, 'A'), alt(2, 'B'), alt(3, 'C')]}
        totalReady={3}
        onShowAll={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/see all/i)).not.toBeInTheDocument();
  });

  it('does NOT show "See all" when totalReady is undefined', () => {
    render(
      <AlternativesGrid
        alternatives={[alt(1, 'A')]}
        onShowAll={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/see all/i)).not.toBeInTheDocument();
  });

  it('does NOT show "See all" when onShowAll is undefined (even if totalReady > 3)', () => {
    render(
      <AlternativesGrid
        alternatives={[alt(1, 'A'), alt(2, 'B'), alt(3, 'C')]}
        totalReady={10}
        onPick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/see all/i)).not.toBeInTheDocument();
  });

  it('shows "See all N ready chapters" link when totalReady > 3 and onShowAll provided', () => {
    const onShowAll = vi.fn();
    render(
      <AlternativesGrid
        alternatives={[alt(1, 'A'), alt(2, 'B'), alt(3, 'C')]}
        totalReady={8}
        onShowAll={onShowAll}
        onPick={vi.fn()}
      />,
    );
    const link = screen.getByRole('button', { name: /see all 8 ready chapters/i });
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('renders Hindi labels when isHi = true', () => {
    mockIsHi.value = true;
    render(
      <AlternativesGrid
        alternatives={[alt(5, 'Atoms')]}
        totalReady={10}
        onShowAll={vi.fn()}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByText('Adhyay 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Saare 10 ready chapters/i })).toBeInTheDocument();
  });

  it('uses sm:grid-cols-3 responsive layout', () => {
    const { container } = render(
      <AlternativesGrid alternatives={[alt(1, 'A')]} onPick={vi.fn()} />,
    );
    const grid = container.querySelector('ul');
    expect(grid?.className).toMatch(/grid-cols-1/);
    expect(grid?.className).toMatch(/sm:grid-cols-3/);
  });
});