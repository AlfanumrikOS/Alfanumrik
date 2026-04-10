import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Foxy Tutor Logic Tests
 *
 * Tests the pure logic extracted from supabase/functions/foxy-tutor/index.ts:
 * - Circuit breaker state transitions
 * - Rate limiting logic
 * - System prompt building
 * - Plan-based daily usage limits
 */

// ─── Replicated circuit breaker from foxy-tutor/index.ts ────────────────

function createCircuitBreaker() {
  return {
    failures: 0,
    lastFailureAt: 0,
    state: 'closed' as 'closed' | 'open' | 'half-open',
    FAILURE_THRESHOLD: 5,
    RESET_TIMEOUT: 60_000,

    canRequest(): boolean {
      if (this.state === 'closed') return true;
      if (this.state === 'open') {
        if (Date.now() - this.lastFailureAt > this.RESET_TIMEOUT) {
          this.state = 'half-open';
          return true;
        }
        return false;
      }
      // half-open: already allowed one request, block further
      return false;
    },

    recordSuccess(): void {
      this.failures = 0;
      this.state = 'closed';
    },

    recordFailure(): void {
      this.failures++;
      this.lastFailureAt = Date.now();
      if (this.failures >= this.FAILURE_THRESHOLD) {
        this.state = 'open';
      }
    },
  };
}

// ─── Replicated rate limiter from foxy-tutor/index.ts ───────────────────

function createRateLimiter(windowMs: number, maxRequests: number, maxMapSize: number) {
  const map = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string): boolean {
      const now = Date.now();
      const e = map.get(key);
      if (!e || now > e.resetAt) {
        if (map.size >= maxMapSize) {
          const firstKey = map.keys().next().value;
          if (firstKey) map.delete(firstKey);
        }
        map.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (e.count >= maxRequests) return false;
      e.count++;
      return true;
    },
    _map: map,
  };
}

// ─── Replicated plan limits from foxy-tutor/index.ts ────────────────────

const PLAN_LIMITS: Record<string, number> = {
  free: 5,
  starter: 30,
  basic: 30,
  pro: 100,
  premium: 100,
  unlimited: 999999,
};

// ─── Replicated system prompt builder (simplified) ──────────────────────

function buildSystemPrompt(
  grade: string,
  subject: string,
  language: string,
  mode: string,
  topicTitle: string | null,
  chapters: string | null,
  lessonStep: string | null,
  ragContext: string | null,
  syllabusContext: string | null = null,
  masteryContext: string | null = null,
): string {
  const lang =
    language === 'hi' ? 'Hindi (Devanagari script)'
    : language === 'hinglish' ? 'Hinglish (Hindi+English mix)'
    : 'English';

  const modeInstr: Record<string, string> = {
    learn: 'Teach concepts step-by-step with examples. Use the Socratic method — ask guiding questions.',
    quiz: 'Ask one question at a time. Wait for the student to answer before revealing the correct answer. Give encouraging feedback.',
    revision: 'Provide concise revision notes with key points, formulas, and common exam mistakes.',
    doubt: 'The student has a specific doubt. Give a clear, direct explanation with an example.',
  };

  let prompt = `You are Foxy 🦊, a warm, encouraging AI tutor for Indian CBSE students.

STUDENT: Grade ${grade} | Subject: ${subject}
LANGUAGE: Respond in ${lang}. Use simple, age-appropriate language.
MODE: ${modeInstr[mode] || modeInstr.learn}`;

  if (topicTitle) prompt += `\nACTIVE TOPIC: ${topicTitle}`;
  if (chapters) prompt += `\nSELECTED CHAPTERS: ${chapters}`;

  if (masteryContext) {
    prompt += `\n\nSTUDENT MASTERY STATE (adapt your response based on this):\n${masteryContext}`;
  }
  if (syllabusContext) {
    prompt += `\n\nCBSE SYLLABUS REFERENCE (formulas, rules, answer patterns — AUTHORITATIVE):\n${syllabusContext}`;
  }
  if (ragContext) {
    prompt += `\n\nNCERT TEXTBOOK CONTENT (PRIMARY SOURCE — base your answer on this):\n${ragContext}`;
  }

  return prompt;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Foxy Tutor Logic', () => {

  describe('Circuit Breaker State Transitions', () => {
    let cb: ReturnType<typeof createCircuitBreaker>;

    beforeEach(() => {
      cb = createCircuitBreaker();
    });

    it('starts in closed state and allows requests', () => {
      expect(cb.state).toBe('closed');
      expect(cb.canRequest()).toBe(true);
    });

    it('stays closed after fewer failures than threshold', () => {
      for (let i = 0; i < 4; i++) {
        cb.recordFailure();
      }
      expect(cb.state).toBe('closed');
      expect(cb.canRequest()).toBe(true);
    });

    it('transitions to open after 5 consecutive failures', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      expect(cb.state).toBe('open');
      expect(cb.canRequest()).toBe(false);
    });

    it('transitions from open to half-open after reset timeout', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      expect(cb.state).toBe('open');

      // Simulate time passing beyond the reset timeout
      cb.lastFailureAt = Date.now() - 61_000;
      expect(cb.canRequest()).toBe(true);
      expect(cb.state).toBe('half-open');
    });

    it('blocks additional requests in half-open state', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      cb.lastFailureAt = Date.now() - 61_000;

      // First request transitions to half-open and is allowed
      expect(cb.canRequest()).toBe(true);
      expect(cb.state).toBe('half-open');

      // Second request in half-open is blocked
      expect(cb.canRequest()).toBe(false);
    });

    it('transitions from half-open to closed on success', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      cb.lastFailureAt = Date.now() - 61_000;
      cb.canRequest(); // transitions to half-open

      cb.recordSuccess();
      expect(cb.state).toBe('closed');
      expect(cb.failures).toBe(0);
      expect(cb.canRequest()).toBe(true);
    });

    it('transitions from half-open back to open on failure', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure();
      }
      cb.lastFailureAt = Date.now() - 61_000;
      cb.canRequest(); // transitions to half-open

      // Fail again — since failures is already at 5 and we increment to 6
      cb.recordFailure();
      expect(cb.state).toBe('open');
      expect(cb.canRequest()).toBe(false);
    });

    it('resets failure count on success even from closed state', () => {
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.failures).toBe(2);

      cb.recordSuccess();
      expect(cb.failures).toBe(0);
      expect(cb.state).toBe('closed');
    });
  });

  describe('Rate Limiting', () => {
    it('allows requests within the limit', () => {
      const limiter = createRateLimiter(60_000, 30, 5000);
      for (let i = 0; i < 30; i++) {
        expect(limiter.check('student-1')).toBe(true);
      }
    });

    it('rejects requests beyond the limit', () => {
      const limiter = createRateLimiter(60_000, 30, 5000);
      for (let i = 0; i < 30; i++) {
        limiter.check('student-1');
      }
      expect(limiter.check('student-1')).toBe(false);
    });

    it('tracks different students independently', () => {
      const limiter = createRateLimiter(60_000, 2, 5000);
      expect(limiter.check('student-A')).toBe(true);
      expect(limiter.check('student-A')).toBe(true);
      expect(limiter.check('student-A')).toBe(false); // over limit

      expect(limiter.check('student-B')).toBe(true); // different student, OK
    });

    it('resets after window expires', () => {
      const limiter = createRateLimiter(60_000, 2, 5000);
      limiter.check('student-1');
      limiter.check('student-1');
      expect(limiter.check('student-1')).toBe(false);

      // Simulate window expiry by manipulating the resetAt
      const entry = limiter._map.get('student-1');
      if (entry) entry.resetAt = Date.now() - 1;

      expect(limiter.check('student-1')).toBe(true); // new window
    });

    it('evicts oldest entry when at max capacity', () => {
      const limiter = createRateLimiter(60_000, 10, 3);
      limiter.check('a');
      limiter.check('b');
      limiter.check('c');
      // Map is at capacity (3). Next new key should evict oldest.
      limiter.check('d');
      expect(limiter._map.has('a')).toBe(false);
      expect(limiter._map.has('d')).toBe(true);
    });
  });

  describe('Plan Usage Limits', () => {
    it('free plan gets 5 messages per day', () => {
      expect(PLAN_LIMITS['free']).toBe(5);
    });

    it('starter/basic plans get 30 messages per day', () => {
      expect(PLAN_LIMITS['starter']).toBe(30);
      expect(PLAN_LIMITS['basic']).toBe(30);
    });

    it('pro/premium plans get 100 messages per day', () => {
      expect(PLAN_LIMITS['pro']).toBe(100);
      expect(PLAN_LIMITS['premium']).toBe(100);
    });

    it('unknown plan falls back to free limit', () => {
      const plan = 'nonexistent';
      const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS['free'];
      expect(limit).toBe(5);
    });
  });

  describe('System Prompt Building', () => {
    it('includes grade and subject', () => {
      const prompt = buildSystemPrompt('9', 'science', 'en', 'learn', null, null, null, null);
      expect(prompt).toContain('Grade 9');
      expect(prompt).toContain('Subject: science');
    });

    it('uses Hindi language label for hi', () => {
      const prompt = buildSystemPrompt('10', 'math', 'hi', 'learn', null, null, null, null);
      expect(prompt).toContain('Hindi (Devanagari script)');
    });

    it('uses Hinglish language label for hinglish', () => {
      const prompt = buildSystemPrompt('10', 'math', 'hinglish', 'learn', null, null, null, null);
      expect(prompt).toContain('Hinglish (Hindi+English mix)');
    });

    it('includes RAG context when provided', () => {
      const rag = 'Newton discovered gravity when an apple fell on his head.';
      const prompt = buildSystemPrompt('9', 'science', 'en', 'learn', null, null, null, rag);
      expect(prompt).toContain('NCERT TEXTBOOK CONTENT');
      expect(prompt).toContain(rag);
    });

    it('includes syllabus context when provided', () => {
      const syllabus = 'CONCEPT: Force and Laws of Motion';
      const prompt = buildSystemPrompt('9', 'science', 'en', 'learn', null, null, null, null, syllabus);
      expect(prompt).toContain('CBSE SYLLABUS REFERENCE');
      expect(prompt).toContain(syllabus);
    });

    it('includes mastery context when provided', () => {
      const mastery = 'Concepts tracked: 5 | WEAK: 2';
      const prompt = buildSystemPrompt('9', 'science', 'en', 'learn', null, null, null, null, null, mastery);
      expect(prompt).toContain('STUDENT MASTERY STATE');
      expect(prompt).toContain(mastery);
    });

    it('includes active topic when provided', () => {
      const prompt = buildSystemPrompt('9', 'science', 'en', 'learn', 'Photosynthesis', null, null, null);
      expect(prompt).toContain('ACTIVE TOPIC: Photosynthesis');
    });

    it('includes selected chapters when provided', () => {
      const prompt = buildSystemPrompt('9', 'science', 'en', 'learn', null, 'Ch 1, Ch 2', null, null);
      expect(prompt).toContain('SELECTED CHAPTERS: Ch 1, Ch 2');
    });

    it('uses mode-specific instruction', () => {
      const doubt = buildSystemPrompt('9', 'science', 'en', 'doubt', null, null, null, null);
      expect(doubt).toContain('specific doubt');

      const quiz = buildSystemPrompt('9', 'science', 'en', 'quiz', null, null, null, null);
      expect(quiz).toContain('one question at a time');
    });

    it('falls back to learn mode for unknown mode', () => {
      const prompt = buildSystemPrompt('9', 'science', 'en', 'unknown_mode', null, null, null, null);
      expect(prompt).toContain('Socratic method');
    });
  });
});
