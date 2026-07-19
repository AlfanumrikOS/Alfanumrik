/**
 * useVoicePlayback — hook for Foxy TTS voice playback.
 *
 * Extracts clean text from message blocks (strips LaTeX, mermaid code),
 * manages Audio object lifecycle, and provides playback controls.
 * Gated on existing `usePythonVoiceEnabled` flag.
 */

import { useState, useCallback, useRef } from 'react';
import type { FoxyBlock } from '@alfanumrik/lib/foxy/schema';

export interface VoicePlaybackState {
  play: () => Promise<void>;
  pause: () => void;
  isPlaying: boolean;
  speed: number;
  setSpeed: (speed: number) => void;
  progress: number;
  duration: number;
  isLoading: boolean;
  error: string | null;
  audioUrl: string | null;
}

/**
 * Extract clean speakable text from Foxy blocks.
 * Strips LaTeX delimiters, mermaid code, diagram queries, map data.
 */
export function extractSpeakableText(blocks: FoxyBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
      case 'step':
      case 'answer':
      case 'exam_tip':
      case 'definition':
      case 'example':
      case 'question':
        if (block.text) {
          // Strip inline LaTeX delimiters but keep the content readable
          const cleaned = block.text
            .replace(/\\\(([^)]*)\\\)/g, '$1')
            .replace(/\\\[([^\]]*)\\\]/g, '$1')
            .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1 over $2')
            .replace(/\\sqrt\{([^}]*)\}/g, 'square root of $1')
            .replace(/\\[a-zA-Z]+/g, ' ')
            .replace(/[{}]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (cleaned) parts.push(cleaned);
        }
        break;
      case 'math':
        // Skip standalone math blocks — too complex to read aloud
        break;
      case 'mcq':
        if ((block as { stem?: string }).stem) {
          parts.push((block as { stem: string }).stem);
        }
        break;
      // Skip diagram, mermaid, code, vertical_math, map blocks
      default:
        break;
    }
  }

  return parts.join('. ');
}

interface UseVoicePlaybackOptions {
  messageId: string;
  blocks: FoxyBlock[];
  enabled?: boolean;
}

export function useVoicePlayback({
  messageId,
  blocks,
  enabled = true,
}: UseVoicePlaybackOptions): VoicePlaybackState {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async () => {
    if (!enabled) return;

    setError(null);

    // If we already have the audio URL, just play
    if (audioUrl && audioRef.current) {
      audioRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
      return;
    }

    // Fetch TTS audio
    setIsLoading(true);
    try {
      const text = extractSpeakableText(blocks);
      if (!text) {
        setError('No speakable text in this message');
        return;
      }

      const res = await fetch('/api/foxy/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, text }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError((errData as { error?: string }).error || 'Voice synthesis failed');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      const audio = new Audio(url);
      audio.playbackRate = speed;
      audioRef.current = audio;

      audio.addEventListener('timeupdate', () => setProgress(audio.currentTime));
      audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setProgress(0);
      });

      await audio.play();
      setIsPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voice playback error');
    } finally {
      setIsLoading(false);
    }
  }, [enabled, audioUrl, blocks, messageId, speed]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  }, []);

  return {
    play,
    pause,
    isPlaying,
    speed,
    setSpeed,
    progress,
    duration,
    isLoading,
    error,
    audioUrl,
  };
}
