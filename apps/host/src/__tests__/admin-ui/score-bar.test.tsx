/**
 * ScoreBar (admin-ui) — scoreBand threshold helper for the Education
 * Intelligence Cloud in-cell micro-bar. Pure 0-100 band classification:
 *   >= 80 success | 60-79 info | 40-59 warning | < 40 danger | null neutral.
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { scoreBand, ScoreBar } from '@alfanumrik/ui/admin-ui/ScoreBar';

describe('scoreBand — 80 / 60 / 40 thresholds', () => {
  it('>= 80 → success', () => {
    expect(scoreBand(80)).toBe('success');
    expect(scoreBand(100)).toBe('success');
  });
  it('60-79 → info', () => {
    expect(scoreBand(60)).toBe('info');
    expect(scoreBand(79)).toBe('info');
  });
  it('40-59 → warning', () => {
    expect(scoreBand(40)).toBe('warning');
    expect(scoreBand(59)).toBe('warning');
  });
  it('< 40 → danger', () => {
    expect(scoreBand(39)).toBe('danger');
    expect(scoreBand(0)).toBe('danger');
  });
  it('null / undefined → neutral (no score yet)', () => {
    expect(scoreBand(null)).toBe('neutral');
    expect(scoreBand(undefined)).toBe('neutral');
  });
  it('non-finite (NaN / Infinity) → neutral', () => {
    expect(scoreBand(NaN)).toBe('neutral');
    expect(scoreBand(Infinity)).toBe('neutral');
  });
});

describe('ScoreBar render — accessible, never colour-only', () => {
  it('renders the numeric value as text next to the bar', () => {
    render(<ScoreBar score={73} label="Composite" />);
    expect(screen.getByText('73')).toBeInTheDocument();
  });
  it('null score renders the em-dash placeholder and an aria meter without valuenow', () => {
    render(<ScoreBar score={null} label="Engagement" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-label', expect.stringContaining('no score'));
    expect(meter).not.toHaveAttribute('aria-valuenow');
  });
  it('a valid score exposes aria-valuenow for screen readers', () => {
    render(<ScoreBar score={88} label="Health" />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '88');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });
});
