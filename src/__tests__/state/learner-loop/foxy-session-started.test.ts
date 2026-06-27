/**
 * Phase 2d tests for /api/foxy/route.ts — ai.foxy_session_started publish.
 *
 *   - mapFoxyModeToEventMode: route mode → event mode enum
 *   - parseFoxyChapterNumber: pulls a positive int off a chapter string
 *   - Event-shape contract: a synthetic event matching what
 *     resolveSession() publishes parses against the registry.
 *
 * The full route is too heavy to integration-test here (auth + RBAC +
 * grounded-answer + cognitive context + chat history). The pure
 * helpers + event shape pin the load-bearing pieces.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  mapFoxyModeToEventMode,
  parseFoxyChapterNumber,
} from '../../../app/api/foxy/route';
import {
  DomainEventSchema,
  FoxySessionStartedSchema,
} from '../../../lib/state/events/registry';

// ─── mapFoxyModeToEventMode ──────────────────────────────────────────

describe('mapFoxyModeToEventMode', () => {
  it('learn → tutor', () => {
    expect(mapFoxyModeToEventMode('learn')).toBe('tutor');
  });

  it('explain → tutor', () => {
    expect(mapFoxyModeToEventMode('explain')).toBe('tutor');
  });

  it('practice → tutor', () => {
    expect(mapFoxyModeToEventMode('practice')).toBe('tutor');
  });

  it('revise → revision', () => {
    expect(mapFoxyModeToEventMode('revise')).toBe('revision');
  });

  it('unknown route mode defaults to tutor (safe fallback)', () => {
    expect(mapFoxyModeToEventMode('chitchat')).toBe('tutor');
    expect(mapFoxyModeToEventMode('')).toBe('tutor');
  });
});

// ─── parseFoxyChapterNumber ──────────────────────────────────────────

describe('parseFoxyChapterNumber', () => {
  it('extracts a leading "Chapter N" prefix', () => {
    expect(parseFoxyChapterNumber('Chapter 7: Light')).toBe(7);
    expect(parseFoxyChapterNumber('chapter 12 - Motion')).toBe(12);
  });

  it('extracts a bare leading number', () => {
    expect(parseFoxyChapterNumber('5')).toBe(5);
  });

  it('extracts N from "N. Title" form', () => {
    expect(parseFoxyChapterNumber('5. Light')).toBe(5);
  });

  it('returns null when no number is present', () => {
    expect(parseFoxyChapterNumber('Light and Sound')).toBeNull();
    expect(parseFoxyChapterNumber('')).toBeNull();
    expect(parseFoxyChapterNumber(null)).toBeNull();
  });

  it('rejects zero (chapter numbers are 1-indexed)', () => {
    expect(parseFoxyChapterNumber('Chapter 0')).toBeNull();
  });

  it('rejects out-of-range chapter input (4+ digits are out-of-scope/abusive, not real CBSE chapters)', () => {
    // Real NCERT chapters are 1-2 digits; "Chapter 9999" is nonsense/abuse.
    // The parser fails closed (returns null) so Foxy RAG chapter-scope
    // filtering never accepts out-of-curriculum input.
    expect(parseFoxyChapterNumber('Chapter 9999: Foo')).toBeNull();
  });
});

// ─── Event shape contract ────────────────────────────────────────────

describe('ai.foxy_session_started — event shape published by resolveSession()', () => {
  function buildEvent(opts: {
    sessionId: string;
    authUserId: string;
    schoolId: string | null;
    subjectCode: string | null;
    chapterNumber: number | null;
    mode: 'tutor' | 'doubt_solve' | 'revision';
  }) {
    return {
      kind: 'ai.foxy_session_started' as const,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: opts.authUserId,
      tenantId: opts.schoolId,
      idempotencyKey: `foxy_session_started:${opts.sessionId}`,
      payload: {
        foxySessionId: opts.sessionId,
        subjectCode: opts.subjectCode,
        chapterNumber: opts.chapterNumber,
        mode: opts.mode,
      },
    };
  }

  it('parses against DomainEventSchema', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: '33333333-3333-3333-3333-333333333333',
      subjectCode: 'science',
      chapterNumber: 7,
      mode: 'tutor',
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('parses against the specific FoxySessionStartedSchema', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      mode: 'revision',
    });
    expect(() => FoxySessionStartedSchema.parse(event)).not.toThrow();
  });

  it('accepts null subjectCode + null chapterNumber (Foxy can open without a chapter context)', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: null,
      chapterNumber: null,
      mode: 'tutor',
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('idempotencyKey is stable per session (retry-safe)', () => {
    const a = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 1,
      mode: 'tutor',
    });
    const b = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111', // same session
      authUserId: '99999999-9999-9999-9999-999999999999', // different other fields
      schoolId: '44444444-4444-4444-4444-444444444444',
      subjectCode: 'science',
      chapterNumber: 2,
      mode: 'revision',
    });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toBe('foxy_session_started:11111111-1111-1111-1111-111111111111');
  });

  it('rejects chapterNumber 0 at schema boundary (defense in depth)', () => {
    const event = buildEvent({
      sessionId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subjectCode: 'math',
      chapterNumber: 0, // invalid
      mode: 'tutor',
    });
    expect(() => DomainEventSchema.parse(event)).toThrow();
  });
});
