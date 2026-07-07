'use client';

/**
 * Touchable — accessible tap primitive (2026-05-19).
 *
 * Why this exists: Tailwind doesn't ship a primitive that guarantees a
 * 44x44px hit area even when the visual is smaller. On dense layouts
 * (badge buttons, chips, icon-only actions) developers tend to ship
 * sub-44px tap targets that violate Apple HIG / Material a11y. Touchable
 * solves this with padding-based expansion: the visual stays its native
 * size, the hit area expands transparently behind it.
 *
 * Design rationale:
 *   - 44x44px min by default (Apple HIG). Bumps to 48px on coarse pointers
 *     (touchscreens) via the .touchable utility in globals.css.
 *   - Active press visual via CSS only (scale 0.96) — no JS animation lib.
 *   - Hover styling gated behind (hover: hover) media query so it never
 *     shows on touch devices (avoids the "sticky hover" bug on mobile).
 *   - Optional haptic feedback via the Vibration API where supported. We
 *     intentionally do NOT polyfill — iOS Safari doesn't expose vibration
 *     and that's fine; the visual press provides enough feedback.
 *   - Renders as a <button> by default; pass `as="a"` for navigation use.
 *   - Forwards aria-* + data-* props so the consumer keeps full a11y
 *     control.
 *
 * P7 (bilingual): no internal user-facing strings — caller provides
 * children and aria-label.
 * P10 (bundle): pure CSS-driven. No client-side state, no effect hooks
 * (other than the one-shot vibration trigger which is opt-in).
 */

import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type AnchorHTMLAttributes,
  type MouseEvent,
  forwardRef,
} from 'react';
import { clsx } from 'clsx';

/** Tap-area size variants — maps to CSS custom properties. */
export type TouchableSize = 'min' | 'comfort' | 'large' | 'hero';

interface TouchableBaseProps {
  /** Tap-area size. Default = 'min' (44px Apple HIG). */
  size?: TouchableSize;
  /** Visual content of the button. */
  children: ReactNode;
  /** Required accessible label (used as aria-label when no text child). */
  label?: string;
  /** Trigger Navigator.vibrate() on press where supported. Off by default. */
  haptic?: boolean | number;
  /** Render as <a> instead of <button>. */
  as?: 'button' | 'a';
  /** Extra class names. */
  className?: string;
}

type TouchableButtonProps = TouchableBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & {
    as?: 'button';
  };

type TouchableAnchorProps = TouchableBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className'> & {
    as: 'a';
  };

export type TouchableProps = TouchableButtonProps | TouchableAnchorProps;

const SIZE_CLASS: Record<TouchableSize, string> = {
  min: 'touchable',
  comfort: 'touchable touchable--comfort',
  large: 'touchable touchable--large',
  hero: 'touchable touchable--hero',
};

function maybeVibrate(haptic: boolean | number | undefined) {
  if (!haptic) return;
  // Only Android Chrome / Firefox support this; iOS Safari is a no-op.
  // Guard against SSR + missing API.
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(typeof haptic === 'number' ? haptic : 10);
  } catch {
    /* non-fatal: some browsers throw if vibration is suspended */
  }
}

export const Touchable = forwardRef<HTMLButtonElement | HTMLAnchorElement, TouchableProps>(
  function Touchable(props, ref) {
    const { size = 'min', children, label, haptic, as = 'button', className, ...rest } = props;
    const classes = clsx(SIZE_CLASS[size], className);
    const handleClick = (e: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
      maybeVibrate(haptic);
      // Forward to the original onClick if provided. Type is awkward across
      // button + anchor; we tunnel through `unknown` to satisfy the union.
      const onClick = (rest as { onClick?: (event: MouseEvent<HTMLElement>) => void }).onClick;
      if (typeof onClick === 'function') onClick(e as unknown as MouseEvent<HTMLElement>);
    };
    if (as === 'a') {
      const anchorRest = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          aria-label={label}
          className={classes}
          {...anchorRest}
          onClick={handleClick}
        >
          {children}
        </a>
      );
    }
    const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type={buttonRest.type ?? 'button'}
        aria-label={label}
        className={classes}
        {...buttonRest}
        onClick={handleClick}
      >
        {children}
      </button>
    );
  },
);

export default Touchable;
