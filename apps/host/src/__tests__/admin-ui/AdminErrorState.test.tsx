/**
 * AdminErrorState — the shared retry-able error surface the super-admin slice-1
 * pass adopts so a failed fetch never renders as a blank screen (the silent-null
 * defect). The data-heavy super-admin pages (analytics, diagnostics, learning,
 * flags, command-center, Control Room) delegate their fetch-failure branch to
 * this primitive, passing their own `fetchAll` as `onRetry`.
 *
 * Covers: renders heading + detail, fires onRetry (the recovery path), bilingual
 * copy (P7), and the compact partial-failure banner variant. Presentation-only —
 * no page mounting / heavy mocking.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminErrorState } from '@alfanumrik/ui/admin-ui';

describe('AdminErrorState — retry-able fetch-failure surface', () => {
  it('renders the default English heading and the passed detail message', () => {
    render(<AdminErrorState onRetry={() => {}} message="Some analytics could not be loaded" />);
    expect(screen.getByText(/Couldn.t load data/)).toBeInTheDocument();
    expect(screen.getByText('Some analytics could not be loaded')).toBeInTheDocument();
  });

  it('re-runs the fetch when Retry is clicked (the recovery path a failed fetch previously lacked)', () => {
    const onRetry = vi.fn();
    render(<AdminErrorState onRetry={onRetry} message="boom" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders Hindi copy when isHi is set (P7)', () => {
    render(<AdminErrorState onRetry={() => {}} isHi />);
    expect(screen.getByText('डेटा लोड नहीं हो सका')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'फिर से कोशिश करें' })).toBeInTheDocument();
  });

  it('surfaces as an alert for assistive tech', () => {
    render(<AdminErrorState onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders a compact partial-failure banner with an inline Retry', () => {
    const onRetry = vi.fn();
    render(<AdminErrorState compact onRetry={onRetry} message="stats refresh failed" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('accepts a custom title override', () => {
    render(<AdminErrorState onRetry={() => {}} title="Failed to load dashboard data" message="x" />);
    expect(screen.getByText('Failed to load dashboard data')).toBeInTheDocument();
  });
});
