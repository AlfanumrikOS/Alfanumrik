'use client';

interface DemoModeBannerProps {
  isDemoUser: boolean;
  isHi?: boolean;
}

export default function DemoModeBanner({ isDemoUser, isHi }: DemoModeBannerProps) {
  if (!isDemoUser) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        padding: '6px 14px',
        borderRadius: 20,
        background: 'rgba(232, 88, 28, 0.9)',
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        zIndex: 50,
        pointerEvents: 'none',
        userSelect: 'none',
        letterSpacing: 0.3,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {isHi ? 'डेमो मोड' : 'Demo Mode'}
    </div>
  );
}
