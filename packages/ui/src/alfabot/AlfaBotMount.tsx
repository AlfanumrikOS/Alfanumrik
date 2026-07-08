'use client';

/**
 * AlfaBotMount — Top-level wrapper that gates the entire widget on the
 * ff_alfabot_v1 feature flag.
 *
 * Flow:
 *   1. On mount, fetch GET /api/feature-flags/check?flag=ff_alfabot_v1.
 *   2. If `enabled === true`, mount the AlfaBotProvider + AlfaBotLauncher.
 *   3. If `enabled === false` (or the probe fails), render nothing. Silent
 *      not-mount per PR-3 spec.
 *
 * Bundle posture (P10):
 *   This file is in the launcher chunk and is tiny. The provider + launcher
 *   are imported eagerly inside the same chunk (they're both lean). The
 *   heavy panel is dynamic-imported by the launcher.
 *
 * We DO NOT use SWR here — the flag value rarely changes during a session
 * and we want zero extra dependencies in the launcher chunk.
 */

import { useEffect, useState } from 'react';
import { AlfaBotProvider } from './AlfaBotProvider';
import AlfaBotLauncher from './AlfaBotLauncher';

const FLAG_NAME = 'ff_alfabot_v1';

export default function AlfaBotMount() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/feature-flags/check?flag=${FLAG_NAME}`, {
          credentials: 'omit',
        });
        if (!res.ok) {
          if (!cancelled) setEnabled(false);
          return;
        }
        const body = (await res.json()) as { enabled?: boolean };
        if (!cancelled) setEnabled(Boolean(body?.enabled));
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled !== true) return null;

  return (
    <AlfaBotProvider>
      <AlfaBotLauncher />
    </AlfaBotProvider>
  );
}
