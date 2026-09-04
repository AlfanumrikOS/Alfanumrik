'use client';

import { type HTMLAttributes } from 'react';
import { cn } from '@alfanumrik/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   MasteryBadge — canonical primitive (Gate-2 B2)

   The discrete 5-level sibling of MasteryRing (ProgressRing.tsx): a
   compact status label for `concept_mastery.mastery_level` (a TEXT enum,
   distinct from `mastery_probability`, the 0-100 percentage MasteryRing
   bands into 3). Verified against LIVE production data (2026-09-04), not
   the design-doc's original assumption — real distinct values are
   beginner / developing / familiar / proficient / mastered. There is no
   stored "not started" value: a student with no concept_mastery row has
   no record at all, so callers render that absence themselves (e.g. by
   not rendering a badge) rather than through a level this component
   defines.

   Same non-colour-only discipline as MasteryRing: every level carries a
   REQUIRED icon + text label, never colour alone (deuteranopia-safe,
   design-system.md §2). Copy is overridable via `label` for Hindi (P7);
   the English default is used otherwise.
   ═══════════════════════════════════════════════════════════════ */

export type MasteryLevel = 'beginner' | 'developing' | 'familiar' | 'proficient' | 'mastered';

interface LevelMeta {
  /** Non-colour backup glyph — shape differs per level, matching MasteryRing's convention. */
  icon: string;
  /** Default English label. */
  label: string;
  varName: string;
}

const LEVELS: Record<MasteryLevel, LevelMeta> = {
  beginner:   { icon: '○', label: 'Beginner',   varName: '--mastery-level-0' },
  developing: { icon: '◔', label: 'Developing', varName: '--mastery-level-1' },
  familiar:   { icon: '◑', label: 'Familiar',   varName: '--mastery-level-2' },
  proficient: { icon: '◕', label: 'Proficient', varName: '--mastery-level-3' },
  mastered:   { icon: '●', label: 'Mastered',   varName: '--mastery-level-4' },
};

/** Stable low-to-high order, e.g. for legends or level pickers. */
export const MASTERY_LEVEL_ORDER: MasteryLevel[] = [
  'beginner',
  'developing',
  'familiar',
  'proficient',
  'mastered',
];

export interface MasteryBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  level: MasteryLevel;
  /** Localized label override (P7) — e.g. Hindi copy. Defaults to the English label. */
  label?: string;
}

export function MasteryBadge({ level, label, className, ...props }: MasteryBadgeProps) {
  const meta = LEVELS[level];
  const color = `var(${meta.varName})`;
  const text = label ?? meta.label;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-fluid-xs font-semibold leading-normal text-[color:var(--text-1)]',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 16%, var(--surface-1))`,
        borderColor: `color-mix(in srgb, ${color} 38%, transparent)`,
      }}
      {...props}
    >
      <span aria-hidden="true" style={{ color }}>
        {meta.icon}
      </span>
      {text}
    </span>
  );
}
