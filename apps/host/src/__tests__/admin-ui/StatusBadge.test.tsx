import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@alfanumrik/ui/admin-ui/StatusBadge';

/**
 * StatusBadge — Plan 0 Task 3.
 *
 * Lifted from src/app/super-admin/_components/StatusBadge.tsx. Uses a
 * variant→class map (success/danger/warning/info/neutral) backed by Tailwind
 * semantic tokens.
 *
 * ── 2026-08-15 AA contrast repair (pinned by the it.each table below) ─────
 * The badge previously mixed its 10% tint into `transparent` (composited
 * backdrop undefined) and painted the raw tone as its own text colour —
 * every non-neutral variant failed WCAG AA. The repair has two halves:
 *  1. Tint mixes into the OPAQUE var(--surface-1), making the background
 *     backdrop-independent: bg-[color-mix(in_srgb,var(--tone)_10%,var(--surface-1))]
 *  2. Foreground comes from the `*-strong` family (text-success-strong /
 *     text-danger-strong / text-warning-strong / text-info-strong), with the
 *     utilities registered in apps/host/tailwind.config.js
 *     (success-strong re-pointed to var(--success-strong); warning-strong /
 *     info-strong / danger-strong newly registered).
 * Reverting EITHER half re-breaks AA — if this test fails, do not "fix" it
 * by restoring the old transparent-tint / raw-tone-text classes.
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
    ['success', 'bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-1))]', 'text-success-strong'],
    ['danger', 'bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface-1))]', 'text-danger-strong'],
    ['warning', 'bg-[color-mix(in_srgb,var(--warning)_10%,var(--surface-1))]', 'text-warning-strong'],
    ['info', 'bg-[color-mix(in_srgb,var(--info)_10%,var(--surface-1))]', 'text-info-strong'],
    ['neutral', 'bg-surface-2', 'text-muted-foreground'],
  ] as const)('maps the %s variant to its token classes', (variant, bg, fg) => {
    render(<StatusBadge label={variant} variant={variant} />);
    const badge = screen.getByText(variant);
    expect(badge.className).toContain(bg);
    expect(badge.className).toContain(fg);
  });
});
