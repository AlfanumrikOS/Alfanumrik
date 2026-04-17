/**
 * HardAbstainCard — render + interaction tests across all 3 variants.
 *
 * Variants:
 *   (a) chapter_not_ready        → scope + alternatives + request-content
 *   (b) upstream_error           → retry button + countdown
 *       circuit_open             → retry button + countdown
 *   (c) no_chunks_retrieved      → generic no-NCERT copy + alternatives
 *       no_supporting_chunks
 *       low_similarity
 *       scope_mismatch
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SuggestedAlternative } from '@/components/foxy/ChatBubble';

const mockIsHi = { value: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi.value }),
}));

import { HardAbstainCard } from '@/components/grounding/HardAbstainCard';

const sampleAlt = (chapterNumber: number, title: string): SuggestedAlternative => ({
  grade: '9',
  subject_code: 'science',
  chapter_number: chapterNumber,
  chapter_title: title,
  rag_status: 'ready',
});

describe('HardAbstainCard — chapter_not_ready variant', () => {
  beforeEach(() => { mockIsHi.value = false; });

  it('renders the chapter-not-ready copy with scope and alternatives (EN)', () => {
    render(
      <HardAbstainCard
        reason="chapter_not_ready"
        scope={{ grade: '9', subject: 'Science', chapter: 'Atoms & Molecules' }}
        alternatives={[sampleAlt(5, 'Atoms'), sampleAlt(6, 'Tissues'), sampleAlt(7, 'Diversity')]}
      />,
    );
    const card = screen.getByTestId('hard-abstain-card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('role', 'status');
    expect(card.textContent).toMatch(/isn.t loaded yet/i);
    expect(card.textContent).toContain('Class 9 Science');
    expect(card.textContent).toContain('Atoms');
    expect(card.textContent).toContain('Tissues');
    expect(card.textContent).toContain('Diversity');
  });

  it('renders Hindi (romanized) chapter-not-ready copy when isHi = true', () => {
    mockIsHi.value = true;
    render(
      <HardAbstainCard
        reason="chapter_not_ready"
        scope={{ grade: '9', subject: 'Science' }}
        alternatives={[sampleAlt(5, 'Atoms')]}
      />,
    );
    expect(screen.getByTestId('hard-abstain-card').textContent).toMatch(/abhi load nahi hua/i);
  });

  it('calls onPickAlternative with the clicked alt', () => {
    const onPick = vi.fn();
    const alts = [sampleAlt(5, 'Atoms'), sampleAlt(6, 'Tissues')];
    render(<HardAbstainCard reason="chapter_not_ready" alternatives={alts} onPickAlternative={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /atoms/i }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(alts[0]);
  });

  it('calls onRequestContent when "Let us know" is clicked (EN)', () => {
    const onReq = vi.fn();
    render(<HardAbstainCard reason="chapter_not_ready" onRequestContent={onReq} />);
    fireEvent.click(screen.getByRole('button', { name: /let us know/i }));
    expect(onReq).toHaveBeenCalledTimes(1);
  });

  it('shows "See all N ready chapters" link when totalReady > alternatives.length', () => {
    const onShowAll = vi.fn();
    render(
      <HardAbstainCard
        reason="chapter_not_ready"
        alternatives={[sampleAlt(5, 'Atoms'), sampleAlt(6, 'Tissues'), sampleAlt(7, 'Diversity')]}
        totalReady={8}
        onShowAllAlternatives={onShowAll}
      />,
    );
    const link = screen.getByRole('button', { name: /see all 8 ready chapters/i });
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });
});

describe('HardAbstainCard — upstream_error / circuit_open variant', () => {
  beforeEach(() => { mockIsHi.value = false; });

  it('renders "catching its breath" copy for upstream_error', () => {
    render(<HardAbstainCard reason="upstream_error" />);
    expect(screen.getByTestId('hard-abstain-card').textContent).toMatch(/catching its breath/i);
  });

  it('renders "catching its breath" copy for circuit_open', () => {
    render(<HardAbstainCard reason="circuit_open" />);
    expect(screen.getByTestId('hard-abstain-card').textContent).toMatch(/catching its breath/i);
  });

  it('renders Hindi variant when isHi = true', () => {
    mockIsHi.value = true;
    render(<HardAbstainCard reason="circuit_open" />);
    expect(screen.getByTestId('hard-abstain-card').textContent).toMatch(/saans le raha hai/i);
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<HardAbstainCard reason="upstream_error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render a retry button when onRetry is omitted', () => {
    render(<HardAbstainCard reason="upstream_error" />);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe('HardAbstainCard — generic variants', () => {
  beforeEach(() => { mockIsHi.value = false; });

  it('renders generic no-NCERT copy for no_supporting_chunks', () => {
    render(<HardAbstainCard reason="no_supporting_chunks" />);
    expect(screen.getByTestId('hard-abstain-card').textContent).toMatch(/no ncert-backed answer/i);
  });

  it('renders generic copy for low_similarity and offers alternatives', () => {
    const onPick = vi.fn();
    const alts = [sampleAlt(2, 'Matter')];
    render(<HardAbstainCard reason="low_similarity" alternatives={alts} onPickAlternative={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /matter/i }));
    expect(onPick).toHaveBeenCalledWith(alts[0]);
  });

  it('renders generic copy for scope_mismatch with no alternatives gracefully', () => {
    render(<HardAbstainCard reason="scope_mismatch" />);
    expect(screen.getByTestId('hard-abstain-card')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('omits alternatives list when array is empty', () => {
    render(<HardAbstainCard reason="no_chunks_retrieved" alternatives={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});