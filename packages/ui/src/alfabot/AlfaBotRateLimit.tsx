'use client';

/**
 * AlfaBotRateLimit — System banner shown above the input when the route
 * 429s. Renders a live countdown plus a prominent escape hatch nudge.
 *
 * The banner clears itself once `rateLimitedUntil` is in the past — we use a
 * 1s interval to drive the countdown copy and to flip the banner off
 * automatically when the bucket resets.
 */

import { useEffect, useState } from 'react';
import { useAlfaBot } from './AlfaBotProvider';
import { useWelcomeV2 } from '@alfanumrik/ui/landing/WelcomeV2Context';
import s from './alfabot.module.css';

function formatSeconds(s: number): string {
  if (s <= 0) return '0s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

export default function AlfaBotRateLimit() {
  const { rateLimitedUntil } = useAlfaBot();
  const { t } = useWelcomeV2();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!rateLimitedUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [rateLimitedUntil]);

  if (!rateLimitedUntil) return null;
  const remaining = Math.max(0, Math.round((rateLimitedUntil.getTime() - now) / 1000));
  if (remaining <= 0) return null;

  return (
    <div className={s.rateLimitBanner} role="alert">
      <span>
        {t(
          'Too many quick messages. Take a breather — back soon.',
          'थोड़ा रुकें — संदेश ज़्यादा हो गए हैं। जल्द लौटें।',
        )}
      </span>
      <span className={s.rateLimitCountdown} aria-label={t('Time remaining', 'शेष समय')}>
        {formatSeconds(remaining)}
      </span>
    </div>
  );
}
