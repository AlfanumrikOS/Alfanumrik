import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Breadcrumbs — sub-page navigation primitive tests (2026-05-19).
 *
 * Covers:
 *   - Renders the parent label as a clickable back button
 *   - Current screen label is rendered in plain text (not a button)
 *   - aria-label includes both parent and current label
 *   - Default parentHref is '/dashboard'
 *   - Custom parentHref overrides the default
 *   - Back button is a real button (keyboard-reachable)
 *   - Back button click pushes to the parent route
 */

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { Breadcrumbs } from '@alfanumrik/ui/responsive/Breadcrumbs';

describe('<Breadcrumbs />', () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it('renders a back button with the parent label', () => {
    render(<Breadcrumbs parentLabel="Home" label="Foxy" />);
    const back = screen.getByRole('button', { name: 'Back to Home' });
    expect(back.textContent).toContain('Home');
  });

  it('renders the current screen label as static text', () => {
    render(<Breadcrumbs parentLabel="Home" label="Foxy" />);
    // The current label appears as a span (not a button)
    expect(screen.getByText('Foxy')).toBeTruthy();
    // Sanity: there's only ONE button (the back button), not two.
    expect(screen.queryAllByRole('button')).toHaveLength(1);
  });

  it('aria-label on the nav includes both parent and current', () => {
    render(<Breadcrumbs parentLabel="Home" label="Foxy" />);
    const nav = screen.getByRole('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb: Home / Foxy');
  });

  it('default back navigates to /dashboard', () => {
    render(<Breadcrumbs parentLabel="Home" label="Profile" />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(pushMock).toHaveBeenCalledWith('/dashboard');
  });

  it('custom parentHref overrides the default', () => {
    render(<Breadcrumbs parentLabel="Learn" parentHref="/learn" label="Chapter 3" />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Learn' }));
    expect(pushMock).toHaveBeenCalledWith('/learn');
  });

  it('renders the back button at the .app-breadcrumbs__back utility', () => {
    const { container } = render(
      <Breadcrumbs parentLabel="Home" label="Foxy" />,
    );
    const back = container.querySelector('.app-breadcrumbs__back');
    expect(back).not.toBeNull();
    expect((back as HTMLElement).tagName).toBe('BUTTON');
  });
});
