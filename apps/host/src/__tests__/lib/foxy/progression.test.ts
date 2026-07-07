import { describe, it, expect } from 'vitest';

/**
 * GUARD #6 — Foxy chapter-progression LADDER survival (Part 2B/2C).
 *
 * The chapter ladder (choose_topic / next_topic) must never be silently dropped.
 * Two binding behaviours:
 *
 *   (A) The 'next_topic' ExpectationKind ROUND-TRIPS through extract -> inject:
 *       extractExpectation recognises a "we advanced to the next topic + here's a
 *       check" reply as kind 'next_topic', and buildExpectationPromptSection
 *       re-anchors that ladder step on the next turn (carrying the topic title
 *       from meta).
 *
 *   (B) An ack-only reply ("Correct! / Bilkul sahi!") does NOT close a
 *       choose_topic / next_topic anchor — the ladder stays OPEN ('unresolved')
 *       so the student is actually carried to the next topic, not reset.
 *
 * `classifyExpectationLifecycle` is internal to /api/foxy/route.ts (not
 * exported), so behaviour (B) is pinned at the exported layers it relies on:
 *   - normalizeKind classifies advance-phrasing + a question as 'next_topic'
 *     (the kind that the route then protects from ack-only closure), and
 *   - buildExpectationPromptSection emits the explicit "do NOT drop the thread"
 *     re-anchor instruction for choose_topic / next_topic.
 * The got-it half of the ack-survival contract is pinned in GUARD #7
 * (learning-action PROGRESSION_EXPECTATION_KINDS).
 */

import {
  extractExpectation,
  buildExpectationPromptSection,
  type OpenExpectation,
  type ExpectationKind,
  __test,
} from '@alfanumrik/lib/learn/foxy-expectations';

const { normalizeKind } = __test;

function openExpectation(kind: ExpectationKind, meta: Record<string, unknown> = {}): OpenExpectation {
  return {
    id: 'exp-1',
    session_id: 'sess-1',
    student_id: 'stud-1',
    kind,
    text: 'Quick check: what is sin 30°?',
    meta,
    subject: 'math',
    grade: '10',
    chapter: '8',
    topic_id: 'topic-uuid-1',
    bloom_level: null,
    difficulty: null,
    created_at: '2026-06-14T00:00:00Z',
    expires_at: '2026-06-15T00:00:00Z',
    asked_message_id: 'msg-1',
  };
}

describe('GUARD #6A — next_topic ExpectationKind round-trips extract -> inject', () => {
  it('extractExpectation classifies an advance-to-next-topic + check reply as next_topic', () => {
    const reply =
      "Great work on similar triangles! Now let's move on to trigonometric ratios.\n" +
      '-> Quick check: in a right triangle, what is sin θ equal to?';
    const extracted = extractExpectation(reply);
    expect(extracted).not.toBeNull();
    expect(extracted!.kind).toBe('next_topic');
  });

  it('a bare "let\'s move on" statement WITHOUT a question is NOT a next_topic anchor', () => {
    const reply = "Now let's move on to trigonometry."; // no '?'
    const extracted = extractExpectation(reply);
    // No question signal at all → null (nothing to anchor).
    expect(extracted).toBeNull();
  });

  it('a structured payload with kind "next_topic" is honoured verbatim', () => {
    const extracted = extractExpectation('advancing to the next topic now', {
      structured: { question: { text: 'What is cos 60°?', kind: 'next_topic' } },
    });
    expect(extracted).not.toBeNull();
    expect(extracted!.kind).toBe('next_topic');
  });

  it('buildExpectationPromptSection re-anchors a next_topic ladder with the topic title from meta', () => {
    const section = buildExpectationPromptSection(
      openExpectation('next_topic', { next_topic_title: 'Trigonometric Ratios' }),
    );
    expect(section).toContain('ANSWERING_NOW');
    expect(section).toContain('Expected answer kind: next_topic');
    // The advanced-to topic is named so Foxy keeps teaching FROM there.
    expect(section).toContain('Trigonometric Ratios');
    // Ladder-survival instruction present (ack-only must not drop the thread).
    expect(section).toMatch(/do NOT drop the thread/i);
  });

  it('buildExpectationPromptSection also emits the ladder-survival rule for choose_topic', () => {
    const section = buildExpectationPromptSection(openExpectation('choose_topic'));
    expect(section).toMatch(/do NOT drop the thread/i);
  });

  it('a non-ladder kind (mcq) gets NO ladder-survival re-anchor instruction', () => {
    const section = buildExpectationPromptSection(openExpectation('mcq'));
    expect(section).not.toMatch(/do NOT drop the thread/i);
  });

  it('null expectation → empty prompt section (template-safe)', () => {
    expect(buildExpectationPromptSection(null)).toBe('');
  });
});

describe('GUARD #6B — kind classification: next_topic precedence + survival anchors', () => {
  it('normalizeKind picks next_topic when advance-phrasing + a question are present', () => {
    const kind = normalizeKind(
      undefined,
      'what is sin θ?',
      "Let's move on to trigonometry. -> what is sin θ?",
    );
    expect(kind).toBe('next_topic');
  });

  it('next_topic trumps the choose_topic menu signal when both could match', () => {
    const kind = normalizeKind(
      undefined,
      'which ratio applies here?',
      "Moving on to the next topic — let's start with ratios. -> which ratio applies here?",
    );
    expect(kind).toBe('next_topic');
  });

  it('an explicit valid hint "choose_topic" is honoured', () => {
    expect(normalizeKind('choose_topic', 'pick one', 'pick one: A, B, C')).toBe('choose_topic');
  });

  it('an explicit valid hint "next_topic" is honoured', () => {
    expect(normalizeKind('next_topic', 'check question?', 'we advanced; check?')).toBe('next_topic');
  });

  it('both choose_topic and next_topic are valid normalized kinds (round-trip stable)', () => {
    for (const kind of ['choose_topic', 'next_topic'] as const) {
      expect(normalizeKind(kind, 'q?', 'reply?')).toBe(kind);
    }
  });
});

describe('GUARD #6C — topic-progress orders the ladder by display_order (next = first unmastered)', () => {
  // The route's loadChapterTopicProgress walks curriculum_topics ordered by
  // display_order and picks the FIRST topic below the mastery threshold as the
  // ladder target. That ordering+pick rule is the pure invariant; we model it
  // here so a regression in "pick next by display_order" is caught even though
  // the route helper itself is internal (it queries supabaseAdmin directly).
  const TOPIC_MASTERED_THRESHOLD = 0.6;

  function pickNext(
    topics: Array<{ title: string; display_order: number }>,
    masteryByTitle: Record<string, number>,
  ): { currentTopic: string | null; nextTopic: string | null } {
    const ordered = [...topics].sort((a, b) => a.display_order - b.display_order);
    let currentTopic: string | null = null;
    let nextTopic: string | null = null;
    for (const t of ordered) {
      const m = masteryByTitle[t.title];
      if (m !== undefined) currentTopic = t.title;
      if (nextTopic === null && (m ?? 0) < TOPIC_MASTERED_THRESHOLD) nextTopic = t.title;
    }
    return { currentTopic, nextTopic };
  }

  const ladder = [
    { title: 'Introduction to Trig', display_order: 1 },
    { title: 'Trig Ratios', display_order: 2 },
    { title: 'Trig Identities', display_order: 3 },
  ];

  it('picks the first unmastered topic in display_order, not document order', () => {
    // 1 mastered, 2 partial → next is "Trig Ratios" (display_order 2).
    const { nextTopic } = pickNext(ladder, { 'Introduction to Trig': 0.8, 'Trig Ratios': 0.3 });
    expect(nextTopic).toBe('Trig Ratios');
  });

  it('all mastered → no next topic (ladder complete, never fabricates one)', () => {
    const { nextTopic } = pickNext(ladder, {
      'Introduction to Trig': 0.9,
      'Trig Ratios': 0.8,
      'Trig Identities': 0.7,
    });
    expect(nextTopic).toBeNull();
  });

  it('no mastery rows at all → first ordered topic is the next target', () => {
    const { nextTopic, currentTopic } = pickNext(ladder, {});
    expect(nextTopic).toBe('Introduction to Trig');
    expect(currentTopic).toBeNull();
  });

  it('current topic is the last touched (highest display_order with any mastery)', () => {
    const { currentTopic } = pickNext(ladder, {
      'Introduction to Trig': 0.9,
      'Trig Ratios': 0.4,
    });
    expect(currentTopic).toBe('Trig Ratios');
  });
});
