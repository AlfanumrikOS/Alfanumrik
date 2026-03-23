'use client';

import { useState, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

const STORAGE_KEY = 'alfanumrik_cookie_consent';

export default function CookieConsent() {
  const [consent, setConsent] = useState<'pending' | 'all' | 'essential'>('pending');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'all' || saved === 'essential') {
      setConsent(saved);
    }
  }, []);

  const accept = (level: 'all' | 'essential') => {
    localStorage.setItem(STORAGE_KEY, level);
    setConsent(level);
  };

  return (
    <>
      {consent === 'all' && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}

      {mounted && consent === 'pending' && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: 'var(--surface-1, #fff)',
            borderTop: '1px solid var(--border, #e5e7eb)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            boxShadow: '0 -2px 12px rgba(0,0,0,0.08)',
            fontFamily: 'var(--font-body, sans-serif)',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--text-2, #555)', margin: 0, flex: 1, minWidth: 200 }}>
            We use cookies to improve your experience.{' '}
            <a href="/privacy" style={{ color: '#E8590C', textDecoration: 'underline', fontWeight: 600 }}>
              Privacy Policy
            </a>
          </p>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => accept('essential')}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: '1px solid var(--border, #e5e7eb)',
                background: 'var(--surface-2, #f5f5f5)',
                color: 'var(--text-2, #555)',
                cursor: 'pointer',
              }}
            >
              Essential Only
            </button>
            <button
              onClick={() => accept('all')}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                background: 'linear-gradient(135deg, #E8590C, #D94A0C)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Accept All
            </button>
          </div>
        </div>
      )}
    </>
  );
}
