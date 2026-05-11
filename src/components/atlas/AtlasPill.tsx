/**
 * AtlasPill — chip primitive used across all four role surfaces.
 *
 * Five tones available; default is "neutral" (cream on cream). Same
 * sizing on every variant — tone only changes background/border/color.
 *
 * Common uses:
 *   <AtlasPill tone="teal">Week of May 5–11</AtlasPill>
 *   <AtlasPill tone="accent" icon="flame">11 day streak</AtlasPill>
 *   <AtlasPill tone="green" icon="arrow-up">+4%</AtlasPill>
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';
import { AtlasIcon, type AtlasIconName } from './AtlasIcon';

export interface AtlasPillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: 'neutral' | 'accent' | 'teal' | 'gold' | 'green' | 'red';
  icon?: AtlasIconName;
  children: ReactNode;
}

export function AtlasPill({
  tone = 'neutral',
  icon,
  className,
  children,
  ...rest
}: AtlasPillProps) {
  return (
    <span
      className={clsx(
        'atlas-pill',
        tone === 'accent' && 'atlas-pill-accent',
        tone === 'teal'   && 'atlas-pill-teal',
        tone === 'gold'   && 'atlas-pill-gold',
        tone === 'green'  && 'atlas-pill-green',
        tone === 'red'    && 'atlas-pill-red',
        className,
      )}
      {...rest}
    >
      {icon && <AtlasIcon name={icon} size={12} strokeWidth={1.8} />}
      {children}
    </span>
  );
}

export default AtlasPill;
