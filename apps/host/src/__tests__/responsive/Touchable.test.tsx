import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { Touchable } from '@alfanumrik/ui/responsive/Touchable';

/**
 * Touchable — accessible tap primitive tests (2026-05-19).
 *
 * Covers:
 *   - Default min hit area (44px) applies via the .touchable class
 *   - Size variants emit the right utility classes
 *   - Renders as <button> by default, <a> when as="a"
 *   - onClick is forwarded and called with the synthetic event
 *   - aria-label / disabled / type attrs pass through
 *   - Haptic opt-in calls navigator.vibrate where supported
 */

describe('<Touchable />', () => {
  it('renders a <button> by default with the .touchable class', () => {
    render(<Touchable label="tap me">Tap</Touchable>);
    const btn = screen.getByRole('button', { name: 'tap me' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.className).toContain('touchable');
    // Default size 'min' should NOT add a size-modifier class.
    expect(btn.className).not.toContain('touchable--comfort');
    expect(btn.className).not.toContain('touchable--large');
    expect(btn.className).not.toContain('touchable--hero');
  });

  it('applies size modifier classes for each variant', () => {
    const { rerender } = render(
      <Touchable label="t1" size="comfort">x</Touchable>,
    );
    expect(screen.getByRole('button').className).toContain('touchable--comfort');

    rerender(<Touchable label="t2" size="large">x</Touchable>);
    expect(screen.getByRole('button').className).toContain('touchable--large');

    rerender(<Touchable label="t3" size="hero">x</Touchable>);
    expect(screen.getByRole('button').className).toContain('touchable--hero');
  });

  it('renders as <a> when as="a" is set, with the href passed through', () => {
    render(
      <Touchable as="a" href="/dashboard" label="go home">
        Home
      </Touchable>,
    );
    const link = screen.getByRole('link', { name: 'go home' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/dashboard');
    expect(link.className).toContain('touchable');
  });

  it('forwards onClick and fires exactly once', () => {
    const onClick = vi.fn();
    render(<Touchable label="press" onClick={onClick}>Press</Touchable>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('honors disabled', () => {
    const onClick = vi.fn();
    render(
      <Touchable label="off" disabled onClick={onClick}>
        Disabled
      </Touchable>,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults button type to "button" (no accidental form submits)', () => {
    render(<Touchable label="safe">x</Touchable>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('passes aria-label through verbatim', () => {
    render(<Touchable label="custom label">x</Touchable>);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('custom label');
  });

  it('calls navigator.vibrate when haptic=true and the API is available', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
    });
    render(<Touchable label="buzz" haptic>x</Touchable>);
    fireEvent.click(screen.getByRole('button'));
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('passes a numeric haptic value through to navigator.vibrate', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
    });
    render(<Touchable label="buzz" haptic={42}>x</Touchable>);
    fireEvent.click(screen.getByRole('button'));
    expect(vibrate).toHaveBeenCalledWith(42);
  });

  it('does not throw when navigator.vibrate is missing (iOS Safari)', () => {
    // Strip vibrate to simulate iOS Safari.
    Object.defineProperty(navigator, 'vibrate', {
      value: undefined,
      configurable: true,
    });
    expect(() => {
      render(<Touchable label="ok" haptic>x</Touchable>);
      fireEvent.click(screen.getByRole('button'));
    }).not.toThrow();
  });

  it('merges custom className with the touchable class', () => {
    render(<Touchable label="x" className="text-orange-500">x</Touchable>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('touchable');
    expect(btn.className).toContain('text-orange-500');
  });
});
