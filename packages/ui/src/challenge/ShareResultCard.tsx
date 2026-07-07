'use client';

import { useCallback } from 'react';
import { Button } from '@alfanumrik/ui/ui';
import { shareResult } from '@alfanumrik/lib/share';
import { playSound } from '@alfanumrik/lib/sounds';

/* ═══════════════════════════════════════════════════════════════
   ShareResultCard — Shareable Daily Challenge Result
   Designed for WhatsApp sharing with a visual card + share button.
   ═══════════════════════════════════════════════════════════════ */

interface ShareResultCardProps {
  chainLength: number;
  moves: number;
  streak: number;
  subject: string;
  date: string;
  isHi: boolean;
}

export default function ShareResultCard({
  chainLength,
  moves,
  streak,
  subject,
  date,
  isHi,
}: ShareResultCardProps) {
  const handleShare = useCallback(() => {
    playSound('tap');

    const checkSquares = Array(chainLength).fill('\u2705').join('');
    const streakLine = streak >= 1 ? `\n\uD83D\uDD25 Day ${streak}` : '';

    const text = isHi
      ? `\uD83E\uDDE0 Alfanumrik Daily | ${date}\n${subject}\n${checkSquares} ${moves} चालों में हल किया${streakLine}\nalfanumrik.com/challenge`
      : `\uD83E\uDDE0 Alfanumrik Daily | ${date}\n${subject}\n${checkSquares} Solved in ${moves} moves${streakLine}\nalfanumrik.com/challenge`;

    shareResult({
      title: isHi ? '\u0905\u0932\u094D\u092B\u093C\u093E\u0928\u0941\u092E\u0930\u093F\u0915 \u0921\u0947\u0932\u0940' : 'Alfanumrik Daily',
      text,
      url: 'https://alfanumrik.com/challenge',
    });
  }, [chainLength, moves, streak, subject, date, isHi]);

  return (
    <div className="space-y-3">
      {/* Visual card */}
      <div
        className="rounded-2xl p-5 space-y-3"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-warm) 7%, white), color-mix(in srgb, var(--purple) 8%, white), color-mix(in srgb, var(--accent-warm) 7%, white))',
          border: '1.5px solid color-mix(in srgb, var(--accent-warm) 20%, transparent)',
        }}
      >
        {/* Title */}
        <p
          className="text-base font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {isHi ? '\u0905\u0932\u094D\u092B\u093C\u093E\u0928\u0941\u092E\u0930\u093F\u0915 \u0921\u0947\u0932\u0940' : 'Alfanumrik Daily'}
        </p>

        {/* Date + Subject */}
        <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
          <span>{date}</span>
          <span>{'\u00B7'}</span>
          <span className="font-medium text-[var(--text-2)]">{subject}</span>
        </div>

        {/* Check squares row */}
        <div className="flex items-center gap-1" aria-label={
          isHi
            ? `${chainLength} कार्ड हल किए`
            : `${chainLength} cards solved`
        }>
          {Array.from({ length: chainLength }, (_, i) => (
            <span
              key={i}
              className="inline-block w-7 h-7 rounded-md text-center leading-7 text-sm"
              style={{
                background: 'color-mix(in srgb, var(--green) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)',
              }}
              aria-hidden="true"
            >
              {'\u2705'}
            </span>
          ))}
        </div>

        {/* Solved in N moves */}
        <p className="text-sm font-semibold text-[var(--text-1)]">
          {isHi
            ? `${moves} \u091A\u093E\u0932\u094B\u0902 \u092E\u0947\u0902 \u0939\u0932 \u0915\u093F\u092F\u093E`
            : `Solved in ${moves} move${moves !== 1 ? 's' : ''}`
          }
        </p>

        {/* Streak */}
        {streak >= 1 && (
          <p className="text-sm font-bold" style={{ color: 'var(--accent-warm)' }}>
            {'\uD83D\uDD25'} {isHi ? `\u0926\u093F\u0928 ${streak}` : `Day ${streak}`}
          </p>
        )}
      </div>

      {/* Share button */}
      <Button
        variant="primary"
        fullWidth
        onClick={handleShare}
      >
        {isHi
          ? '\uD83D\uDCE4 WhatsApp \u092A\u0930 \u0936\u0947\u092F\u0930 \u0915\u0930\u094B'
          : '\uD83D\uDCE4 Share on WhatsApp'
        }
      </Button>
    </div>
  );
}
