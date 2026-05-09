import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatCard } from '@/components/admin-ui/StatCard';

/**
 * StatCard — Plan 0 Task 2.
 *
 * Lifted from src/app/super-admin/_components/StatCard.tsx. Replaces the
 * previous inline-style hex literals (colors.bg / colors.border / colors.text*
 * / colors.success / colors.danger) with Tailwind semantic tokens
 * (bg-surface-1, border-surface-3, text-foreground, text-muted-foreground,
 * text-success, text-danger).
 *
 * Covers:
 *  - Renders label + numeric value (with toLocaleString formatting)
 *  - Renders string values verbatim
 *  - Renders optional subtitle and icon
 *  - Trend uses success token for >= 0, danger token for < 0
 *  - onClick is wired up and the card is keyboard-accessible
 *  - Uses Tailwind tokens (bg-surface-1, border-surface-3, text-foreground,
 *    text-muted-foreground) — no inline hex literals on the root container
 */

describe('StatCard', () => {
  it('renders the provided label and number value with locale formatting', () => {
    render(<StatCard label="Total Students" value={1234} />);
    expect(screen.getByText('Total Students')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();
  });

  it('renders string values verbatim', () => {
    render(<StatCard label="Status" value="N/A" />);
    expect(screen.getByText('N/A')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    render(<StatCard label="Active" value={42} subtitle="last 24h" />);
    expect(screen.getByText('last 24h')).toBeTruthy();
  });

  it('renders icon when provided', () => {
    render(<StatCard label="Errors" value={3} icon="!" />);
    expect(screen.getByText('!')).toBeTruthy();
  });

  it('renders positive trend with success token and a + sign', () => {
    render(<StatCard label="Signups" value={100} trend={{ value: 5, label: 'vs last week' }} />);
    const trend = screen.getByText(/\+5 vs last week/);
    expect(trend).toBeTruthy();
    expect(trend.className).toContain('text-success');
    expect(trend.className).not.toContain('text-danger');
  });

  it('renders negative trend with danger token and no + sign', () => {
    render(<StatCard label="Signups" value={100} trend={{ value: -3, label: 'vs last week' }} />);
    const trend = screen.getByText(/-3 vs last week/);
    expect(trend).toBeTruthy();
    expect(trend.className).toContain('text-danger');
    expect(trend.className).not.toContain('text-success');
  });

  it('invokes onClick when clicked and exposes button affordance', () => {
    const onClick = vi.fn();
    render(<StatCard label="Click me" value={1} onClick={onClick} />);
    const card = screen.getByRole('button');
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('invokes onClick on Enter/Space keys for keyboard accessibility', () => {
    const onClick = vi.fn();
    render(<StatCard label="Keyboard" value={1} onClick={onClick} />);
    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does not expose a button role when onClick is omitted', () => {
    render(<StatCard label="Static" value={9} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses Tailwind tokens on the root container (no inline hex literals)', () => {
    const { container } = render(<StatCard label="Tokens" value={1} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('bg-surface-1');
    expect(root.className).toContain('border-surface-3');
  });

  it('uses muted-foreground for the label text', () => {
    render(<StatCard label="Muted Label" value={1} />);
    const label = screen.getByText('Muted Label');
    expect(label.className).toContain('text-muted-foreground');
  });

  it('uses foreground token for the primary value text', () => {
    render(<StatCard label="Big Number" value={42} />);
    const value = screen.getByText('42');
    expect(value.className).toContain('text-foreground');
  });
});
