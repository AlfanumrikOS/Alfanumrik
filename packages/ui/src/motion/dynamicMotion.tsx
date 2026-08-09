'use client';

import dynamic from 'next/dynamic';
import type { ComponentType, FC, ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════
   createMotionIsland — the safe-by-default framer-motion adoption path.

   THIS FILE CONTAINS NO STATIC framer-motion IMPORT. Its only static
   imports are `next/dynamic` and types; MotionProvider is reached
   through a dynamic `import()`, which webpack emits as a separate async
   chunk. So importing this module adds framer-motion to nothing —
   framer-motion is downloaded when the island first renders on the
   client, not before.

   What is NOT claimed: importing this module is not literally free. It
   costs the wrapper itself (a few hundred bytes) plus `next/dynamic`,
   which is already in every Next.js page's graph. The claim is
   specifically about framer-motion bytes.

   Contract:
     - `ssr: false`      framer-motion never enters the server bundle,
                         and the island's code is not part of the
                         importing module's eager chunk (P10). Whether
                         it also stays off the wire until interaction
                         depends on when you render the island — measure
                         your own page (README rule 4).
     - MotionProvider is resolved inside the SAME lazy boundary as the
       animated component, so the LazyMotion feature-split + `strict`
       guard always wrap it. An adopter cannot forget to add them.
       (Both are `import()`s awaited together; webpack decides whether
       that is one async chunk or two. What is guaranteed is the
       PAIRING — nothing renders until both have resolved — not the
       chunk count.)
     - `fallback` is REQUIRED and rendered while the chunk loads. Pass a
       SHAPE-MATCHED skeleton, not a spinner, so the layout does not
       reflow when the island arrives. (README rule 3 says a
       shape-matched fallback is always required; making the parameter
       required is how that rule is enforced rather than merely asked
       for.)

   P7: renders no copy of its own. `fallback` is a ReactNode supplied by
   the caller, so bilingual text stays the caller's responsibility.
   ═══════════════════════════════════════════════════════════════ */

export interface MotionIslandOptions {
  /**
   * Rendered while the island chunk downloads. REQUIRED — there is no
   * default, so the layout-shift decision cannot be made by omission.
   *
   * Pass a shape-matched skeleton whose box matches the loaded island.
   * A spinner guarantees a layout shift. `null` is permitted only for
   * an island that reserves no layout space at all (a purely decorative
   * overlay); say so in the PR when you pass it.
   */
  fallback: ReactNode;
}

/**
 * Wrap an animated component in a lazily-loaded, reduced-motion-aware,
 * feature-split framer-motion boundary.
 *
 * The module passed to `loader` is the ONLY place allowed to import
 * framer-motion, and it must use the `m.*` proxy (never `motion.*` —
 * `strict` mode throws).
 *
 * @example
 * // MyThing.motion.tsx  — the animated leaf (its own chunk)
 * 'use client';
 * import { m } from 'framer-motion';
 * import { fadeIn } from '@alfanumrik/ui/motion';
 *
 * export default function MyThing({ label }: { label: string }) {
 *   return <m.div variants={fadeIn} initial="hidden" animate="visible">{label}</m.div>;
 * }
 *
 * // MyPage.tsx  — a client component
 * const MyThing = createMotionIsland(() => import('./MyThing.motion'), {
 *   fallback: <Skeleton className="h-24 w-full" />,
 * });
 */
export function createMotionIsland<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  options: MotionIslandOptions,
): ComponentType<P> {
  const { fallback } = options;

  return dynamic<P>(
    async () => {
      // Awaited together, so the provider can never be omitted and the
      // animated component never renders un-wrapped. (Chunk granularity
      // is webpack's call; the pairing is what this guarantees.)
      // This dynamic import is also the ONLY path to MotionProvider from
      // outside this directory — the barrel does not re-export it.
      const [mod, providerMod] = await Promise.all([
        loader(),
        import('./MotionProvider'),
      ]);

      const Animated = mod.default;
      const { MotionProvider } = providerMod;

      const MotionIsland: FC<P> = (props) => (
        <MotionProvider>
          <Animated {...props} />
        </MotionProvider>
      );

      MotionIsland.displayName = `MotionIsland(${
        Animated.displayName ?? 'Component'
      })`;

      return MotionIsland;
    },
    {
      ssr: false,
      loading: () => <>{fallback}</>,
    },
  );
}
