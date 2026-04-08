/**
 * XP Ledger Parity Tests
 *
 * Documents and locks in the invariants introduced by the ledger audit
 * (migrations 20260405300000 and 20260408000004):
 *
 *   GAP 1: atomic_quiz_profile_update bypassed xp_transactions — now fixed.
 *          Quiz XP is written to the ledger first; reconcile_xp() can run
 *          safely without zeroing student XP.
 *
 *   GAP 2: Daily quiz XP cap (P2: 200 XP/day) was not server-side enforced —
 *          now enforced inside atomic_quiz_profile_update via the ledger sum.
 *
 *   GAP 3: No reference_id deduplication in xp_transactions — now guarded by
 *          the unique partial index on (reference_id WHERE NOT NULL) and the
 *          existence-check inside atomic_quiz_profile_update.
 *
 *   GAP 4: add_xp wrapper did not pass p_daily_cap — now routes through
 *          award_xp() which supports per-feature daily caps.
 *
 * Since the ledger functions are SQL (not TypeScript), these tests verify
 * the TypeScript-level logic that feeds into those functions: cap arithmetic,
 * reference_id generation, flagged-submission XP suppression, and the
 * reconciliation invariant.  Each test is fully independent.
 *
 * Regression catalog IDs added here:
 *   xp_ledger_quiz_cap_at_zero, xp_ledger_quiz_cap_partial,
 *   xp_ledger_reference_id_format, xp_ledger_idempotency_semantics,
 *   xp_ledger_flagged_zero, xp_ledger_reconcile_parity,
 *   xp_ledger_add_xp_routes_through_ledger
 */

import { describe, it, expect } from 'vitest';
import { XP_RULES } from '@/lib/xp-rules';
import { calculateScorePercent, calculateQuizXP } from '@/lib/scoring';

// ─── Ledger cap arithmetic (mirrors the SQL inside atomic_quiz_profile_update) ──
//
// v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp))
//
// This is the canonical TypeScript representation of that SQL expression.
// If the SQL changes, this helper must be updated to match.

function computeXpToAward(rawXp: number, todayQuizXp: number): number {
  const cap = XP_RULES.quiz_daily_cap; // 200
  return Math.max(0, Math.min(rawXp, cap - todayQuizXp));
}

// ─── Reference ID generation (mirrors atomic_quiz_profile_update Step 2) ──
//
// v_reference_id := 'quiz_' || p_session_id::TEXT
// NULL is returned when p_session_id IS NULL (legacy 4-param callers).

function buildReferenceId(sessionId: string | null | undefined): string | null {
  if (sessionId == null || sessionId === '') return null;
  return `quiz_${sessionId}`;
}

// ─── Simulated ledger (in-memory xp_transactions entries) ────────────────
// Used to test ON CONFLICT / dedup semantics without a real DB.

interface LedgerEntry {
  referenceId: string | null;
  amount: number;
  studentId: string;
}

class InMemoryLedger {
  private rows: LedgerEntry[] = [];

  insert(entry: LedgerEntry): { inserted: boolean } {
    // Partial unique index: duplicate reference_id (where not null) → skip
    if (
      entry.referenceId !== null &&
      this.rows.some((r) => r.referenceId === entry.referenceId)
    ) {
      return { inserted: false }; // ON CONFLICT DO NOTHING
    }
    this.rows.push(entry);
    return { inserted: true };
  }

  sumForStudent(studentId: string): number {
    return this.rows
      .filter((r) => r.studentId === studentId)
      .reduce((acc, r) => acc + r.amount, 0);
  }

  countForStudent(studentId: string): number {
    return this.rows.filter((r) => r.studentId === studentId).length;
  }

  todayQuizXp(studentId: string): number {
    // All rows are "today" in this in-memory simulation
    return this.rows
      .filter((r) => r.studentId === studentId && r.referenceId?.startsWith('quiz_'))
      .reduce((acc, r) => acc + r.amount, 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Ledger cap arithmetic — TypeScript mirror of the SQL in
//    atomic_quiz_profile_update Step 1 / Step 2
// ════════════════════════════════════════════════════════════════════════════

describe('Ledger cap arithmetic: computeXpToAward mirrors SQL GREATEST(0, LEAST(p_xp, 200 - today))', () => {
  it('awards full XP when nothing earned today', () => {
    expect(computeXpToAward(170, 0)).toBe(170);
  });

  it('awards partial XP when close to daily cap — xp_ledger_quiz_cap_partial', () => {
    // Student has 190 XP today; quiz earns 50 raw → only 10 allowed
    expect(computeXpToAward(50, 190)).toBe(10);
  });

  it('awards 0 when already at daily cap — xp_ledger_quiz_cap_at_zero', () => {
    expect(computeXpToAward(170, 200)).toBe(0);
  });

  it('awards 0 when over daily cap (e.g. legacy direct writes left total > 200)', () => {
    expect(computeXpToAward(50, 250)).toBe(0);
  });

  it('awards exactly 200 at the boundary (off-by-one: 200 is allowed, not rejected)', () => {
    // Student has 0 today; quiz earns exactly 200 → all 200 awarded
    expect(computeXpToAward(200, 0)).toBe(200);
  });

  it('cumulative awards across multiple quizzes never exceed 200', () => {
    // Three quizzes: 170, 170, 50 — only first 200 should be awarded
    let todayTotal = 0;
    const rawAwards = [170, 170, 50];
    const actualAwards: number[] = [];

    for (const raw of rawAwards) {
      const awarded = computeXpToAward(raw, todayTotal);
      actualAwards.push(awarded);
      todayTotal += awarded;
    }

    expect(todayTotal).toBe(200);
    expect(actualAwards[0]).toBe(170); // first quiz: full
    expect(actualAwards[1]).toBe(30);  // second quiz: 200 - 170 = 30 remaining
    expect(actualAwards[2]).toBe(0);   // third quiz: cap exhausted
  });

  it('partial award at 199 + quiz worth 170 → only 1 awarded', () => {
    expect(computeXpToAward(170, 199)).toBe(1);
  });

  it('DAILY_CAP constant is 200 (P2 invariant anchor)', () => {
    // If this constant changes, the ledger SQL must also be updated
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Reference ID generation — mirrors SQL Step 2 in atomic_quiz_profile_update
// ════════════════════════════════════════════════════════════════════════════

describe('Reference ID generation: buildReferenceId mirrors SQL v_reference_id assignment', () => {
  it("format is 'quiz_<sessionId>' — xp_ledger_reference_id_format", () => {
    const sessionId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(buildReferenceId(sessionId)).toBe(`quiz_${sessionId}`);
  });

  it('null sessionId returns null (legacy 4-param callers — no dedup guard)', () => {
    expect(buildReferenceId(null)).toBeNull();
  });

  it('undefined sessionId returns null', () => {
    expect(buildReferenceId(undefined)).toBeNull();
  });

  it('empty string sessionId returns null (treated as absent)', () => {
    expect(buildReferenceId('')).toBeNull();
  });

  it('reference_id prefix is exactly "quiz_" — not "quiz-" or "Quiz_"', () => {
    const id = buildReferenceId('abc-123');
    expect(id).toBe('quiz_abc-123');
    expect(id).not.toMatch(/^quiz-/);
    expect(id).not.toMatch(/^Quiz_/);
  });

  it('different session IDs produce different reference IDs', () => {
    const id1 = buildReferenceId('session-a');
    const id2 = buildReferenceId('session-b');
    expect(id1).not.toBe(id2);
  });

  it('same session ID always produces the same reference ID (deterministic)', () => {
    const sessionId = 'stable-session-xyz';
    expect(buildReferenceId(sessionId)).toBe(buildReferenceId(sessionId));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Idempotency semantics — unique partial index on reference_id
//    ON CONFLICT DO NOTHING: second submission with same session must not
//    create a second ledger entry — xp_ledger_idempotency_semantics
// ════════════════════════════════════════════════════════════════════════════

describe('XP ledger idempotency: duplicate reference_id → single ledger entry', () => {
  it('same session submitted twice results in exactly one ledger row — xp_ledger_idempotency_semantics', () => {
    const ledger = new InMemoryLedger();
    const studentId = 'student-1';
    const sessionId = 'session-abc';
    const refId = buildReferenceId(sessionId)!;
    const xpAmount = 100;

    // First submission
    const first = ledger.insert({ referenceId: refId, amount: xpAmount, studentId });
    // Second submission (retry / double-click / network duplicate)
    const second = ledger.insert({ referenceId: refId, amount: xpAmount, studentId });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false); // ON CONFLICT DO NOTHING
    expect(ledger.countForStudent(studentId)).toBe(1);
    expect(ledger.sumForStudent(studentId)).toBe(xpAmount); // not doubled
  });

  it('different sessions for same student both insert (not erroneously deduped)', () => {
    const ledger = new InMemoryLedger();
    const studentId = 'student-2';

    const first = ledger.insert({
      referenceId: buildReferenceId('session-1'),
      amount: 70,
      studentId,
    });
    const second = ledger.insert({
      referenceId: buildReferenceId('session-2'),
      amount: 100,
      studentId,
    });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(true);
    expect(ledger.countForStudent(studentId)).toBe(2);
    expect(ledger.sumForStudent(studentId)).toBe(170);
  });

  it('null reference_id rows are never deduplicated (legacy callers allowed multiple)', () => {
    const ledger = new InMemoryLedger();
    const studentId = 'student-3';

    // Two legacy submissions without session ID
    const first = ledger.insert({ referenceId: null, amount: 50, studentId });
    const second = ledger.insert({ referenceId: null, amount: 50, studentId });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(true); // null is not unique-constrained
    expect(ledger.countForStudent(studentId)).toBe(2);
  });

  it('deduplication only applies per-student (same reference_id for different students is fine)', () => {
    const ledger = new InMemoryLedger();
    const sharedSessionRef = buildReferenceId('shared-session-id');

    const forStudent1 = ledger.insert({ referenceId: sharedSessionRef, amount: 80, studentId: 'student-A' });
    // In reality reference_ids encode session IDs which are already per-student UUIDs,
    // but test the dedup boundary: the unique partial index is on (reference_id), not
    // (student_id, reference_id). Two students sharing the same reference_id string
    // would conflict at DB level. This test documents that edge case.
    // In production, session UUIDs are globally unique, so this cannot happen.
    const forStudent2 = ledger.insert({ referenceId: sharedSessionRef, amount: 80, studentId: 'student-B' });

    // Our in-memory ledger applies the same partial-unique semantics as the DB index.
    // The second insert is rejected because reference_id is already present.
    expect(forStudent1.inserted).toBe(true);
    expect(forStudent2.inserted).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Flagged submission → XP = 0
//    Anti-cheat check (P3): if a submission is flagged, XP must be 0.
//    This is enforced at the caller level (quiz page / submit endpoint) before
//    atomic_quiz_profile_update is invoked with xp=0.
//    — xp_ledger_flagged_zero
// ════════════════════════════════════════════════════════════════════════════

describe('Flagged submission: XP must be 0 regardless of score — xp_ledger_flagged_zero', () => {
  // The calling code (quiz page, API route) sets xp=0 on flagged submissions.
  // atomic_quiz_profile_update then receives p_xp=0, so v_xp_to_award = 0.
  // award_xp is skipped when v_xp_to_award = 0.

  function computeXpForSubmission(
    correct: number,
    total: number,
    isFlagged: boolean,
  ): number {
    if (isFlagged) return 0;
    const scorePct = calculateScorePercent(correct, total);
    return calculateQuizXP(correct, scorePct);
  }

  it('flagged=true → 0 XP even with perfect score (10/10)', () => {
    expect(computeXpForSubmission(10, 10, true)).toBe(0);
  });

  it('flagged=true → 0 XP with high score (8/10)', () => {
    expect(computeXpForSubmission(8, 10, true)).toBe(0);
  });

  it('flagged=true → 0 XP with partial score (5/10)', () => {
    expect(computeXpForSubmission(5, 10, true)).toBe(0);
  });

  it('flagged=false → XP calculated normally (8/10 = 100 XP)', () => {
    expect(computeXpForSubmission(8, 10, false)).toBe(100);
  });

  it('flagged=false → perfect score awards full 170 XP', () => {
    expect(computeXpForSubmission(10, 10, false)).toBe(170);
  });

  it('computeXpToAward(0, anything) = 0 (zero raw XP → nothing to ledger)', () => {
    expect(computeXpToAward(0, 0)).toBe(0);
    expect(computeXpToAward(0, 100)).toBe(0);
    expect(computeXpToAward(0, 200)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Reconciliation parity invariant — xp_ledger_reconcile_parity
//
//    Before migration 20260408000004, quiz XP was written directly to
//    students.xp_total without a ledger entry.  reconcile_xp() sums
//    xp_transactions and overwrites xp_total → quiz XP would be zeroed.
//
//    After the migration, every quiz award goes through award_xp(), which
//    inserts into xp_transactions AND updates xp_total atomically.
//    Invariant: SUM(xp_transactions.amount WHERE student=X) === students.xp_total
//    for any student X after any number of quiz submissions.
// ════════════════════════════════════════════════════════════════════════════

describe('Reconciliation parity: ledger sum must equal students.xp_total — xp_ledger_reconcile_parity', () => {
  interface SimStudent {
    xpTotal: number;
  }

  function simulateAwardXp(
    student: SimStudent,
    ledger: InMemoryLedger,
    studentId: string,
    amount: number,
    referenceId: string | null,
  ): number {
    if (amount <= 0) return student.xpTotal;
    const result = ledger.insert({ referenceId, amount, studentId });
    if (result.inserted) {
      student.xpTotal += amount;
    }
    return student.xpTotal;
  }

  function reconcile(student: SimStudent, ledger: InMemoryLedger, studentId: string): void {
    // Mirrors reconcile_xp(): SET xp_total = SUM(xp_transactions.amount)
    student.xpTotal = ledger.sumForStudent(studentId);
  }

  it('after quiz submission, reconcile_xp leaves xp_total unchanged', () => {
    const student: SimStudent = { xpTotal: 0 };
    const ledger = new InMemoryLedger();
    const studentId = 'student-reconcile-1';

    const rawXp = calculateQuizXP(8, calculateScorePercent(8, 10)); // 100 XP
    const awarded = computeXpToAward(rawXp, 0);
    simulateAwardXp(student, ledger, studentId, awarded, buildReferenceId('s1'));

    expect(student.xpTotal).toBe(100);

    // reconcile_xp re-derives from ledger — must match
    reconcile(student, ledger, studentId);
    expect(student.xpTotal).toBe(100); // unchanged because ledger was used
  });

  it('multiple quiz submissions: reconcile_xp is idempotent and correct', () => {
    const student: SimStudent = { xpTotal: 0 };
    const ledger = new InMemoryLedger();
    const studentId = 'student-reconcile-2';

    // Three quizzes
    const sessions = [
      { correct: 7, total: 10, sessionId: 'sess-r1' },  // 70 XP
      { correct: 10, total: 10, sessionId: 'sess-r2' }, // 170 XP (but capped)
      { correct: 5, total: 10, sessionId: 'sess-r3' },  // 0 XP (cap exhausted after 170+30)
    ];

    for (const s of sessions) {
      const raw = calculateQuizXP(s.correct, calculateScorePercent(s.correct, s.total));
      const today = ledger.todayQuizXp(studentId);
      const awarded = computeXpToAward(raw, today);
      simulateAwardXp(student, ledger, studentId, awarded, buildReferenceId(s.sessionId));
    }

    // Total awarded capped at 200
    expect(student.xpTotal).toBe(200);

    // reconcile_xp must not change xp_total — ledger matches
    const beforeReconcile = student.xpTotal;
    reconcile(student, ledger, studentId);
    expect(student.xpTotal).toBe(beforeReconcile);
  });

  it('pre-migration scenario: if XP was written without ledger entry, reconcile_xp zeroes it', () => {
    // This documents the HIGH-RISK gap that existed before 20260408000004.
    // Demonstrates why the fix was needed.
    const student: SimStudent = { xpTotal: 170 }; // quiz XP written directly (no ledger)
    const ledger = new InMemoryLedger();            // ledger has NO entry for this quiz
    const studentId = 'student-pre-migration';

    reconcile(student, ledger, studentId);

    // Without ledger entry, reconcile zeroes the student XP — this was the bug
    expect(student.xpTotal).toBe(0);
  });

  it('post-migration scenario: quiz XP in ledger → reconcile_xp is safe', () => {
    const student: SimStudent = { xpTotal: 0 };
    const ledger = new InMemoryLedger();
    const studentId = 'student-post-migration';

    // award_xp inserts ledger entry AND updates xp_total
    const refId = buildReferenceId('safe-session-xyz');
    simulateAwardXp(student, ledger, studentId, 170, refId);

    expect(student.xpTotal).toBe(170);

    reconcile(student, ledger, studentId);
    expect(student.xpTotal).toBe(170); // safe: ledger entry exists
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. add_xp wrapper routes through ledger — xp_ledger_add_xp_routes_through_ledger
//
//    Before migration 20260405300000, add_xp() updated students.xp_total
//    directly without a ledger entry.  After the migration, add_xp() calls
//    award_xp() which writes to xp_transactions first.
//
//    TypeScript-level test: verify the source mapping logic (valid sources
//    pass through, invalid/unknown sources become 'admin_adjustment').
// ════════════════════════════════════════════════════════════════════════════

describe('add_xp source normalisation: valid sources pass through, unknown → admin_adjustment', () => {
  // Mirrors the CASE WHEN logic inside add_xp() SQL function.
  const VALID_SOURCES = new Set([
    'quiz_correct', 'quiz_high_score', 'quiz_perfect',
    'foxy_chat', 'foxy_lesson_complete',
    'streak_daily', 'streak_milestone',
    'topic_mastered', 'chapter_complete',
    'study_task', 'study_week',
    'challenge_win', 'competition_prize',
    'first_quiz_of_day', 'redemption', 'admin_adjustment',
  ]);

  function normalizeAddXpSource(rawSource: string): string {
    if (rawSource === 'unknown') return 'admin_adjustment';
    if (VALID_SOURCES.has(rawSource)) return rawSource;
    return 'admin_adjustment'; // unrecognized → fallback
  }

  it("'unknown' source maps to 'admin_adjustment'", () => {
    expect(normalizeAddXpSource('unknown')).toBe('admin_adjustment');
  });

  it("'quiz_correct' passes through unchanged", () => {
    expect(normalizeAddXpSource('quiz_correct')).toBe('quiz_correct');
  });

  it("'streak_daily' passes through unchanged", () => {
    expect(normalizeAddXpSource('streak_daily')).toBe('streak_daily');
  });

  it("'foxy_chat' passes through unchanged", () => {
    expect(normalizeAddXpSource('foxy_chat')).toBe('foxy_chat');
  });

  it("unrecognized source 'some_other_thing' maps to 'admin_adjustment'", () => {
    expect(normalizeAddXpSource('some_other_thing')).toBe('admin_adjustment');
  });

  it("empty string source maps to 'admin_adjustment'", () => {
    expect(normalizeAddXpSource('')).toBe('admin_adjustment');
  });

  it('all 15 valid sources map to themselves', () => {
    for (const source of VALID_SOURCES) {
      expect(normalizeAddXpSource(source)).toBe(source);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. award_xp daily cap path: p_daily_cap NULL bypasses inner cap check
//
//    In atomic_quiz_profile_update, award_xp is called with p_daily_cap = NULL
//    because the cap is already applied (v_xp_to_award).  This test documents
//    that the outer cap must be applied BEFORE calling award_xp, and that
//    passing a pre-capped amount with p_daily_cap = NULL is the correct pattern.
// ════════════════════════════════════════════════════════════════════════════

describe('award_xp call pattern: outer cap + NULL p_daily_cap avoids double-capping', () => {
  // Simulates what atomic_quiz_profile_update does:
  //   v_xp_to_award = GREATEST(0, LEAST(raw, cap - today))
  //   award_xp(v_xp_to_award, p_daily_cap = NULL)  <-- inner cap bypassed

  function outerCapThenAward(raw: number, todayQuizXp: number): {
    amountPassedToAwardXp: number;
    dailyCapPassedToAwardXp: null;
  } {
    const amountPassedToAwardXp = computeXpToAward(raw, todayQuizXp);
    return {
      amountPassedToAwardXp,
      dailyCapPassedToAwardXp: null, // always null — cap already applied
    };
  }

  it('award_xp receives pre-capped amount, not raw amount', () => {
    const result = outerCapThenAward(170, 150);
    // 200 - 150 = 50 remaining; 170 capped to 50
    expect(result.amountPassedToAwardXp).toBe(50);
    expect(result.dailyCapPassedToAwardXp).toBeNull();
  });

  it('when raw fits within cap, award_xp receives full raw amount', () => {
    const result = outerCapThenAward(100, 0);
    expect(result.amountPassedToAwardXp).toBe(100);
    expect(result.dailyCapPassedToAwardXp).toBeNull();
  });

  it('when cap exhausted, award_xp receives 0 and is skipped', () => {
    const result = outerCapThenAward(50, 200);
    expect(result.amountPassedToAwardXp).toBe(0);
    // In SQL: IF v_xp_to_award > 0 THEN ... END IF
    // award_xp is not called when amount = 0
  });

  it('pattern ensures double-cap does not halve legitimate awards', () => {
    // If award_xp were called with both amount=170 AND p_daily_cap=200 (today=0),
    // it would correctly award 170. But if outer cap already shrunk it to 30
    // (today=170) and inner cap also ran with today's XP, it might double-subtract.
    // The correct pattern: outer cap → amount=30, p_daily_cap=NULL → award 30.
    const todayXp = 170;
    const rawXp = 170;
    const outerCapped = computeXpToAward(rawXp, todayXp); // 30
    expect(outerCapped).toBe(30);

    // With p_daily_cap = NULL, award_xp awards exactly v_actual_award = 30
    // No inner cap check runs (p_daily_cap IS NULL condition in SQL)
    // Final student total: 170 + 30 = 200 ✓
  });
});
