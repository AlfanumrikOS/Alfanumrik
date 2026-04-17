'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { MAINTENANCE_FLAGS } from '@/lib/feature-flags';

const DISMISS_KEY = 'alfanumrik_maintenance_dismissed';
const POLL_MS = 5 * 60 * 1000; // Re-check every 5 minutes

const DEFAULT_EN = 'We are performing scheduled maintenance. Some features may be temporarily unavailable.';
const DEFAULT_HI = 'हम अनुसूचित रखरखाव कर रहे हैं। कुछ सुविधाएँ अस्थायी रूप से अनुपलब्ध हो सकती हैं।';

interface FlagRow {
  is_enabled: boolean;
  metadata: { message_en?: string; message_hi?: string } | null;
}

export default function MaintenanceBanner() {
  const { isHi } = useAuth();
  const [flag, setFlag] = useState<FlagRow | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const { data } = await supabase
          .from('feature_flags')
          .select('is_enabled, metadata')
          .eq('flag_name', MAINTENANCE_FLAGS.MAINTENANCE_BANNER)
          .maybeSingle();
        if (active && data) setFlag(data as FlagRow);
      } catch { /* silent — banner is non-critical */ }
    }

    // Check if previously dismissed this session
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === 'true') {
        setDismissed(true);
      }
    } catch { /* private mode */ }

    check();
    const interval = setInterval(check, POLL_MS);
    return () => { active = false; clearInterval(interval); };
  }, []);

  if (!flag?.is_enabled || dismissed) return null;

  const message = isHi
    ? (flag.metadata?.message_hi || DEFAULT_HI)
    : (flag.metadata?.message_en || DEFAULT_EN);

  function handleDismiss() {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, 'true'); } catch { /* private mode */ }
  }

  return (
    <div
      role="alert"
      aria-label={isHi ? 'रखरखाव सूचना' : 'Maintenance notice'}
      className="w-full bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-center gap-2 text-amber-900 text-xs sm:text-sm font-medium relative"
      style={{ zIndex: 9998 }}
    >
      {/* Warning icon */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-shrink-0">
        <path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>

      <span className="text-center leading-snug">{message}</span>

      <button
        onClick={handleDismiss}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-amber-200/50 transition-colors"
        style={{ minWidth: 44, minHeight: 44 }}
        aria-label={isHi ? 'बंद करें' : 'Dismiss'}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="mx-auto">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
