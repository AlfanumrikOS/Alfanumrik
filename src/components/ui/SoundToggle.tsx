'use client';

import { useState } from 'react';
import { isSoundEnabled, setSoundEnabled, playSound } from '@/lib/sounds';

export default function SoundToggle({ isHi }: { isHi: boolean }) {
  const [enabled, setEnabled] = useState(isSoundEnabled);

  return (
    <button
      onClick={() => {
        const next = !enabled;
        setSoundEnabled(next);
        setEnabled(next);
        if (next) playSound('tap');
      }}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all"
      style={{
        background: enabled ? 'rgba(232,88,28,0.08)' : 'var(--surface-2)',
        border: `1px solid ${enabled ? 'rgba(232,88,28,0.2)' : 'var(--border)'}`,
        color: enabled ? 'var(--orange)' : 'var(--text-3)',
        minHeight: '44px',
        minWidth: '44px',
      }}
      aria-label={isHi ? 'ध्वनि टॉगल' : 'Sound toggle'}
      aria-pressed={enabled}
    >
      {enabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'}{' '}
      {isHi ? (enabled ? 'चालू' : 'बंद') : (enabled ? 'On' : 'Off')}
    </button>
  );
}
