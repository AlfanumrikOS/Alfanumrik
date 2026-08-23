import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SLC-8 (engineering-audit Cycle 3, Student Learning Core) — pin the CURRENT
 * quiz-submit idempotency contract so the eventual server-only cutover is guarded.
 *
 * CURRENT STATE (verified by the audit — this is a PIN, not a fix)
 * ===============================================================
 *   - The live web client `submitQuizResults` (src/lib/supabase.ts) calls
 *     `supabase.rpc('submit_quiz_results_v2', …)` DIRECTLY from the browser with
 *     NO Idempotency-Key (8 params, no p_idempotency_key). Client dedup is an
 *     in-memory Set (lost on reload).
 *   - The hardened server route `/api/quiz/submit` REQUIRES an Idempotency-Key
 *     header (400 otherwise), cross-checks studentId↔JWT, and passes
 *     p_idempotency_key into the RPC for replay short-circuit — but it only runs
 *     as a transparent PASSTHROUGH until `ff_server_only_quiz_submit` flips ON.
 *   - `ff_server_only_quiz_submit` is seeded DEFAULT OFF.
 *   - Double-XP on the direct path is nonetheless blocked by the 7-arg
 *     atomic_quiz_profile_update building reference_id = 'quiz_'||session_id with
 *     ON CONFLICT DO NOTHING (the residual mitigation).
 *
 * WHY PIN, NOT ASSERT-CORRECT
 * ===========================
 * A meaningful "submit is idempotent end-to-end" assertion is NOT feasible today
 * without flipping the flag / driving the server route. So this file pins the
 * CONTRACT AS IT EXISTS — when the cutover lands, these pins flip and force a
 * conscious update. The one behavior we CAN assert today is the residual
 * reference_id dedup that prevents DOUBLE XP on replay (modelled below).
 *
 * TEST-ONLY structural + model pins.
 */

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}

const SUPABASE_TS = '../../packages/lib/src/supabase.ts';
const SUBMIT_ROUTE = 'src/app/api/quiz/submit/route.ts';
const FLAG_SEED =
  'supabase/migrations/20260504100300_server_only_quiz_submit_flag.sql';

// ════════════════════════════════════════════════════════════════════════════
// 1. CURRENT direct-client contract: v2 RPC called WITHOUT an idempotency key.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-8 pin: live client calls submit_quiz_results_v2 directly, no Idempotency-Key', () => {
  const src = read(SUPABASE_TS);

  it('supabase.ts is present and submits via submit_quiz_results_v2 (L1 path)', () => {
    expect(src.length).toBeGreaterThan(0);
    expect(src).toMatch(/rpc\(\s*['"]submit_quiz_results_v2['"]/);
  });

  // PIN FLIPPED 2026-08-11 (Phase 4 resume, owner: backend — exactly the
  // "conscious update" this trip-wire was built to force).
  //
  // The direct L1 path now DOES pass an idempotency key: the server session
  // id itself. That id is a fresh per-session UUID from start_quiz_session,
  // so quiz_sessions' partial unique index on (student_id, idempotency_key)
  // makes "one graded submission per session, forever" a SERVER-enforced
  // invariant — which also closes the section-4 FIXME below about duplicate
  // quiz_sessions ROWS on the keyless path.
  //
  // This was a prerequisite for session resume: without it, the only guard
  // against a resumed tab submitting a second time was the in-memory
  // `_quizDedup` Set, which a page refresh — the exact event resume exists to
  // survive — wipes. It does NOT complete the ff_server_only_quiz_submit
  // cutover (section 2/3 pins below are unchanged); it removes the specific
  // double-submit hazard that blocked resume.
  it('the direct L1 v2 call passes the server session id as p_idempotency_key', () => {
    const flat = src.replace(/\s+/g, ' ');
    const m = flat.match(/rpc\(\s*['"]submit_quiz_results_v2['"]\s*,\s*\{[\s\S]*?p_idempotency_key:[^,}]*/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/p_idempotency_key:\s*sessionId \?\? null/);
  });

  it('client-side dedup is in-memory only (Set), documented as lost on reload', () => {
    expect(src).toMatch(/_quizDedup\s*=\s*new\s+Set/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. The hardened route's STRONGER contract (the cutover target) is intact.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-8 pin: /api/quiz/submit enforces Idempotency-Key + passes it to the RPC', () => {
  const route = read(SUBMIT_ROUTE);

  it('the server-only route exists', () => {
    expect(route.length).toBeGreaterThan(0);
  });

  it('requires an Idempotency-Key header (400 when missing/invalid)', () => {
    expect(route).toMatch(/headers\.get\(\s*['"]idempotency-key['"]\s*\)/i);
    expect(route).toMatch(/IDEMPOTENCY_KEY_REQUIRED/);
    expect(route.replace(/\s+/g, ' ')).toMatch(/status:\s*400/);
  });

  // R9 (2026-08-11): this used to pin `p_idempotency_key: idempotencyKey` —
  // the raw CLIENT header. That pinned the DEFECT. The header is unbound to
  // `sessionId`, so two different client keys on one session were two legal
  // rows under `quiz_sessions_idempotency_key_uniq (student_id,
  // idempotency_key)` → two gradings → double XP (P2), and the resume /
  // `/today` already-graded gates (which look the SESSION ID up in that same
  // column) stopped matching. The route now derives the grading key from the
  // session via `resolveGradingIdempotencyKey`. Behavioural proof lives in
  // src/__tests__/api/quiz-submit-session-bound-idempotency.test.ts.
  it('passes a SESSION-derived p_idempotency_key into submit_quiz_results_v2', () => {
    const flat = route.replace(/\s+/g, ' ');
    expect(flat).toMatch(/rpc\(\s*['"]submit_quiz_results_v2['"][\s\S]*p_idempotency_key:\s*gradingKey/);
    // The grading key comes from the session id, not the request header.
    expect(flat).toMatch(
      /const gradingKey = resolveGradingIdempotencyKey\(\s*body\.sessionId\s*,\s*idempotencyKey\s*\)/,
    );
  });

  it('never forwards the raw client header as the grading key', () => {
    const flat = route.replace(/\s+/g, ' ');
    expect(flat).not.toMatch(/p_idempotency_key:\s*idempotencyKey/);
  });

  it('looks the cached replay row up under the SAME session-derived key', () => {
    // If this SELECT used the header key while the INSERT used the session id,
    // a genuine in-flight retry would 503 instead of replaying.
    const flat = route.replace(/\s+/g, ' ');
    expect(flat).toMatch(/\.eq\(\s*['"]idempotency_key['"]\s*,\s*gradingKey\s*\)/);
  });

  it('runs as a passthrough while ff_server_only_quiz_submit is OFF (cutover not complete)', () => {
    expect(route).toMatch(/isFeatureEnabled\(\s*['"]ff_server_only_quiz_submit['"]/);
    expect(route).toMatch(/quiz_server_submit_passthrough/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. The transition flag is seeded DEFAULT OFF (so the direct path is still live).
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-8 pin: ff_server_only_quiz_submit is seeded default OFF', () => {
  const seed = read(FLAG_SEED).replace(/\s+/g, ' ');

  it('the flag seed migration exists', () => {
    expect(seed.length).toBeGreaterThan(0);
  });

  it("inserts 'ff_server_only_quiz_submit' with is_enabled = false", () => {
    expect(seed).toMatch(/'ff_server_only_quiz_submit',\s*false/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. The ONE guarantee we CAN assert today: the reference_id dedup blocks DOUBLE
//    XP on replay even on the keyless direct path. Models the 7-arg RPC's
//    reference_id = 'quiz_'||session_id + ON CONFLICT DO NOTHING ledger insert.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-8 residual mitigation: reference_id dedup prevents double XP on replay', () => {
  // Mirrors atomic_quiz_profile_update: a per-session reference_id with a partial
  // unique index → the second submit of the same session inserts NO new ledger
  // row and therefore awards NO additional XP.
  function buildReferenceId(sessionId: string): string {
    return `quiz_${sessionId}`;
  }

  class LedgerModel {
    private refs = new Set<string>();
    private total = 0;
    /** returns the XP actually awarded (0 on duplicate reference_id). */
    award(referenceId: string, amount: number): number {
      if (this.refs.has(referenceId)) return 0; // ON CONFLICT DO NOTHING
      this.refs.add(referenceId);
      this.total += amount;
      return amount;
    }
    get xpTotal() {
      return this.total;
    }
  }

  it('same session submitted twice → XP awarded once (no double-count)', () => {
    const ledger = new LedgerModel();
    const ref = buildReferenceId('session-xyz');

    const first = ledger.award(ref, 100);
    const second = ledger.award(ref, 100); // network-retry / double-submit

    expect(first).toBe(100);
    expect(second).toBe(0);
    expect(ledger.xpTotal).toBe(100);
  });

  it('two distinct sessions both award (dedup is per-session, not global)', () => {
    const ledger = new LedgerModel();
    ledger.award(buildReferenceId('s1'), 70);
    ledger.award(buildReferenceId('s2'), 100);
    expect(ledger.xpTotal).toBe(170);
  });

  it("reference_id format is 'quiz_<sessionId>' (matches the SQL builder)", () => {
    expect(buildReferenceId('abc-123')).toBe('quiz_abc-123');
  });

  // RESOLVED 2026-08-11 (Phase 4 resume): the "duplicate quiz_sessions ROW on
  // the keyless direct path" gap is closed WITHOUT waiting for the
  // ff_server_only_quiz_submit cutover. The direct path now supplies
  // p_idempotency_key = the server session id (see section 1), so the v2 RPC's
  // replay short-circuit fires before the INSERT and the partial unique index
  // on (student_id, idempotency_key) backstops any race. The model below pins
  // that behaviour.
  it('a replayed session returns the cached row instead of inserting a second one', () => {
    // Mirrors submit_quiz_results_v2's Phase 2.8 short-circuit: look up
    // (student_id, idempotency_key) first; on a hit, return the cached shape
    // with idempotent_replay: true and INSERT nothing.
    const sessions: Array<{ id: string; studentId: string; key: string; xp: number }> = [];
    function submit(studentId: string, key: string, xp: number) {
      const existing = sessions.find(s => s.studentId === studentId && s.key === key);
      if (existing) return { session_id: existing.id, xp_earned: existing.xp, idempotent_replay: true };
      const row = { id: `qs-${sessions.length + 1}`, studentId, key, xp };
      sessions.push(row);
      return { session_id: row.id, xp_earned: xp, idempotent_replay: false };
    }

    const first = submit('student-1', 'session-xyz', 90);
    const second = submit('student-1', 'session-xyz', 90); // resumed tab / retry

    expect(first.idempotent_replay).toBe(false);
    expect(second.idempotent_replay).toBe(true);
    expect(second.session_id).toBe(first.session_id);
    expect(sessions).toHaveLength(1); // exactly ONE quiz_sessions row
  });
});
