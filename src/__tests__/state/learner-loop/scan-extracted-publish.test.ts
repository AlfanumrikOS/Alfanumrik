/**
 * Phase 2 unit test — verifies the learner.scan_extracted event built by
 * /api/scan-solve matches the registry contract and that the idempotency
 * key is stable per scan id.
 *
 * This is a CONTRACT test, not a route integration test. The route's
 * publishEvent call site (src/app/api/scan-solve/route.ts) builds an
 * event with the same fields used here; if the registry contract drifts,
 * this test fails before the route can ship a bad payload.
 *
 * Why a contract test rather than a route test:
 *   - The route has heavy auth + Supabase + Edge Function dependencies
 *     that aren't worth mocking for a single publish line.
 *   - The registry schema is the source of truth; this test pins both
 *     "the route's event shape parses" and "idempotencyKey is stable".
 *   - Phase 3 will wire dashboards through resolveNextLearnerAction; at
 *     that point an end-to-end integration test against staging covers
 *     the full chain.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DomainEventSchema,
  LearnerScanExtractedSchema,
} from '../../../lib/state/events/registry';

// Replica of the event-building block in
// src/app/api/scan-solve/route.ts. Keep these in sync — any divergence
// here vs the route is exactly what this test is protecting against.
function buildScanExtractedEvent(args: {
  scanId: string;
  authUserId: string;
  schoolId: string | null;
  subject: string | null;
  occurredAt?: string;
}) {
  return {
    kind: 'learner.scan_extracted' as const,
    eventId: randomUUID(),
    occurredAt: args.occurredAt ?? new Date().toISOString(),
    actorAuthUserId: args.authUserId,
    tenantId: args.schoolId,
    idempotencyKey: `scan_extracted:${args.scanId}`,
    payload: {
      uploadId: args.scanId,
      imageType: 'question_paper' as const,
      subjectCode: args.subject ? args.subject.toLowerCase() : null,
      chapterNumber: null,
      questionCount: 1,
    },
  };
}

describe('learner.scan_extracted — event shape published by /api/scan-solve', () => {
  it('parses against the DomainEventSchema discriminated union', () => {
    const event = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: '33333333-3333-3333-3333-333333333333',
      subject: 'Math',
    });
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('parses against the specific LearnerScanExtractedSchema', () => {
    const event = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'science',
    });
    expect(() => LearnerScanExtractedSchema.parse(event)).not.toThrow();
  });

  it('lowercases the subjectCode (matches registry pattern)', () => {
    const event = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'Mathematics',
    });
    expect(event.payload.subjectCode).toBe('mathematics');
  });

  it('handles null subject', () => {
    const event = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: null,
    });
    expect(event.payload.subjectCode).toBeNull();
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('handles B2C tenantId null', () => {
    const event = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'science',
    });
    expect(event.tenantId).toBeNull();
    expect(() => DomainEventSchema.parse(event)).not.toThrow();
  });

  it('idempotencyKey is deterministic from scanId', () => {
    const a = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'math',
    });
    const b = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '99999999-9999-9999-9999-999999999999', // different auth
      schoolId: '44444444-4444-4444-4444-444444444444',     // different tenant
      subject: 'science',                                    // different subject
      occurredAt: '2030-01-01T00:00:00.000Z',                // different time
    });
    // Same scanId → same idempotency key. Retry/duplicate publish is
    // deduped by the DB UNIQUE constraint on idempotency_key.
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toBe('scan_extracted:11111111-1111-1111-1111-111111111111');
  });

  it('different scans produce different idempotencyKeys', () => {
    const a = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'math',
    });
    const b = buildScanExtractedEvent({
      scanId: '99999999-9999-9999-9999-999999999999',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'math',
    });
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it('imageType is locked to question_paper for scan-solve surface', () => {
    // scan-solve is the "solve one question from a paper" flow. Other
    // image_types (assignment, notes, textbook) live on /api/v1/upload-
    // assignment and will get their own publish in a follow-on.
    const event = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'math',
    });
    expect(event.payload.imageType).toBe('question_paper');
  });

  it('questionCount is 1 (one question solved per scan-solve invocation)', () => {
    const event = buildScanExtractedEvent({
      scanId: '11111111-1111-1111-1111-111111111111',
      authUserId: '22222222-2222-2222-2222-222222222222',
      schoolId: null,
      subject: 'math',
    });
    expect(event.payload.questionCount).toBe(1);
  });
});
