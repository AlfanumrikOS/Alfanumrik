'use client';

/**
 * FoxyPanelLauncher — tap-gated dynamic-import wrapper for FoxyPanel embeds.
 *
 * Phase 4 U1: the three student embed surfaces (dashboard, learn, quiz
 * results) must NOT pay the panel's JS cost on first paint. This launcher
 * renders only the compact CTA button until the student taps it; the panel
 * module is then dynamically imported (ssr:false) and mounted below.
 *
 * A regression test (`foxy-panel-no-static-embed.test.ts`) greps every
 * host page.tsx and asserts no static `@alfanumrik/ui/foxy-panel/*` import
 * exists — the only sanctioned entry-point for embeds is this launcher.
 *
 * NOTE: This module itself IS a static import target for host pages. The
 * launcher is tiny (button + useState + dynamic import) and does NOT pull
 * `useFoxyChat` / MessageList / MessageInput into the shared bundle — the
 * `next/dynamic` call defers those until the panel mounts.
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { FoxyPanelProps } from '@alfanumrik/ui/foxy-panel/FoxyPanel';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const FoxyPanelLazy = dynamic(() => import('@alfanumrik/ui/foxy-panel/FoxyPanel'), {
  ssr: false,
  loading: () => null,
});

export interface FoxyPanelLauncherProps extends FoxyPanelProps {
  /** Bilingual CTA label ({ en, hi }). Falls back to 🦊 "Ask Foxy". */
  ctaLabel?: { en: string; hi: string };
  /** Optional test-id override for the CTA button. */
  ctaTestId?: string;
  /** Optional className for the CTA button wrapper. */
  className?: string;
}

export default function FoxyPanelLauncher({
  ctaLabel,
  ctaTestId = 'foxy-panel-cta',
  className,
  ...panelProps
}: FoxyPanelLauncherProps) {
  const [open, setOpen] = useState(false);
  const label = ctaLabel ?? { en: '🦊 Ask Foxy', hi: '🦊 फॉक्सी से पूछो' };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={ctaTestId}
        className={
          className ??
          'inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-[0.98] shadow-sm'
        }
        style={{
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
          border: '1px solid var(--border)',
        }}
      >
        {panelProps.isHi ? label.hi : label.en}
      </button>
    );
  }

  return (
    <div className="h-[520px] w-full" data-testid="foxy-panel-mount">
      <FoxyPanelLazy {...panelProps} onClose={() => setOpen(false)} />
    </div>
  );
}
