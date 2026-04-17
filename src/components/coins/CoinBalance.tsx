'use client';

import { useState, useEffect, useRef } from 'react';

/* ─── Props ─────────────────────────────────────────────── */

interface CoinBalanceProps {
  balance: number;
  recentEarning?: number;  // triggers "+N" animation when set
  isHi: boolean;
}

/* ─── Component ─────────────────────────────────────────── */

export default function CoinBalance({ balance, recentEarning, isHi }: CoinBalanceProps) {
  const [showEarning, setShowEarning] = useState(false);
  const prevEarningRef = useRef<number | undefined>(undefined);

  // Trigger the "+N" animation when recentEarning changes to a positive value
  useEffect(() => {
    if (
      recentEarning !== undefined &&
      recentEarning > 0 &&
      recentEarning !== prevEarningRef.current
    ) {
      setShowEarning(true);
      const timer = setTimeout(() => setShowEarning(false), 1500);
      prevEarningRef.current = recentEarning;
      return () => clearTimeout(timer);
    }
  }, [recentEarning]);

  return (
    <div
      className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid rgba(245, 158, 11, 0.20)',
      }}
      role="status"
      aria-label={
        isHi
          ? `${balance} फॉक्सी सिक्के`
          : `${balance} Foxy Coins`
      }
    >
      {/* Coin icon */}
      <span
        className="flex items-center justify-center rounded-full text-xs font-bold leading-none flex-shrink-0"
        style={{
          width: 20,
          height: 20,
          background: 'linear-gradient(135deg, #F59E0B, #D97706)',
          color: '#FFFFFF',
          fontSize: 11,
        }}
        aria-hidden="true"
      >
        F
      </span>

      {/* Balance number */}
      <span
        className="text-sm font-bold tabular-nums"
        style={{
          color: '#D97706',
          fontFamily: 'var(--font-display)',
        }}
      >
        {balance.toLocaleString('en-IN')}
      </span>

      {/* Animated "+N" bubble */}
      {showEarning && recentEarning !== undefined && recentEarning > 0 && (
        <span
          className="absolute -top-3 -right-1 text-xs font-bold pointer-events-none"
          style={{
            color: '#10B981',
            animation: 'coinEarningRise 1.5s ease-out forwards',
          }}
          aria-live="polite"
        >
          +{recentEarning}
        </span>
      )}

      {/* Keyframes for the earning animation — scoped inline via style tag.
          This avoids adding a global keyframe for a tiny nav-bar component. */}
      <style jsx>{`
        @keyframes coinEarningRise {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translateY(-18px);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
