import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * AppShell — responsive shell primitive tests (2026-05-19).
 *
 * Covers:
 *   - Renders variant and rail-presence attributes for responsive CSS
 *   - Header / nav / children render in their respective slots
 *   - Rail is rendered only for 'rail' + 'split' variants
 *   - Aside is rendered only for 'split' variant AND when aside prop is passed
 *   - One-handed mode state toggles localStorage + data-one-hand attr
 *   - One-handed toggle button has bilingual aria-label
 *   - Restores one-handed pref from localStorage on mount
 */

// Mock AuthContext — only isHi is read by AppShell.
const authState = { isHi: false };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

import { AppShell } from '@alfanumrik/ui/responsive/AppShell';

describe('<AppShell />', () => {
  beforeEach(() => {
    authState.isHi = false;
    window.localStorage.clear();
  });

  it('renders children in the main content slot', () => {
    const { container } = render(
      <AppShell variant="mobile">
        <div data-testid="kid">Body</div>
      </AppShell>,
    );
    expect(screen.getByTestId('kid').textContent).toBe('Body');
    expect(container.querySelector('.app-shell-content')).toBeTruthy();
  });

  it('emits data-variant for the chosen variant', () => {
    const { container, rerender } = render(
      <AppShell variant="mobile">x</AppShell>,
    );
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-variant')).toBe('mobile');
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-has-rail')).toBe('false');

    rerender(<AppShell variant="rail">x</AppShell>);
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-variant')).toBe('rail');
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-has-rail')).toBe('true');

    rerender(<AppShell variant="split">x</AppShell>);
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-variant')).toBe('split');
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-has-rail')).toBe('true');
  });

  it('renders header content in the sticky header slot', () => {
    const { container } = render(
      <AppShell variant="mobile" header={<div data-testid="hdr">Hello</div>}>
        body
      </AppShell>,
    );
    const header = container.querySelector('.app-shell-header');
    expect(header).toBeTruthy();
    expect(screen.getByTestId('hdr').textContent).toBe('Hello');
  });

  it('renders nav content inside .app-shell-nav', () => {
    const { container } = render(
      <AppShell variant="mobile" nav={<div data-testid="nav">N</div>}>
        body
      </AppShell>,
    );
    const nav = container.querySelector('.app-shell-nav');
    expect(nav).toBeTruthy();
    expect(screen.getByTestId('nav').textContent).toBe('N');
  });

  it('does NOT render the rail slot for the mobile variant', () => {
    const { container } = render(
      <AppShell variant="mobile" rail={<div data-testid="r">R</div>}>
        body
      </AppShell>,
    );
    expect(container.querySelector('.app-shell-rail')).toBeNull();
    expect(screen.queryByTestId('r')).toBeNull();
  });

  it('renders the rail slot for the rail variant', () => {
    const { container } = render(
      <AppShell variant="rail" rail={<div data-testid="r">R</div>}>
        body
      </AppShell>,
    );
    expect(container.querySelector('.app-shell-rail')).toBeTruthy();
    expect(screen.getByTestId('r').textContent).toBe('R');
  });

  it('renders the aside slot ONLY for split variant + aside prop', () => {
    const { container, rerender } = render(
      <AppShell variant="split" aside={<div data-testid="a">A</div>}>
        body
      </AppShell>,
    );
    expect(container.querySelector('.app-shell-aside')).toBeTruthy();
    expect(screen.getByTestId('a').textContent).toBe('A');
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-no-aside')).toBe('false');

    // split without aside prop → no aside element + data-no-aside="true"
    rerender(<AppShell variant="split">body</AppShell>);
    expect(container.querySelector('.app-shell-aside')).toBeNull();
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-no-aside')).toBe('true');

    // mobile variant ignores aside prop
    rerender(<AppShell variant="mobile" aside={<div data-testid="a2">A2</div>}>body</AppShell>);
    expect(container.querySelector('.app-shell-aside')).toBeNull();
  });

  it('toggles one-handed mode on button click and writes to localStorage', () => {
    const { container } = render(<AppShell variant="mobile">body</AppShell>);
    const shell = container.querySelector('.app-shell-v2')!;
    expect(shell.getAttribute('data-one-hand')).toBe('false');
    const toggle = container.querySelector('.app-shell-onehand-toggle') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);
    expect(shell.getAttribute('data-one-hand')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('alfanumrik:one-hand')).toBe('true');

    fireEvent.click(toggle);
    expect(shell.getAttribute('data-one-hand')).toBe('false');
    expect(window.localStorage.getItem('alfanumrik:one-hand')).toBe('false');
  });

  it('exposes bilingual aria-label on the one-handed toggle', () => {
    const { container, rerender } = render(<AppShell variant="mobile">body</AppShell>);
    let toggle = container.querySelector('.app-shell-onehand-toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe('Enable one-handed mode');

    authState.isHi = true;
    rerender(<AppShell variant="mobile">body</AppShell>);
    toggle = container.querySelector('.app-shell-onehand-toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe('एक-हाथ मोड चालू करें');
  });

  it('restores one-handed pref from localStorage on mount', () => {
    window.localStorage.setItem('alfanumrik:one-hand', 'true');
    const { container } = render(<AppShell variant="mobile">body</AppShell>);
    const shell = container.querySelector('.app-shell-v2')!;
    expect(shell.getAttribute('data-one-hand')).toBe('true');
  });

  it('honors a custom localStorage key', () => {
    window.localStorage.setItem('custom:onehand', 'true');
    const { container } = render(
      <AppShell variant="mobile" oneHandKey="custom:onehand">
        body
      </AppShell>,
    );
    expect(container.querySelector('.app-shell-v2')?.getAttribute('data-one-hand')).toBe('true');
  });

  it('omits the one-handed toggle button when oneHandToggle=false', () => {
    const { container } = render(
      <AppShell variant="mobile" oneHandToggle={false}>
        body
      </AppShell>,
    );
    expect(container.querySelector('.app-shell-onehand-toggle')).toBeNull();
  });

  it('renders a <main> element for the content slot (a11y landmark)', () => {
    const { container } = render(<AppShell variant="mobile">body</AppShell>);
    const main = container.querySelector('main.app-shell-content');
    expect(main).toBeTruthy();
    expect(main?.getAttribute('id')).toBe('main');
  });
});
