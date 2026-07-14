/**
 * learner.turn_classified — Foxy per-turn PERCEPTION classifier schema.
 *
 * Phase 1 of the Foxy Intelligent Learning OS: a compact, structured read of
 * every Foxy turn that feeds in-turn adaptation, analytics, and reports. This
 * suite pins:
 *   - accept: a well-formed payload parses
 *   - P5: grade is a STRING "6".."12" (integer / out-of-range grades rejected)
 *   - shape: enum + nullability rules for bloomLevel / struggleSignal / etc.
 *   - P13 / binding contract: the payload has NO free-text / PII fields — the
 *     ONLY strings are the subjectCode + short LABEL fields, and nothing on the
 *     schema can carry message text, email, phone, or name.
 *
 * Pure schema parse — no DB, no Supabase, no bus.
 */
import { describe, expect, it } from 'vitest';
import {
  DomainEventSchema,
  LearnerTurnClassifiedSchema,
} from '@alfanumrik/lib/state/events/registry';

const UUID_A = '00000000-0000-0000-0000-000000000001';
const UUID_B = '00000000-0000-0000-0000-000000000002';
const UUID_C = '00000000-0000-0000-0000-000000000003';
const ISO = '2026-07-15T09:30:00.000Z';

const envelope = {
  eventId: UUID_A,
  occurredAt: ISO,
  actorAuthUserId: UUID_B,
  tenantId: null,
  idempotencyKey: 'turn-classified-1',
  kind: 'learner.turn_classified' as const,
};

const validPayload = {
  studentId: UUID_B,
  foxySessionId: UUID_A,
  messageId: UUID_C,
  subjectCode: 'math',
  grade: '9',
  chapterNumber: 4,
  topicId: UUID_C,
  bloomLevel: 'apply' as const,
  misconceptionCode: 'MATH.FRAC.EQUIV.01',
  struggleSignal: 'repeated_wrong' as const,
  intent: 'check_answer',
};

describe('learner.turn_classified schema', () => {
  it('accepts a well-formed payload through the discriminated union', () => {
    const res = DomainEventSchema.safeParse({ ...envelope, payload: validPayload });
    expect(res.success).toBe(true);
  });

  it('accepts nullable fields set to null (pre-binding turn)', () => {
    const res = LearnerTurnClassifiedSchema.safeParse({
      ...envelope,
      payload: {
        ...validPayload,
        chapterNumber: null,
        topicId: null,
        bloomLevel: null,
        misconceptionCode: null,
        struggleSignal: 'none',
      },
    });
    expect(res.success).toBe(true);
  });

  // ── P5: grade is a string "6".."12" ──────────────────────────────────
  it('rejects an integer grade (P5 — grades are strings)', () => {
    const res = LearnerTurnClassifiedSchema.safeParse({
      ...envelope,
      payload: { ...validPayload, grade: 9 },
    });
    expect(res.success).toBe(false);
  });

  it('rejects an out-of-range grade string', () => {
    for (const bad of ['5', '13', '0', 'K', '']) {
      const res = LearnerTurnClassifiedSchema.safeParse({
        ...envelope,
        payload: { ...validPayload, grade: bad },
      });
      expect(res.success, `grade "${bad}" should be rejected`).toBe(false);
    }
  });

  it('accepts every valid grade string 6..12', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      const res = LearnerTurnClassifiedSchema.safeParse({
        ...envelope,
        payload: { ...validPayload, grade: g },
      });
      expect(res.success, `grade "${g}" should be accepted`).toBe(true);
    }
  });

  // ── enum / nullability shape ─────────────────────────────────────────
  it('rejects an unknown struggleSignal', () => {
    const res = LearnerTurnClassifiedSchema.safeParse({
      ...envelope,
      payload: { ...validPayload, struggleSignal: 'panic' },
    });
    expect(res.success).toBe(false);
  });

  it('rejects a PascalCase bloomLevel (canonical lowercase taxonomy only)', () => {
    // Bloom casing on this state/observability event is the LOWERCASE canon —
    // identical to cognitive-engine's BloomLevel and the bloom_progression /
    // question_bank columns it feeds. Foxy's PascalCase MCQ-block enum is a
    // separate LLM-rendering artifact and must NOT reach the bus un-normalized.
    const res = LearnerTurnClassifiedSchema.safeParse({
      ...envelope,
      payload: { ...validPayload, bloomLevel: 'Apply' },
    });
    expect(res.success).toBe(false);
  });

  it('accepts every canonical lowercase bloomLevel (correct order + spelling)', () => {
    for (const level of ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']) {
      const res = LearnerTurnClassifiedSchema.safeParse({
        ...envelope,
        payload: { ...validPayload, bloomLevel: level },
      });
      expect(res.success, `bloomLevel "${level}" should be accepted`).toBe(true);
    }
  });

  it('rejects a non-uuid messageId', () => {
    const res = LearnerTurnClassifiedSchema.safeParse({
      ...envelope,
      payload: { ...validPayload, messageId: 'not-a-uuid' },
    });
    expect(res.success).toBe(false);
  });

  // ── P13 / binding observability contract ─────────────────────────────
  it('drops unknown PII-shaped keys — no messageText/email/phone/name reach the row', () => {
    // Zod object schemas strip unknown keys by default. Even if a caller tries
    // to smuggle message text or PII onto the payload, the parsed output carries
    // ONLY the declared code/id/enum fields. This is the P13 boundary: the raw
    // turn content is never echoed onto the bus.
    const parsed = LearnerTurnClassifiedSchema.parse({
      ...envelope,
      payload: {
        ...validPayload,
        messageText: 'my name is Aarav and my phone is 9876543210',
        email: 'kid@example.com',
        studentName: 'Aarav Sharma',
      },
    });
    const payloadKeys = Object.keys(parsed.payload);
    for (const forbidden of ['messageText', 'email', 'studentName', 'phone', 'name']) {
      expect(payloadKeys).not.toContain(forbidden);
    }
  });

  it('the declared payload shape is exactly the codes/ids/enums contract (no raw-text field)', () => {
    // Enumerate the schema keys and pin the whole set. The only free-form
    // strings are subjectCode + the bounded LABEL fields (misconceptionCode,
    // intent). If a future edit adds a raw-text field (e.g. messageText), this
    // pin fails and forces a P13 review.
    const declaredKeys = Object.keys(
      LearnerTurnClassifiedSchema.shape.payload.shape,
    ).sort();
    expect(declaredKeys).toEqual(
      [
        'bloomLevel',
        'chapterNumber',
        'foxySessionId',
        'grade',
        'intent',
        'messageId',
        'misconceptionCode',
        'struggleSignal',
        'studentId',
        'subjectCode',
        'topicId',
      ].sort(),
    );
  });
});
