/**
 * SLC-4 (engineering-audit remediation) — Fallback Daily-Cap Alignment (P2).
 *
 * THE FIX (src/lib/supabase.ts, submitQuizResults client-side fallback ~544-606)
 * ============================================================================
 * The quiz-submit fallback's atomic-RPC call was repointed from the BROKEN
 * 6-param JSONB overload of `atomic_quiz_profile_update` — whose daily-cap read
 * referenced a NON-EXISTENT `quiz_sessions.xp_earned` column, raised Postgres
 * 42703 at runtime, and let the catch silently degrade to an UNCAPPED
 * `student_learning_profiles` upsert (so the fallback enforced NO 200/day cap and
 * could award a SECOND 200 on top of the primary path → up to 400/day, a P2
 * breach) — to the CANONICAL 7-param VOID overload. Passing
 * `p_session_id: session?.id ?? null` is what forces PostgREST to resolve the
 * void, ledger-based, IST-boundary, 200/day-CAPPED writer — the SAME writer the
 * primary v2 path uses.
 *
 * The void overload returns no JSONB, so the over-cap UI display (`effective_xp`
 * / `xp_capped`) is RE-DERIVED by reading back the AUTHORITATIVE `xp_transactions`
 * ledger row (`reference_id = 'quiz_<session>'`, `.maybeSingle()`):
 *   effectiveXp = ledgerRow.amount;  xpCapped = effectiveXp < xpEarnedUncapped;
 * It is NEVER a client recompute of XP from the correct-count.
 *
 * The degraded uncapped upsert is now reached ONLY on a GENUINE RPC failure
 * (`if (rpcErr) throw rpcErr`), not the old 42703 missing-column path.
 *
 * WHY SOURCE-PIN (+ a MODELLED behavioral arm)
 * ============================================
 * Driving the real `submitQuizResults` fallback needs a full stateful mock of the
 * browser supabase client (rpc + from().insert().select().single() +
 * from().select().eq().maybeSingle()) across primary AND fallback. The repo
 * convention for THIS exact path is the source-pin + ledger-model approach used
 * by `quiz-submit-idempotency-contract-pin.test.ts` and the parity-pin approach
 * of `lib/xp-daily-cap.test.ts`. We mirror both: comment-stripped SOURCE pins
 * that prove the fix is wired (and the broken shape is gone), plus a MODELLED
 * cap arm proving primary+fallback can never exceed 200/day. If the fix is ever
 * reverted, the source pins fail — that is the intended trip-wire.
 *
 * TEST-ONLY structural + model pins. Does NOT modify supabase.ts.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { XP_RULES } from '@alfanumrik/lib/xp-config';

// ─────────────────────────────────────────────────────────────────────
// Helpers: locate + comment-strip the source so prose mentioning the
// "6-param" overload / `atomic_quiz_profile_update` in comments cannot
// produce false matches. We must read CODE, not documentation.
// ─────────────────────────────────────────────────────────────────────
function resolveRepo(rel: string): string {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return resolve(process.cwd(), rel);
}

/** Strip /* *\/ block comments and // line comments (preserving `http://`). */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove // line comments but not the // in protocol-relative/URL contexts.
  return noBlock
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Isolate the submitQuizResults function body (so pins are scoped to it). */
function extractSubmitFn(code: string): string {
  const start = code.indexOf('export async function submitQuizResults');
  expect(start).toBeGreaterThan(-1);
  // The next top-level `export ` after the function start bounds it.
  const after = code.indexOf('\nexport ', start + 1);
  return after > -1 ? code.slice(start, after) : code.slice(start);
}

const SUPABASE_TS = 'src/lib/supabase.ts';
const rawSrc = readFileSync(resolveRepo(SUPABASE_TS), 'utf8');
const code = stripComments(rawSrc);
const submitFn = extractSubmitFn(code);
// Whitespace-flattened view for multi-line object/arg matching.
const flatSubmit = submitFn.replace(/\s+/g, ' ');

// ════════════════════════════════════════════════════════════════════════════
// 1. SOURCE PIN — the fallback RPC resolves to the 7-param VOID overload.
//    The call MUST carry p_session_id (the 7th param). The broken 6-param JSONB
//    shape (no p_session_id) MUST be gone from the submit path.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4 source pin: fallback routes through the 7-param capped void overload', () => {
  it('submitQuizResults is present and contains an atomic_quiz_profile_update fallback call', () => {
    expect(submitFn.length).toBeGreaterThan(0);
    expect(submitFn).toMatch(/rpc\(\s*['"]atomic_quiz_profile_update['"]/);
  });

  it('the fallback atomic_quiz_profile_update call passes p_session_id (forces the void overload)', () => {
    // Isolate the rpc('atomic_quiz_profile_update', { ... }) argument object and
    // assert p_session_id is present inside it.
    const m = flatSubmit.match(
      /rpc\(\s*['"]atomic_quiz_profile_update['"]\s*,\s*\{[^}]*\}/,
    );
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/p_session_id\s*:/);
    // It is routed off the just-inserted session row, not a fabricated id.
    expect(m![0]).toMatch(/p_session_id\s*:\s*session\?\.id\s*\?\?\s*null/);
  });

  it('every atomic_quiz_profile_update call in the submit path carries p_session_id (no bare 6-param shape)', () => {
    // There must be NO atomic_quiz_profile_update rpc invocation whose argument
    // object lacks p_session_id — that would be the broken JSONB overload.
    const calls = [
      ...flatSubmit.matchAll(
        /rpc\(\s*['"]atomic_quiz_profile_update['"]\s*,\s*(\{[^}]*\})/g,
      ),
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c[1]).toMatch(/p_session_id\s*:/);
    }
  });

  it('the canonical 7 named params are all present (p_student_id, p_subject, p_xp, p_total, p_correct, p_time_seconds, p_session_id)', () => {
    const m = flatSubmit.match(
      /rpc\(\s*['"]atomic_quiz_profile_update['"]\s*,\s*(\{[^}]*\})/,
    );
    expect(m).not.toBeNull();
    for (const param of [
      'p_student_id',
      'p_subject',
      'p_xp',
      'p_total',
      'p_correct',
      'p_time_seconds',
      'p_session_id',
    ]) {
      expect(m![1]).toMatch(new RegExp(`${param}\\s*:`));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. SOURCE PIN — over-cap display is RE-DERIVED from the xp_transactions ledger
//    row, never recomputed client-side from the correct-count.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4 source pin: effective_xp / xp_capped re-derived from the authoritative ledger row', () => {
  it('reads back xp_transactions filtered by reference_id = `quiz_${session.id}` via maybeSingle()', () => {
    expect(flatSubmit).toMatch(/from\(\s*['"]xp_transactions['"]\s*\)/);
    expect(flatSubmit).toMatch(/\.select\(\s*['"]amount['"]\s*\)/);
    // reference_id eq filter built from the session id.
    expect(flatSubmit).toMatch(
      /\.eq\(\s*['"]reference_id['"]\s*,\s*`quiz_\$\{session\.id\}`\s*\)/,
    );
    expect(flatSubmit).toMatch(/\.maybeSingle\(\)/);
  });

  it('effectiveXp is taken from the ledger row amount, not a client XP recompute', () => {
    expect(flatSubmit).toMatch(/effectiveXp\s*=\s*ledgerRow\.amount/);
    // xpCapped is derived by comparing the ledger amount to the uncapped value.
    expect(flatSubmit).toMatch(/xpCapped\s*=\s*effectiveXp\s*<\s*xpEarnedUncapped/);
  });

  it('the returned xp_earned surfaces the ledger-derived effectiveXp (not xpEarnedUncapped)', () => {
    expect(flatSubmit).toMatch(/xp_earned\s*:\s*effectiveXp/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. SOURCE PIN — the degraded uncapped upsert is reached ONLY on a genuine RPC
//    failure (`if (rpcErr) throw rpcErr`), not the old swallowed 42703.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4 source pin: degraded uncapped upsert is gated behind a real RPC failure', () => {
  it('the rpc error is re-thrown (if (rpcErr) throw rpcErr) so success never falls through to the uncapped path', () => {
    expect(flatSubmit).toMatch(/if\s*\(\s*rpcErr\s*\)\s*throw\s+rpcErr/);
  });

  it('the last-resort path is an upsert on student_learning_profiles inside the catch (degraded, documented)', () => {
    expect(flatSubmit).toMatch(
      /from\(\s*['"]student_learning_profiles['"]\s*\)\s*\.upsert/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. CAP VALUE UNCHANGED — guard against accidental cap drift. SLC-4 is alignment
//    only: the 200/day value must NOT move.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4: the 200 XP/day cap value is unchanged (alignment only, not a cap change)', () => {
  it('XP_RULES.quiz_daily_cap is still exactly 200', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. BEHAVIORAL (MODELLED) — primary + fallback can never award more than the
//    200/day cap. Models BOTH paths flowing through the SAME ledger writer:
//    a per-day SUM(amount) clamp on xp_transactions. This is the property the
//    SLC-4 repoint restores (the broken 6-param path bypassed this clamp).
//
//    NOTE: the real submitQuizResults fallback requires a full stateful supabase
//    client mock to drive end-to-end; per repo convention for this path
//    (quiz-submit-idempotency-contract-pin.test.ts) the behavioral arm is
//    MODELLED against the SQL clamp semantics rather than the live client. The
//    source pins in §1-§3 prove the fallback is actually wired to this writer.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-4 modelled behavior: primary + fallback both flow through the capped ledger writer', () => {
  const CAP = XP_RULES.quiz_daily_cap; // 200

  // Mirrors atomic_quiz_profile_update's IST-day clamp:
  //   v_remaining    := GREATEST(0, cap - SUM(amount today));
  //   v_effective_xp := LEAST(GREATEST(0, p_xp), v_remaining);
  // and the reference_id ON CONFLICT DO NOTHING idempotency.
  class CappedLedgerWriter {
    private byRef = new Map<string, number>();
    private earnedToday = 0;
    /** Returns the XP actually written (clamped to the daily remainder; 0 on replay). */
    award(referenceId: string, requestedXp: number): number {
      if (this.byRef.has(referenceId)) return 0; // ON CONFLICT DO NOTHING
      const remaining = Math.max(0, CAP - this.earnedToday);
      const effective = Math.min(Math.max(0, requestedXp), remaining);
      this.byRef.set(referenceId, effective);
      this.earnedToday += effective;
      return effective;
    }
    get totalToday() {
      return this.earnedToday;
    }
  }

  it('a single 170-XP quiz writes 170 (room available)', () => {
    const ledger = new CappedLedgerWriter();
    expect(ledger.award('quiz_s1', 170)).toBe(170);
    expect(ledger.totalToday).toBe(170);
  });

  it('primary 200 then a fallback-path quiz cannot push the day past 200 (no second 200 award)', () => {
    const ledger = new CappedLedgerWriter();
    // Primary path already maxed the day.
    expect(ledger.award('quiz_primary', 200)).toBe(200);
    // A later quiz that degrades to the fallback path routes through the SAME
    // capped writer (the SLC-4 repoint) → it can award at most the remainder (0).
    expect(ledger.award('quiz_fallback', 170)).toBe(0);
    expect(ledger.totalToday).toBe(200); // NOT 370/400 (the pre-fix bug)
  });

  it('199 earned + a quiz worth 50 via the fallback path awards exactly 1 (partial remainder, not the full 50, not 0)', () => {
    const ledger = new CappedLedgerWriter();
    expect(ledger.award('quiz_a', 199)).toBe(199);
    expect(ledger.award('quiz_fallback', 50)).toBe(1);
    expect(ledger.totalToday).toBe(200);
  });

  it('same session replayed (network retry) via the fallback awards 0 the second time (reference_id idempotency)', () => {
    const ledger = new CappedLedgerWriter();
    expect(ledger.award('quiz_dup', 100)).toBe(100);
    expect(ledger.award('quiz_dup', 100)).toBe(0);
    expect(ledger.totalToday).toBe(100);
  });

  it('REGRESSION: the pre-SLC-4 uncapped fallback would have allowed up to 400/day — the capped writer forbids it', () => {
    // Pre-fix: the 6-param overload hit 42703 and the catch did an UNCAPPED
    // upsert, so primary (200) + fallback (200) = 400. Model that the capped
    // writer the fallback now uses caps the SECOND award to the remainder (0).
    const ledger = new CappedLedgerWriter();
    ledger.award('quiz_primary', 200);
    const fallbackAward = ledger.award('quiz_fallback', 200);
    expect(fallbackAward).toBeLessThan(200);
    expect(ledger.totalToday).toBeLessThanOrEqual(CAP);
  });
});
