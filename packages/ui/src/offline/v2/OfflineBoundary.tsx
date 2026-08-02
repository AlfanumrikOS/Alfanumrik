'use client';

/**
 * OfflineBoundary — thin, ALWAYS-shipped shell over the student surface.
 *
 * P10 FIX (2026-08-02): this file used to contain the full offline-detection
 * logic (useOfflineState() + the OfflineState swap) directly, as a STATIC
 * import from `packages/ui/src/navigation/GlobalAppLayout.tsx`. Because
 * GlobalAppLayout wraps every route from the root layout, that static import
 * chain — useOfflineState() -> packages/lib/src/offline/store.ts (IndexedDB
 * open/eviction/write-queue/replay) — shipped in the ALWAYS-loaded shared JS
 * chunk for every page in the app (marketing, auth, every portal), even
 * though `ff_offline_v2` is seeded OFF. That regressed the P10 shared-JS
 * budget (CAP_SHARED_KB in scripts/check-bundle-size.mjs) and, via the
 * shared-chunk ratchet, every route that inherits the root layout.
 *
 * Fix: split the flag check from the offline-detection logic.
 *
 *   - THIS file (OfflineBoundary) does ONLY a cheap useFeatureFlags() read.
 *     It imports NOTHING from packages/lib/src/offline/ (no useOfflineState,
 *     no store.ts) and calls no offline-detection hook. When the flag is off
 *     OR still loading (flags is undefined on first render, both during SSR
 *     and the first client hydration pass — see below), it renders
 *     `children` immediately and directly. That is the fast path every page
 *     takes today, and it is exactly as cheap as rendering `children` with
 *     no boundary at all: useFeatureFlags() itself is already paid for
 *     elsewhere in the always-on bundle (AuthContext -> ./swr -> ./supabase
 *     is already a static chain off GlobalAppLayout's own useAuth() import),
 *     so adding this check here is ~0 marginal shared-JS cost.
 *
 *   - OfflineBoundaryActive.tsx (this directory) holds the real logic —
 *     useOfflineState(), the router, and the children/OfflineState swap. It
 *     is loaded via next/dynamic({ ssr: false }) and constructed ONLY once
 *     `flags.ff_offline_v2 === true`, so its module graph (and store.ts)
 *     never enters any bundle for the flag-off population, which today is
 *     everyone. ssr:false is safe specifically THERE (not here) because a
 *     logged-in student who already has the flag on is client-interactive by
 *     the time this branch is reached — see that file's header for the full
 *     argument, including why this never suppresses SSR content: `flags` is
 *     undefined on the server and on the first client render (SWR has not
 *     resolved yet), so both server and first client paint always take the
 *     `children` branch above, before hydration — no markup mismatch, and no
 *     regression from how this behaved before the split.
 *
 * MOUNT POINT: unchanged. Still mounted from
 * `packages/ui/src/navigation/GlobalAppLayout.tsx`, scoped to the logged-in
 * student surface — see the comment at that call site.
 */

import dynamic from 'next/dynamic';
import { useFeatureFlags } from '@alfanumrik/lib/swr';

const OfflineBoundaryActive = dynamic(() => import('./OfflineBoundaryActive'), {
  ssr: false,
});

export default function OfflineBoundary({
  children,
  isHi,
}: {
  children: React.ReactNode;
  isHi: boolean;
}) {
  const { data: flags } = useFeatureFlags();

  // Covers BOTH "flag off" and "flags payload hasn't resolved yet" (flags is
  // undefined while SWR is loading, including during SSR) — both take the
  // no-op fast path with zero offline-module code involved.
  if (flags?.ff_offline_v2 !== true) return <>{children}</>;

  return <OfflineBoundaryActive isHi={isHi}>{children}</OfflineBoundaryActive>;
}
