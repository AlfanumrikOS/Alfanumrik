/**
 * ParentDashboardSkeleton — the shared first-paint skeleton the parent gate
 * renders while auth / dashboard data resolves (replaces the raw "Loading…"
 * text). Presentation-only primitive; verifies the accessibility + bilingual
 * contract without mocking the full parent page.
 *
 * Owning agent: testing (frontend added this lightweight seed per the parent
 * UX-polish task; expand into a full-page gate + empty/error E2E as follow-up).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ParentDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

describe('ParentDashboardSkeleton — loading first-paint', () => {
  it('exposes a polite loading status for assistive tech', () => {
    render(<ParentDashboardSkeleton />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the bilingual English label when provided (P7)', () => {
    render(<ParentDashboardSkeleton label="Loading…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading…');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders the bilingual Hindi label when provided (P7)', () => {
    render(<ParentDashboardSkeleton label="लोड हो रहा है…" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'लोड हो रहा है…');
    expect(screen.getByText('लोड हो रहा है…')).toBeInTheDocument();
  });

  it('renders skeleton bones (the real dashboard shape, not a bare spinner)', () => {
    const { container } = render(<ParentDashboardSkeleton />);
    // Bone uses the shared shimmer animation class; the skeleton should paint
    // multiple placeholder blocks (header + stat grid + activity + insights).
    expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(8);
  });
});
