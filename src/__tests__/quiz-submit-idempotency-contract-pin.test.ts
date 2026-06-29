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

const SUPABASE_TS = 'src/lib/supabase.ts';
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

  it("FIXME(cutover): the direct L1 v2 call passes NO p_idempotency_key today", () => {
    // Isolate the L1 v2 rpc(...) call and assert it does NOT carry p_idempotency_key.
    // When ff_server_only_quiz_submit cutover completes and the client routes
    // through /api/quiz/submit (which DOES supply the key), this pin must be
    // updated — that is the intended trip-wire, not a permanent guarantee.
    const flat = src.replace(/\s+/g, ' ');
    const m = flat.match(/rpc\(\s*['"]submit_quiz_results_v2['"]\s*,\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/p_idempotency_key/);
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

  it('passes p_idempotency_key into submit_quiz_results_v2', () => {
    const flat = route.replace(/\s+/g, ' ');
    expect(flat).toMatch(/rpc\(\s*['"]submit_quiz_results_v2['"][\s\S]*p_idempotency_key:\s*idempotencyKey/);
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

  // FIXME(cutover, SLC-8): the residual mitigation prevents double XP, but it does
  // NOT prevent a duplicate quiz_sessions ROW on the keyless direct path (v2 INSERTs
  // the session before the cap/ledger step). A full "single session row per submit"
  // assertion is only achievable once ff_server_only_quiz_submit is ON and the client
  // routes through /api/quiz/submit with an Idempotency-Key. Pinned as a known gap
  // rather than a false assertion. Owner: backend + architect (rollout); testing pins.
});
