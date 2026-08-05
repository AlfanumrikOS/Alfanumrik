/**
 * Transfer-evidence pins (Foxy North-Star Phase 3, D12).
 * Pure function — no mocks needed. Threshold pin: source mastery >= 0.7.
 */

import { describe, it, expect } from 'vitest';
import {
  detectTransferEvidence,
  evaluateTransferEvidence,
  TRANSFER_SOURCE_MASTERY_MIN,
} from '../../learn/transfer-evidence';

const STUDENT = 'stu-1';

describe('detectTransferEvidence', () => {
  it('threshold constant is 0.7 (assessment-owned "solid mastery" line)', () => {
    expect(TRANSFER_SOURCE_MASTERY_MIN).toBe(0.7);
  });

  it('emits a record when: transfer edge + correct on target + solid source mastery', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 2 }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' }],
      sourceMastery: [{ topicId: 'F', masteryProbability: 0.85 }],
    });
    expect(out).toEqual([{ studentId: STUDENT, topicId: 'T', fromTopicId: 'F' }]);
  });

  it('source mastery exactly at 0.7 counts (inclusive boundary)', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 1 }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' }],
      sourceMastery: [{ topicId: 'F', masteryProbability: 0.7 }],
    });
    expect(out).toHaveLength(1);
  });

  it('source mastery below 0.7 emits nothing', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 1 }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' }],
      sourceMastery: [{ topicId: 'F', masteryProbability: 0.69 }],
    });
    expect(out).toEqual([]);
  });

  it('non-transfer edge types (prerequisite/corequisite) are ignored', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 1 }],
      transferEdges: [
        { fromTopicId: 'F', toTopicId: 'T', edgeType: 'prerequisite' },
        { fromTopicId: 'F', toTopicId: 'T', edgeType: 'corequisite' },
      ],
      sourceMastery: [{ topicId: 'F', masteryProbability: 0.9 }],
    });
    expect(out).toEqual([]);
  });

  it('zero correct responses on the target emits nothing', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 0 }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' }],
      sourceMastery: [{ topicId: 'F', masteryProbability: 0.9 }],
    });
    expect(out).toEqual([]);
  });

  it('duplicate edges dedupe to one record per (target, source) pair', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 1 }],
      transferEdges: [
        { fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' },
        { fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' },
      ],
      sourceMastery: [{ topicId: 'F', masteryProbability: 0.9 }],
    });
    expect(out).toHaveLength(1);
  });

  it('multiple sources into one target emit one record each', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 3 }],
      transferEdges: [
        { fromTopicId: 'F1', toTopicId: 'T', edgeType: 'transfer' },
        { fromTopicId: 'F2', toTopicId: 'T', edgeType: 'transfer' },
        { fromTopicId: 'F3', toTopicId: 'T', edgeType: 'transfer' },
      ],
      sourceMastery: [
        { topicId: 'F1', masteryProbability: 0.9 },
        { topicId: 'F2', masteryProbability: 0.75 },
        { topicId: 'F3', masteryProbability: 0.4 }, // below floor — excluded
      ],
    });
    expect(out).toEqual([
      { studentId: STUDENT, topicId: 'T', fromTopicId: 'F1' },
      { studentId: STUDENT, topicId: 'T', fromTopicId: 'F2' },
    ]);
  });

  it('source with no mastery record emits nothing (no evidence, no claim)', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 1 }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' }],
      sourceMastery: [],
    });
    expect(out).toEqual([]);
  });

  it('self-loop edges are ignored defensively', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 1 }],
      transferEdges: [{ fromTopicId: 'T', toTopicId: 'T', edgeType: 'transfer' }],
      sourceMastery: [{ topicId: 'T', masteryProbability: 0.9 }],
    });
    expect(out).toEqual([]);
  });

  it('empty inputs → empty output', () => {
    expect(
      detectTransferEvidence({
        studentId: STUDENT,
        correctByTopic: [],
        transferEdges: [],
        sourceMastery: [],
      }),
    ).toEqual([]);
  });

  it('non-finite mastery values never qualify', () => {
    const out = detectTransferEvidence({
      studentId: STUDENT,
      correctByTopic: [{ topicId: 'T', correctCount: 1 }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T', edgeType: 'transfer' }],
      sourceMastery: [{ topicId: 'F', masteryProbability: Number.NaN }],
    });
    expect(out).toEqual([]);
  });
});

describe('evaluateTransferEvidence (batch/cron entry point — same 0.7 rule)', () => {
  it('emits full outcome records (source, target, subject, mastery echoed)', () => {
    const out = evaluateTransferEvidence({
      correctResponses: [{ studentId: 'S1', topicId: 'T', subjectCode: 'math' }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T' }],
      sourceMastery: (sid, tid) => (sid === 'S1' && tid === 'F' ? 0.8 : null),
    });
    expect(out).toEqual([
      {
        studentId: 'S1',
        sourceTopicId: 'F',
        targetTopicId: 'T',
        subjectCode: 'math',
        sourceMastery: 0.8,
      },
    ]);
  });

  it('applies the SAME threshold: 0.7 qualifies, 0.69 does not, null never', () => {
    const base = {
      correctResponses: [{ studentId: 'S1', topicId: 'T', subjectCode: null }],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T' }],
    };
    expect(
      evaluateTransferEvidence({ ...base, sourceMastery: () => TRANSFER_SOURCE_MASTERY_MIN }),
    ).toHaveLength(1);
    expect(evaluateTransferEvidence({ ...base, sourceMastery: () => 0.69 })).toEqual([]);
    expect(evaluateTransferEvidence({ ...base, sourceMastery: () => null })).toEqual([]);
    expect(evaluateTransferEvidence({ ...base, sourceMastery: () => Number.NaN })).toEqual([]);
  });

  it('is per-student: only students who answered the target correctly get records', () => {
    const out = evaluateTransferEvidence({
      correctResponses: [
        { studentId: 'S1', topicId: 'T', subjectCode: 'science' },
        { studentId: 'S2', topicId: 'OTHER', subjectCode: 'science' },
      ],
      transferEdges: [{ fromTopicId: 'F', toTopicId: 'T' }],
      sourceMastery: () => 0.9,
    });
    expect(out.map((r) => r.studentId)).toEqual(['S1']);
  });

  it('dedupes repeated correct responses and duplicate edges per (student, pair)', () => {
    const out = evaluateTransferEvidence({
      correctResponses: [
        { studentId: 'S1', topicId: 'T', subjectCode: 'math' },
        { studentId: 'S1', topicId: 'T', subjectCode: 'math' },
      ],
      transferEdges: [
        { fromTopicId: 'F', toTopicId: 'T' },
        { fromTopicId: 'F', toTopicId: 'T' },
      ],
      sourceMastery: () => 0.9,
    });
    expect(out).toHaveLength(1);
  });

  it('re-checks edgeType defensively when present, and skips self-loops', () => {
    const out = evaluateTransferEvidence({
      correctResponses: [{ studentId: 'S1', topicId: 'T', subjectCode: null }],
      transferEdges: [
        { fromTopicId: 'F', toTopicId: 'T', edgeType: 'prerequisite' },
        { fromTopicId: 'T', toTopicId: 'T' },
      ],
      sourceMastery: () => 0.9,
    });
    expect(out).toEqual([]);
  });
});
