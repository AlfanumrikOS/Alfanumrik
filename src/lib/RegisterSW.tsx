'use client';

import { useEffect, useState } from 'react';

export default function RegisterSW() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // DEV ANTI-PATTERN GUARD:
    // Registering the PWA service worker during `next dev` lets it cache the JS
    // bundle and serve STALE code, so source changes "do nothing" across restarts.
    // In development we never register; instead we best-effort UNREGISTER any
    // previously-installed SW and purge its precaches so a developer who already
    // has a stale one gets unstuck on the next fresh load. Never throws; no-ops
    // when serviceWorker / caches are unavailable.
    if (process.env.NODE_ENV !== 'production') {
      (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        } catch {
          /* best-effort cleanup; ignore */
        }
        try {
          if (typeof window !== 'undefined' && 'caches' in window) {
            const keys = await window.caches.keys();
            await Promise.all(keys.map((k) => window.caches.delete(k)));
          }
        } catch {
          /* best-effort cleanup; ignore */
        }
      })();
      return;
    }

    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // Check for updates periodically (every 60 min)
      const interval = setInterval(() => {
        registration.update().catch((err: unknown) => {
          console.warn('[sw] service worker update check failed:', err instanceof Error ? err.message : String(err));
        });
      }, 60 * 60 * 1000);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }
        });
      });

      return () => clearInterval(interval);
    }).catch(console.error);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'var(--text-1, #1a1a1a)',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      <span>New version available</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: 'var(--orange, #E8581C)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Update
      </button>
    </div>
  );
}
