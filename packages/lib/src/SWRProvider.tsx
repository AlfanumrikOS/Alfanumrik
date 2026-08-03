'use client';

/**
 * Global SWR provider — mounts DEFAULT_CONFIG (./swr.tsx) as the app-wide
 * <SWRConfig> so every useSWR call site inherits sane defaults for Indian
 * mobile networks (bounded retries with 4xx short-circuit, 10s deduping,
 * revalidateOnFocus off) instead of SWR library defaults (unbounded error
 * retries, revalidateOnFocus: true, 2s deduping).
 *
 * Precedence: hooks that pass their own SWRConfiguration object (the hooks in
 * ./swr.tsx, teacher/use-teacher-data.ts, pulse/use-pulse.ts, per-page
 * overrides) still win — SWR shallow-merges hook-level config over this
 * context config per option. That override behavior is correct and expected.
 *
 * This is a client component so the server-component root layout
 * (apps/host/src/app/layout.tsx) can mount it. It renders no markup.
 */

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { DEFAULT_CONFIG } from './swr';

export function SWRProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={DEFAULT_CONFIG}>{children}</SWRConfig>;
}

export default SWRProvider;
