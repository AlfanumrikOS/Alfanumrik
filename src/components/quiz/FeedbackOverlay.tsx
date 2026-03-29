'use client';

import { useEffect, useState } from 'react';
import type { FeedbackResult } from '@/lib/feedback-engine';

/**
 * Quiz Feedback Overlay
 *
 * Shows contextual Foxy reactions and combo counter during quiz.
 * Auto-dismisses after 1.5 seconds. Non-blocking — doesn't cover options.
 */

interface FeedbackOverlayProps {
  feedback: FeedbackResult | null;
  isHi: boolean;
}

export default function FeedbackOverlay({ feedback, isHi }: FeedbackOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<FeedbackResult | null>(null);

  useEffect(() => {
    if (!feedback) return;
    setCurrent(feedback);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(timer);
  }, [feedback]);

  if (!visible || !current) return null;

  const isCorrect = current.sound === 'correct' || current.sound === 'streak';
  const foxyText = isHi ? current.foxyLine.hi : current.foxyLine.en;

  return (
    <div
      className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
      style={{
        animation: 'feedbackSlideIn 0.3s ease-out',
      }}
    >
      {/* Combo counter */}
      {current.showCombo && (
        <div
          className="text-center mb-1"
          style={{
            animation: 'comboPulse 0.4s ease-out',
          }}
        >
          <span
            className="text-2xl font-black"
            style={{
              color: current.intensity === 'high' ? '#E8581C' : '#F5A623',
              textShadow: '0 2px 8px rgba(232,88,28,0.3)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {current.comboCount}x COMBO
          </span>
        </div>
      )}

      {/* Foxy reaction bubble */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
        style={{
          background: isCorrect
            ? 'rgba(22, 163, 74, 0.95)'
            : 'rgba(100, 100, 100, 0.9)',
          backdropFilter: 'blur(12px)',
          boxShadow: isCorrect
            ? '0 4px 20px rgba(22, 163, 74, 0.3)'
            : '0 4px 20px rgba(0, 0, 0, 0.15)',
          color: '#fff',
          maxWidth: 280,
        }}
      >
        <span className="text-lg flex-shrink-0">
          {isCorrect ? '🦊' : '🤔'}
        </span>
        <span className="text-sm font-semibold">{foxyText}</span>
      </div>

      <style jsx>{`
        @keyframes feedbackSlideIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-10px) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }
        @keyframes comboPulse {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
