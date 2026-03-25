'use client';

import { useState, useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════
   TalkToLearnButton — Pulsing mic button for voice interaction
   States: idle → listening → processing
   ═══════════════════════════════════════════════════════════════ */

interface TalkToLearnButtonProps {
  isListening: boolean;
  isSpeaking: boolean;
  isLoading: boolean;
  onTap: () => void;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function TalkToLearnButton({
  isListening,
  isSpeaking,
  isLoading,
  onTap,
  color = '#E8581C',
  size = 'md',
}: TalkToLearnButtonProps) {
  const [pulseScale, setPulseScale] = useState(1);

  // Pulse animation when listening
  useEffect(() => {
    if (!isListening) {
      setPulseScale(1);
      return;
    }
    let frame: number;
    let start = performance.now();
    const animate = (t: number) => {
      const elapsed = (t - start) / 1000;
      setPulseScale(1 + Math.sin(elapsed * 3) * 0.08);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [isListening]);

  const sizes = {
    sm: { btn: 40, icon: 18, ring: 52 },
    md: { btn: 52, icon: 22, ring: 68 },
    lg: { btn: 64, icon: 26, ring: 84 },
  };
  const s = sizes[size];

  const state = isListening ? 'listening' : isSpeaking ? 'speaking' : isLoading ? 'loading' : 'idle';

  const bgMap = {
    idle: `linear-gradient(135deg, ${color}, ${color}dd)`,
    listening: 'linear-gradient(135deg, #EF4444, #DC2626)',
    speaking: `linear-gradient(135deg, ${color}80, ${color}60)`,
    loading: `linear-gradient(135deg, ${color}60, ${color}40)`,
  };

  const iconMap = {
    idle: '🎤',
    listening: '⏹',
    speaking: '🔊',
    loading: '...',
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Outer pulse ring */}
      {isListening && (
        <>
          <div
            className="absolute rounded-full"
            style={{
              width: s.ring,
              height: s.ring,
              background: 'rgba(239, 68, 68, 0.15)',
              animation: 'pulse-ring 1.5s ease-out infinite',
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: s.ring + 16,
              height: s.ring + 16,
              background: 'rgba(239, 68, 68, 0.08)',
              animation: 'pulse-ring 1.5s ease-out infinite 0.3s',
            }}
          />
        </>
      )}

      <button
        onClick={onTap}
        disabled={isLoading}
        className="relative rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-60 shadow-lg"
        style={{
          width: s.btn,
          height: s.btn,
          background: bgMap[state],
          transform: `scale(${pulseScale})`,
          boxShadow: isListening
            ? '0 4px 24px rgba(239, 68, 68, 0.4)'
            : `0 4px 20px ${color}40`,
        }}
        aria-label={state === 'idle' ? 'Talk to learn' : state === 'listening' ? 'Stop listening' : 'Speaking'}
      >
        <span style={{ fontSize: s.icon }}>{iconMap[state]}</span>
      </button>
    </div>
  );
}
