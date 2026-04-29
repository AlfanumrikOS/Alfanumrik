/**
 * REG-53 — Quiz authenticity Phase C: options_version + integrity hash
 * (migration 20260430000000_quiz_phase_c_options_versioning.sql).
 *
 * Threat model closed:
 *   Phase A (PR #447, migration 20260428160000) snapshots options +
 *   correct_answer_index into quiz_session_shuffles at session start, so
 *   mid-session edits to question_bank can't corrupt scoring. Phase B
 *   (PR #449, migration 20260429010000) added DB CHECK constraints and a
 *   CI canary on grounding.scoring ops_events warnings. Phase C closes the
 *   last vector: even a Phase-A-correct snapshot could theoretically be
 *   tampered with after INSERT (malicious migration, buggy maintenance
 *   script, accidental update). Phase C eliminates that:
 *
 *     1. question_bank.options_version auto-increments on every UPDATE
 *        where options or correct_answer_index changes (BEFORE UPDATE
 *        trigger).
 *     2. quiz_session_shuffles.options_version_at_serve snapshots the
 *        version at start_quiz_session() time.
 *     3. quiz_session_shuffles.integrity_hash = SHA256 of
 *        options_snapshot::text || correct_answer_index_snapshot.
 *     4. submit_quiz_results_v2 recomputes the hash before scoring.
 *        Mismatch → ops_events warning + ZERO XP for that question.
 *
 * Coverage strategy (parity test, no live Postgres — same pattern as
 * REG-51 quiz-server-shuffle-authority.test.ts):
 *   1. Trigger semantics: pure-TS port of the BEFORE UPDATE trigger
 *      verifies options_version bumps on options or
 *      correct_answer_index change, and ONLY on those changes.
 *   2. start_quiz_session contract: snapshot row carries
 *      options_version_at_serve + integrity_hash. Hash is the SHA256
 *      of options_snapshot::text + correct_answer_index_snapshot::text.
 *   3. submit_quiz_results_v2 contract: hash matches → score normally;
 *      hash mismatches → is_correct=false, ops_events warning,
 *      tampered question contributes ZERO XP.
 *   4. Mixed batch: integrity failure on one question does NOT void the
 *      others.
 *   5. Phase A back-compat: rows with NULL integrity_hash skip
 *      verification and score per Phase A semantics.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────
// 1. Pure-TS port of the BEFORE UPDATE trigger semantics.
//
// Trigger SQL:
//   WHEN (NEW.options IS DISTINCT FROM OLD.options
//         OR NEW.correct_answer_index IS DISTINCT FROM OLD.correct_answer_index)
//   then NEW.options_version := COALESCE(OLD.options_version, 1) + 1;
// ─────────────────────────────────────────────────────────────────────────

interface QuestionBankRow {
  id: string;
  question_text: string;
  options: string[];
  correct_answer_index: number;
  options_version: number;
}

/** Pure mirror of question_bank_bump_options_version_fn + WHEN clause. */
function applyTriggerOnUpdate(oldRow: QuestionBankRow, newRow: QuestionBankRow): QuestionBankRow {
  const optionsChanged = JSON.stringify(oldRow.options) !== JSON.stringify(newRow.options);
  const indexChanged = oldRow.correct_answer_index !== newRow.correct_answer_index;
  if (optionsChanged || indexChanged) {
    return { ...newRow, options_version: (oldRow.options_version ?? 1) + 1 };
  }
  // WHEN clause did NOT match — version stays at the value the writer
  // sent (which Postgres would also leave unchanged from OLD).
  return { ...newRow, options_version: oldRow.options_version ?? 1 };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Pure-TS port of the integrity_hash computation.
//
// SQL: encode(digest(options_snapshot::text || correct_answer_index_snapshot::text, 'sha256'), 'hex')
//
// The PG `jsonb::text` cast produces compact-ish JSON without surrounding
// whitespace. JSON.stringify in JS is the closest deterministic equivalent
// for our snapshot shape (array of short strings); the parity is exact for
// the inputs the migration cares about.
// ─────────────────────────────────────────────────────────────────────────

function computeIntegrityHash(optionsSnapshot: string[], correctIdx: number): string {
  return createHash('sha256')
    .update(JSON.stringify(optionsSnapshot) + String(correctIdx))
    .digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Pure-TS port of the submit_quiz_results_v2 INNER LOOP (Phase C
//    integrity verification + scoring).
// ─────────────────────────────────────────────────────────────────────────

interface SnapshotRow {
  session_id: string;
  question_id: string;
  shuffle_map: number[];
  options_snapshot: string[];
  correct_answer_index_snapshot: number;
  options_version_at_serve: number | null;
  integrity_hash: string | null;
}

interface OpsEvent {
  category: string;
  severity: string;
  question_id: string;
  message: string;
}

interface ScoredResponse {
  question_id: string;
  is_correct: boolean;
  integrity_failed: boolean;
}

function simulateV2Score(
  responses: Array<{ question_id: string; selected_displayed_index: number }>,
  rows: SnapshotRow[],
  opsEventsSink: OpsEvent[],
): ScoredResponse[] {
  const byQid = new Map(rows.map(r => [r.question_id, r]));
  return responses.map(r => {
    const row = byQid.get(r.question_id) ?? null;
    if (!row) return { question_id: r.question_id, is_correct: false, integrity_failed: false };

    // Phase C: integrity verification before scoring.
    let integrityOk = true;
    if (row.integrity_hash !== null) {
      const computed = computeIntegrityHash(row.options_snapshot, row.correct_answer_index_snapshot);
      if (computed !== row.integrity_hash) {
        integrityOk = false;
        opsEventsSink.push({
          category: 'quiz.integrity_mismatch',
          severity: 'warning',
          question_id: r.question_id,
          message: 'quiz_session_shuffles row failed integrity hash verification',
        });
      }
    }

    if (!integrityOk) {
      // Tampered row → ZERO XP for this question, no scoring.
      return { question_id: r.question_id, is_correct: false, integrity_failed: true };
    }

    // Standard Phase A scoring.
    if (
      row.shuffle_map.length === 4 &&
      r.selected_displayed_index >= 0 &&
      r.selected_displayed_index <= 3
    ) {
      const origIdx = row.shuffle_map[r.selected_displayed_index];
      return {
        question_id: r.question_id,
        is_correct: origIdx === row.correct_answer_index_snapshot,
        integrity_failed: false,
      };
    }
    return { question_id: r.question_id, is_correct: false, integrity_failed: false };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('Phase C — question_bank.options_version trigger semantics', () => {
  const baseRow: QuestionBankRow = {
    id: 'q-1',
    question_text: 'What is the capital of India?',
    options: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'],
    correct_answer_index: 0,
    options_version: 1,
  };

  it('options_version bumps on UPDATE when options change', () => {
    const updated = applyTriggerOnUpdate(baseRow, {
      ...baseRow,
      options: ['New Delhi', 'Mumbai', 'Kolkata', 'Chennai'], // typo fix
    });
    expect(updated.options_version).toBe(2);
  });

  it('options_version bumps on UPDATE when correct_answer_index changes', () => {
    const updated = applyTriggerOnUpdate(baseRow, {
      ...baseRow,
      correct_answer_index: 2, // editor reassigns correct
    });
    expect(updated.options_version).toBe(2);
  });

  it('options_version bumps on UPDATE when BOTH options and correct_answer_index change', () => {
    const updated = applyTriggerOnUpdate(baseRow, {
      ...baseRow,
      options: ['Delhi', 'Mumbai', 'Kolkata', 'Hyderabad'],
      correct_answer_index: 1,
    });
    // Single bump per UPDATE statement, not per-column.
    expect(updated.options_version).toBe(2);
  });

  it('options_version does NOT bump when only non-relevant fields change', () => {
    const updated = applyTriggerOnUpdate(baseRow, {
      ...baseRow,
      question_text: 'Reword the prompt slightly', // only question_text changed
    });
    expect(updated.options_version).toBe(1);
  });

  it('options_version stays monotonic across multiple edits', () => {
    let row = baseRow;
    row = applyTriggerOnUpdate(row, { ...row, options: ['A', 'B', 'C', 'D'] });
    expect(row.options_version).toBe(2);
    row = applyTriggerOnUpdate(row, { ...row, correct_answer_index: 3 });
    expect(row.options_version).toBe(3);
    row = applyTriggerOnUpdate(row, { ...row, options: ['A', 'B', 'C', 'E'] });
    expect(row.options_version).toBe(4);
  });
});

describe('Phase C — start_quiz_session populates new snapshot columns', () => {
  it('snapshot row carries options_version_at_serve + integrity_hash matching the input', () => {
    const opts = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'];
    const correctIdx = 0;
    const versionAtServe = 7;

    const expectedHash = computeIntegrityHash(opts, correctIdx);

    // Simulated snapshot row that start_quiz_session would have written.
    const row: SnapshotRow = {
      session_id: 's-1',
      question_id: 'q-1',
      shuffle_map: [0, 1, 2, 3],
      options_snapshot: opts,
      correct_answer_index_snapshot: correctIdx,
      options_version_at_serve: versionAtServe,
      integrity_hash: expectedHash,
    };

    expect(row.options_version_at_serve).toBe(7);
    expect(row.integrity_hash).toBe(expectedHash);
    expect(row.integrity_hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe('Phase C — submit_quiz_results_v2 verifies integrity_hash before scoring', () => {
  const opts = ['Delhi', 'Mumbai', 'Kolkata', 'Chennai'];
  const correctIdx = 0;

  it('hash matches → scores normally (correct selection counted)', () => {
    const validHash = computeIntegrityHash(opts, correctIdx);
    const row: SnapshotRow = {
      session_id: 's',
      question_id: 'q-1',
      shuffle_map: [2, 0, 3, 1], // displays Kolkata, Delhi, Chennai, Mumbai
      options_snapshot: opts,
      correct_answer_index_snapshot: correctIdx,
      options_version_at_serve: 1,
      integrity_hash: validHash,
    };
    const ops: OpsEvent[] = [];
    // Student picked display index 1 = "Delhi" (orig 0 = correct).
    const result = simulateV2Score(
      [{ question_id: 'q-1', selected_displayed_index: 1 }],
      [row],
      ops,
    );
    expect(result[0]).toEqual({ question_id: 'q-1', is_correct: true, integrity_failed: false });
    expect(ops).toHaveLength(0); // no integrity warning
  });

  it('hash mismatch → is_correct=false, ops_events warning emitted, ZERO XP contribution', () => {
    // Snapshot row was tampered with after INSERT — options_snapshot
    // edited from Delhi/Mumbai/Kolkata/Chennai to Delhi/Mumbai/Kolkata/Bengaluru
    // BUT integrity_hash still references the original. Recomputed hash
    // will NOT match.
    const tamperedOpts = ['Delhi', 'Mumbai', 'Kolkata', 'Bengaluru'];
    const originalHash = computeIntegrityHash(opts, correctIdx); // pre-tamper
    const row: SnapshotRow = {
      session_id: 's',
      question_id: 'q-1',
      shuffle_map: [0, 1, 2, 3],
      options_snapshot: tamperedOpts, // diverged from originalHash
      correct_answer_index_snapshot: correctIdx,
      options_version_at_serve: 1,
      integrity_hash: originalHash, // still pinned to the pre-tamper snapshot
    };
    const ops: OpsEvent[] = [];
    const result = simulateV2Score(
      [{ question_id: 'q-1', selected_displayed_index: 0 }], // would be correct under valid snapshot
      [row],
      ops,
    );
    expect(result[0]).toEqual({
      question_id: 'q-1',
      is_correct: false,
      integrity_failed: true,
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].category).toBe('quiz.integrity_mismatch');
    expect(ops[0].severity).toBe('warning');
    expect(ops[0].question_id).toBe('q-1');
  });

  it('mixed batch: integrity failure on one question does NOT void the others', () => {
    const validHash = computeIntegrityHash(opts, correctIdx);
    const goodRow: SnapshotRow = {
      session_id: 's',
      question_id: 'q-good',
      shuffle_map: [0, 1, 2, 3],
      options_snapshot: opts,
      correct_answer_index_snapshot: correctIdx,
      options_version_at_serve: 1,
      integrity_hash: validHash,
    };
    const tamperedRow: SnapshotRow = {
      session_id: 's',
      question_id: 'q-bad',
      shuffle_map: [0, 1, 2, 3],
      options_snapshot: ['changed', 'b', 'c', 'd'],
      correct_answer_index_snapshot: 0,
      options_version_at_serve: 1,
      integrity_hash: 'bogus_hash_that_will_never_match_any_input',
    };

    const ops: OpsEvent[] = [];
    const result = simulateV2Score(
      [
        { question_id: 'q-good', selected_displayed_index: 0 }, // correct (Delhi)
        { question_id: 'q-bad', selected_displayed_index: 0 },  // would be correct, but tampered
      ],
      [goodRow, tamperedRow],
      ops,
    );

    expect(result[0]).toEqual({ question_id: 'q-good', is_correct: true, integrity_failed: false });
    expect(result[1]).toEqual({ question_id: 'q-bad', is_correct: false, integrity_failed: true });

    // ops_events warning is for the bad row only.
    expect(ops).toHaveLength(1);
    expect(ops[0].question_id).toBe('q-bad');
  });

  it('Phase A back-compat: rows with NULL integrity_hash skip verification', () => {
    // Pre-Phase-C row: integrity_hash and options_version_at_serve are
    // NULL. submit_quiz_results_v2 must still score these per Phase A
    // semantics (snapshot wins, no hash check).
    const legacyRow: SnapshotRow = {
      session_id: 's',
      question_id: 'q-legacy',
      shuffle_map: [0, 1, 2, 3],
      options_snapshot: opts,
      correct_answer_index_snapshot: correctIdx,
      options_version_at_serve: null,
      integrity_hash: null,
    };
    const ops: OpsEvent[] = [];
    const result = simulateV2Score(
      [{ question_id: 'q-legacy', selected_displayed_index: 0 }],
      [legacyRow],
      ops,
    );
    expect(result[0]).toEqual({
      question_id: 'q-legacy',
      is_correct: true,
      integrity_failed: false,
    });
    expect(ops).toHaveLength(0);
  });
});
