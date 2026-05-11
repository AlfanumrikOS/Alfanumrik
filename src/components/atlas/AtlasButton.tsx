/**
 * AtlasButton — the only button primitive used across Atlas surfaces.
 *
 * Three variants:
 *   primary — burnt-orange filled, the page CTA. ONE per page.
 *   ink     — deep-ink filled, for secondary actions that still matter.
 *   ghost   — transparent with a quiet border, for tertiary or paired actions.
 *
 * Renders as <button> by default. Pass `as="a"` + `href` for nav-style use
 * (and the icon-right pattern still works).
 */

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';
import { AtlasIcon, type AtlasIconName } from './AtlasIcon';

type CommonProps = {
  variant?: 'primary' | 'ink' | 'ghost';
  icon?: AtlasIconName;
  iconPosition?: 'left' | 'right';
  iconSize?: number;
  children: ReactNode;
};

type AsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button' };
type AsAnchor = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { as: 'a' };

export type AtlasButtonProps = AsButton | AsAnchor;

export function AtlasButton(props: AtlasButtonProps) {
  const {
    variant = 'primary',
    icon,
    iconPosition = 'right',
    iconSize = 18,
    children,
    className,
    as,
    ...rest
  } = props as CommonProps & { className?: string; as?: 'button' | 'a' };

  const cls = clsx(
    'atlas-btn',
    variant === 'primary' && 'atlas-btn-primary',
    variant === 'ink'     && 'atlas-btn-ink',
    variant === 'ghost'   && 'atlas-btn-ghost',
    className,
  );

  const iconNode = icon ? <AtlasIcon name={icon} size={iconSize} /> : null;

  const inner = (
    <>
      {iconPosition === 'left' && iconNode}
      <span>{children}</span>
      {iconPosition === 'right' && iconNode}
    </>
  );

  if (as === 'a') {
    return (
      <a className={cls} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {inner}
      </a>
    );
  }
  return (
    <button className={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {inner}
    </button>
  );
}

export default AtlasButton;
