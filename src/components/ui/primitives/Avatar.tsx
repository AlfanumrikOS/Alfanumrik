'use client';

import { forwardRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TONE_VAR } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Avatar — canonical primitive (Phase 2 Batch B3)

   A user/entity image with a graceful fallback. A11y contract:
     - a real <img> when `src` loads; on load ERROR (or no `src`) it
       falls back to initials derived from `name` (or `alt`).
     - `alt` is REQUIRED for a meaningful avatar; a purely decorative
       avatar passes `decorative` and the whole thing is aria-hidden.
     - optional status dot with a NON-colour backup: the dot carries an
       aria-label/title (`statusLabel`), so status is never colour-only.
   AvatarGroup stacks avatars with an overflow "+N" counter.

   All copy comes from props (alt / name / statusLabel) — P7.
   ═══════════════════════════════════════════════════════════════ */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarStatus = 'online' | 'offline' | 'away' | 'busy';

const SIZE: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-fluid-2xs',
  sm: 'h-8 w-8 text-fluid-xs',
  md: 'h-10 w-10 text-fluid-sm',
  lg: 'h-12 w-12 text-fluid-base',
  xl: 'h-16 w-16 text-fluid-lg',
};

const DOT_SIZE: Record<AvatarSize, string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
  xl: 'h-3.5 w-3.5',
};

/** Status → semantic tone var (the dot is backed by an aria-label too). */
const STATUS_VAR: Record<AvatarStatus, string> = {
  online: TONE_VAR.success,
  offline: TONE_VAR.neutral,
  away: TONE_VAR.warning,
  busy: TONE_VAR.danger,
};

/** Derive up to two initials from a display name (Latin or Devanagari). */
function initialsFrom(source: string | undefined): string {
  if (!source) return '';
  const words = source.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}

export interface AvatarProps {
  src?: string;
  /** Accessible name (REQUIRED unless `decorative`). Also seeds initials. */
  alt?: string;
  /** Explicit display name for the initials fallback (falls back to `alt`). */
  name?: string;
  size?: AvatarSize;
  /** Circle (default) or rounded square. */
  shape?: 'circle' | 'square';
  /** Optional presence dot. */
  status?: AvatarStatus;
  /** Non-colour backup for the status dot (aria-label + title) — P7. */
  statusLabel?: string;
  /** Mark the avatar purely decorative (hidden from assistive tech). */
  decorative?: boolean;
  className?: string;
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { src, alt, name, size = 'md', shape = 'circle', status, statusLabel, decorative = false, className },
  ref,
) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;
  const initials = initialsFrom(name ?? alt);
  const rounding = shape === 'circle' ? 'rounded-full' : 'rounded-lg';

  return (
    <span
      ref={ref}
      className={cn('relative inline-flex shrink-0', className)}
      aria-hidden={decorative || undefined}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden bg-surface-2 font-semibold text-foreground',
          rounding,
          SIZE[size],
        )}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={decorative ? '' : (alt ?? '')}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : initials ? (
          <span aria-hidden={decorative ? undefined : 'true'}>{initials}</span>
        ) : (
          <span aria-hidden="true" className="text-muted-foreground">?</span>
        )}
        {/* When the image failed / is absent, expose the name to SR via a
            visually-hidden span (unless decorative). */}
        {!showImage && !decorative && alt && <span className="sr-only">{alt}</span>}
      </span>
      {status && (
        <span
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
          className={cn(
            'absolute bottom-0 end-0 rounded-full ring-2 ring-surface-1',
            DOT_SIZE[size],
          )}
          style={{ backgroundColor: STATUS_VAR[status] }}
        />
      )}
    </span>
  );
});

export interface AvatarGroupProps {
  /** Avatars to stack (typically <Avatar> elements). */
  children: ReactNode;
  /** Max avatars shown before collapsing into a "+N" counter. */
  max?: number;
  size?: AvatarSize;
  /** Accessible name for the group (P7). */
  'aria-label'?: string;
  /** Localised "+N" formatter (P7). Default `n => \`+${n}\``. */
  overflowLabel?: (count: number) => ReactNode;
  className?: string;
}

export function AvatarGroup({
  children,
  max = 4,
  size = 'md',
  'aria-label': ariaLabel,
  overflowLabel = (n) => `+${n}`,
  className,
}: AvatarGroupProps) {
  const items = Array.isArray(children) ? children.flat() : [children];
  const shown = items.slice(0, Math.max(1, max));
  const overflow = items.length - shown.length;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex items-center', className)}
    >
      {shown.map((child, i) => (
        <span key={i} className={cn('rounded-full ring-2 ring-surface-1', i > 0 && '-ms-2')}>
          {child}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            '-ms-2 inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-foreground ring-2 ring-surface-1',
            SIZE[size],
          )}
        >
          {overflowLabel(overflow)}
        </span>
      )}
    </div>
  );
}
