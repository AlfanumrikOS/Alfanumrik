/**
 * src/lib/today/icon-map.ts — maps the resolver's opaque `iconHint` strings to
 * the emoji glyphs the rest of the app already uses for navigation/affordances
 * (see CORE_TABS / ActionTile / dashboard cards — all emoji-based). No icon
 * library is introduced; this keeps the Today surface visually consistent with
 * the existing design language and adds zero bundle weight.
 *
 * The hint set is the closed list produced by `mapActionToTodayItem`'s
 * `TYPE_PRESENTATION` table. Unknown hints fall back to a neutral spark glyph
 * so a future item type still renders something rather than a blank.
 */

const ICON_BY_HINT: Record<string, string> = {
  'play-resume':  '▶️',
  'compass':      '🧭',
  'cards-stack':  '🗂️',
  'refresh-book': '🔁',
  'target':       '🎯',
  'book-open':    '📖',
  'telescope':    '🔭',
  'scroll':       '📜',
};

/** Resolve an `iconHint` to its emoji glyph; neutral fallback for unknowns. */
export function todayIcon(iconHint: string): string {
  return ICON_BY_HINT[iconHint] ?? '✨';
}
