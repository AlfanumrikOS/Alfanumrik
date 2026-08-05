/**
 * Unit tests for the K3 evidence builder — the pure aggregation used by both
 * the API route and the teacher-dashboard Deno EF.
 */
import { describe, expect, it } from 'vitest';
import {
  buildEvidenceFromRows,
  buildEvidenceForStudents,
  evidenceToJsonb,
  type EvidenceRow,
  type EvidenceQueryClient,
} from '../../teacher/remediation-evidence';

const S1 = '00000000-0000-0000-0000-000000000001';
const S2 = '00000000-0000-0000-0000-000000000002';
const M1 = '00000000-0000-0000-0000-0000000000a1';
const M2 = '00000000-0000-0000-0000-0000000000a2';

describe('buildEvidenceFromRows', () => {
  it('seeds zero-evidence for every requested student even when there are no rows', () => {
    const out = buildEvidenceFromRows([], [S1, S2], 14);
    expect(out.size).toBe(2);
    expect(out.get(S1)).toMatchObject({
      attempts: 0,
      incorrect: 0,
      hintLevelMax: null,
      misconceptionIds: [],
      firstSeen: null,
      lastSeen: null,
      sinceDays: 14,
    });
  });

  it('aggregates attempts / incorrect / hint / misconceptions per student', () => {
    const rows: EvidenceRow[] = [
      { student_id: S1, is_correct: true, hint_level: 0, misconception_id: null, created_at: '2026-08-01T10:00:00.000Z' },
      { student_id: S1, is_correct: false, hint_level: 2, misconception_id: M1, created_at: '2026-08-02T10:00:00.000Z' },
      { student_id: S1, is_correct: false, hint_level: 5, misconception_id: M1, created_at: '2026-08-03T10:00:00.000Z' },
      { student_id: S2, is_correct: false, hint_level: 1, misconception_id: M2, created_at: '2026-08-01T09:00:00.000Z' },
    ];
    const out = buildEvidenceFromRows(rows, [S1, S2], 14);
    expect(out.get(S1)).toMatchObject({
      attempts: 3,
      incorrect: 2,
      hintLevelMax: 5,
      misconceptionIds: [M1], // deduped
      firstSeen: '2026-08-01T10:00:00.000Z',
      lastSeen: '2026-08-03T10:00:00.000Z',
    });
    expect(out.get(S2)).toMatchObject({
      attempts: 1,
      incorrect: 1,
      hintLevelMax: 1,
      misconceptionIds: [M2],
    });
  });

  it('ignores rows for students not in the requested scope', () => {
    const rows: EvidenceRow[] = [
      { student_id: 'ghost', is_correct: false, hint_level: null, misconception_id: null, created_at: '2026-08-01T00:00:00.000Z' },
    ];
    const out = buildEvidenceFromRows(rows, [S1], 14);
    expect(out.get(S1)!.attempts).toBe(0);
    expect(out.has('ghost')).toBe(false);
  });

  it('strips the internal _misconceptionSet from returned Evidence objects', () => {
    const out = buildEvidenceFromRows([], [S1], 7);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((out.get(S1) as any)._misconceptionSet).toBeUndefined();
  });
});

describe('buildEvidenceForStudents (client fail-soft)', () => {
  it('returns empty map for empty student list without hitting the client', async () => {
    let called = false;
    const client: EvidenceQueryClient = {
      from() { called = true; return {} as never; },
    };
    const out = await buildEvidenceForStudents(client, [], 14);
    expect(out.size).toBe(0);
    expect(called).toBe(false);
  });

  it('returns zero-evidence for every requested student on query error', async () => {
    const client: EvidenceQueryClient = {
      from: () => ({
        select: () => ({
          in: () => ({
            gte: async () => ({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    };
    const out = await buildEvidenceForStudents(client, [S1, S2], 14);
    expect(out.size).toBe(2);
    expect(out.get(S1)!.attempts).toBe(0);
    expect(out.get(S2)!.attempts).toBe(0);
  });

  it('clamps sinceDays to 1..90', async () => {
    let capturedIso = '';
    const client: EvidenceQueryClient = {
      from: () => ({
        select: () => ({
          in: () => ({
            gte: async (_col: string, iso: string) => {
              capturedIso = iso;
              return { data: [], error: null };
            },
          }),
        }),
      }),
    };
    await buildEvidenceForStudents(client, [S1], 999);
    // Clamped to 90; iso should be ~90 days ago (allow 10s skew).
    const clampedMs = Date.parse(capturedIso);
    const ninetyAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(clampedMs - ninetyAgoMs)).toBeLessThan(10_000);
  });
});

describe('evidenceToJsonb', () => {
  it('emits snake_case + schema_version for the JSONB column', () => {
    const ev = buildEvidenceFromRows(
      [{ student_id: S1, is_correct: false, hint_level: 3, misconception_id: M1, created_at: '2026-08-01T00:00:00.000Z' }],
      [S1],
      14,
    ).get(S1)!;
    const jsonb = evidenceToJsonb(ev);
    expect(jsonb).toEqual({
      attempts: 1,
      incorrect: 1,
      hint_level_max: 3,
      misconception_ids: [M1],
      first_seen: '2026-08-01T00:00:00.000Z',
      last_seen: '2026-08-01T00:00:00.000Z',
      since_days: 14,
      schema_version: 1,
    });
  });
});
