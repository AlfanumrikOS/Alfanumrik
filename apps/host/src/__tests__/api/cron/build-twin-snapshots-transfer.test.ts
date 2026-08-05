/**
 * /api/cron/build-twin-snapshots — D12 transfer-evidence step
 * (Foxy North-Star Phase 3).
 *
 * Pins:
 *   - gated on ff_prereq_gating_v1 (OFF → skipped:'flag_off', zero writes)
 *   - uses the REAL pure module detectTransferEvidence (0.7 source threshold
 *     lives there — this test exercises it end-to-end through the route)
 *   - one record_transfer_evidence(p_student_id, p_topic_id, p_from_topic_id)
 *     RPC per record + one learner.transfer_evidence event with a
 *     day-bucketed idempotencyKey
 *   - RPC failure → counted error, NO event for that record, run continues
 *   - independent of the twin build (twin flag OFF here — transfer still runs)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/cron-auth', () => ({
  verifyCronAuth: vi.fn(() => ({ ok: true })),
}));

const isFeatureEnabledMock = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...(args as [])),
  DIGITAL_TWIN_FLAGS: { V1: 'ff_digital_twin_v1' },
}));

vi.mock('@alfanumrik/lib/cognitive-engine', () => ({
  predictRetention: vi.fn(() => 0.9),
}));

const publishMock = vi.fn(async () => undefined);
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...args: unknown[]) => publishMock(...(args as [])),
}));

// ── fixture ids ─────────────────────────────────────────────────────────────
const STUDENT_ID = '00000000-0000-0000-0000-0000000000a1';
const AUTH_ID = '00000000-0000-0000-0000-0000000000a2';
const QUESTION_ID = '00000000-0000-0000-0000-0000000000b1';
const TOPIC_T = '00000000-0000-0000-0000-0000000000c1'; // succeeded target
const TOPIC_F = '00000000-0000-0000-0000-0000000000d1'; // solid source

const rpcMock = vi.fn();

const state: {
  responses: unknown[];
  questions: unknown[];
  edges: unknown[];
  mastery: unknown[];
  students: unknown[];
} = { responses: [], questions: [], edges: [], mastery: [], students: [] };

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...(args as [])),
    from: vi.fn((table: string) => {
      if (table === 'quiz_responses') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ not: vi.fn(() => ({ gte: vi.fn(() => ({ lt: vi.fn(() => ({ limit: vi.fn(async () => ({ data: state.responses, error: null })) })) })) })) })) })) };
      }
      if (table === 'question_bank') {
        return { select: vi.fn(() => ({ in: vi.fn(() => ({ not: vi.fn(async () => ({ data: state.questions, error: null })) })) })) };
      }
      if (table === 'concept_edges') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(async () => ({ data: state.edges, error: null })) })) })) };
      }
      if (table === 'concept_mastery') {
        return { select: vi.fn(() => ({ in: vi.fn(() => ({ in: vi.fn(async () => ({ data: state.mastery, error: null })) })) })) };
      }
      if (table === 'students') {
        return { select: vi.fn(() => ({ in: vi.fn(async () => ({ data: state.students, error: null })) })) };
      }
      throw new Error(`unexpected table ${table} (twin build should be flag-off)`);
    }),
  },
}));

import { POST } from '@/app/api/cron/build-twin-snapshots/route';

function mkReq(): NextRequest {
  return new NextRequest('http://localhost/api/cron/build-twin-snapshots', {
    method: 'POST',
    headers: { Authorization: 'Bearer test' },
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: {}, error: null });
  publishMock.mockClear();
  isFeatureEnabledMock.mockReset();
  // Twin build OFF (isolates the transfer step); prereq gating ON.
  isFeatureEnabledMock.mockImplementation(async (flag: string) => flag === 'ff_prereq_gating_v1');

  state.responses = [
    { student_id: STUDENT_ID, question_id: QUESTION_ID, subject: 'Math' },
  ];
  state.questions = [{ id: QUESTION_ID, topic_id: TOPIC_T }];
  state.edges = [{ from_topic_id: TOPIC_F, to_topic_id: TOPIC_T, edge_type: 'transfer' }];
  state.mastery = [{ student_id: STUDENT_ID, topic_id: TOPIC_F, mastery_probability: 0.8 }];
  state.students = [{ id: STUDENT_ID, auth_user_id: AUTH_ID, school_id: null }];
});

describe('build-twin-snapshots D12 transfer step', () => {
  it('flag OFF → skipped, zero RPC calls and zero events', async () => {
    isFeatureEnabledMock.mockResolvedValue(false); // both flags off
    const res = await POST(mkReq());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.transfer.skipped).toBe('flag_off');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('correct answer on T + transfer edge F→T + solid F (0.8) → RPC + event', async () => {
    const res = await POST(mkReq());
    const body = await res.json();
    expect(body.data.transfer).toMatchObject({ candidates: 1, evidenceRecorded: 1, errors: 0 });

    // Binding pin (assessment Phase 3 item 4): evidence lands on the SOURCE
    // topic (already-solid prerequisite = TOPIC_F). p_topic_id is the SOURCE,
    // p_from_topic_id is the dependent TARGET (today's success = TOPIC_T) —
    // migration 20260809000600's comment: "mastery of p_topic_id evidenced
    // indirectly from correct work in dependent p_from_topic_id".
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith('record_transfer_evidence', {
      p_student_id: STUDENT_ID,
      p_topic_id: TOPIC_F,      // SOURCE
      p_from_topic_id: TOPIC_T, // TARGET (dependent)
    });

    expect(publishMock).toHaveBeenCalledOnce();
    const [, event] = publishMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(event.kind).toBe('learner.transfer_evidence');
    expect(event.actorAuthUserId).toBe(AUTH_ID);
    // Idempotency key uses source:target ordering (mirrors payload shape).
    expect(String(event.idempotencyKey)).toMatch(
      new RegExp(`^transfer:${STUDENT_ID}:${TOPIC_F}:${TOPIC_T}:\\d{4}-\\d{2}-\\d{2}$`),
    );
    // Payload pin: the LearnerTransferEvidenceSchema requires sourceTopicId/
    // targetTopicId (not topicId/fromTopicId). Publishing with the old field
    // names would be silently swallowed by publishEvent's try/catch (zod
    // rejection); asserting the shape here catches any regression.
    expect(event.payload).toMatchObject({
      studentId: STUDENT_ID,
      sourceTopicId: TOPIC_F,
      targetTopicId: TOPIC_T,
      subjectCode: 'math', // lowercased from quiz_responses.subject
      sourceMastery: 0.8,
    });
    // Absence of the legacy field names — cheap regression tripwire.
    expect(event.payload).not.toHaveProperty('topicId');
    expect(event.payload).not.toHaveProperty('fromTopicId');
  });

  it('source mastery below the module threshold (0.6 < 0.7) → no evidence', async () => {
    state.mastery = [{ student_id: STUDENT_ID, topic_id: TOPIC_F, mastery_probability: 0.6 }];
    const res = await POST(mkReq());
    const body = await res.json();
    expect(body.data.transfer).toMatchObject({ candidates: 0, evidenceRecorded: 0 });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('non-transfer edge type → no evidence (module filters edge_type)', async () => {
    state.edges = [{ from_topic_id: TOPIC_F, to_topic_id: TOPIC_T, edge_type: 'prerequisite' }];
    // NOTE: the route only queries edge_type='transfer', but the module ALSO
    // re-filters — feed the row through to pin the double guard.
    const res = await POST(mkReq());
    const body = await res.json();
    expect(body.data.transfer.evidenceRecorded).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('RPC failure → counted error, no event, run still succeeds', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await POST(mkReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.transfer).toMatchObject({ candidates: 1, evidenceRecorded: 0, errors: 1 });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('missing auth_user_id → canonical RPC still lands, event skipped', async () => {
    state.students = [{ id: STUDENT_ID, auth_user_id: null, school_id: null }];
    const res = await POST(mkReq());
    const body = await res.json();
    expect(body.data.transfer.evidenceRecorded).toBe(1);
    expect(publishMock).not.toHaveBeenCalled();
  });
});
