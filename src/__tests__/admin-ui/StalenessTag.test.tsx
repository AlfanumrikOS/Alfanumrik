import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StalenessTag } from '@/components/admin-ui/StalenessTag';

describe('StalenessTag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when lastUpdated is null', () => {
    const { container } = render(<StalenessTag lastUpdated={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "just now" when age is under 60 seconds', () => {
    const lastUpdated = new Date(Date.now() - 30 * 1000); // 30s ago
    render(<StalenessTag lastUpdated={lastUpdated} />);
    const tag = screen.getByText(/just now/);
    expect(tag).toBeTruthy();
    // Fresh — uses muted-foreground token (not warning)
    expect(tag.className).toContain('text-muted-foreground');
    expect(tag.className).not.toContain('text-warning');
  });

  it('renders minute count and warning token when stale (>= thresholdMinutes)', () => {
    const lastUpdated = new Date(Date.now() - 6 * 60 * 1000); // 6m ago, threshold default 5
    render(<StalenessTag lastUpdated={lastUpdated} />);
    const tag = screen.getByText(/6m ago/);
    expect(tag).toBeTruthy();
    expect(tag.className).toContain('text-warning');
    expect(tag.className).not.toContain('text-muted-foreground');
    // Stale state appends warning glyph
    expect(tag.textContent).toContain('⚠');
  });

  it('renders fresh (muted) when below custom threshold', () => {
    const lastUpdated = new Date(Date.now() - 4 * 60 * 1000); // 4m ago
    render(<StalenessTag lastUpdated={lastUpdated} thresholdMinutes={10} />);
    const tag = screen.getByText(/4m ago/);
    expect(tag.className).toContain('text-muted-foreground');
    expect(tag.className).not.toContain('text-warning');
    expect(tag.textContent).not.toContain('⚠');
  });

  it('respects custom thresholdMinutes when stale', () => {
    const lastUpdated = new Date(Date.now() - 3 * 60 * 1000); // 3m ago
    render(<StalenessTag lastUpdated={lastUpdated} thresholdMinutes={2} />);
    const tag = screen.getByText(/3m ago/);
    expect(tag.className).toContain('text-warning');
  });

  it('uses text-xs sizing', () => {
    const lastUpdated = new Date(Date.now() - 30 * 1000);
    render(<StalenessTag lastUpdated={lastUpdated} />);
    const tag = screen.getByText(/just now/);
    expect(tag.className).toContain('text-xs');
  });
});
