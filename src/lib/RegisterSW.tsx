'use client';

import { useEffect, useState } from 'react';

export default function RegisterSW() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // Check for updates periodically (every 60 min)
      const interval = setInterval(() => {
        registration.update().catch(() => {});
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
