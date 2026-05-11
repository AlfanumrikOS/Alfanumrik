/**
 * AtlasIcon — single monoline icon primitive for the Editorial Atlas surfaces.
 *
 * Why this exists:
 *   The legacy chrome ships a mishmash of emoji, ASCII glyphs (`@`, `*`),
 *   and one-off SVGs scattered across components. The Atlas redesign
 *   ships one geometric monoline set, drawn inline so there's no icon-font
 *   request, no aria-hidden boilerplate, and no `import { FiHome } from
 *   'react-icons'` round-trip.
 *
 * Aesthetic choices:
 *   - Stroke 1.6 (not 2): heavier than hairline, lighter than chunky.
 *     Reads well at 14-22px which is the chrome range for Atlas surfaces.
 *   - Square viewBox 24x24: standard, eases swapping for Phosphor or
 *     Lucide later if the set outgrows what's inlined here.
 *   - Stroke colour = currentColor: tints from `color:` on the parent.
 *     Means a `text-[var(--ink-3)]` chip and a `text-[var(--accent)]` chip
 *     never need separate icon variants.
 *
 * Adding an icon: add a new case to ICONS below. Keep paths simple
 * (no fills, just strokes) so the geometric monoline language stays
 * coherent.
 */

import type { SVGProps } from 'react';

export type AtlasIconName =
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'check'
  | 'clock'
  | 'sparkle'
  | 'flame'
  | 'home'
  | 'graduation-cap'
  | 'mortarboard'
  | 'user'
  | 'users'
  | 'classroom'
  | 'school'
  | 'chevron-down'
  | 'chevron-right'
  | 'bell'
  | 'refresh'
  | 'send'
  | 'message'
  | 'plus'
  | 'document'
  | 'eye'
  | 'lightbulb'
  | 'compass'
  | 'calendar'
  | 'grid'
  | 'scan'
  | 'foxy'
  | 'fox'
  | 'menu'
  | 'close'
  | 'settings'
  | 'logout'
  | 'pin'
  | 'edit'
  | 'megaphone'
  | 'shield'
  | 'globe'
  | 'star';

const PATHS: Record<AtlasIconName, React.ReactNode> = {
  'arrow-right':   <><path d="M5 12h14" /><path d="M13 5l7 7-7 7" /></>,
  'arrow-up':      <><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></>,
  'arrow-down':    <><path d="M12 5v14" /><path d="M5 12l7 7 7-7" /></>,
  'check':         <path d="M5 13l4 4L19 7" />,
  'clock':         <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  'sparkle':       <><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="M6 6l2.5 2.5" /><path d="M15.5 15.5L18 18" /><path d="M6 18l2.5-2.5" /><path d="M15.5 8.5L18 6" /></>,
  'flame':         <path d="M12 3c1 2 3 3 3 6a3 3 0 11-6 0c0-1 .5-2 .5-3M7 14a5 5 0 1010 0c0-3-2-5-5-9-3 4-5 6-5 9z" />,
  'home':          <><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /></>,
  'graduation-cap':<><path d="M3 9.5L12 4l9 5.5-9 5.5-9-5.5z" /><path d="M7 12v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4" /></>,
  'mortarboard':   <><path d="M3 9.5L12 4l9 5.5-9 5.5-9-5.5z" /><path d="M7 12v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4" /></>,
  'user':          <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>,
  'users':         <><circle cx="9" cy="8" r="4" /><path d="M3 21c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="3" /><path d="M14 21c0-3 2.2-5 5-5s2 0 2 0" /></>,
  'classroom':     <><path d="M3 5h18v12H3z" /><path d="M3 17l4 4M21 17l-4 4" /><path d="M8 9h8M8 13h5" /></>,
  'school':        <><path d="M3 21h18M5 21V9l7-4 7 4v12M10 21v-5h4v5" /><circle cx="9" cy="12" r="0.5" /><circle cx="15" cy="12" r="0.5" /></>,
  'chevron-down':  <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'bell':          <><path d="M6 17V11a6 6 0 1112 0v6l2 2H4z" /><path d="M10 21h4" /></>,
  'refresh':       <><path d="M3 12a9 9 0 109-9v6" /><path d="M3 12l3 3M3 12l3-3" /></>,
  'send':          <><path d="M3 5h12l4 7-4 7H3z" /></>,
  'message':       <path d="M4 4h16v12H5l-1 4z" />,
  'plus':          <><path d="M12 4v16" /><path d="M4 12h16" /></>,
  'document':      <><path d="M14 3v6h6" /><path d="M14 3l6 6v12H4V3z" /></>,
  'eye':           <><path d="M21 12c-2 5-6 8-9 8s-7-3-9-8c2-5 6-8 9-8s7 3 9 8z" /><circle cx="12" cy="12" r="3" /></>,
  'lightbulb':     <><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 00-4 13c1 1 1 2 1 3h6c0-1 0-2 1-3a7 7 0 00-4-13z" /></>,
  'compass':       <><circle cx="12" cy="12" r="9" /><path d="M16 8l-2 6-6 2 2-6z" /></>,
  'calendar':      <><path d="M8 7V3M16 7V3M3 11h18" /><path d="M5 5h14v16H5z" /></>,
  'grid':          <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
  'scan':          <><path d="M3 7h18v10H3z" /><path d="M7 7V3h10v4" /></>,
  'foxy':          <><path d="M12 4c5 1 7 4 7 7 0 4-4 9-7 9s-7-5-7-9c0-3 2-6 7-7z" /><circle cx="9.5" cy="11.5" r="0.6" /><circle cx="14.5" cy="11.5" r="0.6" /><path d="M11 15c.5.5 1.5.5 2 0" /></>,
  'fox':           <><path d="M12 4c5 1 7 4 7 7 0 4-4 9-7 9s-7-5-7-9c0-3 2-6 7-7z" /></>,
  'menu':          <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
  'close':         <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  'settings':      <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06A2 2 0 114.27 16.96l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06A2 2 0 117.04 4.27l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></>,
  'logout':        <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  'pin':           <><circle cx="12" cy="12" r="3" /></>,
  'edit':          <><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" /><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
  'megaphone':     <><path d="M3 11l11-7v15L3 12z" /><path d="M14 7v9" /><path d="M19 9c1 1 1 4 0 5" /></>,
  'shield':        <><path d="M12 3l8 3v6c0 4.5-3 8.5-8 9-5-.5-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  'globe':         <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  'star':          <path d="M12 3l2.7 5.8 6.3.6-4.8 4.4 1.5 6.4L12 17l-5.7 3.2 1.5-6.4L3 9.4l6.3-.6z" />,
};

export interface AtlasIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: AtlasIconName;
  /** Pixel size — applied to both width and height. Default 18. */
  size?: number;
}

export function AtlasIcon({ name, size = 18, strokeWidth = 1.6, className, ...rest }: AtlasIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export default AtlasIcon;
