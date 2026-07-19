'use client';

/**
 * VoicePlayer — Audio playback UI for Foxy TTS responses.
 *
 * Play/pause, speed selector (0.75x/1x/1.25x/1.5x persisted in localStorage),
 * progress bar, time display. Uses HTMLAudioElement API — no third-party library.
 * Bilingual chrome strings (P7).
 */

import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface VoicePlayerProps {
  audioUrl: string;
  isLoading?: boolean;
  onEnded?: () => void;
}

const CHROME = {
  en: {
    play: 'Play',
    pause: 'Pause',
    speed: 'Speed',
    loading: 'Loading audio...',
  },
  hi: {
    play: 'सुनें',
    pause: 'रुकें',
    speed: 'गति',
    loading: 'ऑडियो लोड हो रहा है...',
  },
} as const;

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;
const SPEED_STORAGE_KEY = 'foxy_voice_speed';

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const VoicePlayer = memo(function VoicePlayer({
  audioUrl,
  isLoading,
  onEnded,
}: VoicePlayerProps) {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const stored = localStorage.getItem(SPEED_STORAGE_KEY);
    const parsed = stored ? parseFloat(stored) : 1;
    return SPEED_OPTIONS.includes(parsed as typeof SPEED_OPTIONS[number]) ? parsed : 1;
  });

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.playbackRate = speed;

    const onTimeUpdate = () => setProgress(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnd = () => {
      setIsPlaying(false);
      setProgress(0);
      onEnded?.();
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnd);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnd);
      audio.pause();
      audio.src = '';
    };
  }, [audioUrl, onEnded, speed]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setProgress(newTime);
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEED_OPTIONS.indexOf(prev as typeof SPEED_OPTIONS[number]);
      const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
      localStorage.setItem(SPEED_STORAGE_KEY, String(next));
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        <span>{chrome.loading}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-colors"
        aria-label={isPlaying ? chrome.pause : chrome.play}
      >
        {isPlaying ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      {/* Progress bar */}
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={progress}
        onChange={handleSeek}
        className="flex-1 h-1.5 appearance-none bg-gray-300 dark:bg-gray-600 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500"
      />

      {/* Time display */}
      <span className="text-xs text-gray-500 font-mono min-w-[4rem] text-right">
        {formatTime(progress)}/{formatTime(duration)}
      </span>

      {/* Speed button */}
      <button
        onClick={cycleSpeed}
        className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-orange-500 transition-colors px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600"
        aria-label={chrome.speed}
      >
        {speed}x
      </button>
    </div>
  );
});
