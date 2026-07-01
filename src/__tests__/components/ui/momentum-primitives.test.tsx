import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PremiumCard, GlowButton, StatRing } from '@/components/ui';

/**
 * Focused unit tests for the three Alfa Momentum (Wave 0) primitives added to
 * src/components/ui/index.tsx. These are presentation-only, additive primitives
 * with three hard contracts (per their JSDoc + the Wave 0 change brief):
 *
 *   1. Token-driven: zero hardcoded hex. Colors/shadows/gradients reference CSS
 *      custom properties (var(--…)) or color-mix on a var — never a literal
 *      `#rrggbb`. (The only literal allowed is `#fff`/`#000` inside a color-mix
 *      mixing-anchor, which is not a brand color token. We assert no 6-digit hex.)
 *   2. Bilingual-safe: all copy (labels, center value, icons) is supplied by the
 *      caller — the component hardcodes no English. We pass Hindi + Latin copy and
 *      assert it renders verbatim.
 *   3. Reduced-motion-aware: motion is delivered through global animate-* classes
 *      that collapse under the prefers-reduced-motion block in globals.css, so
 *      there is nothing component-local to assert beyond "the class is present".
 *
 * JSDOM ignores CSS and has no layout, so we assert on DOM structure, rendered
 * text, ARIA, event wiring, and the *absence* of inline hardcoded brand hex —
 * not on computed visual styles.
 */

// Helper: collect every inline `style` attribute string in a subtree.
function inlineStyles(root: HTMLElement): string {
  return Array.from(root.querySelectorAll<HTMLElement>('[style]'))
    .map((el) => el.getAttribute('style') ?? '')
    .join(' | ');
}

// 6-digit hex brand-color literals are forbidden (these primitives are token-
// driven). `#fff`/`#000` 3-digit anchors inside color-mix() are allowed — they
// are mixing endpoints, not brand tokens.
const SIX_DIGIT_HEX = /#[0-9a-fA-F]{6}\b/;

describe('Momentum primitive — PremiumCard', () => {
  it('renders children', () => {
    render(<PremiumCard>Hello content</PremiumCard>);
    expect(screen.getByText('Hello content')).toBeInTheDocument();
  });

  it('renders bilingual caller-supplied copy verbatim (no hardcoded English)', () => {
    render(
      <PremiumCard>
        <span>आज का अभ्यास</span>
      </PremiumCard>,
    );
    expect(screen.getByText('आज का अभ्यास')).toBeInTheDocument();
  });

  it('applies glow, gradient, and hoverable variants together without crashing', () => {
    const { container } = render(
      <PremiumCard glow gradient hoverable>
        Variant body
      </PremiumCard>,
    );
    expect(screen.getByText('Variant body')).toBeInTheDocument();
    // hoverable adds the spring-lift utility class.
    expect(container.querySelector('.card-hover')).not.toBeNull();
  });

  it('passes through onClick and exposes a keyboard-accessible button role', () => {
    const onClick = vi.fn();
    render(<PremiumCard onClick={onClick}>Clickable</PremiumCard>);
    const card = screen.getByRole('button');
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
    // Enter / Space activate it too (it's a div-as-button).
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('is non-interactive (no button role) when onClick is omitted', () => {
    render(<PremiumCard>Static</PremiumCard>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses CSS-var-driven styling with no hardcoded 6-digit hex', () => {
    const { container } = render(
      <PremiumCard glow gradient>
        Token body
      </PremiumCard>,
    );
    const styles = inlineStyles(container);
    expect(styles).toContain('var(--');
    expect(styles).not.toMatch(SIX_DIGIT_HEX);
  });
});

describe('Momentum primitive — GlowButton', () => {
  it('renders caller-supplied label/children (bilingual-safe)', () => {
    render(<GlowButton>शुरू करें</GlowButton>);
    expect(screen.getByRole('button', { name: /शुरू करें/ })).toBeInTheDocument();
  });

  it('renders an icon slot alongside the label', () => {
    render(<GlowButton icon={<span data-testid="gb-icon">✨</span>}>Start</GlowButton>);
    expect(screen.getByTestId('gb-icon')).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('loading shows a spinner, hides the icon, sets aria-busy, and disables the button', () => {
    const { container } = render(
      <GlowButton loading icon={<span data-testid="gb-icon">✨</span>}>
        Saving
      </GlowButton>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    // Spinner is the animate-spin element; the icon is replaced by it while loading.
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByTestId('gb-icon')).toBeNull();
    // Caller label still renders.
    expect(screen.getByText('Saving')).toBeInTheDocument();
  });

  it('forwards onClick when enabled and respects the disabled prop', () => {
    const onClick = vi.fn();
    const { rerender } = render(<GlowButton onClick={onClick}>Go</GlowButton>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <GlowButton onClick={onClick} disabled>
        Go
      </GlowButton>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    // A disabled button does not fire click.
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies size-specific classes for the size prop', () => {
    const { container: sm } = render(<GlowButton size="sm">S</GlowButton>);
    expect(sm.querySelector('button')!.className).toContain('px-4');
    const { container: lg } = render(<GlowButton size="lg">L</GlowButton>);
    expect(lg.querySelector('button')!.className).toContain('px-8');
  });

  it('uses gradient/glow styling with no hardcoded 6-digit hex brand color', () => {
    const { container } = render(<GlowButton>Token</GlowButton>);
    const styles = inlineStyles(container);
    expect(styles).toContain('var(--orange');
    // #fff inside color-mix is an allowed 3-digit anchor; no 6-digit brand hex.
    expect(styles).not.toMatch(SIX_DIGIT_HEX);
  });
});

describe('Momentum primitive — StatRing', () => {
  it('renders the numeric value in the center by default', () => {
    render(<StatRing value={73} />);
    expect(screen.getByText('73%')).toBeInTheDocument();
  });

  it('clamps value above 100 down to 100', () => {
    render(<StatRing value={150} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '100%');
  });

  it('clamps value below 0 up to 0', () => {
    render(<StatRing value={-25} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '0%');
  });

  it('accepts caller-supplied center content (bilingual-safe override)', () => {
    render(<StatRing value={40}>1,240 अंक</StatRing>);
    expect(screen.getByText('1,240 अंक')).toBeInTheDocument();
    // The default "{value}%" text is suppressed when children are provided.
    expect(screen.queryByText('40%')).toBeNull();
  });

  it('applies a mastery-band color token by default (low/mid/high) — never hardcoded hex', () => {
    // low band (< 40) → var(--mastery-low)
    const { container: low } = render(<StatRing value={20} />);
    const lowStroke = low.querySelector('circle[stroke-linecap="round"]');
    expect(lowStroke?.getAttribute('stroke')).toBe('var(--mastery-low)');

    // mid band (40–69) → var(--mastery-mid)
    const { container: mid } = render(<StatRing value={55} />);
    expect(
      mid.querySelector('circle[stroke-linecap="round"]')?.getAttribute('stroke'),
    ).toBe('var(--mastery-mid)');

    // high band (>= 70) → var(--mastery-high)
    const { container: high } = render(<StatRing value={90} />);
    expect(
      high.querySelector('circle[stroke-linecap="round"]')?.getAttribute('stroke'),
    ).toBe('var(--mastery-high)');
  });

  it('accepts a custom color that overrides the mastery band', () => {
    const { container } = render(<StatRing value={20} color="var(--purple)" />);
    const stroke = container.querySelector('circle[stroke-linecap="round"]');
    // Custom color wins over the would-be low-band mastery token.
    expect(stroke?.getAttribute('stroke')).toBe('var(--purple)');
  });

  it('exposes the mastery-fill + score-reveal motion classes (reduced-motion handled globally)', () => {
    const { container } = render(<StatRing value={60} />);
    expect(container.querySelector('.animate-mastery-fill')).not.toBeNull();
    expect(container.querySelector('.animate-score-reveal')).not.toBeNull();
  });
});
