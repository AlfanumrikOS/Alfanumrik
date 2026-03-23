import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Indian market features', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('Offline Store', () => {
    it('caches and retrieves data', async () => {
      const { cacheSet, cacheGet } = await import('@/lib/offlineStore');
      cacheSet('test-key', { xp: 500, streak: 7 });
      const result = cacheGet<{ xp: number; streak: number }>('test-key');
      expect(result).toEqual({ xp: 500, streak: 7 });
    });

    it('returns null for expired data', async () => {
      const { cacheGet } = await import('@/lib/offlineStore');
      // Set item with old timestamp directly
      localStorage.setItem('alf_expired', JSON.stringify({
        data: 'old',
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        version: 1,
      }));
      expect(cacheGet('expired')).toBeNull();
    });

    it('queues offline actions', async () => {
      const { queueOfflineAction, getOfflineQueue, clearOfflineQueue } = await import('@/lib/offlineStore');
      queueOfflineAction({ type: 'quiz_submit', payload: { score: 80 }, timestamp: Date.now() });
      queueOfflineAction({ type: 'review_rate', payload: { quality: 4 }, timestamp: Date.now() });
      const queue = getOfflineQueue();
      expect(queue.length).toBe(2);
      clearOfflineQueue();
      expect(getOfflineQueue().length).toBe(0);
    });
  });

  describe('WhatsApp Share', () => {
    it('generates Hindi quiz share message', async () => {
      const { quizShareMessage } = await import('@/lib/share');
      const msg = quizShareMessage({
        studentName: 'Aarav',
        subject: 'Math',
        score: 90,
        xpEarned: 100,
        isHi: true,
      });
      expect(msg.title).toContain('Aarav');
      expect(msg.title).toContain('90%');
      expect(msg.text).toContain('Alfanumrik');
    });

    it('generates English quiz share message', async () => {
      const { quizShareMessage } = await import('@/lib/share');
      const msg = quizShareMessage({
        studentName: 'Priya',
        subject: 'Science',
        score: 75,
        xpEarned: 80,
        isHi: false,
      });
      expect(msg.text).toContain('Priya');
      expect(msg.text).toContain('75%');
      expect(msg.text).toContain('+80 XP');
    });

    it('generates streak share message', async () => {
      const { streakShareMessage } = await import('@/lib/share');
      const msg = streakShareMessage({ studentName: 'Rohan', days: 30, isHi: false });
      expect(msg.title).toContain('30-day');
      expect(msg.text).toContain('🔥');
    });
  });

  describe('Analytics', () => {
    it('track function does not throw', async () => {
      const { track } = await import('@/lib/analytics');
      // Should silently work without crashing even without Vercel Analytics
      expect(() => {
        track('quiz_completed', {
          subject: 'math',
          score: 85,
          questions: 10,
          grade: '9',
          time_seconds: 120,
        });
      }).not.toThrow();
    });
  });
});
