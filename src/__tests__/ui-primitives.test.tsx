import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Button,
  Textarea,
  Checkbox,
  Toggle,
  FormField,
  LockedCard,
} from '@/components/ui';

/**
 * Tests for Phase 5A quick-win primitives added to src/components/ui/index.tsx
 * Covers:
 *   - Button: new 'destructive' and 'link' variants + loading prop
 *   - Textarea, Checkbox, Toggle, FormField (new form primitives)
 *   - LockedCard (new grade/plan-gated surface)
 */

describe('Button — new variants', () => {
  it('renders destructive variant with danger token styling', () => {
    render(<Button variant="destructive">Delete account</Button>);
    const btn = screen.getByRole('button', { name: /delete account/i });
    expect(btn).toBeTruthy();
    // destructive uses inline style with var(--danger) — verify style attribute is set
    expect(btn.getAttribute('style') || '').toMatch(/danger|#DC2626/i);
  });

  it('renders link variant without padding', () => {
    render(<Button variant="link">Learn more</Button>);
    const btn = screen.getByRole('button', { name: /learn more/i });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('style') || '').toContain('padding');
  });

  it('loading prop disables the button and exposes aria-busy', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Save
      </Button>
    );
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('primary variant still works (backwards compatible)', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Textarea', () => {
  it('renders label bound by htmlFor/id', () => {
    render(<Textarea label="Your feedback" id="fb" />);
    const ta = screen.getByLabelText(/your feedback/i);
    expect(ta).toBeTruthy();
    expect(ta.tagName).toBe('TEXTAREA');
  });

  it('shows error message with role=alert and aria-invalid', () => {
    render(<Textarea label="Notes" error="Too short" />);
    const err = screen.getByRole('alert');
    expect(err.textContent).toContain('Too short');
    const ta = screen.getByLabelText(/notes/i);
    expect(ta.getAttribute('aria-invalid')).toBe('true');
  });

  it('falls back to helperText when no error', () => {
    render(<Textarea label="Notes" helperText="Up to 500 characters" />);
    expect(screen.getByText(/up to 500 characters/i)).toBeTruthy();
  });
});

describe('Checkbox', () => {
  it('toggles checked state via onChange', () => {
    const onChange = vi.fn();
    render(<Checkbox label="I agree" checked={false} onChange={onChange} />);
    const cb = screen.getByLabelText(/i agree/i) as HTMLInputElement;
    expect(cb.type).toBe('checkbox');
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('respects disabled prop', () => {
    const onChange = vi.fn();
    render(
      <Checkbox label="Opt in" checked={false} onChange={onChange} disabled />
    );
    const cb = screen.getByLabelText(/opt in/i) as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });
});

describe('Toggle', () => {
  it('renders as switch with correct aria-checked', () => {
    render(<Toggle label="Notifications" checked onChange={() => {}} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('calls onChange with inverted value when clicked', () => {
    const onChange = vi.fn();
    render(<Toggle label="Sound" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    render(
      <Toggle label="Sound" checked={false} onChange={onChange} disabled />
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('FormField', () => {
  it('renders label + children + helperText', () => {
    render(
      <FormField label="Email" htmlFor="email" helperText="We never spam">
        <input id="email" type="email" />
      </FormField>
    );
    expect(screen.getByText(/email/i)).toBeTruthy();
    expect(screen.getByText(/we never spam/i)).toBeTruthy();
  });

  it('shows required marker when required', () => {
    render(
      <FormField label="Password" required>
        <input type="password" />
      </FormField>
    );
    // Required marker is an asterisk rendered as aria-hidden span
    const label = screen.getByText(/password/i);
    expect(label.textContent).toContain('*');
  });

  it('prefers error over helperText when both are present', () => {
    render(
      <FormField
        label="Grade"
        helperText="Pick your grade"
        error="Grade is required"
      >
        <input />
      </FormField>
    );
    expect(screen.getByRole('alert').textContent).toContain('Grade is required');
    expect(screen.queryByText(/pick your grade/i)).toBeNull();
  });
});

describe('LockedCard', () => {
  it('renders title, reason, and locked label', () => {
    render(
      <LockedCard
        title="Mock Exam"
        reason="Unlocks when you reach grade 9"
        variant="grade"
      />
    );
    expect(screen.getByText(/mock exam/i)).toBeTruthy();
    expect(screen.getByText(/unlocks when you reach grade 9/i)).toBeTruthy();
    expect(screen.getByText(/unlocks later/i)).toBeTruthy();
  });

  it('plan variant shows Premium label', () => {
    render(
      <LockedCard
        title="Advanced Simulations"
        reason="Available on Pro plan"
        variant="plan"
      />
    );
    expect(screen.getByText(/premium/i)).toBeTruthy();
  });

  it('fires onAction when action button is clicked', () => {
    const onAction = vi.fn();
    render(
      <LockedCard
        title="PYQ Papers"
        reason="Locked"
        actionLabel="See what unlocks next"
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /see what unlocks next/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders without action when only title+reason given', () => {
    render(<LockedCard title="Feature" reason="Coming soon" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});