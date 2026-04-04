'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';

export default function PWAInstallPrompt() {
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Only show on Android (not iOS, not desktop, not already installed)
    const isAndroid = /android/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem('pwa_install_dismissed');

    if (!isAndroid || isStandalone || dismissed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!showBanner) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = deferredPrompt as any;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setShowBanner(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa_install_dismissed', Date.now().toString());
  };

  return (
    <div className="pwa-install-banner">
      <span className="text-2xl" aria-hidden="true">🦊</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'Alfanumrik ऐप इंस्टॉल करो!' : 'Install Alfanumrik App!'}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'तेज़ एक्सेस, ऑफलाइन मोड' : 'Faster access, offline mode'}
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={handleInstall}>
        {isHi ? 'इंस्टॉल' : 'Install'}
      </Button>
      <button
        onClick={handleDismiss}
        className="text-lg leading-none"
        style={{ color: 'var(--text-3)', minHeight: '44px', minWidth: '44px' }}
        aria-label={isHi ? 'खारिज करें' : 'Dismiss'}
      >
        &times;
      </button>
    </div>
  );
}
