'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';

/**
 * NetworkStatus — Show offline banner for Indian students on flaky networks.
 *
 * This is critical for tier-2/3 cities where connectivity drops during study.
 * Duolingo shows a subtle offline indicator. We do the same, but bilingual.
 */
export default function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#1E293B',
        color: '#E2E8F0',
        padding: '8px 16px',
        fontSize: 12,
        fontWeight: 600,
        textAlign: 'center',
        fontFamily: 'var(--font-body)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 14 }}>📡</span>
      {isHi ? 'ऑफ़लाइन — कैश्ड डेटा दिख रहा है' : 'Offline — showing cached data'}
    </div>
  );
}
