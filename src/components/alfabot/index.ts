/**
 * AlfaBot — Public barrel export.
 *
 * Only `AlfaBotMount` is exported — the flag-gated top-level entry. All
 * other components (Provider, Launcher, Panel, Message, etc.) are internal
 * to this directory and consumed via relative imports.
 *
 * The mount component itself runs a client-side feature-flag probe via
 * /api/feature-flags/check and silently renders nothing when the flag is
 * off. Callers always render <AlfaBotMount /> unconditionally.
 *
 * Usage:
 *   const AlfaBotMount = dynamic(
 *     () => import('@/components/alfabot').then((m) => m.AlfaBotMount),
 *     { ssr: false, loading: () => null },
 *   );
 */

export { default as AlfaBotMount } from './AlfaBotMount';
