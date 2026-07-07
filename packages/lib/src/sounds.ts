'use client';

/**
 * ALFANUMRIK — Sound Feedback System
 *
 * Subtle, synthesized audio feedback for key student activities.
 * Uses Web Audio API — zero audio file downloads, sub-1KB total.
 *
 * Design principles:
 * - Sounds are gentle rewards, not distractions
 * - All sounds < 300ms duration
 * - Debounced to prevent spam
 * - Respects user preference (localStorage toggle)
 * - Respects device mute state
 * - No autoplay — requires user interaction first
 */

// ─── User Preference ──────────────────────────────────────

const STORAGE_KEY = 'alfanumrik_sounds';

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === 'on'; // Default: ON
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
}

// ─── Audio Context (lazy, singleton) ──────────────────────

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch((err: unknown) => {
    console.warn('[sounds] AudioContext resume failed:', err instanceof Error ? err.message : String(err));
  });
  return ctx;
}

// ─── Debounce ─────────────────────────────────────────────

const lastPlayed = new Map<string, number>();
const DEBOUNCE_MS = 300; // Min interval between same sound

function shouldPlay(id: string): boolean {
  const now = Date.now();
  const last = lastPlayed.get(id) || 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastPlayed.set(id, now);
  return true;
}

// ─── Sound Synthesizers ───────────────────────────────────
// Each function creates a short, pleasant tone using oscillators.
// No audio files needed — pure Web Audio API synthesis.

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', vol = 0.15) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

function playChord(freqs: number[], duration: number, type: OscillatorType = 'sine', vol = 0.08) {
  freqs.forEach(f => playTone(f, duration, type, vol));
}

// ─── Sound Events ─────────────────────────────────────────

const SOUNDS = {
  // Correct answer — bright, uplifting two-note chirp
  correct: () => {
    playTone(880, 0.12, 'sine', 0.12);
    setTimeout(() => playTone(1100, 0.15, 'sine', 0.1), 80);
  },

  // Incorrect answer — soft, low single note (not harsh)
  incorrect: () => {
    playTone(330, 0.2, 'triangle', 0.08);
  },

  // XP gained — quick ascending sparkle
  xp: () => {
    playTone(660, 0.08, 'sine', 0.1);
    setTimeout(() => playTone(880, 0.08, 'sine', 0.08), 60);
    setTimeout(() => playTone(1100, 0.12, 'sine', 0.06), 120);
  },

  // Level up — richer chord
  levelUp: () => {
    playChord([523, 659, 784], 0.3, 'sine', 0.1);
    setTimeout(() => playChord([587, 740, 880], 0.4, 'sine', 0.08), 200);
  },

  // Quiz complete — satisfying completion tone
  complete: () => {
    playTone(523, 0.1, 'sine', 0.1);
    setTimeout(() => playTone(659, 0.1, 'sine', 0.1), 100);
    setTimeout(() => playTone(784, 0.2, 'sine', 0.12), 200);
  },

  // Send message — subtle tap
  tap: () => {
    playTone(800, 0.05, 'sine', 0.06);
  },

  // Limit reached — soft alert
  limit: () => {
    playTone(440, 0.15, 'triangle', 0.1);
    setTimeout(() => playTone(380, 0.2, 'triangle', 0.08), 120);
  },

  // Upgrade success — premium chord
  upgrade: () => {
    playChord([523, 659, 784], 0.15, 'sine', 0.12);
    setTimeout(() => playChord([659, 784, 1047], 0.3, 'sine', 0.1), 150);
    setTimeout(() => playTone(1319, 0.4, 'sine', 0.08), 350);
  },

  // Streak milestone — warm ascending
  streak: () => {
    playTone(440, 0.1, 'sine', 0.1);
    setTimeout(() => playTone(554, 0.1, 'sine', 0.1), 80);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.12), 160);
  },

  // Navigation click — micro click
  click: () => {
    playTone(600, 0.03, 'square', 0.04);
  },

  // Challenge win — triumphant victory fanfare (3-note ascending major chord)
  challengeWin: () => {
    playChord([523, 659, 784], 0.15, 'sine', 0.12);
    setTimeout(() => playChord([659, 784, 1047], 0.2, 'sine', 0.1), 150);
    setTimeout(() => playChord([784, 1047, 1319], 0.4, 'sine', 0.08), 350);
  },

  // Foxy greeting — playful two-note yip (high pitch, bouncy)
  foxyGreet: () => {
    playTone(1200, 0.08, 'sine', 0.1);
    setTimeout(() => playTone(1500, 0.12, 'sine', 0.08), 60);
  },

  // Streak fire — crackling ascending (rapid micro-tones)
  streakFire: () => {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => playTone(400 + i * 100, 0.06, 'sawtooth', 0.04), i * 40);
    }
  },

  // Coin collect — classic coin pickup sound (quick high bounce)
  coin: () => {
    playTone(988, 0.06, 'square', 0.08);
    setTimeout(() => playTone(1319, 0.1, 'square', 0.06), 50);
  },
} as const;

export type SoundEvent = keyof typeof SOUNDS;

// ─── Public API ───────────────────────────────────────────

/**
 * Play a sound event if sounds are enabled and debounce allows.
 * Safe to call anywhere — no-ops silently if disabled or unavailable.
 */
export function playSound(event: SoundEvent): void {
  if (!isSoundEnabled()) return;
  if (!shouldPlay(event)) return;
  try {
    SOUNDS[event]();
  } catch {
    // Silent fail — audio should never break the app
  }
}
