/**
 * EditorialHeadline — the one Fraunces moment per page.
 *
 * Rules from MULTI_ROLE_REDESIGN.md:
 *   - Exactly ONE editorial headline per page.
 *   - Fraunces 400-weight, italic for emphasis runs.
 *   - Inline `<em>` paints with --teal-deep for editorial weight.
 *   - `highlightStart`/`highlightEnd` wrap a span in --accent-soft
 *     for the burnt-orange underglow used on the verdict line.
 *
 * Props are deliberately simple — for richer copy with multiple
 * highlights, drop down to JSX with <em> + <span className="atlas-editorial-highlight">.
 */

import type { CSSProperties, ReactNode } from 'react';
import { clsx } from 'clsx';

export interface EditorialHeadlineProps {
  children: ReactNode;
  /** When provided, renders as a single line with the highlight applied. */
  className?: string;
  /** Visual size: lg = full editorial moment (32-44px), md = section header (22-28px). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Override the HTML tag. Default <h1> for `lg`, <h2> otherwise. */
  as?: 'h1' | 'h2' | 'h3' | 'p';
  style?: CSSProperties;
  id?: string;
}

const SIZE_STYLES: Record<NonNullable<EditorialHeadlineProps['size']>, CSSProperties> = {
  sm: { fontSize: 'clamp(18px, 1.6vw, 22px)', lineHeight: 1.25 },
  md: { fontSize: 'clamp(22px, 2.2vw, 28px)', lineHeight: 1.22 },
  lg: { fontSize: 'clamp(28px, 3.4vw, 44px)', lineHeight: 1.18 },
  xl: { fontSize: 'clamp(34px, 4vw, 52px)',   lineHeight: 1.05 },
};

export function EditorialHeadline({
  children,
  className,
  size = 'lg',
  as,
  style,
  id,
}: EditorialHeadlineProps) {
  const Tag = as ?? (size === 'xl' || size === 'lg' ? 'h1' : 'h2');
  return (
    <Tag
      id={id}
      className={clsx('atlas-editorial', className)}
      style={{ ...SIZE_STYLES[size], ...style }}
    >
      {children}
    </Tag>
  );
}

/**
 * `<EditorialHighlight>` — convenience wrapper so callers don't have to
 * remember the class name. Use inside an `<EditorialHeadline>` to paint
 * the burnt-orange underglow:
 *
 *   <EditorialHeadline>
 *     Aanya is having a <em>strong week</em>, but
 *     <EditorialHighlight>English needs attention</EditorialHighlight>.
 *   </EditorialHeadline>
 */
export function EditorialHighlight({ children }: { children: ReactNode }) {
  return <span className="atlas-editorial-highlight">{children}</span>;
}

export default EditorialHeadline;
