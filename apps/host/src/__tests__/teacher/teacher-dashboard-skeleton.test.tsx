/**
 * TeacherDashboardSkeleton — the shared first-paint skeleton the teacher gate
 * (teacher/layout.tsx Suspense fallback + teacher/page.tsx dynamic loader +
 * CommandCenter initial load) renders while auth / dashboard data resolves,
 * replacing the raw English "Loading teacher workspace…" div. Presentation-only
 * primitive; verifies the accessibility + bilingual contract (P7) without
 * mounting the full CommandCenter.
 *
 * Owning agent: testing (frontend added this lightweight seed per the teacher
 * UX-polish task; expand into a full-page gate + empty/error E2E as follow-up).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeacherDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

describe('TeacherDashboardSkeleton — loading first-paint', () => {
  it('exposes a busy loading status for assistive tech', () => {
    render(<TeacherDashboardSkeleton />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the bilingual English label when provided (P7)', () => {
    render(<TeacherDashboardSkeleton label="Loading your command center…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading your command center…');
    expect(screen.getByText('Loading your command center…')).toBeInTheDocument();
  });

  it('renders the bilingual Hindi label when provided (P7)', () => {
    render(<TeacherDashboardSkeleton label="आपका कमांड सेंटर लोड हो रहा है…" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'आपका कमांड सेंटर लोड हो रहा है…');
    expect(screen.getByText('आपका कमांड सेंटर लोड हो रहा है…')).toBeInTheDocument();
  });

  it('omits visible text when no label is passed (language-neutral server paint)', () => {
    const { container } = render(<TeacherDashboardSkeleton />);
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('renders skeleton bones (the real command-center shape, not a bare spinner)', () => {
    const { container } = render(<TeacherDashboardSkeleton />);
    // Bone uses the shared shimmer animation class; the skeleton should paint
    // multiple placeholder blocks (KPI tiles + at-risk rail + mastery heatmap).
    expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(8);
  });
});
