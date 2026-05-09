import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/admin-ui/StatusBadge';

/**
 * StatusBadge — Plan 0 Task 3.
 *
 * Lifted from src/app/super-admin/_components/StatusBadge.tsx. Uses a
 * variant→class map (success/danger/warning/info/neutral) backed by Tailwind
 * semantic tokens.
 *
 * Covers:
 *  - Renders label text
 *  - Defaults to neutral variant when none provided
 *  - Maps each variant to the correct bg/fg class pair
 */

describe('StatusBadge', () => {
  it('renders the provided label', () => {
    render(<StatusBadge label="Active" variant="success" />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('defaults to the neutral variant when no variant is given', () => {
    render(<StatusBadge label="Idle" />);
    const badge = screen.getByText('Idle');
    expect(badge.className).toContain('bg-surface-2');
    expect(badge.className).toContain('text-muted-foreground');
  });

  it.each([
    ['success', 'bg-success/10', 'text-success'],
    ['danger', 'bg-danger/10', 'text-danger'],
    ['warning', 'bg-warning/10', 'text-warning'],
    ['info', 'bg-info/10', 'text-info'],
    ['neutral', 'bg-surface-2', 'text-muted-foreground'],
  ] as const)('maps the %s variant to its token classes', (variant, bg, fg) => {
    render(<StatusBadge label={variant} variant={variant} />);
    const badge = screen.getByText(variant);
    expect(badge.className).toContain(bg);
    expect(badge.className).toContain(fg);
  });
});
