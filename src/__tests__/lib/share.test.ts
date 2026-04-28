/**
 * Share utilities — unit tests.
 *
 * src/lib/share.ts wraps the Web Share API with a WhatsApp deep-link fallback
 * (because WhatsApp is the dominant share channel for Indian parents).
 *
 * We mock navigator.share and window.open and verify:
 *   - native share is preferred when available
 *   - WhatsApp fallback fires when native is missing OR the user cancels
 *   - bilingual message builders include emoji + correct CTA copy (P7)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shareResult,
  quizShareMessage,
  streakShareMessage,
  challengeInviteMessage,
  challengeResultMessage,
} from '@/lib/share';

afterEach(() => {
  vi.restoreAllMocks();
  // Always clear navigator.share between tests
  if ((navigator as unknown as Record<string, unknown>).share !== undefined) {
    delete (navigator as unknown as Record<string, unknown>).share;
  }
});

describe('shareResult', () => {
  it('uses native navigator.share when available and resolves true', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true, writable: true });

    const result = await shareResult({
      title: 'Big Win',
      text: 'I scored 90%',
      url: 'https://alfanumrik.com/share/123',
    });

    expect(result).toBe(true);
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({
      title: 'Big Win',
      text: 'I scored 90%',
      url: 'https://alfanumrik.com/share/123',
    });
  });

  it('defaults the url to alfanumrik.com when not supplied', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    // No navigator.share → falls through to WhatsApp.
    const result = await shareResult({ title: 'T', text: 'I scored 90%' });
    expect(result).toBe(true);
    const calledUrl = openSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(calledUrl)).toContain('https://alfanumrik.com');
  });

  it('falls back to WhatsApp when navigator.share rejects (user cancel)', async () => {
    const shareSpy = vi.fn().mockRejectedValue(new Error('AbortError'));
    Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true, writable: true });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const result = await shareResult({
      title: 'T',
      text: 'msg',
      url: 'https://x',
    });

    expect(result).toBe(true);
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('msg');
    expect(decodeURIComponent(url)).toContain('https://x');
  });

  it('uses WhatsApp deep link when navigator.share is undefined', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const result = await shareResult({
      title: 'T',
      text: 'Hello world',
      url: 'https://alfanumrik.com',
    });
    expect(result).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/?text='),
      '_blank',
    );
  });
});

describe('quizShareMessage', () => {
  it('returns trophy emoji for high scores (>=80)', () => {
    const msg = quizShareMessage({
      studentName: 'Ravi',
      subject: 'Math',
      score: 90,
      xpEarned: 100,
      isHi: false,
    });
    expect(msg.title).toContain('Ravi');
    expect(msg.title).toContain('90%');
    expect(msg.text).toContain('🏆');
  });

  it('returns star emoji for mid-range scores (60-79)', () => {
    const msg = quizShareMessage({
      studentName: 'Ravi',
      subject: 'Math',
      score: 75,
      xpEarned: 80,
      isHi: false,
    });
    expect(msg.text).toContain('⭐');
  });

  it('returns muscle emoji for lower scores (<60)', () => {
    const msg = quizShareMessage({
      studentName: 'Ravi',
      subject: 'Math',
      score: 45,
      xpEarned: 40,
      isHi: false,
    });
    expect(msg.text).toContain('💪');
  });

  it('renders Hindi copy when isHi=true (P7)', () => {
    const msg = quizShareMessage({
      studentName: 'राहुल',
      subject: 'गणित',
      score: 85,
      xpEarned: 90,
      isHi: true,
    });
    expect(msg.title).toContain('राहुल');
    expect(msg.title).toContain('गणित');
    expect(msg.text).toContain('Alfanumrik');
    // Hindi-specific phrases
    expect(msg.text).toContain('स्कोर');
  });
});

describe('streakShareMessage', () => {
  it('renders fire emoji and English copy', () => {
    const msg = streakShareMessage({ studentName: 'Ravi', days: 7, isHi: false });
    expect(msg.title).toContain('🔥');
    expect(msg.title).toContain('7-day');
    expect(msg.text).toContain('Alfanumrik');
  });

  it('renders Hindi copy when isHi=true', () => {
    const msg = streakShareMessage({ studentName: 'राहुल', days: 14, isHi: true });
    expect(msg.title).toContain('🔥');
    expect(msg.title).toContain('14');
    expect(msg.text).toContain('दिन');
  });
});

describe('challengeInviteMessage', () => {
  it('embeds challenge URL with share code', () => {
    const msg = challengeInviteMessage({
      studentName: 'Ravi',
      subject: 'Math',
      shareCode: 'ABC123',
      isHi: false,
    });
    expect(msg.url).toBe('https://alfanumrik.com/challenge?code=ABC123');
    expect(msg.text).toContain('Ravi');
    expect(msg.text).toContain('Math');
  });

  it('renders Hindi copy when isHi=true', () => {
    const msg = challengeInviteMessage({
      studentName: 'राहुल',
      subject: 'गणित',
      shareCode: 'XYZ',
      isHi: true,
    });
    expect(msg.url).toContain('code=XYZ');
    expect(msg.text).toContain('चैलेंज');
  });
});

describe('challengeResultMessage', () => {
  it('uses winner copy when won=true', () => {
    const msg = challengeResultMessage({
      studentName: 'Ravi',
      subject: 'Math',
      won: true,
      myScore: 90,
      opponentScore: 70,
      opponentName: 'Amit',
      isHi: false,
    });
    expect(msg.title).toContain('Ravi beat Amit');
    expect(msg.text).toContain('🏆');
    expect(msg.text).toContain('90%');
    expect(msg.text).toContain('70%');
  });

  it('uses loser/tough-match copy when won=false', () => {
    const msg = challengeResultMessage({
      studentName: 'Ravi',
      subject: 'Math',
      won: false,
      myScore: 60,
      opponentScore: 75,
      opponentName: 'Amit',
      isHi: false,
    });
    expect(msg.title).toContain('Amit won');
    expect(msg.text).toContain('⚔️');
    expect(msg.text).toContain('Tough match');
  });

  it('renders Hindi copy when isHi=true', () => {
    const msgWon = challengeResultMessage({
      studentName: 'राहुल',
      subject: 'गणित',
      won: true,
      myScore: 90,
      opponentScore: 70,
      opponentName: 'अमित',
      isHi: true,
    });
    expect(msgWon.title).toContain('हराया');
    const msgLost = challengeResultMessage({
      studentName: 'राहुल',
      subject: 'गणित',
      won: false,
      myScore: 50,
      opponentScore: 80,
      opponentName: 'अमित',
      isHi: true,
    });
    expect(msgLost.title).toContain('जीता');
  });
});
