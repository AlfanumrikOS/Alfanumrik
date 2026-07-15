/**
 * AdminDashboardSkeleton / AdminControlRoomSkeleton — the shared first-paint
 * skeletons the super-admin slice-1 pass renders while data resolves, replacing
 * the raw grey "Loading…" text and the AdminShell session gate's bare spinner.
 * Presentation-only primitives; verifies the accessibility + bilingual contract
 * (P7) and that they paint the real dashboard shape (multiple bones), not a bare
 * spinner.
 *
 * Owning agent: testing (frontend seeded this alongside the super-admin UX pass).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminDashboardSkeleton, AdminControlRoomSkeleton } from '@alfanumrik/ui/Skeleton';

describe('AdminDashboardSkeleton — loading first-paint', () => {
  it('exposes a busy loading status for assistive tech', () => {
    render(<AdminDashboardSkeleton />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the bilingual label when provided (P7)', () => {
    render(<AdminDashboardSkeleton label="Loading analytics…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading analytics…');
    expect(screen.getByText('Loading analytics…')).toBeInTheDocument();
  });

  it('renders the Hindi label when provided (P7)', () => {
    render(<AdminDashboardSkeleton label="एनालिटिक्स लोड हो रहा है…" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'एनालिटिक्स लोड हो रहा है…');
  });

  it('omits visible text when no label is passed (language-neutral server paint)', () => {
    const { container } = render(<AdminDashboardSkeleton />);
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('paints the real dashboard shape (KPI tiles + table rows), not a bare spinner', () => {
    const { container } = render(<AdminDashboardSkeleton />);
    expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(8);
  });
});

describe('AdminControlRoomSkeleton — Control Room first-paint', () => {
  it('exposes a busy loading status for assistive tech', () => {
    render(<AdminControlRoomSkeleton />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the bilingual label when provided (P7)', () => {
    render(<AdminControlRoomSkeleton label="Loading control room…" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading control room…');
    expect(screen.getByText('Loading control room…')).toBeInTheDocument();
  });

  it('paints the shape-matched control-room layout (status bar + ops row + KPIs + widgets)', () => {
    const { container } = render(<AdminControlRoomSkeleton />);
    expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(6);
  });
});
